<?php
/**
 * 题目 API
 * GET /api/questions - 查询题目
 * GET /api/questions/:id - 获取单个题目
 * POST /api/questions - 创建题目
 * PUT /api/questions/:id - 更新题目
 * DELETE /api/questions/:id - 删除题目
 */

$method = $_SERVER['REQUEST_METHOD'];
$id = $segments[1] ?? null;

switch ($method) {
    case 'GET':
        if ($id) {
            requireLogin();
            getQuestion($id);
        } else {
            requireLogin();
            listQuestions();
        }
        break;
        
    case 'POST':
        requireAdmin();
        createQuestion();
        break;
        
    case 'PUT':
        requireAdmin();
        updateQuestion($id);
        break;
        
    case 'DELETE':
        requireAdmin();
        deleteQuestion($id);
        break;
        
    default:
        http_response_code(405);
        echo json_encode(['error' => '方法不允许']);
}

/**
 * 查询题目
 */
function listQuestions() {
    $db = getDB();
    
    $conditions = [];
    $params = [];
    
    if (isset($_GET['bank_id'])) {
        $conditions[] = 'bank_id = :bank_id';
        $params[':bank_id'] = $_GET['bank_id'];
    }
    
    if (isset($_GET['type'])) {
        $conditions[] = 'type = :type';
        $params[':type'] = $_GET['type'];
    }
    
    if (isset($_GET['search'])) {
        $conditions[] = 'stem LIKE :search';
        $params[':search'] = '%' . $_GET['search'] . '%';
    }
    
    $sql = "SELECT * FROM questions";
    if (!empty($conditions)) {
        $sql .= " WHERE " . implode(' AND ', $conditions);
    }
    $sql .= " ORDER BY created_at DESC";
    
    $stmt = $db->prepare($sql);
    foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value, SQLITE3_TEXT);
    }
    
    $result = $stmt->execute();
    $questions = [];
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $row['options'] = json_decode($row['options'], true);
        $row['answer'] = json_decode($row['answer'], true);
        $questions[] = $row;
    }
    
    echo json_encode($questions, JSON_UNESCAPED_UNICODE);
}

/**
 * 获取单个题目
 */
function getQuestion($id) {
    $db = getDB();
    $stmt = $db->prepare("SELECT * FROM questions WHERE id = :id");
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $result = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    
    if (!$result) {
        http_response_code(404);
        echo json_encode(['error' => '题目不存在']);
        exit;
    }
    
    $result['options'] = json_decode($result['options'], true);
    $result['answer'] = json_decode($result['answer'], true);
    
    echo json_encode($result, JSON_UNESCAPED_UNICODE);
}

/**
 * 创建题目
 */
function createQuestion() {
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input || empty($input['stem']) || empty($input['type'])) {
        http_response_code(400);
        echo json_encode(['error' => '缺少必填字段']);
        exit;
    }
    
    $type = $input['type'];
    if (!in_array($type, ['single', 'multiple', 'truefalse'])) {
        http_response_code(400);
        echo json_encode(['error' => '无效的题目类型']);
        exit;
    }
    
    $db = getDB();
    
    $stmt = $db->prepare("INSERT INTO questions (bank_id, type, stem, options, answer, explanation) 
                          VALUES (:bank_id, :type, :stem, :options, :answer, :explanation)");
    $stmt->bindValue(':bank_id', $input['bank_id'], SQLITE3_INTEGER);
    $stmt->bindValue(':type', $type, SQLITE3_TEXT);
    $stmt->bindValue(':stem', $input['stem'], SQLITE3_TEXT);
    $stmt->bindValue(':options', json_encode($input['options'], JSON_UNESCAPED_UNICODE), SQLITE3_TEXT);
    $stmt->bindValue(':answer', json_encode($input['answer'], JSON_UNESCAPED_UNICODE), SQLITE3_TEXT);
    $stmt->bindValue(':explanation', $input['explanation'] ?? '', SQLITE3_TEXT);
    $stmt->execute();
    
    $id = $db->lastInsertRowID();
    
    // 重算题库统计
    recountBank($input['bank_id']);
    
    http_response_code(201);
    echo json_encode([
        'ok' => true,
        'id' => $id
    ]);
}

/**
 * 更新题目
 */
function updateQuestion($id) {
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input) {
        http_response_code(400);
        echo json_encode(['error' => '无效的请求数据']);
        exit;
    }
    
    $db = getDB();
    
    // 检查题目是否存在
    $stmt = $db->prepare("SELECT id, bank_id FROM questions WHERE id = :id");
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $result = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    
    if (!$result) {
        http_response_code(404);
        echo json_encode(['error' => '题目不存在']);
        exit;
    }
    
    $stmt = $db->prepare("UPDATE questions SET 
        bank_id = :bank_id, type = :type, stem = :stem, 
        options = :options, answer = :answer, explanation = :explanation 
        WHERE id = :id");
    $stmt->bindValue(':bank_id', $input['bank_id'] ?? $result['bank_id'], SQLITE3_INTEGER);
    $stmt->bindValue(':type', $input['type'] ?? '', SQLITE3_TEXT);
    $stmt->bindValue(':stem', $input['stem'] ?? '', SQLITE3_TEXT);
    $stmt->bindValue(':options', json_encode($input['options'] ?? [], JSON_UNESCAPED_UNICODE), SQLITE3_TEXT);
    $stmt->bindValue(':answer', json_encode($input['answer'] ?? null, JSON_UNESCAPED_UNICODE), SQLITE3_TEXT);
    $stmt->bindValue(':explanation', $input['explanation'] ?? '', SQLITE3_TEXT);
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $stmt->execute();
    
    // 重算题库统计
    recountBank($input['bank_id'] ?? $result['bank_id']);
    
    echo json_encode(['ok' => true]);
}

/**
 * 删除题目
 */
function deleteQuestion($id) {
    $db = getDB();
    
    // 获取题库 ID
    $stmt = $db->prepare("SELECT bank_id FROM questions WHERE id = :id");
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $result = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    
    if (!$result) {
        http_response_code(404);
        echo json_encode(['error' => '题目不存在']);
        exit;
    }
    
    $bankId = $result['bank_id'];
    
    $stmt = $db->prepare("DELETE FROM questions WHERE id = :id");
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $stmt->execute();
    
    // 重算题库统计
    recountBank($bankId);
    
    echo json_encode(['ok' => true]);
}
