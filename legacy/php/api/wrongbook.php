<?php
/**
 * 错题本 API
 * GET /api/wrongbook - 查询错题列表
 * GET /api/wrongbook/today - 查询今日错题
 * POST /api/wrongbook - 添加错题
 * PUT /api/wrongbook/:id/remove - 移除错题
 */

$method = $_SERVER['REQUEST_METHOD'];
$id = $segments[1] ?? null;

switch ($method) {
    case 'GET':
        requireLogin();
        if ($id === 'today') {
            getTodayWrong();
        } elseif ($id) {
            getWrongBook($id);
        } else {
            listWrongBook();
        }
        break;
        
    case 'POST':
        requireLogin();
        addWrong();
        break;
        
    case 'PUT':
        requireLogin();
        if ($segments[2] === 'remove') {
            removeWrong($id);
        } else {
            http_response_code(404);
            echo json_encode(['error' => '端点不存在']);
        }
        break;
        
    default:
        http_response_code(405);
        echo json_encode(['error' => '方法不允许']);
}

/**
 * 查询错题列表
 */
function listWrongBook() {
    $user = getCurrentUser();
    $db = getDB();
    
    $conditions = ['wb.user_id = :user_id', "wb.status = 'active'"];
    $params = [':user_id' => $user['id']];
    
    if (isset($_GET['bank_id'])) {
        $conditions[] = 'wb.bank_id = :bank_id';
        $params[':bank_id'] = $_GET['bank_id'];
    }
    
    $sql = "SELECT wb.*, q.stem, q.type, q.options, q.answer, q.explanation, qb.name as bank_name,
            (SELECT COUNT(*) FROM practice_answers pa WHERE pa.question_id = wb.question_id AND pa.is_correct = 0) as error_count,
            (SELECT COUNT(*) FROM practice_answers pa WHERE pa.question_id = wb.question_id AND pa.is_correct = 1) as correct_count
            FROM wrong_book wb
            JOIN questions q ON wb.question_id = q.id
            JOIN question_banks qb ON wb.bank_id = qb.id
            WHERE " . implode(' AND ', $conditions) . "
            ORDER BY wb.added_at DESC";
    
    $stmt = $db->prepare($sql);
    foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value, SQLITE3_INTEGER);
    }
    
    $result = $stmt->execute();
    $records = [];
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $row['options'] = json_decode($row['options'], true);
        $row['answer'] = json_decode($row['answer'], true);
        $records[] = $row;
    }
    
    echo json_encode($records, JSON_UNESCAPED_UNICODE);
}

/**
 * 查询今日错题
 */
function getTodayWrong() {
    $user = getCurrentUser();
    $db = getDB();
    
    $today = date('Y-m-d');
    
    $sql = "SELECT wb.*, q.stem, q.type, q.options, q.answer, q.explanation, qb.name as bank_name,
            (SELECT COUNT(*) FROM practice_answers pa WHERE pa.question_id = wb.question_id AND pa.is_correct = 0) as error_count,
            (SELECT COUNT(*) FROM practice_answers pa WHERE pa.question_id = wb.question_id AND pa.is_correct = 1) as correct_count
            FROM wrong_book wb
            JOIN questions q ON wb.question_id = q.id
            JOIN question_banks qb ON wb.bank_id = qb.id
            WHERE wb.user_id = :user_id AND wb.status = 'active' AND DATE(wb.added_at) = :today
            ORDER BY wb.added_at DESC";
    
    $stmt = $db->prepare($sql);
    $stmt->bindValue(':user_id', $user['id'], SQLITE3_INTEGER);
    $stmt->bindValue(':today', $today, SQLITE3_TEXT);
    
    $result = $stmt->execute();
    $records = [];
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $row['options'] = json_decode($row['options'], true);
        $row['answer'] = json_decode($row['answer'], true);
        $records[] = $row;
    }
    
    echo json_encode($records, JSON_UNESCAPED_UNICODE);
}

/**
 * 获取单个错题
 */
function getWrongBook($id) {
    $user = getCurrentUser();
    $db = getDB();
    
    $sql = "SELECT wb.*, q.stem, q.type, q.options, q.answer, q.explanation, qb.name as bank_name,
            (SELECT COUNT(*) FROM practice_answers pa WHERE pa.question_id = wb.question_id AND pa.is_correct = 0) as error_count,
            (SELECT COUNT(*) FROM practice_answers pa WHERE pa.question_id = wb.question_id AND pa.is_correct = 1) as correct_count
            FROM wrong_book wb
            JOIN questions q ON wb.question_id = q.id
            JOIN question_banks qb ON wb.bank_id = qb.id
            WHERE wb.id = :id AND wb.user_id = :user_id";
    
    $stmt = $db->prepare($sql);
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $stmt->bindValue(':user_id', $user['id'], SQLITE3_INTEGER);
    
    $result = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    
    if (!$result) {
        http_response_code(404);
        echo json_encode(['error' => '记录不存在']);
        exit;
    }
    
    $result['options'] = json_decode($result['options'], true);
    $result['answer'] = json_decode($result['answer'], true);
    
    echo json_encode($result, JSON_UNESCAPED_UNICODE);
}

/**
 * 添加错题
 */
function addWrong() {
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input || !isset($input['question_id']) || !isset($input['bank_id'])) {
        http_response_code(400);
        echo json_encode(['error' => '缺少必填字段']);
        exit;
    }
    
    $user = getCurrentUser();
    $db = getDB();
    
    // 检查是否已存在
    $stmt = $db->prepare("SELECT id, status FROM wrong_book 
                          WHERE user_id = :user_id AND question_id = :question_id AND bank_id = :bank_id");
    $stmt->bindValue(':user_id', $user['id'], SQLITE3_INTEGER);
    $stmt->bindValue(':question_id', $input['question_id'], SQLITE3_INTEGER);
    $stmt->bindValue(':bank_id', $input['bank_id'], SQLITE3_INTEGER);
    $existing = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    
    if ($existing) {
        if ($existing['status'] === 'removed') {
            // 重新激活
            $stmt = $db->prepare("UPDATE wrong_book SET status = 'active', removed_at = NULL WHERE id = :id");
            $stmt->bindValue(':id', $existing['id'], SQLITE3_INTEGER);
            $stmt->execute();
        }
        echo json_encode(['ok' => true, 'id' => $existing['id']]);
        return;
    }
    
    // 新增
    $stmt = $db->prepare("INSERT INTO wrong_book (user_id, question_id, bank_id) VALUES (:user_id, :question_id, :bank_id)");
    $stmt->bindValue(':user_id', $user['id'], SQLITE3_INTEGER);
    $stmt->bindValue(':question_id', $input['question_id'], SQLITE3_INTEGER);
    $stmt->bindValue(':bank_id', $input['bank_id'], SQLITE3_INTEGER);
    $stmt->execute();
    
    http_response_code(201);
    echo json_encode(['ok' => true, 'id' => $db->lastInsertRowID()]);
}

/**
 * 移除错题
 */
function removeWrong($id) {
    $user = getCurrentUser();
    $db = getDB();
    
    $stmt = $db->prepare("UPDATE wrong_book SET status = 'removed', removed_at = datetime('now', 'localtime') 
                          WHERE id = :id AND user_id = :user_id");
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $stmt->bindValue(':user_id', $user['id'], SQLITE3_INTEGER);
    $stmt->execute();
    
    if ($db->changes() === 0) {
        http_response_code(404);
        echo json_encode(['error' => '记录不存在']);
        exit;
    }
    
    echo json_encode(['ok' => true]);
}
