/**
 * 认证与授权中间件
 */

import type { MiddlewareHandler } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { forbidden, unauthorized } from '../lib/json';
import { readSessionCookie, resolveSession } from '../lib/session';

/**
 * 解析会话并挂到 c.get('auth')。
 *
 * 不在此处强制登录 —— 有些端点（/auth/me）需要区分「未登录」与「无权限」，
 * 由 requireLogin 决定是否拒绝。
 */
export const loadSession: MiddlewareHandler<AppBindings> = async (c, next) => {
  const token = readSessionCookie(c.req.header('Cookie'));
  if (token) {
    const session = await resolveSession(c.env.DB, token);
    if (session) {
      const auth: AuthContext = { user: session.user, sessionId: session.sessionId };
      c.set('auth', auth);
    }
  }
  await next();
};

/** 要求已登录，否则 401 */
export const requireLogin: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (!c.get('auth')) {
    throw unauthorized();
  }
  await next();
};

/** 要求管理员，否则 401 / 403 */
export const requireAdmin: MiddlewareHandler<AppBindings> = async (c, next) => {
  const auth = c.get('auth');
  if (!auth) {
    throw unauthorized();
  }
  if (auth.user.role !== 'admin') {
    throw forbidden();
  }
  await next();
};

/** 取当前登录上下文（在 requireLogin/requireAdmin 之后调用可确保非空） */
export function currentAuth(c: { get: (k: 'auth') => AuthContext | undefined }): AuthContext {
  const auth = c.get('auth');
  if (!auth) throw unauthorized();
  return auth;
}

// ── CSRF 防护 ───────────────────────────────────────────────

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 写操作的 CSRF 校验。
 *
 * 主防线是 Cookie 的 SameSite=Lax（跨站 POST 不携带 Cookie）；
 * 这里再加两道：
 *   1. Origin 头若存在，必须与请求 Host 同源
 *   2. 写操作必须声明 Content-Type: application/json
 *      —— 跨站的简单表单请求无法伪造该类型，会触发预检
 *
 * 旧版 config.php 无条件下发 `Access-Control-Allow-Origin: *`，
 * 且放任 X-User-Id 头但代码从未使用；本架构同源部署，不需要任何 CORS 头。
 */
export const csrfGuard: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) {
    await next();
    return;
  }

  const origin = c.req.header('Origin');
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw forbidden('请求来源不合法', 'BAD_ORIGIN');
    }
    const requestHost = c.req.header('Host') ?? new URL(c.req.url).host;
    if (originHost !== requestHost) {
      throw forbidden('请求来源不合法', 'BAD_ORIGIN');
    }
  }

  const contentType = c.req.header('Content-Type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw forbidden('写操作必须使用 application/json', 'UNSUPPORTED_MEDIA_TYPE');
  }

  await next();
};

/** 取客户端 IP（用于登录限流记录） */
export function clientIp(c: { req: { header: (n: string) => string | undefined } }): string {
  return c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? '';
}
