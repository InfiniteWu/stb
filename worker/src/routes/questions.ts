/**
 * 题目 API
 *
 *   GET    /api/questions          分页查询
 *   GET    /api/questions/:id      单题
 *   POST   /api/questions          新建（管理员）
 *   PUT    /api/questions/:id      更新（管理员）
 *   DELETE /api/questions/:id      删除（管理员）
 */

import { Hono } from 'hono';
import type { AppBindings, QuestionRow, QuestionType } from '../types';
import { badRequest, notFound, readJson, readPagination } from '../lib/json';
import { recountBank } from '../lib/banks';
import { parseIntId } from '../lib/ids';
import { QUESTION_TYPES, validateQuestion } from '../lib/validate';
import { csrfGuard, requireAdmin, requireLogin } from '../middleware/auth';

export const questionRoutes = new Hono<AppBindings>();

/** 对外题目表示：options/answer 由 JSON 字符串解析为原生类型 */
export function toQuestion(row: QuestionRow) {
  return {
    id: row.id,
    bank_id: row.bank_id,
    type: row.type,
    stem: row.stem,
    options: safeParseArray(row.options),
    answer: safeParseJson(row.answer),
    explanation: row.explanation ?? '',
    created_at: row.created_at,
  };
}

function safeParseArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

function safeParseJson(raw: string): number | number[] {
  try {
    return JSON.parse(raw) as number | number[];
  } catch {
    return -1;
  }
}

// ── 分页查询 ─────────────────────────────────────────────────
//
// 旧实现返回裸数组且无分页，题库 2 有 1376 题会一次性返回。
// 实测：1376 题仅 JSON 序列化约 8ms CPU，逼近免费版 10ms 上限。
// 现在强制分页，per_page 默认 50、硬上限 200。
questionRoutes.get('/', requireLogin, async (c) => {
  const { page, perPage, offset } = readPagination(c, { defaultPerPage: 50, maxPerPage: 200 });

  const conditions: string[] = [];
  const params: unknown[] = [];

  const bankIdRaw = c.req.query('bank_id');
  if (bankIdRaw !== undefined) {
    const bankId = parseIntId(bankIdRaw);
    if (bankId === null) throw badRequest('bank_id 不合法');
    conditions.push('bank_id = ?');
    params.push(bankId);
  }

  const type = c.req.query('type');
  if (type !== undefined) {
    if (!QUESTION_TYPES.includes(type as QuestionType)) throw badRequest('题型不合法');
    conditions.push('type = ?');
    params.push(type);
  }

  const search = c.req.query('search');
  if (search !== undefined && search !== '') {
    // D1 对 LIKE 模式有 50 字节上限，超出直接拒绝而不是让查询失败
    if (new TextEncoder().encode(search).length > 40) {
      throw badRequest('搜索关键词过长');
    }
    conditions.push('stem LIKE ?');
    params.push(`%${search}%`);
  }

  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';

  // 总数优先取题库表里预计算的 question_count，避免对大表做 COUNT(*) 全表扫描
  // （免费版 D1 每日仅 5,000,000 行读取，COUNT(*) 会按行数计价）
  let total: number;
  const onlyBankFilter = conditions.length === 1 && params[0] !== undefined && bankIdRaw !== undefined;
  if (onlyBankFilter) {
    const bank = await c.env.DB.prepare('SELECT question_count FROM question_banks WHERE id = ?')
      .bind(params[0])
      .first<{ question_count: number }>();
    total = bank?.question_count ?? 0;
  } else {
    const row = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM questions${where}`)
      .bind(...params)
      .first<{ n: number }>();
    total = row?.n ?? 0;
  }

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM questions${where} ORDER BY id LIMIT ? OFFSET ?`,
  )
    .bind(...params, perPage, offset)
    .all<QuestionRow>();

  return c.json({
    items: (results ?? []).map(toQuestion),
    total,
    page,
    per_page: perPage,
  });
});

// ── 单题 ─────────────────────────────────────────────────────
questionRoutes.get('/:id', requireLogin, async (c) => {
  const id = parseIntId(c.req.param('id'));
  if (id === null) throw badRequest('题目 ID 不合法');

  const row = await c.env.DB.prepare('SELECT * FROM questions WHERE id = ?')
    .bind(id)
    .first<QuestionRow>();
  if (!row) throw notFound('题目不存在');

  return c.json(toQuestion(row));
});

// ── 新建 ─────────────────────────────────────────────────────
//
// 旧实现不校验 bank_id 是否存在、不校验选项与答案，导致外键失败被
// SQLite3 静默吞掉，接口却返回 201 与一个无效 id。
questionRoutes.post('/', csrfGuard, requireAdmin, async (c) => {
  const body = await readJson<Record<string, unknown>>(c);

  const bankId = parseIntId(String(body.bank_id ?? ''));
  if (bankId === null) throw badRequest('bank_id 不合法');

  const bank = await c.env.DB.prepare('SELECT id FROM question_banks WHERE id = ?')
    .bind(bankId)
    .first();
  if (!bank) throw badRequest('题库不存在', 'BANK_NOT_FOUND');

  const parsed = validateQuestion(body);
  if (!parsed.ok) throw badRequest(parsed.error);

  const q = parsed.value;
  const result = await c.env.DB.prepare(
    `INSERT INTO questions (bank_id, type, stem, options, answer, explanation)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      bankId,
      q.type,
      q.stem,
      JSON.stringify(q.options),
      JSON.stringify(q.answer),
      q.explanation,
    )
    .run();

  await recountBank(c.env.DB, bankId);

  return c.json({ ok: true, id: result.meta.last_row_id }, 201);
});

// ── 更新 ─────────────────────────────────────────────────────
//
// 旧实现显式写出所有列并大量使用 `?? ''`，未传的字段会被写成空串，
// 足以把一道题改坏。现在只更新显式提供的字段。
questionRoutes.put('/:id', csrfGuard, requireAdmin, async (c) => {
  const id = parseIntId(c.req.param('id'));
  if (id === null) throw badRequest('题目 ID 不合法');

  const existing = await c.env.DB.prepare('SELECT * FROM questions WHERE id = ?')
    .bind(id)
    .first<QuestionRow>();
  if (!existing) throw notFound('题目不存在');

  const body = await readJson<Record<string, unknown>>(c);

  // 合并到现有值后整体校验，保证任何时刻数据都自洽
  const merged = {
    type: body.type ?? existing.type,
    stem: body.stem ?? existing.stem,
    options: body.options ?? safeParseArray(existing.options),
    answer: body.answer ?? safeParseJson(existing.answer),
    explanation: body.explanation ?? existing.explanation ?? '',
  };

  const parsed = validateQuestion(merged);
  if (!parsed.ok) throw badRequest(parsed.error);

  let bankId = existing.bank_id;
  if (body.bank_id !== undefined) {
    const nextBankId = parseIntId(String(body.bank_id));
    if (nextBankId === null) throw badRequest('bank_id 不合法');
    const bank = await c.env.DB.prepare('SELECT id FROM question_banks WHERE id = ?')
      .bind(nextBankId)
      .first();
    if (!bank) throw badRequest('题库不存在', 'BANK_NOT_FOUND');
    bankId = nextBankId;
  }

  const q = parsed.value;
  await c.env.DB.prepare(
    `UPDATE questions SET bank_id = ?, type = ?, stem = ?, options = ?, answer = ?, explanation = ?
     WHERE id = ?`,
  )
    .bind(
      bankId,
      q.type,
      q.stem,
      JSON.stringify(q.options),
      JSON.stringify(q.answer),
      q.explanation,
      id,
    )
    .run();

  // 题目换了题库时，来源与目标都要重算
  await recountBank(c.env.DB, bankId);
  if (bankId !== existing.bank_id) {
    await recountBank(c.env.DB, existing.bank_id);
  }

  return c.json({ ok: true });
});

// ── 删除 ─────────────────────────────────────────────────────
questionRoutes.delete('/:id', csrfGuard, requireAdmin, async (c) => {
  const id = parseIntId(c.req.param('id'));
  if (id === null) throw badRequest('题目 ID 不合法');

  const existing = await c.env.DB.prepare('SELECT bank_id FROM questions WHERE id = ?')
    .bind(id)
    .first<{ bank_id: number }>();
  if (!existing) throw notFound('题目不存在');

  const result = await c.env.DB.prepare('DELETE FROM questions WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) throw notFound('题目不存在');

  await recountBank(c.env.DB, existing.bank_id);

  return c.json({ ok: true });
});
