/**
 * 口令处理 —— 客户端拉伸 + 服务端快速验签
 *
 * ## 为什么不用服务端哈希
 *
 * Workers 免费版每个请求只有 10 ms CPU。实测（真实 workerd）：
 *   PBKDF2-SHA256 600k 轮（OWASP 推荐值）≈ 201 ms
 *   bcrypt cost 12（旧库所用的 PHP 默认）  ≈ 250 ms
 * 两者都远超预算，因此服务端无法承载任何强度合格的口令哈希。
 *
 * ## 采用的方案（Bitwarden / 1Password 同款分离式 KDF）
 *
 *   1. 客户端 GET 挑战：拿到 salt 与 iterations
 *   2. 客户端算 stretched = PBKDF2-SHA256(password, salt, iterations, 32B)
 *      —— 约 200 ms，花用户自己的 CPU，不占 Worker 预算
 *   3. 客户端 POST verifier = base64(stretched)
 *   4. 服务端算 HMAC-SHA256(key=salt, msg=stretched)，与库中值常量时间比较
 *      —— 耗时 < 0.1 ms
 *
 * ## 安全性
 *
 * - **数据库泄露**：攻击者拿到 salt 与 HMAC 值，二者均不可逆。破解每个候选
 *   口令仍需完整跑一次 600k 轮 PBKDF2 —— 与直接存 bcrypt/PBKDF2 强度相同，
 *   没有任何削弱。
 * - **服务器被攻破**：攻击者拿到的是 stretched 而非明文口令，可冒充该用户
 *   登录，但无法还原口令本身（无法用于撞库其它站点）。相比服务端直接收到
 *   明文口令的常规方案，这是增强。
 * - **在线爆破**：每次猜测都要完整跑一遍 600k PBKDF2，成本与常规方案相同；
 *   另有 login_attempts 限流兜底。
 * - **代价**：登录多一次 /api/auth/challenge 往返；协议非标准。
 */

import { nowStamp, toBeijingStamp } from './time';

/** 默认拉伸轮数。客户端与挑战接口共用此值。 */
export const DEFAULT_KDF_ITERATIONS = 600_000;

/** 派生密钥长度（字节） */
const KEY_BYTES = 32;

/** 盐长度（字节） */
const SALT_BYTES = 16;

export type PasswordAlgo = 'stretch-pbkdf2-sha256' | 'legacy-bcrypt';

// ── 编码 ────────────────────────────────────────────────────

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── 随机与摘要 ───────────────────────────────────────────────

/** 生成口令盐（base64） */
export function generateSalt(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

/** 生成会话 token（base64url，无填充，可直接放进 Cookie） */
export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SHA-256 → 十六进制（会话表只存 token 的摘要） */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(digest));
}

// ── HMAC ────────────────────────────────────────────────────

async function importHmacKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/**
 * 由盐与客户端拉伸值派生存库校验值。
 * 这是服务端唯一的口令运算，耗时 < 0.1 ms。
 */
export async function deriveVerifier(saltB64: string, stretchedB64: string): Promise<string> {
  const key = await importHmacKey(base64ToBytes(saltB64));
  const sig = await crypto.subtle.sign('HMAC', key, base64ToBytes(stretchedB64));
  return bytesToBase64(new Uint8Array(sig));
}

/**
 * 由用户名派生确定性假盐。
 *
 * 对不存在的用户名也返回稳定值，使攻击者无法通过反复调用 challenge 判断
 * 用户名是否存在（若假盐每次都变，或与真实盐长度/格式不同，就成了枚举预言机）。
 */
export async function deriveDecoySalt(secret: string, username: string): Promise<string> {
  const key = await importHmacKey(new TextEncoder().encode(secret));
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`decoy:${username}`));
  return bytesToBase64(new Uint8Array(sig).slice(0, SALT_BYTES));
}

// ── 常量时间比较 ─────────────────────────────────────────────

/**
 * 常量时间字符串比较，避免通过响应时间差推断校验值。
 * 先比较长度（长度本身不是秘密），再对全部字节做异或累加，不提前返回。
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ── 高层操作 ─────────────────────────────────────────────────

export interface NewCredential {
  salt: string;
  iterations: number;
  algo: PasswordAlgo;
  /** 入库的校验值 */
  passwordHash: string;
}

/**
 * 由客户端提交的拉伸值构造入库凭据。
 * 新增用户、重置口令、修改口令都走这里。
 */
export async function credentialFromVerifier(
  verifierB64: string,
  iterations: number = DEFAULT_KDF_ITERATIONS,
): Promise<NewCredential> {
  const salt = generateSalt();
  return {
    salt,
    iterations,
    algo: 'stretch-pbkdf2-sha256',
    passwordHash: await deriveVerifier(salt, verifierB64),
  };
}

/** 校验客户端提交的拉伸值是否匹配库中凭据 */
export async function verifyCredential(
  saltB64: string,
  storedHash: string,
  verifierB64: string,
): Promise<boolean> {
  const candidate = await deriveVerifier(saltB64, verifierB64);
  return timingSafeEqual(candidate, storedHash);
}

// ── 客户端提交的 KDF 载荷 ────────────────────────────────────

export interface KdfPayload {
  salt: string;
  iterations: number;
  verifier: string;
}

/** 合法 base64 且解码后恰好 16 字节 */
function isValidSalt(b64: string): boolean {
  if (!/^[A-Za-z0-9+/]{22}==$/.test(b64)) return false;
  try {
    return base64ToBytes(b64).length === SALT_BYTES;
  } catch {
    return false;
  }
}

/** 合法 base64 且解码后恰好 32 字节（PBKDF2 输出长度） */
function isValidVerifier(b64: string): boolean {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(b64)) return false;
  try {
    return base64ToBytes(b64).length === KEY_BYTES;
  } catch {
    return false;
  }
}

/**
 * 校验客户端提交的 KDF 载荷。
 * 盐由客户端生成（盐不是秘密，只需唯一），因此必须严格校验格式，
 * 避免把畸形数据写进库后导致该账号永久无法登录。
 */
export function parseKdfPayload(input: unknown): KdfPayload | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;

  const salt = typeof o.salt === 'string' ? o.salt : '';
  const verifier = typeof o.verifier === 'string' ? o.verifier : '';
  if (!isValidSalt(salt) || !isValidVerifier(verifier)) return null;

  const rawIterations = typeof o.iterations === 'number' ? o.iterations : DEFAULT_KDF_ITERATIONS;
  // 轮数下限防止客户端用极低轮数弱化自己的口令
  const iterations = Number.isFinite(rawIterations)
    ? Math.min(Math.max(Math.floor(rawIterations), 100_000), 2_000_000)
    : DEFAULT_KDF_ITERATIONS;

  return { salt, iterations, verifier };
}

/**
 * 由客户端提供的盐与拉伸值构造入库凭据。
 * 与 credentialFromVerifier 的区别是盐由调用方给定（而非服务端生成）。
 */
export async function credentialFromPayload(payload: KdfPayload): Promise<NewCredential> {
  return {
    salt: payload.salt,
    iterations: payload.iterations,
    algo: 'stretch-pbkdf2-sha256',
    passwordHash: await deriveVerifier(payload.salt, payload.verifier),
  };
}

// ── 登录限流 ─────────────────────────────────────────────────

/** 限流窗口（分钟）与阈值 */
export const LOGIN_WINDOW_MINUTES = 15;
export const LOGIN_MAX_FAILURES = 10;

/**
 * 是否应拒绝本次登录尝试。
 * 只统计失败次数；成功登录会清空该用户名的失败记录。
 * 时间戳为定长北京时间字符串，可直接按字典序比较。
 */
export async function isRateLimited(
  db: D1Database,
  username: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const since = toBeijingStamp(nowMs - LOGIN_WINDOW_MINUTES * 60_000);

  const row = await db
    .prepare(
      `SELECT COUNT(*) AS failures FROM login_attempts
       WHERE username = ? AND success = 0 AND attempted_at >= ?`,
    )
    .bind(username, since)
    .first<{ failures: number }>();

  return (row?.failures ?? 0) >= LOGIN_MAX_FAILURES;
}

/** 记录一次登录尝试；成功时顺带清空该用户名的失败历史 */
export async function recordLoginAttempt(
  db: D1Database,
  username: string,
  ip: string,
  success: boolean,
): Promise<void> {
  const now = nowStamp();
  if (success) {
    await db.batch([
      db.prepare('DELETE FROM login_attempts WHERE username = ? AND success = 0').bind(username),
      db
        .prepare('INSERT INTO login_attempts (username, ip, success, attempted_at) VALUES (?, ?, 1, ?)')
        .bind(username, ip, now),
    ]);
    return;
  }
  await db
    .prepare('INSERT INTO login_attempts (username, ip, success, attempted_at) VALUES (?, ?, 0, ?)')
    .bind(username, ip, now)
    .run();
}
