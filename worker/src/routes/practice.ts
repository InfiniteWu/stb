/**
 * 练习 API
 *
 *   POST /api/practice/pick        按题型抽题
 *   POST /api/practice/pick-wrong  从错题本抽题
 *   POST /api/practice/submit      提交并服务端判分
 *
 * 重要契约变更：抽题接口**不再返回 answer / explanation**。
 * 旧实现把正确答案随题下发（因为判分在前端），任何人打开开发者工具即可看到答案。
 * 现在判分在服务端，复习时才通过 /api/sessions/:id 返回答案与解析。
 */

import { Hono } from 'hono';
import type { AppBindings, QuestionType } from '../types';
import { badRequest, readJson } from '../lib/json';
import {
  gradeAnswer,
  isUnanswered,
  normalizeSelected,
  parseCorrectAnswer,
  serializeSelected,
} from '../lib/grade';
import { applyPermutation, shuffleIndices, signPermutation, unmapSelection, verifyPermutation } from '../lib/shuffle';
import { QUESTION_TYPES } from '../lib/validate';
import { nowStamp } from '../lib/time';
import { parseIntId } from '../lib/ids';
import { currentAuth, csrfGuard, requireLogin } from '../middleware/auth';

export const practiceRoutes = new Hono<AppBindings>();

/** 单次抽题的题目数上限 */
const MAX_PICK_TOTAL = 100;
/**
 * 提交时单次作答的题目数上限。
 *
 * 作答明细用单次 db.batch() 写入。据 D1 文档，batch 是「一次调用」，
 * 内部语句顺序执行且整体构成一个事务 —— 因此 100 条 INSERT 只占 1 次调用，
 * 不会触及免费版每次 Worker 调用 50 次查询的额度；同时它还保证原子性：
 * 要么全部写入，要么整体回滚。
 *
 * 若线上出现 1102 或查询额度相关错误，优先下调此值，而不是改成逐条写入。
 */
const MAX_SUBMIT_ANSWERS = 100;
/** 置换签名密钥（与 KDF 密钥复用同一 secret，用途已由消息前缀区分） */
function shuffleSecret(env: AppBindings['Bindings']): string {
  return (env.SERVER_KDF_SECRET ?? 'dev-only-insecure-kdf-secret') + ':shuffle';
}

/** 抽题时下发的题目形状：不含答案与解析 */
interface PickedQuestion {
  id: number;
  bank_id: number;
  type: QuestionType;
  stem: string;
  options: string[];
  shuffle_token?: string;
}

interface RawQuestion {
  id: number;
  bank_id: number;
  type: QuestionType;
  stem: string;
  options: string;
  answer: string;
  explanation: string | null;
}

function parseCount(raw: unknown, fallback = 0): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

/** 构造下发给客户端的题目；shuffle 时重排选项并附签名置换 token */
async function toPickedQuestion(
  q: RawQuestion,
  secret: string,
  shuffle: boolean,
): Promise<PickedQuestion> {
  let options: string[];
  try {
    const parsed = JSON.parse(q.options);
    options = Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    options = [];
  }

  const base: PickedQuestion = {
    id: q.id,
    bank_id: q.bank_id,
    type: q.type,
    stem: q.stem,
    options,
  };

  if (!shuffle || options.length < 2) return base;

  const perm = shuffleIndices(options.length);
  base.options = applyPermutation(options, perm);
  base.shuffle_token = await signPermutation(secret, q.id, perm);

  return base;
}

// ── 抽题 ─────────────────────────────────────────────────────
practiceRoutes.post('/pick', csrfGuard, requireLogin, async (c) => {
  const body = await readJson<Record<string, unknown>>(c);

  const bankId = parseIntId(String(body.bank_id ?? ''));
  if (bankId === null) throw badRequest('缺少题库 ID');

  const bank = await c.env.DB.prepare('SELECT id FROM question_banks WHERE id = ?')
    .bind(bankId)
    .first();
  if (!bank) throw badRequest('题库不存在', 'BANK_NOT_FOUND');

  const wanted: Array<{ type: QuestionType; count: number }> = QUESTION_TYPES.map((type) => ({
    type,
    count: parseCount(body[`${type}_count`], 0),
  }));

  const totalWanted = wanted.reduce((sum, w) => sum + w.count, 0);
  if (totalWanted <= 0) throw badRequest('请至少选择一道题目');
  if (totalWanted > MAX_PICK_TOTAL) {
    throw badRequest(`单次最多抽取 ${MAX_PICK_TOTAL} 道题`);
  }

  const shuffle = body.shuffle_options === true;
  const secret = shuffleSecret(c.env);
  const questions: PickedQuestion[] = [];

  // 每种题型一次查询；免费版每请求 50 次查询额度，这里最多 3 次
  for (const { type, count } of wanted) {
    if (count === 0) continue;

    const { results } = await c.env.DB.prepare(
      'SELECT * FROM questions WHERE bank_id = ? AND type = ? ORDER BY RANDOM() LIMIT ?',
    )
      .bind(bankId, type, count)
      .all<RawQuestion>();

    for (const row of results ?? []) {
      questions.push(await toPickedQuestion(row, secret, shuffle));
    }
  }

  if ((body.mode ?? 'random') === 'random') {
    for (let i = questions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = questions[i]!;
      questions[i] = questions[j]!;
      questions[j] = tmp;
    }
  }

  return c.json({
    bank_id: bankId,
    questions,
    total: questions.length,
    mode: (body.mode ?? 'random') === 'random' ? 'random' : 'sequential',
  });
});

// ── 从错题本抽题 ─────────────────────────────────────────────
practiceRoutes.post('/pick-wrong', csrfGuard, requireLogin, async (c) => {
  const { user } = currentAuth(c);
  const body = await readJson<Record<string, unknown>>(c);

  const count = Math.min(Math.max(parseCount(body.count, 10) || 10, 1), MAX_PICK_TOTAL);

  // 旧实现用 `if ($bankId)` 判断，使 bank_id=0 被当作「未提供」而静默忽略；
  // 这里显式区分 undefined 与非法值。
  const conditions = ["wb.user_id = ?", "wb.status = 'active'"];
  const params: unknown[] = [user.id];

  if (body.bank_id !== undefined && body.bank_id !== null) {
    const bankId = parseIntId(String(body.bank_id));
    if (bankId === null) throw badRequest('bank_id 不合法');
    conditions.push('wb.bank_id = ?');
    params.push(bankId);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT q.* FROM wrong_book wb
     JOIN questions q ON wb.question_id = q.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY RANDOM() LIMIT ?`,
  )
    .bind(...params, count)
    .all<RawQuestion>();

  const secret = shuffleSecret(c.env);
  const questions: PickedQuestion[] = [];
  for (const row of results ?? []) {
    questions.push(await toPickedQuestion(row, secret, false));
  }

  return c.json({ questions, total: questions.length, mode: 'wrongbook' });
});

// ── 提交 ─────────────────────────────────────────────────────
//
// 契约：{ mode, answers: [{ question_id, selected, shuffle_token? }] }
// 不再接受 bank_id 与 is_correct —— bank 由题目自行推导，对错由服务端裁定。
practiceRoutes.post('/submit', csrfGuard, requireLogin, async (c) => {
  const { user } = currentAuth(c);
  const body = await readJson<Record<string, unknown>>(c);

  const rawAnswers = body.answers;
  if (!Array.isArray(rawAnswers) || rawAnswers.length === 0) {
    throw badRequest('缺少作答数据');
  }
  if (rawAnswers.length > MAX_SUBMIT_ANSWERS) {
    throw badRequest(`单次最多提交 ${MAX_SUBMIT_ANSWERS} 道题`);
  }

  const modeRaw = typeof body.mode === 'string' ? body.mode : 'random';
  const mode = ['random', 'wrongbook', 'sequential'].includes(modeRaw) ? modeRaw : 'random';

  // 解析作答项，收集题目 ID
  const items = rawAnswers.map((raw) => {
    const a = (raw ?? {}) as Record<string, unknown>;
    const qid = parseIntId(String(a.question_id ?? ''));
    if (qid === null) throw badRequest('question_id 不合法');
    return {
      questionId: qid,
      selected: normalizeSelected(a.selected),
      shuffleToken: typeof a.shuffle_token === 'string' ? a.shuffle_token : null,
    };
  });

  // 一次查询取回所有题目，而不是旧实现那样每题查一次
  // （旧实现 20 题要 ~60 次查询，免费版每请求仅 50 次额度）
  const uniqueIds = [...new Set(items.map((i) => i.questionId))];
  const placeholders = uniqueIds.map(() => '?').join(',');
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM questions WHERE id IN (${placeholders})`,
  )
    .bind(...uniqueIds)
    .all<RawQuestion>();

  const questionById = new Map<number, RawQuestion>();
  for (const q of results ?? []) questionById.set(q.id, q);

  const secret = shuffleSecret(c.env);

  let correctCount = 0;
  let wrongCount = 0;
  let unansweredCount = 0;

  // 先算出每题的判定结果与收敛后的「原始下标答案」
  const graded: Array<{
    questionId: number;
    selectedJson: string | null;
    correctJson: string;
    isCorrect: number | null;
    answered: boolean;
    bankId: number;
  }> = [];

  for (const item of items) {
    const q = questionById.get(item.questionId);
    if (!q) continue; // 题目已被删除，跳过

    const correct = parseCorrectAnswer(q.answer);
    if (correct === null) continue;

    let selected = item.selected;

    // 若抽题时打乱了选项，先把选择映射回原始下标
    if (item.shuffleToken) {
      let optionCount = 0;
      try {
        const parsed = JSON.parse(q.options);
        optionCount = Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        optionCount = 0;
      }
      const perm = await verifyPermutation(secret, q.id, item.shuffleToken, optionCount);
      if (!perm) throw badRequest('选项乱序凭证不合法', 'BAD_SHUFFLE_TOKEN');
      if (!isUnanswered(selected)) {
        selected = unmapSelection(selected as number | number[], perm);
      }
    }

    const answered = !isUnanswered(selected);
    const isCorrect = gradeAnswer(q.type, correct, selected);

    if (!answered) unansweredCount++;
    else if (isCorrect) correctCount++;
    else wrongCount++;

    graded.push({
      questionId: q.id,
      selectedJson: serializeSelected(selected),
      correctJson: JSON.stringify(correct),
      isCorrect: answered ? (isCorrect ? 1 : 0) : null,
      answered,
      bankId: q.bank_id,
    });
  }

  if (graded.length === 0) throw badRequest('没有可判分的题目');

  const total = graded.length;

  // 会话归属题库：单一题库则记该库；跨题库错题练习则记 NULL
  const bankIds = [...new Set(graded.map((g) => g.bankId))];
  const sessionBankId = bankIds.length === 1 ? bankIds[0]! : null;

  const submittedAt = nowStamp();
  const sessionResult = await c.env.DB.prepare(
    `INSERT INTO practice_sessions
       (user_id, bank_id, mode, total_count, correct_count, wrong_count, unanswered_count, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      user.id,
      sessionBankId,
      mode,
      total,
      correctCount,
      wrongCount,
      unansweredCount,
      submittedAt,
    )
    .run();

  const sessionId = sessionResult.meta.last_row_id;

  // 作答明细批量写入（单个 batch 往返）
  await c.env.DB.batch(
    graded.map((g) =>
      c.env.DB.prepare(
        `INSERT INTO practice_answers
           (session_id, question_id, selected_answer, correct_answer, is_correct)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(sessionId, g.questionId, g.selectedJson, g.correctJson, g.isCorrect),
    ),
  );

  // ── 错题本维护 ──
  const wrongQuestionIds = graded.filter((g) => g.answered && g.isCorrect === 0).map((g) => g.questionId);
  const correctQuestionIds = graded.filter((g) => g.answered && g.isCorrect === 1).map((g) => g.questionId);

  const bankOf = new Map(graded.map((g) => [g.questionId, g.bankId]));

  // 答错 → 加入/重新激活错题本
  //
  // 旧实现用 INSERT OR IGNORE：由于 UNIQUE(user_id, question_id, bank_id)，
  // 曾因连续答对而自动移出的题目（status='removed'）永远不会再被加回来，
  // 这是错题本最实质的一个 bug。这里用 UPSERT 显式重置为 active。
  if (wrongQuestionIds.length > 0) {
    await c.env.DB.batch(
      wrongQuestionIds.map((qid) =>
        c.env.DB.prepare(
          `INSERT INTO wrong_book (user_id, question_id, bank_id, status, added_at, removed_at)
           VALUES (?, ?, ?, 'active', ?, NULL)
           ON CONFLICT (user_id, question_id, bank_id)
           DO UPDATE SET status = 'active', added_at = excluded.added_at, removed_at = NULL`,
        ).bind(user.id, qid, bankOf.get(qid)!, submittedAt),
      ),
    );
  }

  // 连续答对 5 次 → 自动移出错题本
  //
  // 旧实现对每道题各查一次「最近 5 次作答」，20 题就是 20+ 次查询。
  // 免费版每请求只有 50 次查询额度，这里改用一条窗口函数查询一次性算出
  // 所有「最近 5 次全对」的题目，再一条 batch 更新。
  if (correctQuestionIds.length > 0) {
    const inList = correctQuestionIds.map(() => '?').join(',');
    const eligible = await c.env.DB.prepare(
      `SELECT question_id
       FROM (
         SELECT pa.question_id AS question_id,
                pa.is_correct  AS is_correct,
                ROW_NUMBER() OVER (PARTITION BY pa.question_id ORDER BY pa.id DESC) AS rn
         FROM practice_answers pa
         JOIN practice_sessions ps ON pa.session_id = ps.id
         WHERE ps.user_id = ? AND pa.question_id IN (${inList})
       )
       WHERE rn <= 5
       GROUP BY question_id
       HAVING COUNT(*) = 5 AND SUM(is_correct) = 5`,
    )
      .bind(user.id, ...correctQuestionIds)
      .all<{ question_id: number }>();

    const toRemove = (eligible.results ?? []).map((r) => r.question_id);
    if (toRemove.length > 0) {
      const removeList = toRemove.map(() => '?').join(',');
      await c.env.DB.prepare(
        `UPDATE wrong_book SET status = 'removed', removed_at = ?
         WHERE user_id = ? AND status = 'active' AND question_id IN (${removeList})`,
      )
        .bind(submittedAt, user.id, ...toRemove)
        .run();
    }
  }

  const accuracy = total > 0 ? correctCount / total : 0;

  return c.json({
    session_id: sessionId,
    total_count: total,
    correct_count: correctCount,
    wrong_count: wrongCount,
    unanswered_count: unansweredCount,
    accuracy,
    submitted_at: submittedAt,
  });
});
