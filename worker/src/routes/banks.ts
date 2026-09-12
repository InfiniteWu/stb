/**
 * 题库 API
 *
 *   GET    /api/banks                  列出题库
 *   POST   /api/banks                  新建题库（管理员）
 *   GET    /api/banks/:id              题库详情
 *   PUT    /api/banks/:id              更新题库（管理员）
 *   DELETE /api/banks/:id              删除题库（管理员）
 *   POST   /api/banks/:id/recount      重算统计（管理员）
 *   GET    /api/banks/:id/export       分页导出（客户端循环拼装）
 */

import { Hono } from 'hono';
import type { AppBindings, BankRow } from '../types';
import { badRequest, notFound, ok, readJson, readPagination } from '../lib/json';
import { recountBank, toBank } from '../lib/banks';
import { parseIntId } from '../lib/ids';
import { validateBankInput } from '../lib/validate';
import { csrfGuard, requireAdmin, requireLogin } from '../middleware/auth';

export const bankRoutes = new Hono<AppBindings>();

/** 取题库；不存在则 404 */
async function mustGetBank(db: D1Database, id: number): Promise<BankRow> {
  const row = await db.prepare('SELECT * FROM question_banks WHERE id = ?').bind(id).first<BankRow>();
  if (!row) throw notFound('题库不存在');
  return row;
}

// ── 列出题库 ─────────────────────────────────────────────────
bankRoutes.get('/', requireLogin, async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM question_banks ORDER BY created_at DESC, id DESC',
  ).all<BankRow>();

  return c.json((results ?? []).map(toBank));
});

// ── 新建题库 ─────────────────────────────────────────────────
bankRoutes.post('/', csrfGuard, requireAdmin, async (c) => {
  const body = await readJson<{ name?: unknown; description?: unknown }>(c);
  const parsed = validateBankInput(body, { requireName: true });
  if (!parsed.ok) throw badRequest(parsed.error);

  const result = await c.env.DB.prepare(
    'INSERT INTO question_banks (name, description) VALUES (?, ?)',
  )
    .bind(parsed.name!, parsed.description ?? '')
    .run();

  return c.json({ ok: true, id: result.meta.last_row_id }, 201);
});

// ── 题库详情 ─────────────────────────────────────────────────
bankRoutes.get('/:id', requireLogin, async (c) => {
  const id = parseIntId(c.req.param('id'));
  if (id === null) throw badRequest('题库 ID 不合法');

  return c.json(toBank(await mustGetBank(c.env.DB, id)));
});

// ── 更新题库 ─────────────────────────────────────────────────
//
// 旧实现用 `$input['name'] ?? ''` 拼 UPDATE，未提供 name 时会把题库名写成空串。
// 现在只更新显式传入的字段。
bankRoutes.put('/:id', csrfGuard, requireAdmin, async (c) => {
  const id = parseIntId(c.req.param('id'));
  if (id === null) throw badRequest('题库 ID 不合法');

  await mustGetBank(c.env.DB, id);
  const body = await readJson<{ name?: unknown; description?: unknown }>(c);
  const parsed = validateBankInput(body, { requireName: false });
  if (!parsed.ok) throw badRequest(parsed.error);

  const fields: string[] = [];
  const values: unknown[] = [];
  if (parsed.name !== undefined) {
    fields.push('name = ?');
    values.push(parsed.name);
  }
  if (parsed.description !== undefined) {
    fields.push('description = ?');
    values.push(parsed.description);
  }

  if (fields.length === 0) return c.json({ ok: true });

  values.push(id);
  await c.env.DB.prepare(`UPDATE question_banks SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return c.json({ ok: true });
});

// ── 删除题库 ─────────────────────────────────────────────────
bankRoutes.delete('/:id', csrfGuard, requireAdmin, async (c) => {
  const id = parseIntId(c.req.param('id'));
  if (id === null) throw badRequest('题库 ID 不合法');

  const result = await c.env.DB.prepare('DELETE FROM question_banks WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) throw notFound('题库不存在');

  return c.json({ ok: true });
});

// ── 重算统计 ─────────────────────────────────────────────────
bankRoutes.post('/:id/recount', csrfGuard, requireAdmin, async (c) => {
  const id = parseIntId(c.req.param('id'));
  if (id === null) throw badRequest('题库 ID 不合法');

  await mustGetBank(c.env.DB, id);
  await recountBank(c.env.DB, id);

  return c.json({ ok: true });
});

// ── 分页导出 ─────────────────────────────────────────────────
//
// 旧实现一次性返回整个题库：实测 1376 道题仅 JSON 序列化就需约 8ms CPU，
// 已接近免费版每请求 10ms 的上限。改为分页，由客户端循环拼装。
bankRoutes.get('/:id/export', requireLogin, async (c) => {
  const id = parseIntId(c.req.param('id'));
  if (id === null) throw badRequest('题库 ID 不合法');

  const bank = await mustGetBank(c.env.DB, id);
  const { page, perPage, offset } = readPagination(c, { defaultPerPage: 200, maxPerPage: 200 });

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM questions WHERE bank_id = ? ORDER BY id LIMIT ? OFFSET ?',
  )
    .bind(id, perPage, offset)
    .all<{ id: number; bank_id: number; type: string; stem: string; options: string; answer: string; explanation: string | null; created_at: string }>();

  const questions = (results ?? []).map((q) => ({
    ...q,
    options: JSON.parse(q.options) as string[],
    answer: JSON.parse(q.answer) as number | number[],
    explanation: q.explanation ?? '',
  }));

  return ok(c, {
    bank: toBank(bank),
    questions,
    total: bank.question_count,
    page,
    per_page: perPage,
    has_more: offset + questions.length < bank.question_count,
  });
});
