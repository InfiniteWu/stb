/**
 * 服务端判分回归测试
 *
 * 对应修复：判分从前端移到服务端、未作答语义、错题本重新激活。
 */

import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { loginAs, createBankWithQuestions, post, get, SAMPLE_QUESTIONS } from './helpers';

describe('判分', () => {
    it('全部答对时统计正确', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { bankId, questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        const res = await post(
            '/api/practice/submit',
            {
                mode: 'random',
                answers: [
                    { question_id: questionIds[0]!, selected: 1 },
                    { question_id: questionIds[1]!, selected: [0, 2] },
                    { question_id: questionIds[2]!, selected: 0 },
                ],
            },
            cookie,
        );

        expect(res.status).toBe(200);
        expect(res.data.correct_count).toBe(3);
        expect(res.data.wrong_count).toBe(0);
        expect(res.data.unanswered_count).toBe(0);
        expect(res.data.accuracy).toBeCloseTo(1);
        expect(bankId).toBeGreaterThan(0);
    });

    it('客户端伪造 is_correct 无效（旧实现可伪造满分）', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        // 故意全部答错，却声称 is_correct: true
        const res = await post(
            '/api/practice/submit',
            {
                mode: 'random',
                answers: [
                    { question_id: questionIds[0]!, selected: 0, is_correct: true },
                    { question_id: questionIds[1]!, selected: [1], is_correct: true },
                    { question_id: questionIds[2]!, selected: 1, is_correct: true },
                ],
            },
            cookie,
        );

        expect(res.status).toBe(200);
        expect(res.data.correct_count).toBe(0);
        expect(res.data.wrong_count).toBe(3);
    });

    it('多选题按集合比较，顺序无关', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        // 正确答案是 [0,2]，这里以 [2,0] 提交
        const res = await post(
            '/api/practice/submit',
            { mode: 'random', answers: [{ question_id: questionIds[1]!, selected: [2, 0] }] },
            cookie,
        );

        expect(res.data.correct_count).toBe(1);
    });

    it('多选题少选算错', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        const res = await post(
            '/api/practice/submit',
            { mode: 'random', answers: [{ question_id: questionIds[1]!, selected: [0] }] },
            cookie,
        );

        expect(res.data.wrong_count).toBe(1);
        expect(res.data.correct_count).toBe(0);
    });

    it('未作答计「未答」而非「答错」（旧实现 unanswered_count 恒为 0）', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        const res = await post(
            '/api/practice/submit',
            {
                mode: 'random',
                answers: [
                    { question_id: questionIds[0]!, selected: 1 },
                    { question_id: questionIds[1]!, selected: null },
                    { question_id: questionIds[2]!, selected: null },
                ],
            },
            cookie,
        );

        expect(res.data.correct_count).toBe(1);
        expect(res.data.wrong_count).toBe(0);
        expect(res.data.unanswered_count).toBe(2);
    });

    it('未作答的题不会进入错题本', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        await post(
            '/api/practice/submit',
            {
                mode: 'random',
                answers: [
                    { question_id: questionIds[0]!, selected: null },
                    { question_id: questionIds[2]!, selected: null },
                ],
            },
            cookie,
        );

        const wb = await get('/api/wrongbook', cookie);
        expect(wb.data).toHaveLength(0);
    });

    it('抽题响应不包含答案与解析（旧实现随题下发）', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { bankId } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        const res = await post(
            '/api/practice/pick',
            { bank_id: bankId, single_count: 1, multiple_count: 1, truefalse_count: 1 },
            cookie,
        );

        expect(res.status).toBe(200);
        expect(res.data.questions).toHaveLength(3);
        for (const q of res.data.questions) {
            expect(q).not.toHaveProperty('answer');
            expect(q).not.toHaveProperty('explanation');
        }
    });

    it('打乱选项后仍能正确判分（签名置换）', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { bankId } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        const picked = await post(
            '/api/practice/pick',
            { bank_id: bankId, single_count: 1, shuffle_options: true },
            cookie,
        );

        const q = picked.data.questions[0];
        expect(q.shuffle_token).toBeTruthy();

        // 从库里取真实答案，再换算到「显示顺序」下的下标。
        // perm[display] = original，故需要对置换求逆。
        const row = await env.DB.prepare('SELECT answer FROM questions WHERE id = ?')
            .bind(q.id)
            .first<{ answer: string }>();
        const correctOriginal = JSON.parse(row!.answer) as number;

        const perm = await derivePermutation(q.shuffle_token, q.id, q.options.length);
        const displayIndex = perm.indexOf(correctOriginal);
        expect(displayIndex).toBeGreaterThanOrEqual(0);

        const res = await post(
            '/api/practice/submit',
            {
                mode: 'random',
                answers: [
                    { question_id: q.id, selected: displayIndex, shuffle_token: q.shuffle_token },
                ],
            },
            cookie,
        );

        expect(res.data.correct_count).toBe(1);
    });

    it('伪造的置换凭证被拒绝', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { bankId } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        const picked = await post(
            '/api/practice/pick',
            { bank_id: bankId, single_count: 1, shuffle_options: true },
            cookie,
        );
        const q = picked.data.questions[0];

        const res = await post(
            '/api/practice/submit',
            {
                mode: 'random',
                answers: [{ question_id: q.id, selected: 0, shuffle_token: '0-1-2.deadbeef' }],
            },
            cookie,
        );

        expect(res.status).toBe(400);
        expect(res.data.code).toBe('BAD_SHUFFLE_TOKEN');
    });

    it('跨题库错题练习的 bank_id 记为 NULL（旧实现记成第一题的题库）', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const a = await createBankWithQuestions(SAMPLE_QUESTIONS, '题库A');
        const b = await createBankWithQuestions(SAMPLE_QUESTIONS, '题库B');

        const res = await post(
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

        const session = await env.DB.prepare('SELECT bank_id, mode FROM practice_sessions WHERE id = ?')
            .bind(res.data.session_id)
            .first<{ bank_id: number | null; mode: string }>();

        expect(session!.bank_id).toBeNull();
        expect(session!.mode).toBe('wrongbook');
    });
});

/** 从签名置换 token 中还原置换（测试用，直接解析 <perm>.<sig> 的 perm 部分） */
async function derivePermutation(
    token: string,
    questionId: number,
    expectedLength: number,
): Promise<number[]> {
    const dot = token.lastIndexOf('.');
    const perm = token
        .slice(0, dot)
        .split('-')
        .map((s) => parseInt(s, 10));
    expect(perm).toHaveLength(expectedLength);
    expect(questionId).toBeGreaterThan(0);
    return perm;
}
