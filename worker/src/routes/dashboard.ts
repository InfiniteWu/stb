/**
 * 仪表盘 API
 *
 *   GET /api/dashboard   今日学习概览
 *
 * 旧实现的两个问题都已修正：
 *   1. 用 DATE(col) = date('now','localtime') 过滤 —— D1 跑在 UTC，
 *      localtime 等于 UTC，判定整体偏移 8 小时；且对列套函数使索引失效，
 *      每次都全表扫描（D1 按扫描行数计费）。现改为北京时间范围谓词。
 *   2. `data.today_wrong_per_bank.length` 在前端被无条件访问。
 */

import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { todayBounds } from '../lib/time';
import { currentAuth, requireLogin } from '../middleware/auth';

export const dashboardRoutes = new Hono<AppBindings>();

dashboardRoutes.use('*', requireLogin);

dashboardRoutes.get('/', async (c) => {
  const { user } = currentAuth(c);
  const { start, end } = todayBounds();

  // 四条统计用一次 batch 发出，减少往返；每条都命中索引
  const results = await c.env.DB.batch<
    { n?: number; bank_id?: number; bank_name?: string; count?: number }
  >([
    // 今日答题数
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n
       FROM practice_answers pa
       JOIN practice_sessions ps ON pa.session_id = ps.id
       WHERE ps.user_id = ? AND ps.submitted_at >= ? AND ps.submitted_at < ?`,
    ).bind(user.id, start, end),

    // 今日答对数
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n
       FROM practice_answers pa
       JOIN practice_sessions ps ON pa.session_id = ps.id
       WHERE ps.user_id = ? AND ps.submitted_at >= ? AND ps.submitted_at < ?
         AND pa.is_correct = 1`,
    ).bind(user.id, start, end),

    // 今日新增错题
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM wrong_book
       WHERE user_id = ? AND added_at >= ? AND added_at < ?`,
    ).bind(user.id, start, end),

    // 今日错题按题库分布
    c.env.DB.prepare(
      `SELECT wb.bank_id, qb.name AS bank_name, COUNT(*) AS count
       FROM wrong_book wb
       JOIN question_banks qb ON wb.bank_id = qb.id
       WHERE wb.user_id = ? AND wb.added_at >= ? AND wb.added_at < ?
         AND wb.status = 'active'
       GROUP BY wb.bank_id, qb.name
       ORDER BY count DESC`,
    ).bind(user.id, start, end),
  ]);

  // batch 的结果顺序与语句顺序一致
  const todayPracticeCount = results[0]?.results?.[0]?.n ?? 0;
  const todayCorrectCount = results[1]?.results?.[0]?.n ?? 0;
  const todayNewWrong = results[2]?.results?.[0]?.n ?? 0;
  const perBank = results[3]?.results ?? [];

  return c.json({
    today_practice_count: todayPracticeCount,
    today_correct_count: todayCorrectCount,
    today_accuracy: todayPracticeCount > 0 ? todayCorrectCount / todayPracticeCount : 0,
    today_new_wrong: todayNewWrong,
    today_wrong_per_bank: perBank,
  });
});
