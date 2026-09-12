/**
 * 测试环境准备：应用 schema 迁移，并清空业务表。
 */

import { env, applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach } from 'vitest';

beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

/**
 * 每个用例前清空业务表，保证用例之间互不影响。
 * 顺序按外键依赖，避免触发约束错误。
 */
beforeEach(async () => {
    await env.DB.batch([
        env.DB.prepare('DELETE FROM practice_answers'),
        env.DB.prepare('DELETE FROM practice_sessions'),
        env.DB.prepare('DELETE FROM wrong_book'),
        env.DB.prepare('DELETE FROM study_records'),
        env.DB.prepare('DELETE FROM questions'),
        env.DB.prepare('DELETE FROM question_banks'),
        env.DB.prepare('DELETE FROM sessions'),
        env.DB.prepare('DELETE FROM login_attempts'),
        env.DB.prepare('DELETE FROM users'),
    ]);
});
