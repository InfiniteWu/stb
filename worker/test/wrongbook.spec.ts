/**
 * 错题本回归测试
 *
 * 重点：移出后能重新进入（旧实现因 INSERT OR IGNORE 与唯一约束冲突
 * 而永远加不回来）、按用户隔离计数（旧实现会统计到他人的作答）。
 */

import { describe, it, expect } from 'vitest';
import { loginAs, createBankWithQuestions, post, get, put, SAMPLE_QUESTIONS } from './helpers';

/** 提交单题作答 */
async function answerOne(cookie: string, questionId: number, selected: unknown) {
    return post(
        '/api/practice/submit',
        { mode: 'random', answers: [{ question_id: questionId, selected }] },
        cookie,
    );
}

describe('错题本', () => {
    it('答错自动进入错题本', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        await answerOne(cookie, questionIds[0]!, 0); // 正确答案是 1

        const wb = await get('/api/wrongbook', cookie);
        expect(wb.data).toHaveLength(1);
        expect(wb.data[0].question_id).toBe(questionIds[0]!);
        expect(wb.data[0].status).toBe('active');
    });

    it('移出后再次答错能重新进入（旧实现永远加不回来）', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);
        const qid = questionIds[0]!;

        // 1) 答错 → 进入错题本
        await answerOne(cookie, qid, 0);
        const wb1 = await get('/api/wrongbook', cookie);
        expect(wb1.data).toHaveLength(1);
        const entryId = wb1.data[0].id;

        // 2) 手动移出
        const removed = await put(`/api/wrongbook/${entryId}/remove`, {}, cookie);
        expect(removed.status).toBe(200);
        const wb2 = await get('/api/wrongbook', cookie);
        expect(wb2.data).toHaveLength(0);

        // 3) 再次答错 → 必须重新出现
        await answerOne(cookie, qid, 0);
        const wb3 = await get('/api/wrongbook', cookie);
        expect(wb3.data).toHaveLength(1);
        expect(wb3.data[0].question_id).toBe(qid);
        expect(wb3.data[0].status).toBe('active');
    });

    it('连续答对 5 次自动移出错题本', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);
        const qid = questionIds[0]!;

        // 该题正确答案是 1，先答 0 制造一次错误
        await answerOne(cookie, qid, 0);
        expect((await get('/api/wrongbook', cookie)).data).toHaveLength(1);

        // 连续答对 5 次
        for (let i = 0; i < 5; i++) {
            const r = await answerOne(cookie, qid, 1);
            expect(r.status).toBe(200);
        }

        const wb = await get('/api/wrongbook', cookie);
        expect(wb.data).toHaveLength(0);
    });

    it('中间夹一次答错则不满足连续 5 次', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);
        const qid = questionIds[0]!;

        await answerOne(cookie, qid, 0); // 错
        for (let i = 0; i < 3; i++) await answerOne(cookie, qid, 1); // 对对对
        await answerOne(cookie, qid, 0); // 错 —— 打断连续
        for (let i = 0; i < 3; i++) await answerOne(cookie, qid, 1); // 对对对

        // 最近 5 次里含有一次错误，不应被移出
        const wb = await get('/api/wrongbook', cookie);
        expect(wb.data).toHaveLength(1);
    });

    it('连续答对不足 5 次不移出', async () => {
        const { cookie } = await loginAs('u1', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);
        const qid = questionIds[0]!;

        await answerOne(cookie, qid, 0);
        for (let i = 0; i < 4; i++) {
            await answerOne(cookie, qid, 1);
        }

        const wb = await get('/api/wrongbook', cookie);
        expect(wb.data).toHaveLength(1);
    });

    it('error_count / correct_count 按用户隔离（旧实现会串到他人数据）', async () => {
        const alice = await loginAs('alice', 'pass1234');
        const bob = await loginAs('bob', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);
        const qid = questionIds[0]!;

        // Alice 答错 3 次
        for (let i = 0; i < 3; i++) await answerOne(alice.cookie, qid, 0);

        // Bob 只答错 1 次
        await answerOne(bob.cookie, qid, 0);

        const aliceWb = await get('/api/wrongbook', alice.cookie);
        const bobWb = await get('/api/wrongbook', bob.cookie);

        expect(aliceWb.data[0].error_count).toBe(3);
        expect(bobWb.data[0].error_count).toBe(1);
    });

    it('看不到他人的错题', async () => {
        const alice = await loginAs('alice', 'pass1234');
        const bob = await loginAs('bob', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        await answerOne(alice.cookie, questionIds[0]!, 0);

        const bobWb = await get('/api/wrongbook', bob.cookie);
        expect(bobWb.data).toHaveLength(0);
    });

    it('取单条错题时不能越权访问他人的记录', async () => {
        const alice = await loginAs('alice', 'pass1234');
        const bob = await loginAs('bob', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        await answerOne(alice.cookie, questionIds[0]!, 0);
        const aliceWb = await get('/api/wrongbook', alice.cookie);
        const entryId = aliceWb.data[0].id;

        const res = await get(`/api/wrongbook/${entryId}`, bob.cookie);
        expect(res.status).toBe(404);
    });

    it('移出他人的错题返回 404', async () => {
        const alice = await loginAs('alice', 'pass1234');
        const bob = await loginAs('bob', 'pass1234');
        const { questionIds } = await createBankWithQuestions(SAMPLE_QUESTIONS);

        await answerOne(alice.cookie, questionIds[0]!, 0);
        const entryId = (await get('/api/wrongbook', alice.cookie)).data[0].id;

        const res = await put(`/api/wrongbook/${entryId}/remove`, {}, bob.cookie);
        expect(res.status).toBe(404);

        // Alice 的记录应仍然存在
        expect((await get('/api/wrongbook', alice.cookie)).data).toHaveLength(1);
    });
});
