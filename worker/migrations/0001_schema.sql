-- ═══════════════════════════════════════════════════════════════
-- 刷题宝 D1 Schema
--
-- 时间约定：所有时间戳均为「北京时间字符串」'YYYY-MM-DD HH:MM:SS'，
-- 由 worker/src/lib/time.ts 显式计算后绑定。
-- 不使用 datetime('now','localtime')：D1 跑在 UTC，该表达式等于 UTC，
-- 会让所有「今天」的判定偏移 8 小时。
--
-- 外键：D1 默认强制外键（等价于 PRAGMA foreign_keys=on），无需显式开启。
-- 因此这里不能出现 PRAGMA 语句。
-- ═══════════════════════════════════════════════════════════════

-- ── 用户 ────────────────────────────────────────────────────────
CREATE TABLE users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    username             TEXT NOT NULL UNIQUE,
    display_name         TEXT NOT NULL,
    role                 TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
    created_at           TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),

    -- 口令：客户端拉伸（PBKDF2-SHA256）+ 服务端 HMAC-SHA256 验签。
    -- 免费版 CPU 限制（10ms/请求）下无法承载 bcrypt/PBKDF2 服务端哈希，
    -- 故硬化放在客户端，服务端只做一次 HMAC 比较。
    password_hash        TEXT,
    password_algo        TEXT NOT NULL DEFAULT 'stretch-pbkdf2-sha256',
    kdf_salt             TEXT,
    kdf_iterations       INTEGER NOT NULL DEFAULT 600000,

    -- 迁移前遗留的 PHP bcrypt 哈希，仅作审计留存，不可用于登录
    legacy_password_hash TEXT
);

-- ── 会话 ────────────────────────────────────────────────────────
-- 只存 sha256(token)，明文 token 仅存在于 Cookie。
-- 取代 PHP 的文件 session，可服务端吊销。
CREATE TABLE sessions (
    id           TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL,
    created_at   TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ── 登录限流 ────────────────────────────────────────────────────
CREATE TABLE login_attempts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT NOT NULL,
    ip           TEXT NOT NULL DEFAULT '',
    success      INTEGER NOT NULL CHECK(success IN (0, 1)),
    attempted_at TEXT NOT NULL
);

-- ── 题库 ────────────────────────────────────────────────────────
CREATE TABLE question_banks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    question_count  INTEGER NOT NULL DEFAULT 0,
    single_count    INTEGER NOT NULL DEFAULT 0,
    multiple_count  INTEGER NOT NULL DEFAULT 0,
    truefalse_count INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

-- ── 题目 ────────────────────────────────────────────────────────
-- options / answer 仍沿用旧格式：
--   options = JSON 字符串数组
--   answer  = 单选/判断为 JSON 数字（0 基下标），多选为 JSON 数字数组
-- 保持兼容，避免改写 1569 道既有题目。
CREATE TABLE questions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bank_id     INTEGER NOT NULL,
    type        TEXT NOT NULL CHECK(type IN ('single', 'multiple', 'truefalse')),
    stem        TEXT NOT NULL,
    options     TEXT NOT NULL,
    answer      TEXT NOT NULL,
    explanation TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (bank_id) REFERENCES question_banks(id) ON DELETE CASCADE
);

-- ── 错题本 ──────────────────────────────────────────────────────
CREATE TABLE wrong_book (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    bank_id     INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'removed')),
    added_at    TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    removed_at  TEXT,
    -- 旧库缺失该 CASCADE，导致删除用户时外键失败而接口仍报成功
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
    FOREIGN KEY (bank_id) REFERENCES question_banks(id) ON DELETE CASCADE,
    UNIQUE (user_id, question_id, bank_id)
);

-- ── 答题记录（单题粒度，历史遗留表，当前无调用方）────────────────
CREATE TABLE study_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    bank_id     INTEGER NOT NULL,
    is_correct  INTEGER NOT NULL CHECK(is_correct IN (0, 1)),
    answered_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
    FOREIGN KEY (bank_id) REFERENCES question_banks(id) ON DELETE CASCADE
);

-- ── 练习会话 ────────────────────────────────────────────────────
-- bank_id 可空：跨题库的错题练习没有单一题库，NULL 是诚实建模
-- （旧库为 NOT NULL，导致跨库错题练习会把会话记到错误的题库上）
CREATE TABLE practice_sessions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL,
    bank_id          INTEGER,
    mode             TEXT NOT NULL DEFAULT 'random'
                     CHECK(mode IN ('random', 'wrongbook', 'sequential')),
    total_count      INTEGER NOT NULL DEFAULT 0,
    correct_count    INTEGER NOT NULL DEFAULT 0,
    wrong_count      INTEGER NOT NULL DEFAULT 0,
    unanswered_count INTEGER NOT NULL DEFAULT 0,
    submitted_at     TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (bank_id) REFERENCES question_banks(id) ON DELETE CASCADE
);

-- ── 练习作答明细 ────────────────────────────────────────────────
CREATE TABLE practice_answers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      INTEGER NOT NULL,
    question_id     INTEGER NOT NULL,
    selected_answer TEXT,
    correct_answer  TEXT NOT NULL,
    is_correct      INTEGER CHECK(is_correct IN (0, 1)),
    FOREIGN KEY (session_id) REFERENCES practice_sessions(id) ON DELETE CASCADE
);

-- ═══════════════════════════════════════════════════════════════
-- 索引
-- 免费版 D1 每日仅 5,000,000 行读取，索引直接决定配额消耗速度。
-- ═══════════════════════════════════════════════════════════════

-- 抽题：WHERE bank_id = ? AND type = ?
CREATE INDEX idx_questions_bank_type ON questions(bank_id, type);

-- 题库题目列表分页：WHERE bank_id = ? ORDER BY id
CREATE INDEX idx_questions_bank_id ON questions(bank_id, id);

-- 错题本：WHERE user_id = ? AND status = ?
CREATE INDEX idx_wrong_book_user_status ON wrong_book(user_id, status);

-- 错题本按题库过滤
CREATE INDEX idx_wrong_book_user_bank ON wrong_book(user_id, bank_id, status);

-- 错题本的错/对次数统计：WHERE question_id = ? AND is_correct = ?
CREATE INDEX idx_practice_answers_question ON practice_answers(question_id, is_correct);

-- 会话明细：WHERE session_id = ?
CREATE INDEX idx_practice_answers_session ON practice_answers(session_id);

-- 「今日练习」范围查询：WHERE user_id = ? AND submitted_at >= ? AND < ?
-- 用范围谓词而非 DATE(submitted_at)=? ，后者无法命中索引
CREATE INDEX idx_practice_sessions_user_time ON practice_sessions(user_id, submitted_at);

-- 「今日错题」范围查询
CREATE INDEX idx_wrong_book_user_added ON wrong_book(user_id, added_at);

-- 练习记录列表：WHERE user_id = ? ORDER BY submitted_at DESC
CREATE INDEX idx_practice_sessions_user_bank ON practice_sessions(user_id, bank_id);

-- 会话校验：WHERE id = ? AND expires_at > ?
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- 限流：WHERE username = ? AND attempted_at >= ?
CREATE INDEX idx_login_attempts_user_time ON login_attempts(username, attempted_at);
