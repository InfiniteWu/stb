/**
 * 题库统计维护
 */

import type { BankRow } from '../types';

/** 对外暴露的题库（含解析后的统计） */
export interface Bank {
  id: number;
  name: string;
  description: string;
  question_count: number;
  single_count: number;
  multiple_count: number;
  truefalse_count: number;
  created_at: string;
}

export function toBank(row: BankRow): Bank {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    question_count: row.question_count ?? 0,
    single_count: row.single_count ?? 0,
    multiple_count: row.multiple_count ?? 0,
    truefalse_count: row.truefalse_count ?? 0,
    created_at: row.created_at,
  };
}

/**
 * 重算题库统计。
 *
 * 旧实现用 `SUM(CASE WHEN type='single' THEN 1 ELSE 0 END)` —— 空题库时
 * SUM 返回 NULL，于是统计字段被写成 NULL 而不是 0（实测 typeof 为 null），
 * 前端显示 "null"。
 *
 * 这里改用 `COUNT(*) + WHERE 条件`：COUNT 永不返回 NULL，
 * 从结构上消除该问题，而不是靠外层 COALESCE 打补丁。
 *
 * 单条 UPDATE 内联四个子查询（5 个绑定参数），只需 1 次 D1 查询 ——
 * 免费版每请求只有 50 次查询额度，导入时需要精打细算。
 */
export async function recountBank(db: D1Database, bankId: number): Promise<void> {
  await db
    .prepare(
      `UPDATE question_banks SET
         question_count  = (SELECT COUNT(*) FROM questions WHERE bank_id = ?),
         single_count    = (SELECT COUNT(*) FROM questions WHERE bank_id = ? AND type = 'single'),
         multiple_count  = (SELECT COUNT(*) FROM questions WHERE bank_id = ? AND type = 'multiple'),
         truefalse_count = (SELECT COUNT(*) FROM questions WHERE bank_id = ? AND type = 'truefalse')
       WHERE id = ?`,
    )
    .bind(bankId, bankId, bankId, bankId, bankId)
    .run();
}
