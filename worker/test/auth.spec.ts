/**
 * 认证与授权回归测试
 */

import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { api, loginAs, createUserRow, post, get, stretch } from './helpers';

describe('认证', () => {
    it('完整登录流程可用', async () => {
        await createUserRow('alice', 'pass1234', 'admin');

        const ch = await post('/api/auth/challenge', { username: 'alice' });
        expect(ch.status).toBe(200);
        expect(typeof ch.data.salt).toBe('string');
        expect(ch.data.iterations).toBeGreaterThanOrEqual(100000);

        const verifier = await stretch('pass1234', ch.data.salt, ch.data.iterations);
        const login = await post('/api/auth/login', { username: 'alice', verifier });

        expect(login.status).toBe(200);
        expect(login.data.user.username).toBe('alice');
        expect(login.setCookie).toContain('__Host-sid=');

        const me = await get('/api/auth/me', login.setCookie!);
        expect(me.status).toBe(200);
        expect(me.data.user.username).toBe('alice');
    });

    it('错误口令被拒绝', async () => {
        await createUserRow('alice', 'pass1234');
        const ch = await post('/api/auth/challenge', { username: 'alice' });
        const verifier = await stretch('wrong-password', ch.data.salt, ch.data.iterations);

        const res = await post('/api/auth/login', { username: 'alice', verifier });
        expect(res.status).toBe(401);
        expect(res.setCookie).toBeNull();
    });

    /**
     * 回归：改密曾用 credentialFromVerifier 入库，它会另生成一个服务端盐，
     * 把客户端拉伸新口令时用的盐丢掉。登录时 /challenge 下发的是库里的盐，
     * 客户端据此重新拉伸得到的值与入库值永不相等 —— 改密「成功」之后账号
     * 再也登不进去，原口令又已被覆盖。这里按登录页的真实流程复现。
     */
    it('改密后可以用新口令登录（客户端盐必须原样入库）', async () => {
        await createUserRow('alice', 'oldpass1');

        const ch0 = await post('/api/auth/challenge', { username: 'alice' });
        const v0 = await stretch('oldpass1', ch0.data.salt, ch0.data.iterations);
        const login = await post('/api/auth/login', { username: 'alice', verifier: v0 });
        expect(login.status).toBe(200);
        const cookie = login.setCookie!;

        // 旧口令：用服务端下发的盐拉伸
        const ch1 = await post('/api/auth/challenge', { username: 'alice' });
        const currentVerifier = await stretch('oldpass1', ch1.data.salt, ch1.data.iterations);

        // 新口令：客户端自选盐拉伸，等价于前端 KDF.makeKdfPayload
        const nextSalt = btoa(
            String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))),
        );
        const nextIterations = 100_000;
        const nextVerifier = await stretch('newpass2', nextSalt, nextIterations);

        const changed = await post(
            '/api/auth/change-password',
            {
                current_verifier: currentVerifier,
                next: { salt: nextSalt, iterations: nextIterations, verifier: nextVerifier },
            },
            cookie,
        );
        expect(changed.status).toBe(200);

        // 库里的盐必须就是客户端拉伸新口令时用的那个，否则登录必然失败
        const ch2 = await post('/api/auth/challenge', { username: 'alice' });
        expect(ch2.data.salt).toBe(nextSalt);

        // 完整重放登录页流程：新口令可登录
        const v2 = await stretch('newpass2', ch2.data.salt, ch2.data.iterations);
        const relogin = await post('/api/auth/login', { username: 'alice', verifier: v2 });
        expect(relogin.status).toBe(200);

        // 旧口令必须失效
        const ch3 = await post('/api/auth/challenge', { username: 'alice' });
        const v3 = await stretch('oldpass1', ch3.data.salt, ch3.data.iterations);
        const oldLogin = await post('/api/auth/login', { username: 'alice', verifier: v3 });
        expect(oldLogin.status).toBe(401);
    });

    it('未知用户返回确定性假盐（不可用于枚举用户名）', async () => {
        const a = await post('/api/auth/challenge', { username: 'ghost' });
        const b = await post('/api/auth/challenge', { username: 'ghost' });

        expect(a.status).toBe(200);
        expect(a.data.salt).toBe(b.data.salt);

        // 与真实用户的盐形态一致，无法据长度或格式区分
        await createUserRow('alice', 'pass1234');
        const real = await post('/api/auth/challenge', { username: 'alice' });
        expect(a.data.salt).toHaveLength(real.data.salt.length);
        expect(a.data.salt).not.toBe(real.data.salt);
    });

    it('响应中不泄露任何口令字段', async () => {
        await createUserRow('alice', 'pass1234', 'admin');
        const login = await loginAs('alice', 'pass1234', 'admin');

        const me = await get('/api/auth/me', login.cookie);
        const users = await get('/api/users', login.cookie);

        for (const payload of [me.data, users.data]) {
            const text = JSON.stringify(payload);
            expect(text).not.toMatch(/password_hash/);
            expect(text).not.toMatch(/kdf_salt/);
            expect(text).not.toMatch(/legacy_password/);
        }
    });

    it('legacy-bcrypt 账号提示需要重置且无法登录', async () => {
        await env.DB.prepare(
            `INSERT INTO users (username, display_name, role, password_algo, legacy_password_hash)
             VALUES ('old', '老账号', 'user', 'legacy-bcrypt', '$2y$12$abcdefghijklmnopqrstuv')`,
        ).run();

        const ch = await post('/api/auth/challenge', { username: 'old' });
        expect(ch.data.needsReset).toBe(true);
        expect(ch.data.code).toBe('PASSWORD_RESET_REQUIRED');

        const login = await post('/api/auth/login', {
            username: 'old',
            verifier: 'A'.repeat(43) + '=',
        });
        expect(login.status).toBe(401);
    });

    it('登录会签发新会话（消除会话固定）', async () => {
        await createUserRow('alice', 'pass1234');
        const first = await loginAs('alice', 'pass1234');

        const ch = await post('/api/auth/challenge', { username: 'alice' });
        const verifier = await stretch('pass1234', ch.data.salt, ch.data.iterations);
        const second = await post('/api/auth/login', { username: 'alice', verifier });

        expect(second.setCookie).not.toBe(first.cookie);
    });

    it('登出后旧 Cookie 失效', async () => {
        const { cookie } = await loginAs('alice', 'pass1234');
        expect((await get('/api/auth/me', cookie)).status).toBe(200);

        const out = await post('/api/auth/logout', {}, cookie);
        expect(out.status).toBe(200);
        expect((await get('/api/auth/me', cookie)).status).toBe(401);
    });

    it('连续失败达到阈值后触发限流', async () => {
        await createUserRow('alice', 'pass1234');
        const ch = await post('/api/auth/challenge', { username: 'alice' });
        const bad = await stretch('nope', ch.data.salt, ch.data.iterations);

        let sawRateLimit = false;
        for (let i = 0; i < 15; i++) {
            const res = await post('/api/auth/login', { username: 'alice', verifier: bad });
            if (res.status === 429) {
                sawRateLimit = true;
                break;
            }
        }
        expect(sawRateLimit).toBe(true);
    });

    it('伪造的 Cookie 无法通过', async () => {
        const res = await get('/api/auth/me', '__Host-sid=forged-token-value');
        expect(res.status).toBe(401);
    });
});

describe('CSRF 防护', () => {
    it('跨站 Origin 被拒绝', async () => {
        const { cookie } = await loginAs('alice', 'pass1234');

        const res = await api('POST', '/api/auth/logout', {
            body: {},
            cookie,
            origin: 'https://evil.example.com',
        });
        expect(res.status).toBe(403);
        expect(res.data.code).toBe('BAD_ORIGIN');
    });

    it('带请求体时非 JSON 的 Content-Type 被拒绝', async () => {
        const { cookie } = await loginAs('alice', 'pass1234');

        // 跨站表单能发出的正是这种简单类型，必须挡下
        const res = await api('POST', '/api/auth/logout', {
            body: { a: 1 },
            cookie,
            contentType: 'application/x-www-form-urlencoded',
        });
        expect(res.status).toBe(403);
        expect(res.data.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('无请求体的写操作（DELETE）不受 Content-Type 限制', async () => {
        const alice = await loginAs('alice', 'pass1234', 'admin');
        const bob = await createUserRow('bob', 'pass1234');

        // 不带 Content-Type，不应被 CSRF 守卫误伤
        const res = await api('DELETE', `/api/users/${bob}`, { cookie: alice.cookie });
        expect(res.status).toBe(200);
    });

    it('同源 JSON 写操作正常放行', async () => {
        const { cookie } = await loginAs('alice', 'pass1234');
        const res = await api('POST', '/api/auth/logout', { body: {}, cookie });
        expect(res.status).toBe(200);
    });
});

describe('权限', () => {
    it('未登录访问受保护端点返回 401', async () => {
        for (const path of ['/api/banks', '/api/dashboard', '/api/wrongbook', '/api/users']) {
            const res = await get(path);
            expect(res.status, path).toBe(401);
        }
    });

    it('普通用户访问管理端点返回 403', async () => {
        const { cookie } = await loginAs('bob', 'pass1234', 'user');

        expect((await get('/api/users', cookie)).status).toBe(403);
        expect((await post('/api/banks', { name: 'x' }, cookie)).status).toBe(403);
        expect((await post('/api/import', { questions: [] }, cookie)).status).toBe(403);
    });

    it('管理员可以访问管理端点', async () => {
        const { cookie } = await loginAs('root', 'pass1234', 'admin');
        expect((await get('/api/users', cookie)).status).toBe(200);
        expect((await get('/api/banks', cookie)).status).toBe(200);
    });
});
