<?php
/**
 * 仪表盘 API
 * GET /api/dashboard - 获取今日统计
 */

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'GET') {
    http_response_code(405);
    echo json_encode(['error' => '方法不允许']);
    exit;
}

requireLogin();
getDashboard();

function getDashboard() {
    $user = getCurrentUser();
    $db = getDB();
    $today = date('Y-m-d');

    // 今日练习数（通过 practice_answers 计算总答题数）
    // 使用 SQLite 的 date('now','localtime') 确保时区一致
    $stmt = $db->prepare("SELECT COUNT(*) FROM practice_answers pa
                          JOIN practice_sessions ps ON pa.session_id = ps.id
                          WHERE ps.user_id = :user_id AND DATE(ps.submitted_at) = date('now','localtime')");
    $stmt->bindValue(':user_id', $user['id'], SQLITE3_INTEGER);
    $todayPracticeCount = $stmt->execute()->fetchArray()[0];

    // 今日正确数
    $stmt = $db->prepare("SELECT COUNT(*) FROM practice_answers pa
                          JOIN practice_sessions ps ON pa.session_id = ps.id
                          WHERE ps.user_id = :user_id AND DATE(ps.submitted_at) = date('now','localtime') AND pa.is_correct = 1");
    $stmt->bindValue(':user_id', $user['id'], SQLITE3_INTEGER);
    $todayCorrectCount = $stmt->execute()->fetchArray()[0];

    // 今日正确率
    $todayAccuracy = $todayPracticeCount > 0 ? round($todayCorrectCount / $todayPracticeCount, 2) : 0;

    // 今日新增错题数
    $stmt = $db->prepare("SELECT COUNT(*) FROM wrong_book WHERE user_id = :user_id AND DATE(added_at) = date('now','localtime')");
    $stmt->bindValue(':user_id', $user['id'], SQLITE3_INTEGER);
    $todayNewWrong = $stmt->execute()->fetchArray()[0];

    // 今日按题库分组的错题分布
    $stmt = $db->prepare("SELECT wb.bank_id, qb.name as bank_name, COUNT(*) as count
                          FROM wrong_book wb
                          JOIN question_banks qb ON wb.bank_id = qb.id
                          WHERE wb.user_id = :user_id AND DATE(wb.added_at) = date('now','localtime') AND wb.status = 'active'
                          GROUP BY wb.bank_id, qb.name");
    $stmt->bindValue(':user_id', $user['id'], SQLITE3_INTEGER);
    $result = $stmt->execute();

    $todayWrongPerBank = [];
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $todayWrongPerBank[] = $row;
    }

    echo json_encode([
        'today_practice_count' => $todayPracticeCount,
        'today_accuracy' => $todayAccuracy,
        'today_new_wrong' => $todayNewWrong,
        'today_wrong_per_bank' => $todayWrongPerBank
    ]);
}
