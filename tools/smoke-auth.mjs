#!/usr/bin/env node
/**
 * 端到端冒烟测试：用真实 HTTP 请求跑通认证全流程。
 *
 * 用法：node tools/smoke-auth.mjs [baseUrl] [用户名] [口令]
 *
 * 它扮演浏览器：完成 /challenge 取盐、PBKDF2 拉伸、/login 提交 verifier，
 * 然后验证 Cookie 会话、/me、登出、以及若干负路径。
 * 用于在写单元测试之前先确认真实运行时行为。
 */

const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';
const USERNAME = process.argv[3] ?? 'admin';
const PASSWORD = process.argv[4];

if (!PASSWORD) {
  console.error('用法: node tools/smoke-auth.mjs <baseUrl> <用户名> <口令>');
  process.exit(1);
}

let pass = 0;
let fail = 0;

const check = (label, cond, detail = '') => {
  if (cond) {
    pass++;
    console.log(`  ✔ ${label}`);
  } else {
    fail++;
    console.log(`  ✘ ${label}${detail ? '  → ' + detail : ''}`);
  }
};

const post = (path, body, cookie) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: BASE,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });

const get = (path, cookie) =>
  fetch(BASE + path, {
    headers: { Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) },
  });

/** 从 Set-Cookie 中取出 __Host-sid 值 */
const sidFrom = (res) => {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const c of raw) {
    const m = /(?:^|,\s*)__Host-sid=([^;]*)/.exec(c);
    if (m) return m[1];
  }
  return null;
};

const stretch = async (password, saltB64, iterations) => {
  const salt = Buffer.from(saltB64, 'base64');
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    256,
  );
  return Buffer.from(bits).toString('base64');
};

console.log(`\n═══ 认证冒烟测试  ${BASE}  用户=${USERNAME} ═══\n`);

// 1) 健康检查
console.log('健康检查');
const health = await get('/api/health');
check('GET /api/health 返回 200', health.status === 200, `实际 ${health.status}`);

// 2) 挑战（存在的用户）
console.log('\n挑战');
const chRes = await post('/api/auth/challenge', { username: USERNAME });
const challenge = await chRes.json();
check('已存在账号返回 salt', typeof challenge.salt === 'string' && challenge.salt.length > 0,
  JSON.stringify(challenge).slice(0, 120));
check('返回 iterations', typeof challenge.iterations === 'number', String(challenge.iterations));

// 3) 挑战（不存在的用户）—— 必须是确定性假盐，且形态与真盐一致
const ghost1 = await (await post('/api/auth/challenge', { username: 'no-such-user-xyz' })).json();
const ghost2 = await (await post('/api/auth/challenge', { username: 'no-such-user-xyz' })).json();
check('未知用户返回假盐而非报错', typeof ghost1.salt === 'string');
check('假盐是确定性的（不构成枚举预言机）', ghost1.salt === ghost2.salt);
check('假盐长度与真盐一致', ghost1.salt.length === (challenge.salt ?? '').length);
check('假盐与真盐不同', ghost1.salt !== challenge.salt);

// 4) 错误口令
console.log('\n失败路径');
const badVerifier = await stretch(PASSWORD + '-wrong', challenge.salt, challenge.iterations);
const badRes = await post('/api/auth/login', { username: USERNAME, verifier: badVerifier });
check('错误口令返回 401', badRes.status === 401, `实际 ${badRes.status}`);
check('错误口令不下发 Cookie', sidFrom(badRes) === null);

const noUserRes = await post('/api/auth/login', { username: 'no-such-user-xyz', verifier: badVerifier });
check('未知用户登录返回 401', noUserRes.status === 401, `实际 ${noUserRes.status}`);

// 5) 正确口令
console.log('\n登录');
const verifier = await stretch(PASSWORD, challenge.salt, challenge.iterations);
const loginRes = await post('/api/auth/login', { username: USERNAME, verifier });
const loginBody = await loginRes.json();
check('正确口令返回 200', loginRes.status === 200, JSON.stringify(loginBody).slice(0, 160));
const sid = sidFrom(loginRes);
check('下发 __Host-sid Cookie', typeof sid === 'string' && sid.length > 0);

const setCookieRaw = (loginRes.headers.getSetCookie?.() ?? []).join(' ');
check('Cookie 带 HttpOnly', /HttpOnly/i.test(setCookieRaw));
check('Cookie 带 Secure', /Secure/i.test(setCookieRaw));
check('Cookie 带 SameSite=Lax', /SameSite=Lax/i.test(setCookieRaw));
check('登录响应不含任何哈希字段', !/password_hash|kdf_salt|legacy_password/.test(JSON.stringify(loginBody)));

// 6) 会话
console.log('\n会话');
const meRes = await get('/api/auth/me', `__Host-sid=${sid}`);
const me = await meRes.json();
check('GET /me 返回 200', meRes.status === 200, `实际 ${meRes.status}`);
check('/me 返回正确用户', me.user?.username === USERNAME, JSON.stringify(me).slice(0, 120));
check('/me 不泄露口令字段', !/password_hash|kdf_salt/.test(JSON.stringify(me)));

const noCookie = await get('/api/auth/me');
check('无 Cookie 访问 /me 返回 401', noCookie.status === 401, `实际 ${noCookie.status}`);

const badCookie = await get('/api/auth/me', '__Host-sid=totally-invalid-token');
check('伪造 token 返回 401', badCookie.status === 401, `实际 ${badCookie.status}`);

// 7) 管理员权限
console.log('\n权限');
const usersRes = await get('/api/users', `__Host-sid=${sid}`);
check('管理员可列出用户', usersRes.status === 200, `实际 ${usersRes.status}`);
const usersList = await usersRes.json();
if (usersRes.status === 200) {
  check('用户列表不含哈希字段', !/password_hash|kdf_salt/.test(JSON.stringify(usersList)));
}

// 8) CSRF
console.log('\nCSRF 防护');
const crossOrigin = await fetch(BASE + '/api/auth/logout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com', Cookie: `__Host-sid=${sid}` },
  body: '{}',
});
check('跨站 Origin 被拒绝', crossOrigin.status === 403, `实际 ${crossOrigin.status}`);

// 跨站表单必须「带请求体」才会被 Content-Type 检查拦下 ——
// 无体的请求本就不携带参数，强制要求 application/json 只会误伤正常的
// DELETE / 无体 PUT。这里用真实表单体来验证。
const formPost = await fetch(BASE + '/api/auth/logout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE, Cookie: `__Host-sid=${sid}` },
  body: 'a=1',
});
check('带请求体的非 JSON Content-Type 被拒绝', formPost.status === 403, `实际 ${formPost.status}`);

const emptyBody = await fetch(BASE + '/api/auth/logout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE, Cookie: `__Host-sid=${sid}` },
});
check('无请求体的写操作不受 Content-Type 限制', emptyBody.status === 200, `实际 ${emptyBody.status}`);

// 9) 登出
console.log('\n登出');
const logoutRes = await post('/api/auth/logout', {}, `__Host-sid=${sid}`);
check('登出返回 200', logoutRes.status === 200, `实际 ${logoutRes.status}`);

const afterLogout = await get('/api/auth/me', `__Host-sid=${sid}`);
check('登出后旧 Cookie 失效', afterLogout.status === 401, `实际 ${afterLogout.status}`);

// 汇总
console.log(`\n═══ 结果: ${pass} 通过 / ${fail} 失败 ═══\n`);
process.exit(fail === 0 ? 0 : 1);
