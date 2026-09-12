/**
 * 用户管理 API（仅管理员）
 *
 *   GET    /api/users              列出用户
 *   GET    /api/users/:id          单个用户
 *   POST   /api/users              新建用户
 *   PUT    /api/users/:id          改显示名 / 角色
 *   DELETE /api/users/:id          删除用户
 *   POST   /api/users/:id/reset-password  重置口令
 *
 * 口令由管理员浏览器完成 PBKDF2 拉伸后再提交（见 lib/password.ts），
 * 服务端只做一次 HMAC 存库，因此这里收到的始终是 kdf 载荷而非明文口令。
 */

import { Hono } from 'hono';
import type { AppBindings, Role, UserRow } from '../types';
import { badRequest, notFound, readJson } from '../lib/json';
import { credentialFromPayload, parseKdfPayload } from '../lib/password';
import { destroyUserSessions, toPublicUser } from '../lib/session';
import { currentAuth, csrfGuard, requireAdmin } from '../middleware/auth';

export const userRoutes = new Hono<AppBindings>();

userRoutes.use('*', requireAdmin);

const VALID_ROLES: readonly Role[] = ['admin', 'user'];

function normalizeUsername(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

// ── 列出用户 ─────────────────────────────────────────────────
userRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, username, display_name, role, created_at FROM users ORDER BY id',
  ).all<Pick<UserRow, 'id' | 'username' | 'display_name' | 'role' | 'created_at'>>();

  return c.json(results ?? []);
});

// ── 单个用户 ─────────────────────────────────────────────────
userRoutes.get('/:id', async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) throw badRequest('用户 ID 不合法');

  const row = await c.env.DB.prepare(
    'SELECT id, username, display_name, role, created_at FROM users WHERE id = ?',
  )
    .bind(id)
    .first();

  if (!row) throw notFound('用户不存在');
  return c.json(row);
});

// ── 新建用户 ─────────────────────────────────────────────────
userRoutes.post('/', csrfGuard, async (c) => {
  const body = await readJson<{
    username?: unknown;
    display_name?: unknown;
    role?: unknown;
    kdf?: unknown;
  }>(c);

  const username = normalizeUsername(body.username);
  if (!username) throw badRequest('用户名不能为空');
  if (username.length > 32) throw badRequest('用户名不能超过 32 个字符');
  if (!/^[\w.-]+$/.test(username)) throw badRequest('用户名只能包含字母、数字、下划线、点与连字符');

  const role: Role = VALID_ROLES.includes(body.role as Role) ? (body.role as Role) : 'user';

  const payload = parseKdfPayload(body.kdf);
  if (!payload) throw badRequest('口令数据不合法');

  const displayName =
    typeof body.display_name === 'string' && body.display_name.trim()
      ? body.display_name.trim()
      : username;
  if (displayName.length > 32) throw badRequest('显示名不能超过 32 个字符');

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?')
    .bind(username)
    .first();
  if (existing) throw badRequest('用户名已存在', 'USERNAME_TAKEN');

  const cred = await credentialFromPayload(payload);

  const result = await c.env.DB.prepare(
    `INSERT INTO users (username, display_name, role, password_hash, password_algo, kdf_salt, kdf_iterations)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(username, displayName, role, cred.passwordHash, cred.algo, cred.salt, cred.iterations)
    .run();

  return c.json({ ok: true, id: result.meta.last_row_id }, 201);
});

// ── 更新用户 ─────────────────────────────────────────────────
userRoutes.put('/:id', csrfGuard, async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) throw badRequest('用户 ID 不合法');

  const body = await readJson<{ display_name?: unknown; role?: unknown }>(c);
  const me = currentAuth(c);

  const row = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ?')
    .bind(id)
    .first<Pick<UserRow, 'id' | 'role'>>();
  if (!row) throw notFound('用户不存在');

  const fields: string[] = [];
  const values: unknown[] = [];

  if (typeof body.display_name === 'string') {
    const name = body.display_name.trim();
    if (!name) throw badRequest('显示名不能为空');
    if (name.length > 32) throw badRequest('显示名不能超过 32 个字符');
    fields.push('display_name = ?');
    values.push(name);
  }

  if (body.role !== undefined) {
    if (!VALID_ROLES.includes(body.role as Role)) throw badRequest('角色不合法');
    const nextRole = body.role as Role;

    // 不允许把自己降级，否则会失去管理入口
    if (id === me.user.id && nextRole !== 'admin') {
      throw badRequest('不能修改自己的角色', 'CANNOT_DEMOTE_SELF');
    }
    // 系统至少要保留一个管理员
    if (row.role === 'admin' && nextRole !== 'admin') {
      const admins = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")
        .first<{ n: number }>();
      if ((admins?.n ?? 0) <= 1) throw badRequest('至少需要保留一个管理员', 'LAST_ADMIN');
    }
    fields.push('role = ?');
    values.push(nextRole);
  }

  if (fields.length === 0) {
    return c.json({ ok: true });
  }

  values.push(id);
  const result = await c.env.DB.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  if (result.meta.changes === 0) throw notFound('用户不存在');
  return c.json({ ok: true });
});

// ── 删除用户 ─────────────────────────────────────────────────
//
// 旧实现的问题：wrong_book.user_id 缺少 ON DELETE CASCADE，删除会触发
// 外键失败；而 SQLite3Stmt::execute() 默认不抛异常，代码忽略了返回值，
// 于是接口返回 {"ok":true} 但用户根本没被删除。
// 现在 schema 已补齐 CASCADE，且这里检查 meta.changes。
userRoutes.delete('/:id', csrfGuard, async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) throw badRequest('用户 ID 不合法');

  const me = currentAuth(c);
  if (id === me.user.id) throw badRequest('不能删除自己的账号', 'CANNOT_DELETE_SELF');

  const row = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ?')
    .bind(id)
    .first<Pick<UserRow, 'id' | 'role'>>();
  if (!row) throw notFound('用户不存在');

  if (row.role === 'admin') {
    const admins = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")
      .first<{ n: number }>();
    if ((admins?.n ?? 0) <= 1) {
      throw badRequest('不能删除唯一的管理员', 'LAST_ADMIN');
    }
  }

  const result = await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) throw notFound('用户不存在');

  return c.json({ ok: true });
});

// ── 重置口令 ─────────────────────────────────────────────────
userRoutes.post('/:id/reset-password', csrfGuard, async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) throw badRequest('用户 ID 不合法');

  const body = await readJson<{ kdf?: unknown }>(c);
  const payload = parseKdfPayload(body.kdf);
  if (!payload) throw badRequest('口令数据不合法');

  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?')
    .bind(id)
    .first();
  if (!exists) throw notFound('用户不存在');

  const cred = await credentialFromPayload(payload);
  await c.env.DB.prepare(
    `UPDATE users SET password_hash = ?, password_algo = ?, kdf_salt = ?, kdf_iterations = ?
     WHERE id = ?`,
  )
    .bind(cred.passwordHash, cred.algo, cred.salt, cred.iterations, id)
    .run();

  // 被重置者此前所有登录立即失效
  await destroyUserSessions(c.env.DB, id);

  return c.json({ ok: true });
});

/** 供其他模块复用的用户公开表示 */
export { toPublicUser };
