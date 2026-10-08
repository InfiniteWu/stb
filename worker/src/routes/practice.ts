/**
 * 练习 API
 *
 *   POST /api/practice/pick        按题型抽题（only_unanswered=true 时只抽未答过的题）
 *   POST /api/practice/pick-wrong  从错题本抽题
 *   POST /api/practice/submit      提交并服务端判分（作答过的题记入答题状态）
 *   GET  /api/practice/state       答题状态：?bank_id=N 查单库明细（含各题型），缺省查全库汇总
 *   POST /api/practice/state/clear 清空某库的答题状态
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
import { requireKdfSecret } from '../lib/password';
import { currentAuth, csrfGuard, requireLogin } from '../middleware/auth';

export const practiceRoutes = new Hono<AppBindings>();

/**
 * D1 单条查询最多 100 个绑定参数（见 D1 Limits），IN (...) 必须分片。
 * 写入 batch 则按此大小分批，既避开超大 batch 的体积/耗时风险，
 * 又把查询次数控制在免费版每次调用 50 次额度内（当前最大题库 1376 题约 44 次）。
 */
const IN_CHUNK_SIZE = 100;
const WRITE_CHUNK_SIZE = 100;
/** 带 user_id 占 1 个参数的 IN 查询分片大小（N + 1 <= 100） */
const IN_CHUNK_WITH_USER = 99;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
/**
 * 置换签名密钥。与 KDF 密钥复用同一个 secret，用途已由消息前缀区分；
 * 缺失时同样直接报错，不做静默降级（见 requireKdfSecret）。
 */
function shuffleSecret(env: AppBindings['Bindings']): string {
  return requireKdfSecret(env) + ':shuffle';
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
  const { user } = currentAuth(c);
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

  // 仅未答：排除该用户已作答过的题目（子查询不占绑定参数名额）
  const onlyUnanswered = body.only_unanswered === true;
  const shuffle = body.shuffle_options === true;
  const secret = shuffleSecret(c.env);
  const questions: PickedQuestion[] = [];

  // 每种题型一次查询；免费版每请求 50 次查询额度，这里最多 3 次
  for (const { type, count } of wanted) {
    if (count === 0) continue;

    const sql = onlyUnanswered
      ? `SELECT * FROM questions
          WHERE bank_id = ? AND type = ?
            AND id NOT IN (SELECT question_id FROM user_question_state WHERE user_id = ?)
          ORDER BY RANDOM() LIMIT ?`
      : 'SELECT * FROM questions WHERE bank_id = ? AND type = ? ORDER BY RANDOM() LIMIT ?';
    const binds = onlyUnanswered ? [bankId, type, user.id, count] : [bankId, type, count];

    const { results } = await c.env.DB.prepare(sql).bind(...binds).all<RawQuestion>();

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

  const count = Math.max(parseCount(body.count, 10) || 10, 1);

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

  // 按题目 ID 取回题目：D1 单条查询最多 100 个绑定参数，
  // 超过 100 题时必须分片查询（旧的 100 题上限正好卡在这个边界上）。
  const uniqueIds = [...new Set(items.map((i) => i.questionId))];
  const questionById = new Map<number, RawQuestion>();
  for (const idChunk of chunk(uniqueIds, IN_CHUNK_SIZE)) {
    const placeholders = idChunk.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM questions WHERE id IN (${placeholders})`,
    )
      .bind(...idChunk)
      .all<RawQuestion>();
    for (const q of results ?? []) questionById.set(q.id, q);
  }

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

    // 未作答按答错处理：计入 wrong_count，并进入错题本。
    // unansweredCount 仍单独统计 —— 它现在是「错误」的子集（其中几道是没答的），
    // 所以「正确 + 错误 = 总题数」依然成立，界面把它显示为「其中未答」。
    if (!answered) unansweredCount++;
    if (answered && isCorrect) correctCount++;
    else wrongCount++;

    graded.push({
      questionId: q.id,
      selectedJson: serializeSelected(selected),
      correctJson: JSON.stringify(correct),
      // 未作答也记 0（旧实现记 null）。历史数据里的 null 仍按「未作答」读，
      // 详情页因此改为依据 selected_answer 是否为空来判断，不再依赖 is_correct。
      isCorrect: answered && isCorrect ? 1 : 0,
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

  // 作答明细分批 batch 写入（每批 100 条，兼顾 batch 体积与查询次数）
  for (const gChunk of chunk(graded, WRITE_CHUNK_SIZE)) {
    await c.env.DB.batch(
      gChunk.map((g) =>
        c.env.DB.prepare(
          `INSERT INTO practice_answers
             (session_id, question_id, selected_answer, correct_answer, is_correct)
           VALUES (?, ?, ?, ?, ?)`,
        ).bind(sessionId, g.questionId, g.selectedJson, g.correctJson, g.isCorrect),
      ),
    );
  }

  // ── 错题本维护 ──
  // isCorrect 现在只有 0 / 1 两种取值（未作答记 0），所以未作答会一并进错题本
  const wrongQuestionIds = graded.filter((g) => g.isCorrect === 0).map((g) => g.questionId);
  const correctQuestionIds = graded.filter((g) => g.isCorrect === 1).map((g) => g.questionId);

  const bankOf = new Map(graded.map((g) => [g.questionId, g.bankId]));

  // 答错 → 加入/重新激活错题本
  //
  // 旧实现用 INSERT OR IGNORE：由于 UNIQUE(user_id, question_id, bank_id)，
  // 曾因连续答对而自动移出的题目（status='removed'）永远不会再被加回来，
  // 这是错题本最实质的一个 bug。这里用 UPSERT 显式重置为 active。
  if (wrongQuestionIds.length > 0) {
    for (const qidChunk of chunk(wrongQuestionIds, WRITE_CHUNK_SIZE)) {
      await c.env.DB.batch(
        qidChunk.map((qid) =>
          c.env.DB.prepare(
            `INSERT INTO wrong_book (user_id, question_id, bank_id, status, added_at, removed_at)
             VALUES (?, ?, ?, 'active', ?, NULL)
             ON CONFLICT (user_id, question_id, bank_id)
             DO UPDATE SET status = 'active', added_at = excluded.added_at, removed_at = NULL`,
          ).bind(user.id, qid, bankOf.get(qid)!, submittedAt),
        ),
      );
    }
  }

  // 连续答对 5 次 → 自动移出错题本
  //
  // 旧实现对每道题各查一次「最近 5 次作答」，20 题就是 20+ 次查询。
  // 这里用窗口函数查询按 IN 分片批量算出所有「最近 5 次全对」的题目，
  // 再分片更新（IN 含 user_id 等固定参数，同样受 100 绑定参数限制）。
  if (correctQuestionIds.length > 0) {
    const toRemove: number[] = [];
    for (const idChunk of chunk(correctQuestionIds, IN_CHUNK_WITH_USER)) {
      const inList = idChunk.map(() => '?').join(',');
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
        .bind(user.id, ...idChunk)
        .all<{ question_id: number }>();
      for (const r of eligible.results ?? []) toRemove.push(r.question_id);
    }
    if (toRemove.length > 0) {
      for (const rmChunk of chunk(toRemove, IN_CHUNK_WITH_USER - 1)) {
        const removeList = rmChunk.map(() => '?').join(',');
        await c.env.DB.prepare(
          `UPDATE wrong_book SET status = 'removed', removed_at = ?
           WHERE user_id = ? AND status = 'active' AND question_id IN (${removeList})`,
        )
          .bind(submittedAt, user.id, ...rmChunk)
          .run();
      }
    }
  }

  // ── 答题状态 ──
  // 真正给出选项的作答记为「已答」（selected_answer 为 NULL 或空数组的不记，
  // 与服务端 isUnanswered 语义对齐：null 序列化为 NULL，[] 序列化为 '[]'）。
  // 用一条 INSERT..SELECT 从刚写入的作答明细里汇总，无论多少题都只占 1 次查询。
  await c.env.DB.prepare(
    `INSERT INTO user_question_state (user_id, question_id, bank_id, answered_at)
     SELECT ?, pa.question_id, q.bank_id, ?
     FROM practice_answers pa
     JOIN questions q ON q.id = pa.question_id
     WHERE pa.session_id = ?
       AND pa.selected_answer IS NOT NULL
       AND pa.selected_answer <> '[]'
     ON CONFLICT (user_id, question_id)
     DO UPDATE SET bank_id = excluded.bank_id, answered_at = excluded.answered_at`,
  )
    .bind(user.id, submittedAt, sessionId)
    .run();

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

// ── 答题状态查询 ─────────────────────────────────────────────
//
//   GET /api/practice/state?bank_id=N  单库明细：
//     { bank_id, total, answered, unanswered,
//       by_type: { single: { total, answered, unanswered }, ... } }
//   GET /api/practice/state            全库汇总（题库列表页用）：
//     { banks: [{ bank_id, answered }] }，未答数由前端按 total - answered 推导
practiceRoutes.get('/state', requireLogin, async (c) => {
  const { user } = currentAuth(c);
  const bankIdRaw = c.req.query('bank_id');

  // 全库汇总：每个库一行已答数
  if (bankIdRaw === undefined || bankIdRaw === '') {
    const { results } = await c.env.DB.prepare(
      'SELECT bank_id, COUNT(*) AS n FROM user_question_state WHERE user_id = ? GROUP BY bank_id',
    )
      .bind(user.id)
      .all<{ bank_id: number; n: number }>();
    return c.json({
      banks: (results ?? []).map((r) => ({ bank_id: r.bank_id, answered: r.n })),
    });
  }

  const bankId = parseIntId(bankIdRaw);
  if (bankId === null) throw badRequest('bank_id 不合法');

  const bank = await c.env.DB.prepare(
    'SELECT question_count, single_count, multiple_count, truefalse_count FROM question_banks WHERE id = ?',
  )
    .bind(bankId)
    .first<{
      question_count: number;
      single_count: number;
      multiple_count: number;
      truefalse_count: number;
    }>();
  if (!bank) throw badRequest('题库不存在', 'BANK_NOT_FOUND');

  const { results } = await c.env.DB.prepare(
    `SELECT q.type AS type, COUNT(*) AS n
     FROM user_question_state s
     JOIN questions q ON q.id = s.question_id
     WHERE s.user_id = ? AND s.bank_id = ?
     GROUP BY q.type`,
  )
    .bind(user.id, bankId)
    .all<{ type: string; n: number }>();

  const answeredByType: Record<QuestionType, number> = { single: 0, multiple: 0, truefalse: 0 };
  for (const r of results ?? []) {
    if ((QUESTION_TYPES as readonly string[]).includes(r.type)) {
      answeredByType[r.type as QuestionType] = r.n;
    }
  }

  const byType = {} as Record<QuestionType, { total: number; answered: number; unanswered: number }>;
  let answered = 0;
  for (const type of QUESTION_TYPES) {
    const total = bank[`${type}_count`] ?? 0;
    const a = answeredByType[type];
    answered += a;
    byType[type] = { total, answered: a, unanswered: Math.max(0, total - a) };
  }

  const total = bank.question_count ?? 0;
  return c.json({
    bank_id: bankId,
    total,
    answered,
    unanswered: Math.max(0, total - answered),
    by_type: byType,
  });
});

// ── 清空答题状态 ─────────────────────────────────────────────
practiceRoutes.post('/state/clear', csrfGuard, requireLogin, async (c) => {
  const { user } = currentAuth(c);
  const body = await readJson<Record<string, unknown>>(c);

  const bankId = parseIntId(String(body.bank_id ?? ''));
  if (bankId === null) throw badRequest('缺少题库 ID');

  const bank = await c.env.DB.prepare('SELECT id FROM question_banks WHERE id = ?')
    .bind(bankId)
    .first();
  if (!bank) throw badRequest('题库不存在', 'BANK_NOT_FOUND');

  const res = await c.env.DB.prepare(
    'DELETE FROM user_question_state WHERE user_id = ? AND bank_id = ?',
  )
    .bind(user.id, bankId)
    .run();

  return c.json({ ok: true, deleted: res.meta.changes ?? 0 });
});
