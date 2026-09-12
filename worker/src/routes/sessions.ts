/**
 * 练习记录 API
 *
 *   GET /api/sessions        分页列表
 *   GET /api/sessions/:id    单次练习详情
 */

import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { badRequest, notFound, readPagination } from '../lib/json';
import { parseIntId } from '../lib/ids';
import { currentAuth, requireLogin } from '../middleware/auth';

export const sessionRoutes = new Hono<AppBindings>();

sessionRoutes.use('*', requireLogin);

// ── 列表 ─────────────────────────────────────────────────────
//
// 旧实现的问题：
//   1. 无分页，全部返回；
//   2. 只返回 bank_id，前端直接把这个数字显示成「题库」列，
//      而真正可读的题库名需要 JOIN question_banks；
//   3. 跨题库错题练习会把会话记到 questions[0] 的题库上。
// 现在 JOIN 出 bank_name，跨库练习 bank_id 为 NULL，bank_name 显示为「错题练习」。
sessionRoutes.get('/', async (c) => {
  const { user } = currentAuth(c);
  const { page, perPage, offset } = readPagination(c, { defaultPerPage: 20, maxPerPage: 100 });

  const conditions = ['ps.user_id = ?'];
  const params: unknown[] = [user.id];

  const bankIdRaw = c.req.query('bank_id');
  if (bankIdRaw !== undefined) {
    const bankId = parseIntId(bankIdRaw);
    if (bankId === null) throw badRequest('bank_id 不合法');
    conditions.push('ps.bank_id = ?');
    params.push(bankId);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM practice_sessions ps ${where}`,
  )
    .bind(...params)
    .first<{ n: number }>();

  const { results } = await c.env.DB.prepare(
    `SELECT ps.*, qb.name AS bank_name
     FROM practice_sessions ps
     LEFT JOIN question_banks qb ON ps.bank_id = qb.id
     ${where}
     ORDER BY ps.submitted_at DESC, ps.id DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...params, perPage, offset)
    .all<Record<string, unknown> & { bank_name: string | null; mode: string }>();

  const sessions = (results ?? []).map((s) => ({
    ...s,
    // 跨题库错题练习没有单一题库，给出可读标签而不是 null
    bank_name: s.bank_name ?? (s.mode === 'wrongbook' ? '错题练习' : '未知题库'),
  }));

  return c.json({
    total: totalRow?.n ?? 0,
    page,
    per_page: perPage,
    sessions,
  });
});

// ── 详情 ─────────────────────────────────────────────────────
sessionRoutes.get('/:id', async (c) => {
  const { user } = currentAuth(c);
  const id = parseIntId(c.req.param('id'));
  if (id === null) throw badRequest('练习 ID 不合法');

  const session = await c.env.DB.prepare(
    `SELECT ps.*, qb.name AS bank_name
     FROM practice_sessions ps
     LEFT JOIN question_banks qb ON ps.bank_id = qb.id
     WHERE ps.id = ? AND ps.user_id = ?`,
  )
    .bind(id, user.id)
    .first<Record<string, unknown> & { mode: string; bank_name: string | null }>();

  if (!session) throw notFound('记录不存在');

  const { results } = await c.env.DB.prepare(
    `SELECT pa.id, pa.question_id, pa.selected_answer, pa.correct_answer, pa.is_correct,
            q.stem, q.type, q.options, q.explanation
     FROM practice_answers pa
     JOIN questions q ON pa.question_id = q.id
     WHERE pa.session_id = ?
     ORDER BY pa.id`,
  )
    .bind(id)
    .all<{
      id: number;
      question_id: number;
      selected_answer: string | null;
      correct_answer: string;
      is_correct: number | null;
      stem: string;
      type: string;
      options: string;
      explanation: string | null;
    }>();

  const answers = (results ?? []).map((a) => ({
    ...a,
    // 单选/判断为数字，多选为数组 —— 前端必须按数组归一化处理，
    // 旧前端用 `oi === correct_answer` 比较，多选题永远不成立。
    selected_answer: parseJsonOrNull(a.selected_answer),
    correct_answer: parseJsonOrNull(a.correct_answer),
    options: safeArray(a.options),
    explanation: a.explanation ?? '',
  }));

  return c.json({
    session: {
      ...session,
      bank_name: session.bank_name ?? (session.mode === 'wrongbook' ? '错题练习' : '未知题库'),
    },
    answers,
  });
});

function parseJsonOrNull(raw: string | null): number | number[] | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as number | number[];
  } catch {
    return null;
  }
}

function safeArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
