<?php
/**
 * 数据库连接和初始化
 */

require_once __DIR__ . '/config.php';

function getDB() {
    static $db = null;
    
    if ($db === null) {
        $db = new SQLite3(DB_PATH);
        
        if (!$db) {
            http_response_code(500);
            echo json_encode(['error' => '数据库连接失败']);
            exit;
        }
        
        // 启用 WAL 模式
        $db->exec('PRAGMA journal_mode=WAL');
        
        // 启用外键约束
        $db->exec('PRAGMA foreign_keys=ON');
    }
    
    return $db;
}

/**
 * 初始化数据库表结构
 */
function initDB() {
    $db = getDB();
    
    $schemas = [
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
        );"
    ];
    
    foreach ($schemas as $sql) {
        $result = $db->exec($sql);
        if (!$result) {
            error_log('建表失败: ' . $db->lastErrorMsg());
        }
    }
    
    return true;
}

/**
 * 重算题库统计
 */
function recountBank($bankId) {
    $db = getDB();
    
    $stmt = $db->prepare("SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN type = 'single' THEN 1 ELSE 0 END) as single_count,
        SUM(CASE WHEN type = 'multiple' THEN 1 ELSE 0 END) as multiple_count,
        SUM(CASE WHEN type = 'truefalse' THEN 1 ELSE 0 END) as truefalse_count
        FROM questions WHERE bank_id = :bank_id");
    $stmt->bindValue(':bank_id', $bankId, SQLITE3_INTEGER);
    $result = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    
    $stmt = $db->prepare("UPDATE question_banks SET 
        question_count = :total,
        single_count = :single_count,
        multiple_count = :multiple_count,
        truefalse_count = :truefalse_count
        WHERE id = :id");
    $stmt->bindValue(':total', $result['total'], SQLITE3_INTEGER);
    $stmt->bindValue(':single_count', $result['single_count'], SQLITE3_INTEGER);
    $stmt->bindValue(':multiple_count', $result['multiple_count'], SQLITE3_INTEGER);
    $stmt->bindValue(':truefalse_count', $result['truefalse_count'], SQLITE3_INTEGER);
    $stmt->bindValue(':id', $bankId, SQLITE3_INTEGER);
    $stmt->execute();
    
    return true;
}
