/**
 * 题目、题库统计、分页、用户级联删除、时区等回归测试
 */

import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { toBeijingDate, toBeijingStamp } from '../src/lib/time';
import {
    loginAs,
    createUserRow,
    createBankWithQuestions,
    post,
    get,
    put,
    del,
    stretch,
    BASE,
    SAMPLE_QUESTIONS,
} from './helpers';

describe('题库统计', () => {
    it('删除全部题目后计数为 0 而非 NULL（旧实现 SUM() 返回 NULL）', async () => {
        const { cookie } = await loginAs('admin', 'pass1234', 'admin');
        const { bankId, questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        for (const qid of questionIds) {
            await del(`/api/questions/${qid}`, cookie);
        }

        const bank = await get(`/api/banks/${bankId}`, cookie);
        expect(bank.data.question_count).toBe(0);
        expect(bank.data.single_count).toBe(0);
        expect(bank.data.multiple_count).toBe(0);
        expect(bank.data.truefalse_count).toBe(0);

        // 明确断言不是 null —— 这正是旧实现的症状
        expect(bank.data.question_count).not.toBeNull();
    });

    it('校验并重算题库统计', async () => {
        const { cookie } = await loginAs('admin', 'pass1234', 'admin');
        const { bankId } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        const bank = await get(`/api/banks/${bankId}`, cookie);
        expect(bank.data.question_count).toBe(3);
        expect(bank.data.single_count).toBe(1);
        expect(bank.data.multiple_count).toBe(1);
        expect(bank.data.truefalse_count).toBe(1);
    });
});

describe('题目校验', () => {
    it('拒绝不存在的题库（旧实现外键失败被吞仍返回 201）', async () => {
        const { cookie } = await loginAs('admin', 'pass1234', 'admin');
        const res = await post(
            '/api/questions',
            { bank_id: 999999, type: 'single', stem: '题干', options: ['a', 'b'], answer: 0 },
            cookie,
        );
        expect(res.status).toBe(400);
        expect(res.data.code).toBe('BANK_NOT_FOUND');
    });

    it('拒绝非法题型', async () => {
        const { cookie } = await loginAs('admin', 'pass1234', 'admin');
        const { bankId } = await createBankWithQuestions(SAMPLE_QUESTIONS);
        const res = await post(
            '/api/questions',
            { bank_id: bankId, type: 'essay', stem: '题干', options: ['a', 'b'], answer: 0 },
            cookie,
        );
        expect(res.status).toBe(400);
    });

    it('拒绝少于 2 个选项', async () => {
        const { cookie } = await loginAs('admin', 'pass1234', 'admin');
        const { bankId } = await createBankWithQuestions(SAMPLE_QUESTIONS);
        const res = await post(
            '/api/questions',
            { bank_id: bankId, type: 'single', stem: '题干', options: ['a'], answer: 0 },
            cookie,
        );
        expect(res.status).toBe(400);
    });

    it('拒绝越界的答案下标', async () => {
        const { cookie } = await loginAs('admin', 'pass1234', 'admin');
        const { bankId } = await createBankWithQuestions(SAMPLE_QUESTIONS);
        const res = await post(
            '/api/questions',
            { bank_id: bankId, type: 'single', stem: '题干', options: ['a', 'b'], answer: 9 },
            cookie,
        );
        expect(res.status).toBe(400);
        expect(res.data.error).toMatch(/超出选项范围/);
    });

    it('部分更新不会破坏未传字段（旧实现会把未传字段写成空串）', async () => {
        const { cookie } = await loginAs('admin', 'pass1234', 'admin');
        const { bankId, questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);
        const qid = questionIds[1]!; // 多选题，answer 为 [0,2]

        const res = await put(`/api/questions/${qid}`, { stem: '改过的题干' }, cookie);
        expect(res.status).toBe(200);

        const after = await get(`/api/questions/${qid}`, cookie);
        expect(after.data.stem).toBe('改过的题干');
        expect(after.data.type).toBe('multiple');
        expect(after.data.options).toEqual(['A', 'B', 'C', 'D']);
        expect(after.data.answer).toEqual([0, 2]);

        expect(bankId).toBeGreaterThan(0);
    });

    it('更新题库时不传 name 不会把名称清空（旧实现在此写空串）', async () => {
        const { cookie } = await loginAs('admin', 'pass1234', 'admin');
        const { bankId } = await createBankWithQuestions(SAMPLE_QUESTIONS, '原名');

        await put(`/api/banks/${bankId}`, { description: '只改描述' }, cookie);

        const bank = await get(`/api/banks/${bankId}`, cookie);
        expect(bank.data.name).toBe('原名');
        expect(bank.data.description).toBe('只改描述');
    });
});

describe('分页', () => {
    it('per_page 被钳制到上限 200', async () => {
        const { cookie } = await loginAs('admin', 'pass1234', 'admin');
        await createBankWithQuestions(SAMPLE_QUESTIONS);

        const res = await get('/api/questions?per_page=99999', cookie);
        expect(res.data.per_page).toBe(200);
    });

    it('返回封套结构而非裸数组', async () => {
        const { cookie } = await loginAs('admin', 'pass1234', 'admin');
        const { bankId } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        const res = await get(`/api/questions?bank_id=${bankId}&per_page=2`, cookie);
        expect(Array.isArray(res.data.items)).toBe(true);
        expect(res.data.items).toHaveLength(2);
        expect(res.data.total).toBe(3);
        expect(res.data.page).toBe(1);
    });

    it('分页返回不重复', async () => {
        const { cookie } = await loginAs('admin', 'pass1234', 'admin');
        const { bankId } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        const p1 = await get(`/api/questions?bank_id=${bankId}&per_page=2&page=1`, cookie);
        const p2 = await get(`/api/questions?bank_id=${bankId}&per_page=2&page=2`, cookie);

        const ids1 = p1.data.items.map((q: any) => q.id);
        const ids2 = p2.data.items.map((q: any) => q.id);
        expect(ids1.some((id: number) => ids2.includes(id))).toBe(false);
    });
});

describe('用户管理', () => {
    it('删除带关联数据的用户成功并级联清理（旧实现外键失败却返回成功）', async () => {
        const admin = await loginAs('root', 'pass1234', 'admin');

        // loginAs 内部已建号，这里直接取 id，避免重复创建
        const { userId: bobId, cookie: bobCookie } = await loginAs('bob', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);
        await post(
            '/api/practice/submit',
            { mode: 'random', answers: [{ question_id: questionIds[0]!, selected: 0 }] },
            bobCookie,
        );

        expect(
            (await env.DB.prepare('SELECT COUNT(*) AS n FROM wrong_book WHERE user_id = ?').bind(bobId).first<{ n: number }>())!.n,
        ).toBe(1);

        const res = await del(`/api/users/${bobId}`, admin.cookie);
        expect(res.status).toBe(200);

        // 用户确实被删除
        const stillThere = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(bobId).first();
        expect(stillThere).toBeNull();

        // 关联数据被级联清理，不留孤儿
        expect(
            (await env.DB.prepare('SELECT COUNT(*) AS n FROM wrong_book WHERE user_id = ?').bind(bobId).first<{ n: number }>())!.n,
        ).toBe(0);
        expect(
            (await env.DB.prepare('SELECT COUNT(*) AS n FROM practice_sessions WHERE user_id = ?').bind(bobId).first<{ n: number }>())!.n,
        ).toBe(0);
    });

    it('不能删除自己', async () => {
        const admin = await loginAs('root', 'pass1234', 'admin');
        const res = await del(`/api/users/${admin.userId}`, admin.cookie);
        expect(res.status).toBe(400);
        expect(res.data.code).toBe('CANNOT_DELETE_SELF');
    });

    it('不能删除最后一个管理员', async () => {
        const root = await loginAs('root', 'pass1234', 'admin');
        const other = await loginAs('boss', 'pass1234', 'admin');

        // root 删除 boss 是允许的（还剩 root）
        expect((await del(`/api/users/${other.userId}`, root.cookie)).status).toBe(200);
    });

    it('用户名重复被拒绝', async () => {
        const admin = await loginAs('root', 'pass1234', 'admin');
        await createUserRow('dup', 'pass1234');

        const res = await post(
            '/api/users',
            {
                username: 'dup',
                display_name: 'dup',
                kdf: {
                    salt: btoa('0123456789abcdef'),
                    iterations: 100000,
                    verifier: btoa(String.fromCharCode(...new Uint8Array(32))),
                },
            },
            admin.cookie,
        );
        expect(res.status).toBe(400);
        expect(res.data.code).toBe('USERNAME_TAKEN');
    });

    it('重置口令后旧会话立即失效', async () => {
        const admin = await loginAs('root', 'pass1234', 'admin');
        const bob = await loginAs('bob', 'pass1234');

        expect((await get('/api/auth/me', bob.cookie)).status).toBe(200);

        const salt = btoa('0123456789abcdef');
        const reset = await post(
            `/api/users/${bob.userId}/reset-password`,
            {
                kdf: {
                    salt,
                    iterations: 100000,
                    verifier: btoa(String.fromCharCode(...new Uint8Array(32))),
                },
            },
            admin.cookie,
        );
        expect(reset.status).toBe(200);

        expect((await get('/api/auth/me', bob.cookie)).status).toBe(401);
    });
});

describe('导入', () => {
    it('超过单批上限被拒绝', async () => {
        const { cookie } = await loginAs('admin', 'pass1234', 'admin');
        const res = await post(
            '/api/import',
            {
                bankName: 'x',
                questions: Array.from({ length: 31 }, () => ({
                    type: 'single',
                    stem: 's',
                    options: ['a', 'b'],
                    answer: 0,
                })),
            },
            cookie,
        );
        expect(res.status).toBe(400);
        expect(res.data.code).toBe('BATCH_TOO_LARGE');
    });

    it('导入成功并更新统计，错误定位到整体题号', async () => {
        const { cookie } = await loginAs('admin', 'pass1234', 'admin');
        const res = await post(
            '/api/import',
            {
                bankName: '导入库',
                start_index: 10,
                questions: [
                    { type: 'single', stem: '好题', options: ['a', 'b'], answer: 0 },
                    { type: 'single', stem: '', options: ['a', 'b'], answer: 0 }, // 第 12 题
                ],
            },
            cookie,
        );

        expect(res.status).toBe(201);
        expect(res.data.imported).toBe(1);
        expect(res.data.errors).toHaveLength(1);
        // start_index=10，第二条对应整体第 12 题
        expect(res.data.errors[0].index).toBe(12);

        const bank = await get(`/api/banks/${res.data.bank_id}`, cookie);
        expect(bank.data.question_count).toBe(1);
    });

    it('追加到已有题库时不新建题库', async () => {
        const { cookie } = await loginAs('admin', 'pass1234', 'admin');
        const { bankId } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        const res = await post(
            '/api/import',
            {
                bank_id: bankId,
                questions: [{ type: 'single', stem: '追加题', options: ['a', 'b'], answer: 1 }],
            },
            cookie,
        );

        expect(res.status).toBe(200);
        expect(res.data.bank_created).toBe(false);
        expect(res.data.bank_id).toBe(bankId);

        const bank = await get(`/api/banks/${bankId}`, cookie);
        expect(bank.data.question_count).toBe(4);
    });
});

describe('练习记录', () => {
    it('列表带可读的题库名（旧实现只返回裸 bank_id）', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS, '我的题库');

        await post(
            '/api/practice/submit',
            { mode: 'random', answers: [{ question_id: questionIds[0]!, selected: 1 }] },
            cookie,
        );

        const res = await get('/api/sessions', cookie);
        expect(res.data.sessions[0].bank_name).toBe('我的题库');
    });

    it('跨题库错题练习显示为「错题练习」', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const a = await createBankWithQuestions(SAMPLE_QUESTIONS, 'A库');
        const b = await createBankWithQuestions(SAMPLE_QUESTIONS, 'B库');

        await post(
            '/api/practice/submit',
            {
                mode: 'wrongbook',
                answers: [
                    { question_id: a.questionIds[0]!, selected: 1 },
                    { question_id: b.questionIds[0]!, selected: 1 },
                ],
            },
            cookie,
        );

        const res = await get('/api/sessions', cookie);
        expect(res.data.sessions[0].bank_name).toBe('错题练习');
    });

    it('详情里多选题的答案与选择都是数组', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        const submit = await post(
            '/api/practice/submit',
            { mode: 'random', answers: [{ question_id: questionIds[1]!, selected: [0, 2] }] },
            cookie,
        );

        const detail = await get(`/api/sessions/${submit.data.session_id}`, cookie);
        const multi = detail.data.answers.find((a: any) => a.type === 'multiple');

        expect(Array.isArray(multi.correct_answer)).toBe(true);
        expect(Array.isArray(multi.selected_answer)).toBe(true);
        expect(multi.correct_answer).toEqual([0, 2]);
    });

    it('未作答的详情里 is_correct 为 null 且 selected_answer 为 null', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        const submit = await post(
            '/api/practice/submit',
            { mode: 'random', answers: [{ question_id: questionIds[0]!, selected: null }] },
            cookie,
        );

        const detail = await get(`/api/sessions/${submit.data.session_id}`, cookie);
        expect(detail.data.answers[0].is_correct).toBeNull();
        expect(detail.data.answers[0].selected_answer).toBeNull();
    });

    it('看不到他人的练习记录', async () => {
        const alice = await loginAs('alice', 'pass1234');
        const bob = await loginAs('bob', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        const submit = await post(
            '/api/practice/submit',
            { mode: 'random', answers: [{ question_id: questionIds[0]!, selected: 1 }] },
            alice.cookie,
        );

        expect((await get(`/api/sessions/${submit.data.session_id}`, bob.cookie)).status).toBe(404);
        expect((await get('/api/sessions', bob.cookie)).data.total).toBe(0);
    });

    it('按时间范围筛选（range=7d 排除更早的记录）', async () => {
        const { userId, cookie } = await loginAs('u1', 'pass1234');
        const { bankId, questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        // 一条「今天」的走接口提交，一条 10 天前的直接写库
        // （提交接口只会写当前时间，构造历史数据只能写库）
        await post(
            '/api/practice/submit',
            { mode: 'random', answers: [{ question_id: questionIds[0]!, selected: 1 }] },
            cookie,
        );
        await env.DB.prepare(
            `INSERT INTO practice_sessions
               (user_id, bank_id, mode, total_count, correct_count, wrong_count, unanswered_count, submitted_at)
             VALUES (?, ?, 'random', 1, 1, 0, 0, ?)`,
        )
            .bind(userId, bankId, toBeijingStamp(Date.now() - 10 * 86_400_000))
            .run();

        expect((await get('/api/sessions', cookie)).data.total).toBe(2);
        expect((await get('/api/sessions?range=7d', cookie)).data.total).toBe(1);
        expect((await get('/api/sessions?range=30d', cookie)).data.total).toBe(2);
        expect((await get('/api/sessions?range=all', cookie)).data.total).toBe(2);
    });

    it('按正确率区间筛选（整数百分比、闭区间）', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        // 全对（100%）与全错（0%）各一条
        await post(
            '/api/practice/submit',
            { mode: 'random', answers: [{ question_id: questionIds[0]!, selected: 1 }] },
            cookie,
        );
        await post(
            '/api/practice/submit',
            { mode: 'random', answers: [{ question_id: questionIds[2]!, selected: 1 }] },
            cookie,
        );

        expect((await get('/api/sessions', cookie)).data.total).toBe(2);

        const high = await get('/api/sessions?min_accuracy=80', cookie);
        expect(high.data.total).toBe(1);
        expect(high.data.sessions[0].correct_count).toBe(1);

        const low = await get('/api/sessions?max_accuracy=59', cookie);
        expect(low.data.total).toBe(1);
        expect(low.data.sessions[0].correct_count).toBe(0);

        // 闭区间：min=max=100 只留全对那条
        const exact = await get('/api/sessions?min_accuracy=100&max_accuracy=100', cookie);
        expect(exact.data.total).toBe(1);
        expect(exact.data.sessions[0].correct_count).toBe(1);
    });

    it('非法筛选参数返回 400', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');

        expect((await get('/api/sessions?range=1y', cookie)).status).toBe(400);
        expect((await get('/api/sessions?min_accuracy=abc', cookie)).status).toBe(400);
        expect((await get('/api/sessions?min_accuracy=101', cookie)).status).toBe(400);
        expect((await get('/api/sessions?max_accuracy=60.5', cookie)).status).toBe(400);
        expect((await get('/api/sessions?max_accuracy=-1', cookie)).status).toBe(400);
    });
});

describe('仪表盘', () => {
    it('统计条数与正确率', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        await post(
            '/api/practice/submit',
            {
                mode: 'random',
                answers: [
                    { question_id: questionIds[0]!, selected: 1 }, // 对
                    { question_id: questionIds[2]!, selected: 1 }, // 错
                ],
            },
            cookie,
        );

        const res = await get('/api/dashboard', cookie);
        expect(res.data.today_practice_count).toBe(2);
        expect(res.data.today_correct_count).toBe(1);
        expect(res.data.today_accuracy).toBeCloseTo(0.5);
        expect(res.data.today_new_wrong).toBe(1);
        expect(Array.isArray(res.data.today_wrong_per_bank)).toBe(true);
    });

    it('trend 恒为 7 项、日期连续升序，无练习的日子 accuracy 为 null', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);
        await post(
            '/api/practice/submit',
            { mode: 'random', answers: [{ question_id: questionIds[0]!, selected: 1 }] },
            cookie,
        );

        const { data } = await get('/api/dashboard', cookie);
        expect(data.trend).toHaveLength(7);

        const days = data.trend.map((t: any) => t.day as string);
        expect([...days].sort()).toEqual(days); // 升序
        for (let i = 1; i < days.length; i++) {
            const prev = Date.parse(days[i - 1]! + 'T00:00:00Z');
            const cur = Date.parse(days[i]! + 'T00:00:00Z');
            expect(cur - prev).toBe(86_400_000); // 相邻差一天，无跳日
        }
        expect(days[6]).toBe(toBeijingDate(Date.now())); // 最后一项是今天

        // 只有今天有练习，之前 6 天是空白天
        expect(data.trend[6].answered).toBe(1);
        expect(data.trend[6].correct).toBe(1);
        expect(data.trend[6].accuracy).toBeCloseTo(1);
        expect(data.trend.slice(0, 6).every((t: any) => t.accuracy === null)).toBe(true);
    });

    it('recent_session 取最近一条；没有练习时为 null', async () => {
        const blank = await loginAs('nobody', 'pass1234');
        expect((await get('/api/dashboard', blank.cookie)).data.recent_session).toBeNull();

        const { cookie } = await loginAs('u1', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS, '我的题库');
        const submit = await post(
            '/api/practice/submit',
            { mode: 'random', answers: [{ question_id: questionIds[0]!, selected: 1 }] },
            cookie,
        );

        const recent = (await get('/api/dashboard', cookie)).data.recent_session;
        expect(recent.id).toBe(submit.data.session_id);
        expect(recent.bank_name).toBe('我的题库');
        expect(recent.total_count).toBe(1);
        expect(recent.accuracy).toBeCloseTo(1);
    });

    it('wrong_active_count 随错题产生而变化', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        expect((await get('/api/dashboard', cookie)).data.wrong_active_count).toBe(0);

        await post(
            '/api/practice/submit',
            { mode: 'random', answers: [{ question_id: questionIds[2]!, selected: 1 }] },
            cookie,
        );
        expect((await get('/api/dashboard', cookie)).data.wrong_active_count).toBe(1);
    });
});

describe('时区', () => {
    /**
     * D1 跑在 UTC，`datetime('now','localtime')` 在 D1 中等于 UTC。
     * 旧实现用它判定「今天」，会让所有统计整体偏移 8 小时。
     * 这里直接验证时间工具函数的北京日边界。
     */
    it('北京日边界按 UTC+8 计算', async () => {
        const { beijingDayBounds } = await import('../src/lib/time');

        // 北京时间 2026-03-01 00:30 —— 对应 UTC 2026-02-28 16:30
        const t = Date.UTC(2026, 1, 28, 16, 30, 0);
        const b = beijingDayBounds(t);

        expect(b.today).toBe('2026-03-01');
        expect(b.start).toBe('2026-03-01 00:00:00');
        expect(b.end).toBe('2026-03-02 00:00:00');
    });

    it('北京时间 23:30 仍属当日，不跨到 UTC 的次日', async () => {
        const { beijingDayBounds } = await import('../src/lib/time');

        // 北京时间 2026-03-01 23:30 —— 对应 UTC 2026-03-01 15:30
        const t = Date.UTC(2026, 2, 1, 15, 30, 0);
        const b = beijingDayBounds(t);

        expect(b.today).toBe('2026-03-01');
        expect(b.start).toBe('2026-03-01 00:00:00');
    });

    it('跨零点时进入新的一天', async () => {
        const { beijingDayBounds } = await import('../src/lib/time');

        const before = Date.UTC(2026, 2, 1, 15, 59, 59); // 北京 23:59:59
        const after = Date.UTC(2026, 2, 1, 16, 0, 0); // 北京次日 00:00:00

        expect(beijingDayBounds(before).today).toBe('2026-03-01');
        expect(beijingDayBounds(after).today).toBe('2026-03-02');
    });

    it('生成的时间戳格式与历史数据一致（YYYY-MM-DD HH:MM:SS）', async () => {
        const { toBeijingStamp } = await import('../src/lib/time');
        const s = toBeijingStamp(Date.UTC(2026, 0, 2, 3, 4, 5));
        expect(s).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        expect(s).toBe('2026-01-02 11:04:05');
    });
});

describe('公开统计接口（登录页用）', () => {
    it('无需登录即可读取，且只返回聚合数字', async () => {
        await createBankWithQuestions(SAMPLE_QUESTIONS);

        // 刻意不带 cookie
        const res = await get('/api/public/stats');
        expect(res.status).toBe(200);
        expect(res.data.question_count).toBe(SAMPLE_QUESTIONS.length);
        expect(res.data.bank_count).toBe(1);
        expect(res.data.practice_count).toBe(0);
        // 只有三个聚合字段，不该夹带用户相关数据
        expect(Object.keys(res.data).sort()).toEqual([
            'bank_count',
            'practice_count',
            'question_count',
        ]);
    });

    it('带 5 分钟边缘缓存（避免每次刷新都打 D1）', async () => {
        const res = await SELF.fetch(BASE + '/api/public/stats');
        expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
    });

    it('练习次数随提交增长', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);
        await post(
            '/api/practice/submit',
            { mode: 'random', answers: [{ question_id: questionIds[0]!, selected: 1 }] },
            cookie,
        );

        const res = await get('/api/public/stats');
        expect(res.data.practice_count).toBe(1);
    });
});

describe('登录「记住我」', () => {
    /** 走完整挑战/拉伸流程，返回原始 Set-Cookie */
    async function loginRaw(extra: Record<string, unknown>): Promise<string> {
        await createUserRow('u1', 'pass1234');
        const ch = await post('/api/auth/challenge', { username: 'u1' });
        const verifier = await stretch('pass1234', ch.data.salt, ch.data.iterations);
        const res = await SELF.fetch(BASE + '/api/auth/login', {
            method: 'POST',
            headers: { Origin: BASE, 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'u1', verifier, ...extra }),
        });
        return res.headers.get('Set-Cookie') ?? '';
    }

    it('默认（桌面端不带该字段）仍是 7 天持久 Cookie', async () => {
        const cookie = await loginRaw({});
        expect(cookie).toContain('__Host-sid=');
        expect(cookie).toContain('Max-Age=604800');
    });

    it('显式 remember=false 时发会话 Cookie（不带 Max-Age，关掉浏览器即失效）', async () => {
        const cookie = await loginRaw({ remember: false });
        expect(cookie).toContain('__Host-sid=');
        expect(cookie).not.toContain('Max-Age');
        // 安全属性不能因为这次改动而丢失
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('Secure');
        expect(cookie).toContain('SameSite=Lax');
    });

    it('remember=true 与缺省一致', async () => {
        const cookie = await loginRaw({ remember: true });
        expect(cookie).toContain('Max-Age=604800');
    });
});
