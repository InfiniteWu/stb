#!/usr/bin/env node
/**
 * 设置 / 重置某个账号的口令（引导用）。
 *
 * 用法：
 *   node worker/scripts/set-password.mjs <用户名> [口令]
 *   node worker/scripts/set-password.mjs <用户名> --stdin < 口令文件
 *
 * 输出可直接喂给 wrangler 的 SQL：
 *   node worker/scripts/set-password.mjs admin '新口令' > /tmp/pw.sql
 *   npx wrangler d1 execute DB --local  --file=/tmp/pw.sql
 *   npx wrangler d1 execute DB --remote --file=/tmp/pw.sql
 *
 * 为什么需要它：旧 PHP 版用 bcrypt($2y$12$)，新架构下无法验证，迁移过来的
 * 账号 password_hash 为空、password_algo='legacy-bcrypt'，必须先重置一次口令
 * 才能登录。它同时充当管理员初始口令的引导入口。
 *
 * 关键：本脚本使用与浏览器完全相同的 WebCrypto API 与参数
 * （crypto.subtle.deriveBits PBKDF2-SHA256，32 字节输出；
 *  再以盐为 HMAC-SHA256 密钥对拉伸值签名），
 * 因此结果与服务端 lib/password.ts 的校验逻辑逐字节一致。
 * 该一致性由 worker/test/password.spec.ts 断言。
 */

import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;

/**
 * 必须与 worker/src/lib/password.ts 的 DEFAULT_KDF_ITERATIONS 保持一致。
 * 此处无法直接 import 该 TS 模块（其内部使用无扩展名的 TS 风格导入，
 * Node 的 ESM 解析器无法处理），故显式重复并由测试守护。
 */
const DEFAULT_KDF_ITERATIONS = 600_000;

const SALT_BYTES = 16;
const KEY_BITS = 256;

// ── 编码（与 worker/src/lib/password.ts 对齐）────────────────
const bytesToBase64 = (bytes) => Buffer.from(bytes).toString('base64');
const base64ToBytes = (b64) => new Uint8Array(Buffer.from(b64, 'base64'));

// ── 参数解析 ─────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
  console.error(`用法: node worker/scripts/set-password.mjs <用户名> [口令|--stdin]

示例:
  node worker/scripts/set-password.mjs admin 'MyS3cret-Pass' > /tmp/pw.sql
  npx wrangler d1 execute DB --local --file=/tmp/pw.sql

选项:
  --iterations <n>   PBKDF2 轮数（默认 ${DEFAULT_KDF_ITERATIONS}）
  --stdin            从标准输入读取口令，避免进入 shell 历史`);
  process.exit(argv.length === 0 ? 1 : 0);
}

const username = argv[0];

let iterations = DEFAULT_KDF_ITERATIONS;
const iterIdx = argv.indexOf('--iterations');
if (iterIdx !== -1) {
  const parsed = Number.parseInt(argv[iterIdx + 1] ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 100_000) {
    console.error('✘ --iterations 必须是 ≥ 100000 的整数');
    process.exit(1);
  }
  iterations = parsed;
}

let password;
if (argv.includes('--stdin')) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
} else {
  password = argv[1];
}

if (!password) {
  console.error('✘ 口令不能为空');
  process.exit(1);
}
if (password.length < 6) {
  console.error('✘ 口令至少 6 位');
  process.exit(1);
}

// ── 派生 ─────────────────────────────────────────────────────
const salt = webcrypto.getRandomValues(new Uint8Array(SALT_BYTES));
const saltB64 = bytesToBase64(salt);

const baseKey = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
  'deriveBits',
]);
const stretchedBits = await subtle.deriveBits(
  { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
  baseKey,
  KEY_BITS,
);

const hmacKey = await subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const signature = await subtle.sign('HMAC', hmacKey, stretchedBits);
const verifier = bytesToBase64(new Uint8Array(signature));

const esc = (v) => `'${String(v).replace(/'/g, "''")}'`;

process.stdout.write(`-- 为账号 ${username} 设置口令（迭代 ${iterations} 轮）
-- 生成于 ${new Date().toISOString()}
UPDATE users
   SET password_hash  = ${esc(verifier)},
       password_algo  = 'stretch-pbkdf2-sha256',
       kdf_salt       = ${esc(saltB64)},
       kdf_iterations = ${iterations}
 WHERE username = ${esc(username)};

-- 校验：上面必须恰好影响 1 行。若为 0 行说明用户名不存在。
SELECT changes() AS affected_rows;
`);
