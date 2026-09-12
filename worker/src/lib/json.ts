/**
 * 统一响应与错误处理
 *
 * 约定：成功返回业务 JSON；失败返回 `{ error, code }` 加语义化 HTTP 状态码。
 */

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppBindings } from '../types';

export type AppContext = Context<AppBindings>;

/** 业务错误：由 onError 统一转成 JSON 响应 */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST') =>
  new ApiError(400, code, message);

export const unauthorized = (message = '请先登录', code = 'UNAUTHORIZED') =>
  new ApiError(401, code, message);

export const forbidden = (message = '需要管理员权限', code = 'FORBIDDEN') =>
  new ApiError(403, code, message);

export const notFound = (message = '资源不存在', code = 'NOT_FOUND') =>
  new ApiError(404, code, message);

export const tooManyRequests = (message = '请求过于频繁，请稍后再试', code = 'RATE_LIMITED') =>
  new ApiError(429, code, message);

/** 成功响应 */
export function ok<T>(c: AppContext, data: T, status: ContentfulStatusCode = 200) {
  return c.json(data, status);
}

/**
 * 解析 JSON 请求体；为空或非法 JSON 时抛出 400。
 */
export async function readJson<T = Record<string, unknown>>(c: AppContext): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest('请求体不是合法的 JSON', 'INVALID_JSON');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('请求体必须是 JSON 对象', 'INVALID_JSON');
  }
  return body as T;
}

/** 取正整数分页参数并做上限钳制 */
export function readPagination(
  c: AppContext,
  { defaultPerPage = 20, maxPerPage = 200 }: { defaultPerPage?: number; maxPerPage?: number } = {},
): { page: number; perPage: number; offset: number } {
  const rawPage = Number.parseInt(c.req.query('page') ?? '1', 10);
  const rawPer = Number.parseInt(c.req.query('per_page') ?? String(defaultPerPage), 10);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const perPage = Number.isFinite(rawPer) && rawPer > 0 ? Math.min(rawPer, maxPerPage) : defaultPerPage;

  return { page, perPage, offset: (page - 1) * perPage };
}
