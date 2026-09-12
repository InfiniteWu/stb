/**
 * 服务端判分
 *
 * 旧实现把判分放在前端，并把 `is_correct` 直接提交给后端入库 ——
 * 任何人都能伪造满分，且客户端算法一改历史数据就全错。
 * 现在客户端只上报 `selected`，对错由服务端裁定。
 */

import type { QuestionType } from '../types';

/** 客户端上报的作答：单选/判断为下标，多选为下标数组，未作答为 null */
export type Selected = number | number[] | null;

/** 归一化后的正确答案 */
export type CorrectAnswer = number | number[];

/**
 * 把库里存的 JSON 答案解析成规范形式。
 * 旧库格式：单选/判断 = 数字，多选 = 数字数组。
 */
export function parseCorrectAnswer(raw: string | null | undefined): CorrectAnswer | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'number' && Number.isInteger(parsed)) return parsed;
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'number' && Number.isInteger(v))) {
      return parsed as number[];
    }
    return null;
  } catch {
    return null;
  }
}

/** 判断是否「未作答」（区别于答错） */
export function isUnanswered(selected: Selected): boolean {
  if (selected === null || selected === undefined) return true;
  if (Array.isArray(selected) && selected.length === 0) return true;
  return false;
}

/** 归一化客户端上报的 selected，剔除非法值 */
export function normalizeSelected(input: unknown): Selected {
  if (input === null || input === undefined) return null;

  if (typeof input === 'number' && Number.isInteger(input) && input >= 0) {
    return input;
  }

  if (Array.isArray(input)) {
    const nums = input.filter(
      (v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0,
    );
    // 去重并排序，使 [2,0,1] 与 [0,1,2] 等价
    return [...new Set(nums)].sort((a, b) => a - b);
  }

  return null;
}

/**
 * 判定作答是否正确。
 *
 * 多选按集合比较（顺序无关），单选/判断按下标相等；
 * 未作答一律返回 false，但调用方应先用 isUnanswered 区分「未答」与「答错」。
 */
export function gradeAnswer(
  type: QuestionType,
  correct: CorrectAnswer | null,
  selected: Selected,
): boolean {
  if (correct === null || isUnanswered(selected)) return false;

  if (type === 'multiple') {
    const correctArr = Array.isArray(correct) ? [...correct].sort((a, b) => a - b) : [correct];
    const selectedArr = Array.isArray(selected) ? [...selected].sort((a, b) => a - b) : [selected];

    if (correctArr.length !== selectedArr.length) return false;
    return correctArr.every((v, i) => v === selectedArr[i]);
  }

  // 单选 / 判断：正确答案必为单个下标
  const correctIdx = Array.isArray(correct) ? (correct[0] ?? -1) : correct;
  const selectedIdx = Array.isArray(selected) ? (selected[0] ?? -1) : selected;
  return correctIdx === selectedIdx;
}

/** 把归一化后的作答序列化为入库 JSON */
export function serializeSelected(selected: Selected): string | null {
  if (selected === null) return null;
  return JSON.stringify(selected);
}
