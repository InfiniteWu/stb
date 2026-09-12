/**
 * 题库导入 API
 *
 *   POST /api/import   批量导入题目（管理员）
 *
 * ## 为什么必须分批
 *
 * 免费版每次 Worker 调用只有 50 次 D1 查询额度。旧实现把整个 JSON 一次性
 * 导入 —— 内置题库有 1376 道题，就是 1376 次 INSERT 加若干次统计更新，
 * 远超额度必然失败。实测表明仅在 JSON 序列化阶段就已逼近 CPU 上限。
 *
 * 因此改为**客户端分批**：每次最多 30 道题（1 次建库/校验 + 30 次插入
 * + 1 次统计重算 ≈ 32 次查询，安全落在 50 以内），由前端循环并展示进度。
 *
 * 请求体：
 *   {
 *     bank_id?: number,        // 追加到已有题库
 *     bankName?: string,       // 或新建题库（仅第一批需要）
 *     description?: string,
 *     start_index?: number,    // 本批第一题在整体中的序号，用于错误定位
 *     questions: Question[]
 *   }
 */

import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { badRequest, notFound, readJson } from '../lib/json';
import { recountBank } from '../lib/banks';
import { parseIntId, validateQuestion } from '../lib/validate';
import { csrfGuard, requireAdmin } from '../middleware/auth';

export const importRoutes = new Hono<AppBindings>();

/** 单批最大题量：与 50 次查询额度留出安全余量 */
export const MAX_IMPORT_BATCH = 30;

importRoutes.post('/', csrfGuard, requireAdmin, async (c) => {
  const body = await readJson<{
    bank_id?: unknown;
    bankName?: unknown;
    description?: unknown;
    start_index?: unknown;
    questions?: unknown;
  }>(c);

  if (!Array.isArray(body.questions)) {
    throw badRequest('questions 必须是数组');
  }
  if (body.questions.length === 0) {
    throw badRequest('questions 不能为空');
  }
  if (body.questions.length > MAX_IMPORT_BATCH) {
    throw badRequest(
      `单批最多导入 ${MAX_IMPORT_BATCH} 道题（当前 ${body.questions.length} 道），请分批提交`,
      'BATCH_TOO_LARGE',
    );
  }

  // ── 确定目标题库 ──
  let bankId: number;
  let bankCreated = false;

  if (body.bank_id !== undefined && body.bank_id !== null && body.bank_id !== '') {
    const parsed = parseIntId(String(body.bank_id));
    if (parsed === null) throw badRequest('bank_id 不合法');
    const bank = await c.env.DB.prepare('SELECT id FROM question_banks WHERE id = ?')
      .bind(parsed)
      .first();
    if (!bank) throw notFound('题库不存在');
    bankId = parsed;
  } else {
    const name = typeof body.bankName === 'string' ? body.bankName.trim() : '';
    if (!name) throw badRequest('未指定 bank_id 时必须提供 bankName');
    if (name.length > 64) throw badRequest('题库名称不能超过 64 个字符');

    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const created = await c.env.DB.prepare(
      'INSERT INTO question_banks (name, description) VALUES (?, ?)',
    )
      .bind(name, description)
      .run();

    bankId = created.meta.last_row_id;
    bankCreated = true;
  }

  // ── 逐题校验并插入 ──
  const startIndex =
    typeof body.start_index === 'number' && Number.isFinite(body.start_index)
      ? Math.max(0, Math.floor(body.start_index))
      : 0;

  const errors: Array<{ index: number; error: string }> = [];
  const statements: D1PreparedStatement[] = [];

  body.questions.forEach((raw, i) => {
    const globalIndex = startIndex + i + 1; // 面向用户的 1 基序号
    const outcome = validateQuestion(raw, globalIndex);

    if (!outcome.ok) {
      errors.push({ index: globalIndex, error: outcome.error });
      return;
    }

    const q = outcome.value;
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO questions (bank_id, type, stem, options, answer, explanation)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        bankId,
        q.type,
        q.stem,
        JSON.stringify(q.options),
        JSON.stringify(q.answer),
        q.explanation,
      ),
    );
  });

  // 单次 batch 完成全部插入
  let imported = 0;
  if (statements.length > 0) {
    try {
      await c.env.DB.batch(statements);
      imported = statements.length;
    } catch (err) {
      // 批量失败时逐条重试，以便定位到具体是哪一题
      for (let i = 0; i < statements.length; i++) {
        try {
          await statements[i]!.run();
          imported++;
        } catch (inner) {
          errors.push({
            index: startIndex + i + 1,
            error: inner instanceof Error ? inner.message : '写入失败',
          });
        }
      }
    }
  }

  // 重算统计（1 次查询）
  await recountBank(c.env.DB, bankId);

  return c.json(
    {
      ok: true,
      bank_id: bankId,
      bank_created: bankCreated,
      imported,
      failed: errors.length,
      errors,
    },
    bankCreated ? 201 : 200,
  );
});
