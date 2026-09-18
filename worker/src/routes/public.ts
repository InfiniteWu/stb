/**
 * 公开只读接口（无需登录）
 *
 *   GET /api/public/stats   登录页品牌区的数据条
 *
 * 只暴露聚合数字，不含任何用户数据。三条查询都落在小表上：
 * question_banks 一个题库一行（question_count 是既有的冗余计数，
 * 所以不必去扫 questions 表），因此题目再多也不会让这个接口变慢。
 *
 * 登录页是匿名访问最频繁的页面，响应带 5 分钟边缘缓存，
 * 避免每次刷新都打一次 D1。
 */

import { Hono } from 'hono';
import type { AppBindings } from '../types';

export const publicRoutes = new Hono<AppBindings>();

publicRoutes.get('/stats', async (c) => {
  const results = await c.env.DB.batch<{ n?: number }>([
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(question_count), 0) AS n, COUNT(*) AS banks FROM question_banks`,
    ),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM practice_sessions`),
  ]);

  const banks = results[0]?.results?.[0] ?? {};
  const practiceCount = results[1]?.results?.[0]?.n ?? 0;

  c.header('Cache-Control', 'public, max-age=300');

  return c.json({
    question_count: (banks as { n?: number }).n ?? 0,
    bank_count: (banks as { banks?: number }).banks ?? 0,
    practice_count: practiceCount,
  });
});
