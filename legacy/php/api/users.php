<?php
/**
 * 用户管理 API（仅管理员）
 * GET /api/users - 列出所有用户
 * POST /api/users - 创建用户
 * PUT /api/users/:id - 更新用户
 * DELETE /api/users/:id - 删除用户
 * POST /api/users/:id/reset-password - 重置密码
 */

$method = $_SERVER['REQUEST_METHOD'];
$id = $segments[1] ?? null;
$action = $segments[2] ?? null;

requireAdmin();

switch ($method) {
    case 'GET':
        if ($id) {
            getUser($id);
        } else {
            listUsers();
        }
        break;
        
    case 'POST':
        if ($id && $action === 'reset-password') {
            resetPassword($id);
        } else {
            createUser();
        }
        break;
        
    case 'PUT':
        updateUser($id);
        break;
        
    case 'DELETE':
        deleteUser($id);
        break;
        
    default:
        http_response_code(405);
        echo json_encode(['error' => '方法不允许']);
}

/**
 * 列出所有用户
 */
function listUsers() {
    $db = getDB();
    $result = $db->query("SELECT id, username, display_name, role, created_at FROM users ORDER BY id");
    
    $users = [];
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $users[] = $row;
    }
    
    echo json_encode($users);
}

/**
 * 获取单个用户
 */
function getUser($id) {
    $db = getDB();
    $stmt = $db->prepare("SELECT id, username, display_name, role, created_at FROM users WHERE id = :id");
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $result = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    
    if (!$result) {
        http_response_code(404);
        echo json_encode(['error' => '用户不存在']);
        exit;
    }
    
    echo json_encode($result);
}

/**
 * 创建用户
 */
function createUser() {
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input || empty($input['username']) || empty($input['password'])) {
        http_response_code(400);
        echo json_encode(['error' => '用户名和密码不能为空']);
        exit;
    }
    
    $db = getDB();
    
    // 检查用户名是否已存在
    $stmt = $db->prepare("SELECT id FROM users WHERE username = :username");
    $stmt->bindValue(':username', $input['username'], SQLITE3_TEXT);
    $result = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    
    if ($result) {
        http_response_code(400);
        echo json_encode(['error' => '用户名已存在']);
        exit;
    }
    
    $passwordHash = password_hash($input['password'], PASSWORD_DEFAULT);
    
    $stmt = $db->prepare("INSERT INTO users (username, password_hash, display_name, role) 
                          VALUES (:username, :password_hash, :display_name, :role)");
    $stmt->bindValue(':username', $input['username'], SQLITE3_TEXT);
    $stmt->bindValue(':password_hash', $passwordHash, SQLITE3_TEXT);
    $stmt->bindValue(':display_name', $input['display_name'] ?? $input['username'], SQLITE3_TEXT);
    $stmt->bindValue(':role', $input['role'] ?? 'user', SQLITE3_TEXT);
    $stmt->execute();
    
    http_response_code(201);
    echo json_encode([
        'ok' => true,
        'id' => $db->lastInsertRowID()
    ]);
}

/**
 * 更新用户
 */
function updateUser($id) {
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input) {
        http_response_code(400);
        echo json_encode(['error' => '无效的请求数据']);
        exit;
    }
    
    $db = getDB();
    
    // 检查用户是否存在
    $stmt = $db->prepare("SELECT id FROM users WHERE id = :id");
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $result = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    
    if (!$result) {
        http_response_code(404);
        echo json_encode(['error' => '用户不存在']);
        exit;
    }
    
    $fields = [];
    $params = [':id' => $id];
    
    if (isset($input['display_name'])) {
        $fields[] = 'display_name = :display_name';
        $params[':display_name'] = $input['display_name'];
    }
    
    if (isset($input['role'])) {
        $fields[] = 'role = :role';
        $params[':role'] = $input['role'];
    }
    
    if (empty($fields)) {
        echo json_encode(['ok' => true]);
        return;
    }
    
    $sql = "UPDATE users SET " . implode(', ', $fields) . " WHERE id = :id";
    $stmt = $db->prepare($sql);
    foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value, SQLITE3_TEXT);
    }
    $stmt->execute();
    
    echo json_encode(['ok' => true]);
}

/**
 * 删除用户
 */
function deleteUser($id) {
    $db = getDB();
    
    // 不允许删除管理员
    $stmt = $db->prepare("SELECT role FROM users WHERE id = :id");
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $result = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    
    if (!$result) {
        http_response_code(404);
        echo json_encode(['error' => '用户不存在']);
        exit;
    }
    
    if ($result['role'] === 'admin') {
        http_response_code(400);
        echo json_encode(['error' => '不能删除管理员账户']);
        exit;
    }
    
    $stmt = $db->prepare("DELETE FROM users WHERE id = :id");
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $stmt->execute();
    
    echo json_encode(['ok' => true]);
}

/**
 * 重置密码
 */
function resetPassword($id) {
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input || empty($input['password'])) {
        http_response_code(400);
        echo json_encode(['error' => '新密码不能为空']);
        exit;
    }
    
    $db = getDB();
    
    // 检查用户是否存在
    $stmt = $db->prepare("SELECT id FROM users WHERE id = :id");
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $result = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    
    if (!$result) {
        http_response_code(404);
        echo json_encode(['error' => '用户不存在']);
        exit;
    }
    
    $passwordHash = password_hash($input['password'], PASSWORD_DEFAULT);
    
    $stmt = $db->prepare("UPDATE users SET password_hash = :hash WHERE id = :id");
    $stmt->bindValue(':hash', $passwordHash, SQLITE3_TEXT);
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $stmt->execute();
    
    echo json_encode(['ok' => true]);
}
