/**
 * 入参校验
 *
 * 旧实现里校验散落各处：import.php 有一套 validateQuestion，
 * questions.php 的 createQuestion 却完全不校验（不查 bank_id 是否存在、
 * 不验选项与答案），导致外键失败被静默吞掉却仍返回 201。
 * 这里统一成一份，所有写入路径共用。
 */

import type { QuestionType } from '../types';

export const QUESTION_TYPES: readonly QuestionType[] = ['single', 'multiple', 'truefalse'];

export const MAX_QUESTION_BYTES = 100_000;
export const MAX_BANK_NAME_LEN = 64;
export const MAX_STEM_LEN = 5_000;
export const MAX_OPTIONS = 12;
export const MAX_OPTION_LEN = 1_000;
export const MAX_EXPLANATION_LEN = 5_000;

/** 单个选项上限等常量集中在此，导入接口据此切分批次 */

export interface NormalizedQuestion {
  type: QuestionType;
  stem: string;
  options: string[];
  answer: number | number[];
  explanation: string;
}

export type ValidationOutcome =
  | { ok: true; value: NormalizedQuestion }
  | { ok: false; error: string };

/** 校验并归一化一道题目；index 用于给导入错误定位题号 */
export function validateQuestion(input: unknown, index?: number): ValidationOutcome {
  const prefix = index === undefined ? '' : `第 ${index} 题: `;

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: `${prefix}题目必须是对象` };
  }
  const q = input as Record<string, unknown>;

  // ── 题干 ──
  const stem = typeof q.stem === 'string' ? q.stem.trim() : '';
  if (!stem) return { ok: false, error: `${prefix}题干不能为空` };
  if (stem.length > MAX_STEM_LEN) {
    return { ok: false, error: `${prefix}题干过长（上限 ${MAX_STEM_LEN} 字）` };
  }

  // ── 题型 ──
  if (!QUESTION_TYPES.includes(q.type as QuestionType)) {
    return { ok: false, error: `${prefix}题型必须是 single / multiple / truefalse` };
  }
  const type = q.type as QuestionType;

  // ── 选项 ──
  if (!Array.isArray(q.options) || q.options.length < 2) {
    return { ok: false, error: `${prefix}选项必须是不少于 2 项的数组` };
  }
  if (q.options.length > MAX_OPTIONS) {
    return { ok: false, error: `${prefix}选项过多（上限 ${MAX_OPTIONS} 项）` };
  }
  const options: string[] = [];
  for (let i = 0; i < q.options.length; i++) {
    const opt = q.options[i];
    if (typeof opt !== 'string' || !opt.trim()) {
      return { ok: false, error: `${prefix}第 ${i + 1} 个选项不能为空` };
    }
    if (opt.length > MAX_OPTION_LEN) {
      return { ok: false, error: `${prefix}第 ${i + 1} 个选项过长` };
    }
    options.push(opt.trim());
  }

  // ── 答案 ──
  const optionCount = options.length;
  const rawAnswer = q.answer;

  if (type === 'multiple') {
    if (!Array.isArray(rawAnswer) || rawAnswer.length === 0) {
      return { ok: false, error: `${prefix}多选题答案必须是非空数组` };
    }
    const idxs: number[] = [];
    for (const v of rawAnswer) {
      if (typeof v !== 'number' || !Number.isInteger(v)) {
        return { ok: false, error: `${prefix}答案必须是不超过选项范围的整数下标` };
      }
      if (v < 0 || v >= optionCount) {
        return { ok: false, error: `${prefix}答案下标 ${v} 超出选项范围（0-${optionCount - 1}）` };
      }
      idxs.push(v);
    }
    const unique = [...new Set(idxs)].sort((a, b) => a - b);
    if (unique.length !== idxs.length) {
      return { ok: false, error: `${prefix}多选题答案存在重复下标` };
    }
    return {
      ok: true,
      value: {
        type,
        stem,
        options,
        answer: unique,
        explanation: normalizeExplanation(q.explanation),
      },
    };
  }

  // single / truefalse
  if (typeof rawAnswer !== 'number' || !Number.isInteger(rawAnswer)) {
    return { ok: false, error: `${prefix}答案必须是不超过选项范围的整数下标` };
  }
  if (rawAnswer < 0 || rawAnswer >= optionCount) {
    return { ok: false, error: `${prefix}答案下标 ${rawAnswer} 超出选项范围（0-${optionCount - 1}）` };
  }

  return {
    ok: true,
    value: {
      type,
      stem,
      options,
      answer: rawAnswer,
      explanation: normalizeExplanation(q.explanation),
    },
  };
}

function normalizeExplanation(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  return trimmed.length > MAX_EXPLANATION_LEN ? trimmed.slice(0, MAX_EXPLANATION_LEN) : trimmed;
}

/** 校验题库名称与描述 */
export function validateBankInput(
  input: { name?: unknown; description?: unknown },
  { requireName }: { requireName: boolean },
): { ok: true; name?: string; description?: string } | { ok: false; error: string } {
  const out: { name?: string; description?: string } = {};

  if (input.name !== undefined) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) return { ok: false, error: '题库名称不能为空' };
    if (name.length > MAX_BANK_NAME_LEN) {
      return { ok: false, error: `题库名称不能超过 ${MAX_BANK_NAME_LEN} 个字符` };
    }
    out.name = name;
  } else if (requireName) {
    return { ok: false, error: '题库名称不能为空' };
  }

  if (input.description !== undefined) {
    const desc = typeof input.description === 'string' ? input.description.trim() : '';
    if (desc.length > 500) return { ok: false, error: '题库描述不能超过 500 个字符' };
    out.description = desc;
  }

  return { ok: true, ...out };
}

export { parseIntId } from './ids';
