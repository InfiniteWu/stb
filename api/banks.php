<?php
/**
 * 题库 API
 * GET /api/banks - 列出所有题库
 * POST /api/banks - 创建题库
 * PUT /api/banks/:id - 更新题库
 * DELETE /api/banks/:id - 删除题库
 * GET /api/banks/:id/export - 导出题库
 * POST /api/banks/:id/recount - 重算统计
 */

$method = $_SERVER['REQUEST_METHOD'];
$id = $segments[1] ?? null;
$action = $segments[2] ?? null;

switch ($method) {
    case 'GET':
        if ($id && $action === 'export') {
            // 导出题库
            requireLogin();
            exportBank($id);
        } elseif ($id) {
            // 获取单个题库
            requireLogin();
            getBank($id);
        } else {
            // 列出所有题库
            requireLogin();
            listBanks();
        }
        break;
        
    case 'POST':
        if ($id && $action === 'recount') {
            // 重算统计
            requireAdmin();
            recountBankApi($id);
        } else {
            // 创建题库
            requireAdmin();
            createBank();
        }
        break;
        
    case 'PUT':
        requireAdmin();
        updateBank($id);
        break;
        
    case 'DELETE':
        requireAdmin();
        deleteBank($id);
        break;
        
    default:
        http_response_code(405);
        echo json_encode(['error' => '方法不允许']);
}

/**
 * 列出所有题库
 */
function listBanks() {
    $db = getDB();
    $result = $db->query("SELECT * FROM question_banks ORDER BY created_at DESC");
    $banks = [];
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $banks[] = $row;
    }
    echo json_encode($banks);
}

/**
 * 获取单个题库
 */
function getBank($id) {
    $db = getDB();
    $stmt = $db->prepare("SELECT * FROM question_banks WHERE id = :id");
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $result = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    
    if (!$result) {
        http_response_code(404);
        echo json_encode(['error' => '题库不存在']);
        exit;
    }
    
    echo json_encode($result);
}

/**
 * 创建题库
 */
function createBank() {
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input || empty($input['name'])) {
        http_response_code(400);
        echo json_encode(['error' => '题库名称不能为空']);
        exit;
    }
    
    $db = getDB();
    $stmt = $db->prepare("INSERT INTO question_banks (name, description) VALUES (:name, :description)");
    $stmt->bindValue(':name', $input['name'], SQLITE3_TEXT);
    $stmt->bindValue(':description', $input['description'] ?? '', SQLITE3_TEXT);
    $stmt->execute();
    
    $id = $db->lastInsertRowID();
    
    http_response_code(201);
    echo json_encode([
        'ok' => true,
        'id' => $id
    ]);
}

/**
 * 更新题库
 */
function updateBank($id) {
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input) {
        http_response_code(400);
        echo json_encode(['error' => '无效的请求数据']);
        exit;
    }
    
    $db = getDB();
    
    // 检查题库是否存在
    $stmt = $db->prepare("SELECT id FROM question_banks WHERE id = :id");
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $result = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    
    if (!$result) {
        http_response_code(404);
        echo json_encode(['error' => '题库不存在']);
        exit;
    }
    
    $stmt = $db->prepare("UPDATE question_banks SET name = :name, description = :description WHERE id = :id");
    $stmt->bindValue(':name', $input['name'] ?? '', SQLITE3_TEXT);
    $stmt->bindValue(':description', $input['description'] ?? '', SQLITE3_TEXT);
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $stmt->execute();
    
    echo json_encode(['ok' => true]);
}

/**
 * 删除题库
 */
function deleteBank($id) {
    $db = getDB();
    
    $stmt = $db->prepare("DELETE FROM question_banks WHERE id = :id");
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $result = $stmt->execute();
    
    if ($db->changes() === 0) {
        http_response_code(404);
        echo json_encode(['error' => '题库不存在']);
        exit;
    }
    
    echo json_encode(['ok' => true]);
}

/**
 * 导出题库
 */
function exportBank($id) {
    $db = getDB();
    
    $stmt = $db->prepare("SELECT * FROM question_banks WHERE id = :id");
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $bank = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    
    if (!$bank) {
        http_response_code(404);
        echo json_encode(['error' => '题库不存在']);
        exit;
    }
    
    $stmt = $db->prepare("SELECT * FROM questions WHERE bank_id = :bank_id");
    $stmt->bindValue(':bank_id', $id, SQLITE3_INTEGER);
    $result = $stmt->execute();
    
    $questions = [];
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $row['options'] = json_decode($row['options'], true);
        $row['answer'] = json_decode($row['answer'], true);
        $questions[] = $row;
    }
    
    echo json_encode([
        'bank' => $bank,
        'questions' => $questions
    ], JSON_UNESCAPED_UNICODE);
}

/**
 * 重算题库统计
 */
function recountBankApi($id) {
    recountBank($id);
    echo json_encode(['ok' => true]);
}
