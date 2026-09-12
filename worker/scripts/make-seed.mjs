#!/usr/bin/env node
/**
 * 由旧 PHP 版 SQLite 库生成 D1 种子 SQL。
 *
 * 用法：node worker/scripts/make-seed.mjs
 * 输入：legacy/data/shuatibao.db
 * 输出：worker/migrations/0002_seed.sql
 *
 * 关键处理：
 *  1. 保留原始 id，使错题本/作答明细等外键引用保持有效；
 *  2. 用户口令无法迁移 —— 旧的是 PHP bcrypt($2y$12$)，在新架构下
 *     （客户端 PBKDF2 拉伸 + 服务端 HMAC 验签）无法验证。
 *     因此原哈希移入 legacy_password_hash 仅作审计，password_hash 置空、
 *     password_algo 标为 'legacy-bcrypt'，迁移后必须由管理员重置口令；
 *  3. 时间戳原样搬运（旧库已是北京时间字符串，格式与新库一致）；
 *  4. 单条 INSERT 控制在 100 KB 以内（D1 语句长度上限）；
 *  5. 生成前先校验旧数据是否满足新 schema 的 CHECK 约束。
 */

import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const SRC_DB = resolve(REPO, 'legacy/data/shuatibao.db');
const OUT_SQL = resolve(REPO, 'worker/migrations/0002_seed.sql');

// D1 单条语句上限 100 KB，留出安全余量
const MAX_STATEMENT_BYTES = 80 * 1024;

if (!existsSync(SRC_DB)) {
  console.error(`✘ 找不到源数据库: ${SRC_DB}`);
  console.error('  该文件应位于 legacy/data/shuatibao.db（不入 git，需从备份恢复）');
  process.exit(1);
}

const db = new DatabaseSync(SRC_DB, { readOnly: true });

// ── SQL 字面量 ────────────────────────────────────────────────
const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v === null || v === undefined ? 'NULL' : String(Number(v)));

// ── 源数据校验 ────────────────────────────────────────────────
const problems = [];
const check = (label, sql, allowed) => {
  for (const row of db.prepare(sql).all()) {
    const v = String(row.v);
    if (!allowed.includes(v)) problems.push(`${label}: 出现非法值 "${v}"`);
  }
};

check('users.role', 'SELECT DISTINCT role AS v FROM users', ['admin', 'user']);
check('questions.type', 'SELECT DISTINCT type AS v FROM questions', ['single', 'multiple', 'truefalse']);
check('wrong_book.status', 'SELECT DISTINCT status AS v FROM wrong_book', ['active', 'removed']);
check('practice_sessions.mode', 'SELECT DISTINCT mode AS v FROM practice_sessions', [
  'random',
  'wrongbook',
  'sequential',
]);

if (problems.length) {
  console.error('✘ 源数据不满足新 schema 约束：');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

// ── 表导出定义 ────────────────────────────────────────────────
const TABLES = [
  {
    name: 'users',
    columns: [
      'id', 'username', 'display_name', 'role', 'created_at',
      'password_hash', 'password_algo', 'kdf_salt', 'kdf_iterations',
      'legacy_password_hash',
    ],
    // 口令无法迁移：原 bcrypt 哈希转入 legacy_password_hash，
    // password_hash 置空等待管理员重置。
    map: (r) => [
      n(r.id), q(r.username), q(r.display_name), q(r.role), q(r.created_at),
      'NULL', q('legacy-bcrypt'), 'NULL', n(600000), q(r.password_hash),
    ],
    source: 'SELECT * FROM users ORDER BY id',
  },
  {
    name: 'question_banks',
    columns: [
      'id', 'name', 'description', 'question_count', 'single_count',
      'multiple_count', 'truefalse_count', 'created_at',
    ],
    map: (r) => [
      n(r.id), q(r.name), q(r.description ?? ''),
      n(r.question_count ?? 0), n(r.single_count ?? 0),
      n(r.multiple_count ?? 0), n(r.truefalse_count ?? 0), q(r.created_at),
    ],
    source: 'SELECT * FROM question_banks ORDER BY id',
  },
  {
    name: 'questions',
    columns: ['id', 'bank_id', 'type', 'stem', 'options', 'answer', 'explanation', 'created_at'],
    map: (r) => [
      n(r.id), n(r.bank_id), q(r.type), q(r.stem),
      q(r.options), q(r.answer), q(r.explanation ?? ''), q(r.created_at),
    ],
    source: 'SELECT * FROM questions ORDER BY id',
  },
  {
    name: 'wrong_book',
    columns: ['id', 'user_id', 'question_id', 'bank_id', 'status', 'added_at', 'removed_at'],
    map: (r) => [
      n(r.id), n(r.user_id), n(r.question_id), n(r.bank_id),
      q(r.status), q(r.added_at), q(r.removed_at),
    ],
    source: 'SELECT * FROM wrong_book ORDER BY id',
  },
  {
    name: 'study_records',
    columns: ['id', 'user_id', 'question_id', 'bank_id', 'is_correct', 'answered_at'],
    map: (r) => [
      n(r.id), n(r.user_id), n(r.question_id), n(r.bank_id), n(r.is_correct), q(r.answered_at),
    ],
    source: 'SELECT * FROM study_records ORDER BY id',
  },
  {
    name: 'practice_sessions',
    columns: [
      'id', 'user_id', 'bank_id', 'mode', 'total_count',
      'correct_count', 'wrong_count', 'unanswered_count', 'submitted_at',
    ],
    map: (r) => [
      n(r.id), n(r.user_id), n(r.bank_id), q(r.mode),
      n(r.total_count), n(r.correct_count), n(r.wrong_count),
      n(r.unanswered_count ?? 0), q(r.submitted_at),
    ],
    source: 'SELECT * FROM practice_sessions ORDER BY id',
  },
  {
    name: 'practice_answers',
    columns: ['id', 'session_id', 'question_id', 'selected_answer', 'correct_answer', 'is_correct'],
    map: (r) => [
      n(r.id), n(r.session_id), n(r.question_id),
      q(r.selected_answer), q(r.correct_answer), n(r.is_correct),
    ],
    source: 'SELECT * FROM practice_answers ORDER BY id',
  },
];

// ── 生成 ──────────────────────────────────────────────────────
const lines = [];
const stats = [];
let maxStmt = 0;

lines.push('-- ═══════════════════════════════════════════════════════════════');
lines.push('-- 0002_seed.sql —— 由 legacy/data/shuatibao.db 自动生成，请勿手工编辑');
lines.push(`-- 生成时间: ${new Date().toISOString()}`);
lines.push('--');
lines.push('-- 用户口令说明：旧 PHP 版用 bcrypt($2y$12$)，新架构下无法验证，');
lines.push('-- 原哈希已存入 legacy_password_hash 仅作审计。');
lines.push("-- 这些账号 password_hash 为空、password_algo='legacy-bcrypt'，");
lines.push('-- 迁移后必须由管理员重置口令。');
lines.push('-- ═══════════════════════════════════════════════════════════════');
lines.push('');
lines.push('BEGIN TRANSACTION;');
lines.push('');

for (const t of TABLES) {
  const rows = db.prepare(t.source).all();
  if (rows.length === 0) {
    stats.push(`${t.name}: 0 行（跳过）`);
    continue;
  }

  lines.push(`-- ── ${t.name}: ${rows.length} 行 ─────────────────────────────`);

  const colList = t.columns.join(', ');
  const VALUE_BUDGET = MAX_STATEMENT_BYTES - 200; // 预留 INSERT 前缀与分号

  let batch = [];
  let batchBytes = 0;

  const flush = () => {
    if (batch.length === 0) return;
    const stmt = `INSERT INTO ${t.name} (${colList}) VALUES\n${batch.join(',\n')};`;
    const bytes = Buffer.byteLength(stmt, 'utf8');
    if (bytes > maxStmt) maxStmt = bytes;
    if (bytes > MAX_STATEMENT_BYTES) {
      console.error(`✘ ${t.name} 单条 INSERT 达 ${bytes} 字节，超过 ${MAX_STATEMENT_BYTES} 上限`);
      process.exit(1);
    }
    lines.push(stmt);
    batch = [];
    batchBytes = 0;
  };

  for (const r of rows) {
    const tuple = `(${t.map(r).join(', ')})`;
    const size = Buffer.byteLength(tuple, 'utf8') + 3;
    if (batchBytes + size > VALUE_BUDGET) flush();
    batch.push(tuple);
    batchBytes += size;
  }
  flush();
  lines.push('');
  stats.push(`${t.name}: ${rows.length} 行`);
}

// 显式校正自增序列：虽然 SQLite 在插入显式 id 后会自行抬高
// sqlite_sequence，这里再显式设一次以免依赖该行为。
lines.push('-- ── 校正自增序列 ─────────────────────────────────────────');
for (const t of TABLES) {
  if (!t.columns.includes('id')) continue;
  lines.push(
    `UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(id), 0) FROM ${t.name}) ` +
      `WHERE name = '${t.name}';`,
  );
}
lines.push('');
lines.push('COMMIT;');
lines.push('');

writeFileSync(OUT_SQL, lines.join('\n'), 'utf8');

// ── 报告 ──────────────────────────────────────────────────────
const outBytes = Buffer.byteLength(lines.join('\n'), 'utf8');
console.log('✔ 种子 SQL 已生成');
for (const s of stats) console.log('   ' + s);
console.log(`   最大单条 INSERT: ${(maxStmt / 1024).toFixed(1)} KB（上限 ${MAX_STATEMENT_BYTES / 1024} KB）`);
console.log(`   输出: ${OUT_SQL}`);
console.log(`   大小: ${(outBytes / 1024).toFixed(1)} KB`);

db.close();
