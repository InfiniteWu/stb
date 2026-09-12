<?php
/**
 * 答题记录 API
 * POST /api/records - 记录单次答题结果
 */

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => '方法不允许']);
    exit;
}

requireLogin();
addRecord();

function addRecord() {
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input || !isset($input['question_id']) || !isset($input['bank_id']) || !isset($input['is_correct'])) {
        http_response_code(400);
        echo json_encode(['error' => '缺少必填字段']);
        exit;
    }
    
    $user = getCurrentUser();
    $db = getDB();
    
    $stmt = $db->prepare("INSERT INTO study_records (user_id, question_id, bank_id, is_correct) 
                          VALUES (:user_id, :question_id, :bank_id, :is_correct)");
    $stmt->bindValue(':user_id', $user['id'], SQLITE3_INTEGER);
    $stmt->bindValue(':question_id', $input['question_id'], SQLITE3_INTEGER);
    $stmt->bindValue(':bank_id', $input['bank_id'], SQLITE3_INTEGER);
    $stmt->bindValue(':is_correct', $input['is_correct'] ? 1 : 0, SQLITE3_INTEGER);
    $stmt->execute();
    
    http_response_code(201);
    echo json_encode(['ok' => true]);
}
