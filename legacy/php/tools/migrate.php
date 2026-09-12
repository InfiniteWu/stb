<?php
/**
 * 数据迁移脚本 - 从旧数据库导入题库和题目
 * 用法: php tools/migrate.php
 */

define('BASE_DIR', dirname(__DIR__));
define('OLD_DB', BASE_DIR . '/server\\shuatibao.db');
define('NEW_DB', BASE_DIR . '/data/shuatibao.db');

// 连接旧数据库
$oldDb = new SQLite3(OLD_DB);
if (!$oldDb) {
    die("无法打开旧数据库: " . OLD_DB . "\n");
}

// 连接新数据库
$newDb = new SQLite3(NEW_DB);
if (!$newDb) {
    die("无法创建新数据库: " . NEW_DB . "\n");
}

echo "开始迁移...\n";

// 1. 创建新表结构
$schemas = [
    // 启用 WAL 模式
    "PRAGMA journal_mode=WAL;",
    "PRAGMA foreign_keys=ON;",
    
    // 用户表
    "CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );",
    
    // 题库表
    "CREATE TABLE IF NOT EXISTS question_banks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        question_count INTEGER DEFAULT 0,
        single_count INTEGER DEFAULT 0,
        multiple_count INTEGER DEFAULT 0,
        truefalse_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );",
    
    // 题目表
    "CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bank_id INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('single', 'multiple', 'truefalse')),
        stem TEXT NOT NULL,
        options TEXT NOT NULL,
        answer TEXT NOT NULL,
        explanation TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (bank_id) REFERENCES question_banks(id) ON DELETE CASCADE
    );",
    
    // 错题本
    "CREATE TABLE IF NOT EXISTS wrong_book (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        question_id INTEGER NOT NULL,
        bank_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'removed')),
        added_at TEXT DEFAULT (datetime('now', 'localtime')),
        removed_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
        FOREIGN KEY (bank_id) REFERENCES question_banks(id) ON DELETE CASCADE,
        UNIQUE(user_id, question_id, bank_id)
    );",
    
    // 答题记录
    "CREATE TABLE IF NOT EXISTS study_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        question_id INTEGER NOT NULL,
        bank_id INTEGER NOT NULL,
        is_correct INTEGER NOT NULL CHECK(is_correct IN (0, 1)),
        answered_at TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
        FOREIGN KEY (bank_id) REFERENCES question_banks(id) ON DELETE CASCADE
    );",
    
    // 练习会话
    "CREATE TABLE IF NOT EXISTS practice_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        bank_id INTEGER NOT NULL,
        mode TEXT NOT NULL DEFAULT 'random',
        total_count INTEGER NOT NULL DEFAULT 0,
        correct_count INTEGER NOT NULL DEFAULT 0,
        wrong_count INTEGER NOT NULL DEFAULT 0,
        unanswered_count INTEGER NOT NULL DEFAULT 0,
        submitted_at TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (bank_id) REFERENCES question_banks(id) ON DELETE CASCADE
    );",
    
    // 练习作答详情
    "CREATE TABLE IF NOT EXISTS practice_answers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        question_id INTEGER NOT NULL,
        selected_answer TEXT,
        correct_answer TEXT NOT NULL,
        is_correct INTEGER,
        FOREIGN KEY (session_id) REFERENCES practice_sessions(id) ON DELETE CASCADE
    );",
    
    // 插入默认管理员用户 (密码: admin123)
    "INSERT OR IGNORE INTO users (username, password_hash, display_name, role) 
     VALUES ('admin', '" . password_hash('admin123', PASSWORD_DEFAULT) . "', '管理员', 'admin');"
];

foreach ($schemas as $sql) {
    $result = $newDb->exec($sql);
    if (!$result) {
        echo "执行SQL失败: " . $sql . "\n";
        echo "错误: " . $newDb->lastErrorMsg() . "\n";
    }
}

echo "表结构创建完成\n";

// 2. 迁移题库数据
echo "迁移题库数据...\n";
$banks = $oldDb->query("SELECT * FROM question_banks");
$bankCount = 0;
while ($bank = $banks->fetchArray(SQLITE3_ASSOC)) {
    $stmt = $newDb->prepare("INSERT INTO question_banks (id, name, description, question_count, single_count, multiple_count, truefalse_count, created_at) 
                             VALUES (:id, :name, :description, :question_count, :single_count, :multiple_count, :truefalse_count, :created_at)");
    $stmt->bindValue(':id', $bank['id'], SQLITE3_INTEGER);
    $stmt->bindValue(':name', $bank['name'], SQLITE3_TEXT);
    $stmt->bindValue(':description', $bank['description'], SQLITE3_TEXT);
    $stmt->bindValue(':question_count', $bank['question_count'], SQLITE3_INTEGER);
    $stmt->bindValue(':single_count', $bank['single_count'], SQLITE3_INTEGER);
    $stmt->bindValue(':multiple_count', $bank['multiple_count'], SQLITE3_INTEGER);
    $stmt->bindValue(':truefalse_count', $bank['truefalse_count'], SQLITE3_INTEGER);
    $stmt->bindValue(':created_at', $bank['created_at'], SQLITE3_TEXT);
    $stmt->execute();
    $bankCount++;
}
echo "迁移了 $bankCount 个题库\n";

// 3. 迁移题目数据
echo "迁移题目数据...\n";
$questions = $oldDb->query("SELECT * FROM questions");
$questionCount = 0;
while ($question = $questions->fetchArray(SQLITE3_ASSOC)) {
    $stmt = $newDb->prepare("INSERT INTO questions (id, bank_id, type, stem, options, answer, explanation, created_at) 
                             VALUES (:id, :bank_id, :type, :stem, :options, :answer, :explanation, :created_at)");
    $stmt->bindValue(':id', $question['id'], SQLITE3_INTEGER);
    $stmt->bindValue(':bank_id', $question['bank_id'], SQLITE3_INTEGER);
    $stmt->bindValue(':type', $question['type'], SQLITE3_TEXT);
    $stmt->bindValue(':stem', $question['stem'], SQLITE3_TEXT);
    $stmt->bindValue(':options', $question['options'], SQLITE3_TEXT);
    $stmt->bindValue(':answer', $question['answer'], SQLITE3_TEXT);
    $stmt->bindValue(':explanation', $question['explanation'], SQLITE3_TEXT);
    $stmt->bindValue(':created_at', $question['created_at'], SQLITE3_TEXT);
    $stmt->execute();
    $questionCount++;
}
echo "迁移了 $questionCount 道题目\n";

// 4. 重置序列（确保后续插入不会冲突）
$newDb->exec("DELETE FROM sqlite_sequence WHERE name IN ('question_banks', 'questions');");
$newDb->exec("INSERT INTO sqlite_sequence (name, seq) VALUES ('question_banks', (SELECT MAX(id) FROM question_banks));");
$newDb->exec("INSERT INTO sqlite_sequence (name, seq) VALUES ('questions', (SELECT MAX(id) FROM questions));");

$oldDb->close();
$newDb->close();

echo "迁移完成！\n";
echo "新数据库位置: " . NEW_DB . "\n";
