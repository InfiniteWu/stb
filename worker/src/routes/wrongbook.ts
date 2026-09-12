/**
 * 错题本 API
 *
 *   GET    /api/wrongbook          错题列表
 *   GET    /api/wrongbook/today    今日新增错题
 *   GET    /api/wrongbook/:id      单条错题
 *   POST   /api/wrongbook          手动加入错题本
 *   PUT    /api/wrongbook/:id/remove  移出错题本
 */

import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { badRequest, notFound, readJson } from '../lib/json';
import { parseIntId } from '../lib/ids';
import { nowStamp, todayBounds } from '../lib/time';
import { currentAuth, csrfGuard, requireLogin } from '../middleware/auth';

export const wrongBookRoutes = new Hono<AppBindings>();

wrongBookRoutes.use('*', requireLogin);

/**
 * 错题查询的公共列。
 *
 * 旧实现的 error_count / correct_count 子查询只按 question_id 过滤，
 * **没有按用户过滤** —— 多个用户共用同一道题时，会统计到别人的作答，
 * 等于把他人练习情况泄露出来。这里全部以 wb.user_id 收敛到当前用户。
 */
const WRONG_SELECT = `
  SELECT wb.*,
         q.stem, q.type, q.options, q.answer, q.explanation,
         qb.name AS bank_name,
         (SELECT COUNT(*) FROM practice_answers pa
            JOIN practice_sessions ps ON pa.session_id = ps.id
           WHERE ps.user_id = wb.user_id AND pa.question_id = wb.question_id
             AND pa.is_correct = 0) AS error_count,
         (SELECT COUNT(*) FROM practice_answers pa
            JOIN practice_sessions ps ON pa.session_id = ps.id
           WHERE ps.user_id = wb.user_id AND pa.question_id = wb.question_id
             AND pa.is_correct = 1) AS correct_count
  FROM wrong_book wb
  JOIN questions q ON wb.question_id = q.id
  JOIN question_banks qb ON wb.bank_id = qb.id
`;

interface WrongRow {
  id: number;
  user_id: number;
  question_id: number;
  bank_id: number;
  status: string;
  added_at: string;
  removed_at: string | null;
  stem: string;
  type: string;
  options: string;
  answer: string;
  explanation: string | null;
  bank_name: string;
  error_count: number;
  correct_count: number;
}

function shape(row: WrongRow) {
  return {
    ...row,
    options: safeArray(row.options),
    answer: safeJson(row.answer),
    explanation: row.explanation ?? '',
  };
}

function safeArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function safeJson(raw: string): number | number[] {
  try {
    return JSON.parse(raw) as number | number[];
  } catch {
    return -1;
  }
}

// ── 列表 ─────────────────────────────────────────────────────
wrongBookRoutes.get('/', async (c) => {
  const { user } = currentAuth(c);

  const conditions = ['wb.user_id = ?', "wb.status = 'active'"];
  const params: unknown[] = [user.id];

  const bankIdRaw = c.req.query('bank_id');
  if (bankIdRaw !== undefined) {
    const bankId = parseIntId(bankIdRaw);
    if (bankId === null) throw badRequest('bank_id 不合法');
    conditions.push('wb.bank_id = ?');
    params.push(bankId);
  }

  const { results } = await c.env.DB.prepare(
    `${WRONG_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY wb.added_at DESC, wb.id DESC`,
  )
    .bind(...params)
    .all<WrongRow>();

  return c.json((results ?? []).map(shape));
});

// ── 今日错题 ─────────────────────────────────────────────────
//
// 旧实现用 DATE(wb.added_at) = DATE('now','localtime')，两个问题：
//   1. D1 跑在 UTC，localtime 等于 UTC，判定整体偏移 8 小时；
//   2. 对列套函数导致索引失效，只能全表扫描（D1 按行数计费）。
// 现改为北京时间计算出的范围谓词，可命中 idx_wrong_book_user_added。
wrongBookRoutes.get('/today', async (c) => {
  const { user } = currentAuth(c);
  const { start, end } = todayBounds();

  const { results } = await c.env.DB.prepare(
    `${WRONG_SELECT}
     WHERE wb.user_id = ? AND wb.status = 'active'
       AND wb.added_at >= ? AND wb.added_at < ?
     ORDER BY wb.added_at DESC, wb.id DESC`,
  )
    .bind(user.id, start, end)
    .all<WrongRow>();

  return c.json((results ?? []).map(shape));
});

// ── 单条 ─────────────────────────────────────────────────────
wrongBookRoutes.get('/:id', async (c) => {
  const { user } = currentAuth(c);
  const id = parseIntId(c.req.param('id'));
  if (id === null) throw badRequest('错题 ID 不合法');

  const row = await c.env.DB.prepare(`${WRONG_SELECT} WHERE wb.id = ? AND wb.user_id = ?`)
    .bind(id, user.id)
    .first<WrongRow>();

  if (!row) throw notFound('记录不存在');
  return c.json(shape(row));
});

// ── 手动加入 ─────────────────────────────────────────────────
wrongBookRoutes.post('/', csrfGuard, async (c) => {
  const { user } = currentAuth(c);
  const body = await readJson<{ question_id?: unknown; bank_id?: unknown }>(c);

  const questionId = parseIntId(String(body.question_id ?? ''));
  const bankId = parseIntId(String(body.bank_id ?? ''));
  if (questionId === null || bankId === null) throw badRequest('缺少必填字段');

  // 校验题目与题库的从属关系，避免写入不一致的组合
  const q = await c.env.DB.prepare('SELECT id, bank_id FROM questions WHERE id = ?')
    .bind(questionId)
    .first<{ id: number; bank_id: number }>();
  if (!q) throw notFound('题目不存在');
  if (q.bank_id !== bankId) throw badRequest('题目与题库不匹配');

  const result = await c.env.DB.prepare(
    `INSERT INTO wrong_book (user_id, question_id, bank_id, status, added_at, removed_at)
     VALUES (?, ?, ?, 'active', ?, NULL)
     ON CONFLICT (user_id, question_id, bank_id)
     DO UPDATE SET status = 'active', added_at = excluded.added_at, removed_at = NULL`,
  )
    .bind(user.id, questionId, bankId, nowStamp())
    .run();

  const row = await c.env.DB.prepare(
    'SELECT id FROM wrong_book WHERE user_id = ? AND question_id = ? AND bank_id = ?',
  )
    .bind(user.id, questionId, bankId)
    .first<{ id: number }>();

  return c.json({ ok: true, id: row?.id ?? result.meta.last_row_id }, 201);
});

// ── 移出 ─────────────────────────────────────────────────────
//
// 旧实现在 PUT 分支里直接读 $segments[2]，未定义时会抛 PHP 8 的
// Undefined array key 警告；这里由路由匹配保证存在。
wrongBookRoutes.put('/:id/remove', csrfGuard, async (c) => {
  const { user } = currentAuth(c);
  const id = parseIntId(c.req.param('id'));
  if (id === null) throw badRequest('错题 ID 不合法');


  const result = await c.env.DB.prepare(
    `UPDATE wrong_book SET status = 'removed', removed_at = ?
     WHERE id = ? AND user_id = ? AND status = 'active'`,
  )
    .bind(nowStamp(), id, user.id)
    .run();

  if (result.meta.changes === 0) throw notFound('记录不存在');
  return c.json({ ok: true });
});
