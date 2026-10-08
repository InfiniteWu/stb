/**
 * 答题状态回归测试
 *
 * 语义：只有真正给出选项的提交才记为「已答」；
 * 交卷留空的不记，「仅未答」仍可抽到；清空只删状态行。
 */

import { describe, it, expect } from 'vitest';
import { loginAs, createBankWithQuestions, post, get } from './helpers';

const STATE_QUESTIONS = [
    { type: 'single' as const, stem: '单1', options: ['a', 'b'], answer: 0 as number | number[] },
    { type: 'single' as const, stem: '单2', options: ['a', 'b'], answer: 1 as number | number[] },
    { type: 'single' as const, stem: '单3', options: ['a', 'b'], answer: 0 as number | number[] },
    {
        type: 'multiple' as const,
        stem: '多1',
        options: ['A', 'B', 'C', 'D'],
        answer: [0, 2] as number | number[],
    },
    {
        type: 'multiple' as const,
        stem: '多2',
        options: ['A', 'B', 'C', 'D'],
        answer: [1, 3] as number | number[],
    },
    { type: 'truefalse' as const, stem: '判1', options: ['对', '错'], answer: 0 as number | number[] },
];

describe('答题状态', () => {
    it('提交后已作答的题记入状态，留空的不记', async () => {
        const { cookie } = await loginAs('st1', 'pass1234');
        const { bankId, questionIds } = await createBankWithQuestions(STATE_QUESTIONS, '状态库');

        // 单1答对、单2答错、多1留空、判1答对
        const submit = await post(
            '/api/practice/submit',
            {
                mode: 'random',
                answers: [
                    { question_id: questionIds[0]!, selected: 0 },
                    { question_id: questionIds[1]!, selected: 0 },
                    { question_id: questionIds[3]!, selected: null },
                    { question_id: questionIds[5]!, selected: 0 },
                ],
            },
            cookie,
        );
        expect(submit.status).toBe(200);

        const st = await get(`/api/practice/state?bank_id=${bankId}`, cookie);
        expect(st.status).toBe(200);
        expect(st.data.total).toBe(6);
        expect(st.data.answered).toBe(3);
        expect(st.data.unanswered).toBe(3);
        expect(st.data.by_type.single).toEqual({ total: 3, answered: 2, unanswered: 1 });
        // 留空的多1不记，仍算未答
        expect(st.data.by_type.multiple).toEqual({ total: 2, answered: 0, unanswered: 2 });
        expect(st.data.by_type.truefalse).toEqual({ total: 1, answered: 1, unanswered: 0 });
    });

    it('仅未答抽题排除已答过的题，普通抽题不受影响', async () => {
        const { cookie } = await loginAs('st2', 'pass1234');
        const { bankId, questionIds } = await createBankWithQuestions(STATE_QUESTIONS, '状态库');

        await post(
            '/api/practice/submit',
            { mode: 'random', answers: [{ question_id: questionIds[0]!, selected: 0 }] },
            cookie,
        );

        const only = await post(
            '/api/practice/pick',
            { bank_id: bankId, single_count: 5, only_unanswered: true },
            cookie,
        );
        expect(only.status).toBe(200);
        expect(only.data.questions).toHaveLength(2);
        expect(only.data.questions.map((q: any) => q.id)).not.toContain(questionIds[0]);

        const normal = await post(
            '/api/practice/pick',
            { bank_id: bankId, single_count: 3 },
            cookie,
        );
        expect(normal.status).toBe(200);
        expect(normal.data.questions).toHaveLength(3);
    });

    it('清空状态后计数归零，且不影响练习记录与错题本', async () => {
        const { cookie } = await loginAs('st3', 'pass1234');
        const { bankId, questionIds } = await createBankWithQuestions(STATE_QUESTIONS, '状态库');

        // 单2故意答错 → 进错题本 + 记状态
        await post(
            '/api/practice/submit',
            { mode: 'random', answers: [{ question_id: questionIds[1]!, selected: 0 }] },
            cookie,
        );
        expect((await get(`/api/practice/state?bank_id=${bankId}`, cookie)).data.answered).toBe(1);
        expect((await get('/api/wrongbook', cookie)).data).toHaveLength(1);

        const clear = await post('/api/practice/state/clear', { bank_id: bankId }, cookie);
        expect(clear.status).toBe(200);
        expect(clear.data.deleted).toBe(1);

        const after = await get(`/api/practice/state?bank_id=${bankId}`, cookie);
        expect(after.data.answered).toBe(0);
        expect(after.data.unanswered).toBe(6);
        // 练习记录与错题本不受影响
        expect((await get('/api/sessions', cookie)).data.total).toBe(1);
        expect((await get('/api/wrongbook', cookie)).data).toHaveLength(1);
    });

    it('全库汇总只返回有状态的库，且按用户隔离', async () => {
        const alice = await loginAs('alice_st', 'pass1234');
        const bob = await loginAs('bob_st', 'pass1234');
        const { bankId, questionIds } = await createBankWithQuestions(STATE_QUESTIONS, '状态库');

        await post(
            '/api/practice/submit',
            { mode: 'random', answers: [{ question_id: questionIds[0]!, selected: 0 }] },
            alice.cookie,
        );

        const aSummary = await get('/api/practice/state', alice.cookie);
        expect(aSummary.data.banks).toEqual([{ bank_id: bankId, answered: 1 }]);

        const bSummary = await get('/api/practice/state', bob.cookie);
        expect(bSummary.data.banks).toEqual([]);
    });

    it('非法 bank_id 返回 400', async () => {
        const { cookie } = await loginAs('st4', 'pass1234');
        expect((await get('/api/practice/state?bank_id=abc', cookie)).status).toBe(400);
        expect((await post('/api/practice/state/clear', { bank_id: 999999 }, cookie)).status).toBe(
            400,
        );
    });
});
