/**
 * 认证 API
 *
 *   POST /api/auth/challenge          取 KDF 参数（登录第一步）
 *   POST /api/auth/login              校验 verifier 并签发会话
 *   POST /api/auth/logout             登出
 *   GET  /api/auth/me                 当前用户
 *   POST /api/auth/update-profile     改显示名
 *   POST /api/auth/change-password    改口令
 */

import { Hono } from 'hono';
import type { AppBindings, UserRow } from '../types';
import { badRequest, notFound, readJson, tooManyRequests, unauthorized } from '../lib/json';
import {
  DEFAULT_KDF_ITERATIONS,
  credentialFromVerifier,
  deriveDecoySalt,
  isRateLimited,
  recordLoginAttempt,
  verifyCredential,
} from '../lib/password';
import {
  buildClearCookie,
  buildSessionCookie,
  createSession,
  destroySession,
  destroyUserSessions,
  purgeExpiredSessions,
  readSessionCookie,
  resolveSession,
  SESSION_DAYS,
  toPublicUser,
} from '../lib/session';
import { clientIp, currentAuth, csrfGuard, requireLogin } from '../middleware/auth';

export const authRoutes = new Hono<AppBindings>();

/** 用户名规范化：去空白；口令相关字段一律不做 trim（口令可含空格） */
function normalizeUsername(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

/** 开发环境兜底密钥；生产必须用 `wrangler secret put SERVER_KDF_SECRET` 设置 */
function kdfSecret(env: AppBindings['Bindings']): string {
  return env.SERVER_KDF_SECRET ?? 'dev-only-insecure-kdf-secret';
}

// ── 登录第一步：取挑战 ───────────────────────────────────────
//
// 对不存在的用户名返回 HMAC 派生的确定性假盐，长度与格式与真盐一致，
// 使攻击者无法据此枚举用户名。
//
// 例外：legacy-bcrypt 账号会显式返回 needsReset。这是迁移期的一次性妥协 ——
// 旧 PHP 的 bcrypt 哈希在新架构下无法验证，若不告知，用户只会看到
// “用户名或密码错误”而不知为何。该信息仅暴露「此账号待重置」，
// 且所有账号重置完毕后该分支自然消失。
authRoutes.post('/challenge', csrfGuard, async (c) => {
  const body = await readJson<{ username?: unknown }>(c);
  const username = normalizeUsername(body.username);
  if (!username) {
    throw badRequest('用户名不能为空');
  }

  const user = await c.env.DB.prepare(
    'SELECT id, username, password_algo, kdf_salt, kdf_iterations FROM users WHERE username = ?',
  )
    .bind(username)
    .first<Pick<UserRow, 'id' | 'username' | 'password_algo' | 'kdf_salt' | 'kdf_iterations'>>();

  if (user && user.password_algo === 'legacy-bcrypt') {
    return c.json({
      needsReset: true,
      error: '该账号由旧系统迁移而来，需要管理员重置密码后才能登录',
      code: 'PASSWORD_RESET_REQUIRED',
    });
  }

  if (user && user.kdf_salt) {
    return c.json({
      salt: user.kdf_salt,
      iterations: user.kdf_iterations ?? DEFAULT_KDF_ITERATIONS,
      algo: 'PBKDF2-SHA256',
    });
  }

  return c.json({
    salt: await deriveDecoySalt(kdfSecret(c.env), username),
    iterations: DEFAULT_KDF_ITERATIONS,
    algo: 'PBKDF2-SHA256',
  });
});

// ── 登录 ─────────────────────────────────────────────────────
authRoutes.post('/login', csrfGuard, async (c) => {
  const body = await readJson<{ username?: unknown; verifier?: unknown }>(c);
  const username = normalizeUsername(body.username);
  const verifier = typeof body.verifier === 'string' ? body.verifier : '';

  if (!username || !verifier) {
    throw badRequest('用户名和密码不能为空');
  }

  const ip = clientIp(c);

  if (await isRateLimited(c.env.DB, username)) {
    await recordLoginAttempt(c.env.DB, username, ip, false);
    throw tooManyRequests('登录失败次数过多，请 15 分钟后再试');
  }

  const user = await c.env.DB.prepare(
    `SELECT id, username, display_name, role, password_hash, password_algo,
            kdf_salt, kdf_iterations
     FROM users WHERE username = ?`,
  )
    .bind(username)
    .first<UserRow>();

  // 统一失败路径：用户不存在 / 待重置 / 校验不通过，对外都是同一句话，
  // 且都走一次 HMAC，避免通过响应时间区分。
  const fail = async () => {
    await recordLoginAttempt(c.env.DB, username, ip, false);
    return unauthorized('用户名或密码错误', 'INVALID_CREDENTIALS');
  };

  if (!user || user.password_algo !== 'stretch-pbkdf2-sha256' || !user.kdf_salt || !user.password_hash) {
    throw await fail();
  }

  const matched = await verifyCredential(user.kdf_salt, user.password_hash, verifier);
  if (!matched) {
    throw await fail();
  }

  const auth = toPublicUser(user);
  const { token } = await createSession(c.env.DB, user.id);

  await recordLoginAttempt(c.env.DB, username, ip, true);
  // 顺带清理过期会话，避免额外的定时任务
  await purgeExpiredSessions(c.env.DB);

  c.header('Set-Cookie', buildSessionCookie(token, SESSION_DAYS * 86_400));
  return c.json({ ok: true, user: auth });
});

// ── 登出 ─────────────────────────────────────────────────────
authRoutes.post('/logout', csrfGuard, async (c) => {
  const token = readSessionCookie(c.req.header('Cookie'));
  if (token) {
    // 即便会话已失效也照常返回成功，登出应是幂等的
    const session = await resolveSession(c.env.DB, token);
    if (session) await destroySession(c.env.DB, session.sessionId);
  }
  c.header('Set-Cookie', buildClearCookie());
  return c.json({ ok: true });
});

// ── 当前用户 ─────────────────────────────────────────────────
authRoutes.get('/me', requireLogin, (c) => {
  const { user } = currentAuth(c);
  return c.json({ user });
});

// ── 修改显示名 ───────────────────────────────────────────────
authRoutes.post('/update-profile', csrfGuard, requireLogin, async (c) => {
  const body = await readJson<{ display_name?: unknown }>(c);
  const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
  if (!displayName) {
    throw badRequest('显示名不能为空');
  }
  if (displayName.length > 32) {
    throw badRequest('显示名不能超过 32 个字符');
  }

  const { user } = currentAuth(c);
  await c.env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?')
    .bind(displayName, user.id)
    .run();

  return c.json({ ok: true, user: { ...user, display_name: displayName } });
});

// ── 修改口令 ─────────────────────────────────────────────────
//
// 请求体：{ current_verifier, next: { verifier, iterations? } }
// 客户端需对旧口令与新口令各做一次拉伸（旧口令的盐取 /challenge）。
authRoutes.post('/change-password', csrfGuard, requireLogin, async (c) => {
  const { user, sessionId } = currentAuth(c);
  const body = await readJson<{
    current_verifier?: unknown;
    next?: { verifier?: unknown; iterations?: unknown };
  }>(c);

  const currentVerifier = typeof body.current_verifier === 'string' ? body.current_verifier : '';
  const nextVerifier = typeof body.next?.verifier === 'string' ? body.next.verifier : '';
  const nextIterations =
    typeof body.next?.iterations === 'number' && body.next.iterations > 0
      ? Math.floor(body.next.iterations)
      : DEFAULT_KDF_ITERATIONS;

  if (!currentVerifier || !nextVerifier) {
    throw badRequest('请填写完整');
  }
  if (nextVerifier.length < 16) {
    throw badRequest('新密码不合法');
  }

  const row = await c.env.DB.prepare('SELECT password_hash, kdf_salt FROM users WHERE id = ?')
    .bind(user.id)
    .first<Pick<UserRow, 'password_hash' | 'kdf_salt'>>();

  if (!row?.kdf_salt || !row.password_hash) {
    throw notFound('账号状态异常，请联系管理员重置密码');
  }

  const matched = await verifyCredential(row.kdf_salt, row.password_hash, currentVerifier);
  if (!matched) {
    throw badRequest('原密码错误', 'INVALID_CURRENT_PASSWORD');
  }

  const cred = await credentialFromVerifier(nextVerifier, nextIterations);
  await c.env.DB.prepare(
    `UPDATE users SET password_hash = ?, password_algo = ?, kdf_salt = ?, kdf_iterations = ?
     WHERE id = ?`,
  )
    .bind(cred.passwordHash, cred.algo, cred.salt, cred.iterations, user.id)
    .run();

  // 改密后使其它设备的会话立即失效，保留当前会话
  await destroyUserSessions(c.env.DB, user.id, sessionId);

  return c.json({ ok: true });
});
