/**
 * 全局类型定义
 */

/** Worker 绑定与运行时变量 */
export interface Env {
  /** D1 数据库 */
  DB: D1Database;
  /** 静态资源绑定（public/） */
  ASSETS: Fetcher;
  /** 运行环境标识 */
  ENVIRONMENT?: string;
  /**
   * 口令挑战用的服务端密钥，用于为未知用户名派生确定性假盐，
   * 避免通过 /api/auth/challenge 枚举用户名。
   * 用 `wrangler secret put SERVER_KDF_SECRET` 设置。
   */
  SERVER_KDF_SECRET?: string;
}

// ── 领域模型 ──────────────────────────────────────────────

export type Role = 'admin' | 'user';
export type QuestionType = 'single' | 'multiple' | 'truefalse';
export type WrongStatus = 'active' | 'removed';
export type PracticeMode = 'random' | 'wrongbook' | 'sequential';

/** 用户表行 */
export interface UserRow {
  id: number;
  username: string;
  password_hash: string | null;
  display_name: string;
  role: Role;
  created_at: string;
  password_algo: string;
  kdf_salt: string | null;
  kdf_iterations: number | null;
  legacy_password_hash: string | null;
}

/** 对外暴露的用户信息（绝不含哈希） */
export interface PublicUser {
  id: number;
  username: string;
  display_name: string;
  role: Role;
}

/** 题目表行（options/answer 为 JSON 字符串） */
export interface QuestionRow {
  id: number;
  bank_id: number;
  type: QuestionType;
  stem: string;
  options: string;
  answer: string;
  explanation: string | null;
  created_at: string;
}

/** 对外暴露的题目（options/answer 已解析） */
export interface Question {
  id: number;
  bank_id: number;
  type: QuestionType;
  stem: string;
  options: string[];
  answer: number | number[];
  explanation: string;
  created_at: string;
}

/** 题库表行 */
export interface BankRow {
  id: number;
  name: string;
  description: string | null;
  question_count: number;
  single_count: number;
  multiple_count: number;
  truefalse_count: number;
  created_at: string;
}

/** 会话表行 */
export interface SessionRow {
  id: string;
  user_id: number;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

/** 已认证的请求上下文 */
export interface AuthContext {
  user: PublicUser;
  sessionId: string;
}

/** Hono 环境类型 */
export interface AppBindings {
  Bindings: Env;
  Variables: {
    auth?: AuthContext;
  };
}
