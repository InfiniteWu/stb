/**
 * 二哥刷题宝 —— Worker 入口
 *
 * 路由分工：
 *   - `/api/*` 由本 Worker 处理（wrangler.jsonc 的 run_worker_first）
 *   - 其余请求由 Workers 静态资源层直接响应，不进入 Worker，不计 CPU
 *
 * 注意：本文件只负责装配，业务路由在 routes/ 下按资源拆分。
 */

import { Hono } from 'hono';
import type { AppBindings } from './types';
import { ApiError } from './lib/json';
import { nowStamp } from './lib/time';
import { loadSession } from './middleware/auth';
import { authRoutes } from './routes/auth';
import { bankRoutes } from './routes/banks';
import { dashboardRoutes } from './routes/dashboard';
import { importRoutes } from './routes/import';
import { practiceRoutes } from './routes/practice';
import { questionRoutes } from './routes/questions';
import { recordRoutes } from './routes/records';
import { sessionRoutes } from './routes/sessions';
import { userRoutes } from './routes/users';
import { wrongBookRoutes } from './routes/wrongbook';

const app = new Hono<AppBindings>();

// 所有 /api/* 请求先解析会话，后续中间件按需拒绝
app.use('/api/*', loadSession);

// ── 健康检查（部署冒烟用，不需要认证）──────────────────────
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    service: 'shuatibao',
    environment: c.env.ENVIRONMENT ?? 'unknown',
    time: nowStamp(),
  }),
);

app.route('/api/auth', authRoutes);
app.route('/api/banks', bankRoutes);
app.route('/api/questions', questionRoutes);
app.route('/api/practice', practiceRoutes);
app.route('/api/sessions', sessionRoutes);
app.route('/api/wrongbook', wrongBookRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/records', recordRoutes);
app.route('/api/import', importRoutes);
app.route('/api/users', userRoutes);

// ── 未匹配的路径 ──────────────────────────────────────────
app.notFound((c) => {
  const { pathname } = new URL(c.req.url);

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return c.json({ error: 'API 端点不存在', code: 'NOT_FOUND' }, 404);
  }

  // 非 /api 路径正常由静态资源层处理；这里兜底以防 Worker 被直接调用
  return c.env.ASSETS.fetch(c.req.raw);
});

// ── 统一错误处理 ─────────────────────────────────────────
// 取代旧版 `catch (Exception $e)` —— 那会漏掉 PHP 8 的 Error/TypeError
app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.message, code: err.code }, err.status);
  }

  console.error('未处理异常:', err);
  return c.json({ error: '服务器内部错误', code: 'INTERNAL_ERROR' }, 500);
});

export default app;
