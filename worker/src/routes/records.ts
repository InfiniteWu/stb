/**
 * 单题答题记录 API
 *
 *   POST /api/records   记录一次单题作答
 *
 * 说明：这张表（study_records）是历史遗留 —— 现有前端从未调用它，
 * 实际练习记录走的是 practice_sessions / practice_answers。
 * 保留端点与表以兼容外部调用方，并补上了缺失的 ON DELETE CASCADE，
 * 但 is_correct 一律由服务端判定，不接受客户端提交。
 */

import { Hono } from 'hono';
import type { AppBindings, QuestionType } from '../types';
import { badRequest, notFound, readJson } from '../lib/json';
import { parseIntId } from '../lib/ids';
import { gradeAnswer, normalizeSelected, parseCorrectAnswer } from '../lib/grade';
import { nowStamp } from '../lib/time';
import { currentAuth, csrfGuard, requireLogin } from '../middleware/auth';

export const recordRoutes = new Hono<AppBindings>();

recordRoutes.post('/', csrfGuard, requireLogin, async (c) => {
  const { user } = currentAuth(c);
  const body = await readJson<{ question_id?: unknown; selected?: unknown }>(c);

  const questionId = parseIntId(String(body.question_id ?? ''));
  if (questionId === null) throw badRequest('question_id 不合法');

  const q = await c.env.DB.prepare('SELECT id, bank_id, type, answer FROM questions WHERE id = ?')
    .bind(questionId)
    .first<{ id: number; bank_id: number; type: QuestionType; answer: string }>();
  if (!q) throw notFound('题目不存在');

  const correct = parseCorrectAnswer(q.answer);
  if (correct === null) throw badRequest('题目答案数据异常');

  // 旧实现直接采信客户端传来的 is_correct，可任意伪造；现由服务端判定
  const selected = normalizeSelected(body.selected);
  const isCorrect = gradeAnswer(q.type, correct, selected);

  await c.env.DB.prepare(
    'INSERT INTO study_records (user_id, question_id, bank_id, is_correct, answered_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(user.id, q.id, q.bank_id, isCorrect ? 1 : 0, nowStamp())
    .run();

  return c.json({ ok: true, is_correct: isCorrect }, 201);
});
