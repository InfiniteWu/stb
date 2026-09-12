/**
 * ID 参数解析
 *
 * 单独成模块是因为几乎所有路由都要用，且这里承载了一个具体的修复：
 * 旧实现用 `if ($bankId)` 判断参数是否存在，使合法的 0 被当作「未提供」
 * 而静默忽略。真正的「未提供」与「非法值」必须区分对待。
 */

/**
 * 解析正整数 ID。
 * 返回 null 表示非法或未提供 —— 调用方需自行区分该场景的语义。
 */
export function parseIntId(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
