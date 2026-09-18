/**
 * 仪表盘 API
 *
 *   GET /api/dashboard   今日概览 + 最近练习 + 最近 7 天趋势 + 待复习错题数
 *
 * 旧实现的两个问题都已修正：
 *   1. 用 DATE(col) = date('now','localtime') 过滤 —— D1 跑在 UTC，
 *      localtime 等于 UTC，判定整体偏移 8 小时；且对列套函数使索引失效，
 *      每次都全表扫描（D1 按扫描行数计费）。现改为北京时间范围谓词。
 *   2. `data.today_wrong_per_bank.length` 在前端被无条件访问。
 *
 * 后追加的 recent_session / trend / wrong_active_count 同样走这一批 batch，
 * 一次往返拿全，首屏不必多打两次请求。
 */

import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { recentDayBounds, todayBounds } from '../lib/time';
import { currentAuth, requireLogin } from '../middleware/auth';

export const dashboardRoutes = new Hono<AppBindings>();

/** 趋势窗口长度（天，含今天） */
const TREND_DAYS = 7;

dashboardRoutes.use('*', requireLogin);

dashboardRoutes.get('/', async (c) => {
  const { user } = currentAuth(c);
  const { start, end } = todayBounds();
  const trend7 = recentDayBounds(TREND_DAYS);

  // 七条统计用一次 batch 发出，减少往返；每条都命中索引
  const results = await c.env.DB.batch<
    Record<string, unknown> & { n?: number; day?: string; total?: number; correct?: number }
  >([
    // 1) 今日答题数
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n
       FROM practice_answers pa
       JOIN practice_sessions ps ON pa.session_id = ps.id
       WHERE ps.user_id = ? AND ps.submitted_at >= ? AND ps.submitted_at < ?`,
    ).bind(user.id, start, end),

    // 2) 今日答对数
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n
       FROM practice_answers pa
       JOIN practice_sessions ps ON pa.session_id = ps.id
       WHERE ps.user_id = ? AND ps.submitted_at >= ? AND ps.submitted_at < ?
         AND pa.is_correct = 1`,
    ).bind(user.id, start, end),

    // 3) 今日新增错题
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM wrong_book
       WHERE user_id = ? AND added_at >= ? AND added_at < ?`,
    ).bind(user.id, start, end),

    // 4) 今日错题按题库分布
    c.env.DB.prepare(
      `SELECT wb.bank_id, qb.name AS bank_name, COUNT(*) AS count
       FROM wrong_book wb
       JOIN question_banks qb ON wb.bank_id = qb.id
       WHERE wb.user_id = ? AND wb.added_at >= ? AND wb.added_at < ?
         AND wb.status = 'active'
       GROUP BY wb.bank_id, qb.name
       ORDER BY count DESC`,
    ).bind(user.id, start, end),

    // 5) 最近一次练习（跨题库错题练习 bank_id 为空，名称在下方兜底）
    c.env.DB.prepare(
      `SELECT ps.id, ps.total_count, ps.correct_count, ps.wrong_count,
              ps.unanswered_count, ps.submitted_at, ps.mode,
              qb.name AS bank_name
       FROM practice_sessions ps
       LEFT JOIN question_banks qb ON ps.bank_id = qb.id
       WHERE ps.user_id = ?
       ORDER BY ps.submitted_at DESC, ps.id DESC
       LIMIT 1`,
    ).bind(user.id),

    // 6) 最近 7 天按北京自然日聚合。submitted_at 是北京时间字符串，前 10 位
    //    即日期；分组表达式只作用于已被 user_id + 时间范围命中的少量行，
    //    不会退化成全表扫描。
    c.env.DB.prepare(
      `SELECT substr(ps.submitted_at, 1, 10) AS day,
              SUM(ps.total_count)   AS total,
              SUM(ps.correct_count) AS correct
       FROM practice_sessions ps
       WHERE ps.user_id = ? AND ps.submitted_at >= ? AND ps.submitted_at < ?
       GROUP BY day`,
    ).bind(user.id, trend7.start, trend7.end),

    // 7) 待复习错题数（错题本里 active 的条数）
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM wrong_book WHERE user_id = ? AND status = 'active'`,
    ).bind(user.id),
  ]);

  // batch 的结果顺序与语句顺序一致
  const todayPracticeCount = results[0]?.results?.[0]?.n ?? 0;
  const todayCorrectCount = results[1]?.results?.[0]?.n ?? 0;
  const todayNewWrong = results[2]?.results?.[0]?.n ?? 0;
  const perBank = results[3]?.results ?? [];
  const recentRow = results[4]?.results?.[0];
  const trendRows = results[5]?.results ?? [];
  const wrongActiveCount = results[6]?.results?.[0]?.n ?? 0;

  // 把有练习的日期铺进固定长度窗口，空白天补 0（accuracy 为 null）：
  // 前端因此不必自己排日历，也不会出现"今天缺一格"的错位
  const byDay = new Map<string, { answered: number; correct: number }>();
  for (const row of trendRows) {
    if (typeof row.day !== 'string') continue;
    byDay.set(row.day, { answered: row.total ?? 0, correct: row.correct ?? 0 });
  }
  const trend = trend7.days.map((day) => {
    const hit = byDay.get(day);
    const answered = hit?.answered ?? 0;
    const correct = hit?.correct ?? 0;
    return { day, answered, correct, accuracy: answered > 0 ? correct / answered : null };
  });

  const recentTotal = (recentRow?.total_count as number | undefined) ?? 0;
  const recentSession = recentRow
    ? {
        id: recentRow.id,
        bank_name:
          (recentRow.bank_name as string | null) ??
          (recentRow.mode === 'wrongbook' ? '错题练习' : '未知题库'),
        total_count: recentTotal,
        correct_count: recentRow.correct_count ?? 0,
        wrong_count: recentRow.wrong_count ?? 0,
        unanswered_count: recentRow.unanswered_count ?? 0,
        // 口径与站内一致：correct / total（未答计入分母）
        accuracy: recentTotal > 0 ? ((recentRow.correct_count as number) ?? 0) / recentTotal : 0,
        submitted_at: recentRow.submitted_at,
      }
    : null;

  return c.json({
    today_practice_count: todayPracticeCount,
    today_correct_count: todayCorrectCount,
    today_accuracy: todayPracticeCount > 0 ? todayCorrectCount / todayPracticeCount : 0,
    today_new_wrong: todayNewWrong,
    today_wrong_per_bank: perBank,
    recent_session: recentSession,
    trend,
    wrong_active_count: wrongActiveCount,
  });
});
