/**
 * 选项乱序
 *
 * 旧实现的问题：服务端打乱选项后连答案一起下发，由前端判分。
 * 现在判分移到服务端，但服务端在抽题时并不建立会话记录，
 * 到提交时已经不知道当初的打乱顺序了。
 *
 * 采用「签名置换」无状态方案：
 *   抽题时生成置换 perm（perm[显示下标] = 原下标），随题下发一个签名 token；
 *   提交时回传 token，服务端验签后据此把用户选择映射回原下标再判分。
 *
 * 为什么签名不是可有可无的：置换本身不影响作弊（正确答案不下发），
 * 但若可任意伪造，会把伪造的置换写进 practice_answers.correct_answer，
 * 污染历史数据与错题本统计。HMAC 一次验签仅耗微秒级 CPU。
 */

import { bytesToBase64, base64ToBytes, timingSafeEqual } from './password';

/** 生成置换：返回 perm，其中 perm[显示下标] = 原下标 */
export function shuffleIndices(n: number): number[] {
  const perm = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = perm[i]!;
    perm[i] = perm[j]!;
    perm[j] = tmp;
  }
  return perm;
}

/** 按置换重排数组 */
export function applyPermutation<T>(items: T[], perm: number[]): T[] {
  return perm.map((oldIdx) => items[oldIdx]!);
}

const enc = new TextEncoder();

async function hmacBase64Url(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bytesToBase64(new Uint8Array(sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 打包并签名置换，格式 "<p0-p1-...>.<sig>" */
export async function signPermutation(
  secret: string,
  questionId: number,
  perm: number[],
): Promise<string> {
  const body = perm.join('-');
  const sig = await hmacBase64Url(secret, `${questionId}:${body}`);
  return `${body}.${sig}`;
}

/**
 * 验签并还原置换。
 * 任何格式错误、非合法置换、签名不匹配都返回 null，调用方应转为 400。
 */
export async function verifyPermutation(
  secret: string,
  questionId: number,
  token: string,
  expectedLength: number,
): Promise<number[] | null> {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const perm = body.split('-').map((s) => Number.parseInt(s, 10));
  if (perm.length !== expectedLength) return null;
  if (perm.some((v) => !Number.isInteger(v) || v < 0 || v >= expectedLength)) return null;

  // 必须是 0..n-1 的排列
  const sorted = [...perm].sort((a, b) => a - b);
  if (sorted.some((v, i) => v !== i)) return null;

  const expected = await hmacBase64Url(secret, `${questionId}:${body}`);
  if (!timingSafeEqual(expected, sig)) return null;

  return perm;
}

/**
 * 把「显示顺序下的选择」映射回「原始下标」。
 * 单选/判断返回数字，多选返回排序去重后的数组。
 */
export function unmapSelection(selected: number | number[], perm: number[]): number | number[] {
  if (Array.isArray(selected)) {
    const mapped = selected.map((i) => perm[i]).filter((v): v is number => v !== undefined);
    return [...new Set(mapped)].sort((a, b) => a - b);
  }
  return perm[selected] ?? -1;
}

/** 把「原始下标下的答案」映射到「显示顺序」，用于复习页展示 */
export function mapAnswerToDisplay(answer: number | number[], perm: number[]): number | number[] {
  // perm[display] = original，故反查：original -> display
  const inverse = new Map<number, number>();
  perm.forEach((original, display) => inverse.set(original, display));

  if (Array.isArray(answer)) {
    const mapped = answer.map((i) => inverse.get(i)).filter((v): v is number => v !== undefined);
    return mapped.sort((a, b) => a - b);
  }
  return inverse.get(answer) ?? -1;
}

export { base64ToBytes };
