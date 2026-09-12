<?php
/**
 * 练习记录 API
 * GET /api/sessions - 查询练习记录
 * GET /api/sessions/:id - 获取单次练习详情
 */

$method = $_SERVER['REQUEST_METHOD'];
$id = $segments[1] ?? null;

switch ($method) {
    case 'GET':
        requireLogin();
        if ($id) {
            getSession($id);
        } else {
            listSessions();
        }
        break;
        
    default:
        http_response_code(405);
        echo json_encode(['error' => '方法不允许']);
}

/**
 * 查询练习记录
 */
function listSessions() {
    $user = getCurrentUser();
    $db = getDB();
    
    $page = intval($_GET['page'] ?? 1);
    $perPage = intval($_GET['per_page'] ?? 20);
    $offset = ($page - 1) * $perPage;
    
    $conditions = ['user_id = :user_id'];
    $params = [':user_id' => $user['id']];
    
    if (isset($_GET['bank_id'])) {
        $conditions[] = 'bank_id = :bank_id';
        $params[':bank_id'] = $_GET['bank_id'];
    }
    
    // 获取总数
    $sql = "SELECT COUNT(*) FROM practice_sessions WHERE " . implode(' AND ', $conditions);
    $stmt = $db->prepare($sql);
    foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value, SQLITE3_INTEGER);
    }
    $total = $stmt->execute()->fetchArray()[0];
    
    // 获取列表
    $sql = "SELECT * FROM practice_sessions WHERE " . implode(' AND ', $conditions) . 
           " ORDER BY submitted_at DESC LIMIT :limit OFFSET :offset";
    $stmt = $db->prepare($sql);
    foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value, SQLITE3_INTEGER);
    }
    $stmt->bindValue(':limit', $perPage, SQLITE3_INTEGER);
    $stmt->bindValue(':offset', $offset, SQLITE3_INTEGER);
    
    $result = $stmt->execute();
    $sessions = [];
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $sessions[] = $row;
    }
    
    echo json_encode([
        'total' => $total,
        'page' => $page,
        'per_page' => $perPage,
        'sessions' => $sessions
    ]);
}

/**
 * 获取单次练习详情
 */
function getSession($id) {
    $user = getCurrentUser();
    $db = getDB();
    
    $stmt = $db->prepare("SELECT * FROM practice_sessions WHERE id = :id AND user_id = :user_id");
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $stmt->bindValue(':user_id', $user['id'], SQLITE3_INTEGER);
    $session = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    
    if (!$session) {
        http_response_code(404);
        echo json_encode(['error' => '记录不存在']);
        exit;
    }
    
    // 获取答案详情
    $stmt = $db->prepare("SELECT pa.*, q.stem, q.type, q.options, q.explanation 
                          FROM practice_answers pa 
                          JOIN questions q ON pa.question_id = q.id 
                          WHERE pa.session_id = :session_id");
    $stmt->bindValue(':session_id', $id, SQLITE3_INTEGER);
    $result = $stmt->execute();
    
    $answers = [];
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $row['selected_answer'] = json_decode($row['selected_answer'], true);
        $row['correct_answer'] = json_decode($row['correct_answer'], true);
        $row['options'] = json_decode($row['options'], true);
        $answers[] = $row;
    }
    
    echo json_encode([
        'session' => $session,
        'answers' => $answers
    ], JSON_UNESCAPED_UNICODE);
}
