/**
 * 会话管理
 *
 * 取代 PHP 的文件 session：
 *   - D1 只存 sha256(token)，明文 token 仅存在于 Cookie，库泄露也无法直接冒用
 *   - 可服务端吊销（登出即删行；改密/重置后删除该用户其它会话）
 *   - 登录时签发新 token（消除会话固定）
 *
 * Cookie 使用 __Host- 前缀：强制 Secure、Path=/、且不允许 Domain 属性，
 * 浏览器会将其限定为「仅当前主机」，天然阻隔子域间的会话串用。
 */

import type { PublicUser, Role, UserRow } from '../types';
import { generateSessionToken, sha256Hex } from './password';
import { stampAfterDays, toBeijingStamp } from './time';

/** 会话有效期（天） */
export const SESSION_DAYS = 7;

export const SESSION_COOKIE = '__Host-sid';

/** 从 Cookie 头中取出会话 token */
export function readSessionCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === SESSION_COOKIE) {
      return part.slice(idx + 1).trim() || null;
    }
  }
  return null;
}

/**
 * 构造 Set-Cookie。
 *
 * maxAgeSeconds > 0：持久 Cookie，Max-Age 与库中 expires_at 一致；
 * maxAgeSeconds <= 0：**会话 Cookie**（不带 Max-Age）—— 浏览器关闭即失效，
 *   对应登录页「记住我」未勾选的情况。服务端 expires_at 仍是 7 天，所以
 *   浏览器一直开着不会被中途踢下线，只是重开浏览器后要重新登录。
 */
export function buildSessionCookie(token: string, maxAgeSeconds = SESSION_DAYS * 86_400): string {
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeSeconds > 0) parts.push(`Max-Age=${maxAgeSeconds}`);
  return parts.join('; ');
}

/** 清除 Cookie（登出） */
export function buildClearCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** 创建会话，返回明文 token（仅此一次可见） */
export async function createSession(
  db: D1Database,
  userId: number,
  nowMs: number = Date.now(),
): Promise<{ token: string; expiresAt: string }> {
  const token = generateSessionToken();
  const id = await sha256Hex(token);
  const now = toBeijingStamp(nowMs);
  const expiresAt = stampAfterDays(SESSION_DAYS, () => nowMs);

  await db
    .prepare(
      'INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(id, userId, now, now, expiresAt)
    .run();

  return { token, expiresAt };
}

/** 会话解析结果 */
export interface ResolvedSession {
  sessionId: string;
  expiresAt: string;
  user: PublicUser;
}

/**
 * 校验会话 token 并取出用户。
 *
 * 单次 JOIN 查询完成，不额外查用户表；顺带惰性更新 last_seen_at。
 * 过期会话直接删除并返回 null。
 */
export async function resolveSession(
  db: D1Database,
  token: string,
  nowMs: number = Date.now(),
): Promise<ResolvedSession | null> {
  const id = await sha256Hex(token);
  const now = toBeijingStamp(nowMs);

  const row = await db
    .prepare(
      `SELECT s.id           AS session_id,
              s.expires_at   AS expires_at,
              u.id           AS user_id,
              u.username     AS username,
              u.display_name AS display_name,
              u.role         AS role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
    )
    .bind(id)
    .first<{
      session_id: string;
      expires_at: string;
      user_id: number;
      username: string;
      display_name: string;
      role: Role;
    }>();

  if (!row) return null;

  // 时间戳为定长北京时间字符串，字典序比较即时间序
  if (row.expires_at <= now) {
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
    return null;
  }

  // 惰性刷新活跃时间。条件里的 last_seen_at < now 让同一秒内的重复请求
  // 不产生写入，省下 D1 的行写入配额（免费版每日 10 万行）。
  await db
    .prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ? AND last_seen_at < ?')
    .bind(now, id, now)
    .run();

  return {
    sessionId: row.session_id,
    expiresAt: row.expires_at,
    user: {
      id: row.user_id,
      username: row.username,
      display_name: row.display_name,
      role: row.role,
    },
  };
}

/** 删除单个会话（登出） */
export async function destroySession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}

/**
 * 删除某用户的全部会话，可选保留当前会话。
 * 改密 / 被管理员重置口令 / 删除用户后调用，使旧登录立即失效。
 */
export async function destroyUserSessions(
  db: D1Database,
  userId: number,
  exceptSessionId?: string,
): Promise<void> {
  if (exceptSessionId) {
    await db
      .prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?')
      .bind(userId, exceptSessionId)
      .run();
    return;
  }
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

/** 清理过期会话（可由 Cron 触发；当前在登录时顺带调用） */
export async function purgeExpiredSessions(db: D1Database, nowMs: number = Date.now()): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(toBeijingStamp(nowMs)).run();
}

/** 把用户行转成对外安全表示（剥离一切哈希字段） */
export function toPublicUser(row: Pick<UserRow, 'id' | 'username' | 'display_name' | 'role'>): PublicUser {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
  };
}
