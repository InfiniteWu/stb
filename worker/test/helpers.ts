/**
 * 测试辅助：真实 HTTP 调用 + 会话管理 + 数据夹具。
 */

import { SELF, env } from 'cloudflare:test';

export const BASE = 'https://example.com';

/** 一次 API 调用 */
export interface ApiResult<T = any> {
    status: number;
    data: T;
    setCookie: string | null;
}

/** 用真实 HTTP 请求打整个 Worker（含中间件链） */
export async function api<T = any>(
    method: string,
    path: string,
    options: { body?: unknown; cookie?: string; origin?: string | null; contentType?: string } = {},
): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {};

    // origin 显式传 null 表示「不带 Origin 头」；默认同源
    const origin = options.origin === undefined ? BASE : options.origin;
    if (origin) headers['Origin'] = origin;

    if (options.contentType) {
        headers['Content-Type'] = options.contentType;
    } else if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }
    if (options.cookie) headers['Cookie'] = options.cookie;

    // 必须走 SELF：它才会把请求派发给被测 Worker。
    // 直接用全局 fetch 会落到静态资源层，POST/DELETE 会得到 405。
    const res = await SELF.fetch(BASE + path, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    let sid: string | null = null;
    for (const c of setCookies) {
        const m = /^__Host-sid=([^;]*)/.exec(c);
        if (m) sid = m[1] ? `__Host-sid=${m[1]}` : null;
    }

    const text = await res.text();
    let data: any = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }
    }

    return { status: res.status, data, setCookie: sid };
}

export const get = <T = any>(path: string, cookie?: string) => api<T>('GET', path, { cookie });
export const post = <T = any>(path: string, body?: unknown, cookie?: string) =>
    api<T>('POST', path, { body: body ?? {}, cookie });
export const put = <T = any>(path: string, body: unknown, cookie?: string) =>
    api<T>('PUT', path, { body, cookie });
export const del = <T = any>(path: string, cookie?: string) => api<T>('DELETE', path, { cookie });

/**
 * 按前端的真实流程拉伸口令：
 * 取挑战 → PBKDF2 → 提交 verifier。
 */
export async function stretch(password: string, saltB64: string, iterations: number): Promise<string> {
    const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        key,
        256,
    );
    return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

function randomSalt(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return btoa(String.fromCharCode(...bytes));
}

/**
 * 直接写库创建用户（比走接口快，且不受管理员权限约束）。
 *
 * 幂等：用户名已存在时改为更新其凭据并复用原 id。
 * 这样「先 createUserRow 再 loginAs」或同名的多步用例都不会撞唯一约束 ——
 * 这是写测试时极易犯的错误，与其在每个用例里小心翼翼，不如让辅助函数容错。
 */
export async function createUserRow(
    username: string,
    password: string,
    role: 'admin' | 'user' = 'user',
): Promise<number> {
    const salt = randomSalt();
    const iterations = 100_000; // 测试用低轮数，保持用例快速；服务端下限即为 100000
    const verifier = await stretch(password, salt, iterations);

    // 服务端存的是 HMAC(salt, stretched)
    const { deriveVerifier } = await import('../src/lib/password');
    const hash = await deriveVerifier(salt, verifier);

    const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?')
        .bind(username)
        .first<{ id: number }>();

    if (existing) {
        await env.DB.prepare(
            `UPDATE users
                SET display_name = ?, role = ?, password_hash = ?,
                    password_algo = 'stretch-pbkdf2-sha256', kdf_salt = ?, kdf_iterations = ?,
                    legacy_password_hash = NULL
              WHERE id = ?`,
        )
            .bind(username, role, hash, salt, iterations, existing.id)
            .run();
        return existing.id;
    }

    const res = await env.DB.prepare(
        `INSERT INTO users (username, display_name, role, password_hash, password_algo, kdf_salt, kdf_iterations)
         VALUES (?, ?, ?, ?, 'stretch-pbkdf2-sha256', ?, ?)`,
    )
        .bind(username, username, role, hash, salt, iterations)
        .run();

    return res.meta.last_row_id;
}

/** 创建用户并登录，返回 Cookie */
export async function loginAs(
    username: string,
    password: string,
    role: 'admin' | 'user' = 'user',
): Promise<{ userId: number; cookie: string }> {
    const userId = await createUserRow(username, password, role);

    const ch = await post('/api/auth/challenge', { username });
    const verifier = await stretch(password, ch.data.salt, ch.data.iterations);
    const res = await post('/api/auth/login', { username, verifier });

    if (res.status !== 200 || !res.setCookie) {
        throw new Error(`登录失败: ${res.status} ${JSON.stringify(res.data)}`);
    }
    return { userId, cookie: res.setCookie };
}

/** 建题库 + 题目，返回 id */
export async function createBankWithQuestions(
    questions: Array<{
        type: 'single' | 'multiple' | 'truefalse';
        stem: string;
        options: string[];
        answer: number | number[];
    }>,
    bankName = '测试题库',
): Promise<{ bankId: number; questionIds: number[] }> {
    const bank = await env.DB.prepare('INSERT INTO question_banks (name) VALUES (?)')
        .bind(bankName)
        .run();
    const bankId = bank.meta.last_row_id;

    const ids: number[] = [];
    for (const q of questions) {
        const r = await env.DB.prepare(
            `INSERT INTO questions (bank_id, type, stem, options, answer, explanation)
             VALUES (?, ?, ?, ?, ?, '')`,
        )
            .bind(bankId, q.type, q.stem, JSON.stringify(q.options), JSON.stringify(q.answer))
            .run();
        ids.push(r.meta.last_row_id);
    }

    await env.DB.prepare(
        `UPDATE question_banks SET
           question_count  = (SELECT COUNT(*) FROM questions WHERE bank_id = ?),
           single_count    = (SELECT COUNT(*) FROM questions WHERE bank_id = ? AND type='single'),
           multiple_count  = (SELECT COUNT(*) FROM questions WHERE bank_id = ? AND type='multiple'),
           truefalse_count = (SELECT COUNT(*) FROM questions WHERE bank_id = ? AND type='truefalse')
         WHERE id = ?`,
    )
        .bind(bankId, bankId, bankId, bankId, bankId)
        .run();

    return { bankId, questionIds: ids };
}

/** 常用夹具：单选/多选/判断各一题 */
export const SAMPLE_QUESTIONS = [
    { type: 'single' as const, stem: '单选题干', options: ['甲', '乙', '丙'], answer: 1 },
    { type: 'multiple' as const, stem: '多选题干', options: ['A', 'B', 'C', 'D'], answer: [0, 2] },
    { type: 'truefalse' as const, stem: '判断题干', options: ['对', '错'], answer: 0 },
];
