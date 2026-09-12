<?php
/**
 * 认证 API
 * POST /api/auth/login - 登录
 * POST /api/auth/logout - 登出
 * GET /api/auth/me - 获取当前用户
 */

$method = $_SERVER['REQUEST_METHOD'];
$action = $segments[1] ?? 'me';

switch ($action) {
    case 'login':
        if ($method !== 'POST') {
            http_response_code(405);
            echo json_encode(['error' => '方法不允许']);
            exit;
        }
        
        $input = json_decode(file_get_contents('php://input'), true);
        
        if (!$input || !isset($input['username']) || !isset($input['password'])) {
            http_response_code(400);
            echo json_encode(['error' => '用户名和密码不能为空']);
            exit;
        }
        
        $user = login($input['username'], $input['password']);
        
        if (!$user) {
            http_response_code(401);
            echo json_encode(['error' => '用户名或密码错误']);
            exit;
        }
        
        echo json_encode([
            'ok' => true,
            'user' => $user
        ]);
        break;
        
    case 'logout':
        logout();
        echo json_encode(['ok' => true]);
        break;
        
    case 'me':
        requireLogin();
        $user = getCurrentUser();
        echo json_encode(['user' => $user]);
        break;

    case 'update-profile':
        if ($method !== 'POST') {
            http_response_code(405);
            echo json_encode(['error' => '方法不允许']);
            exit;
        }
        requireLogin();
        $input = json_decode(file_get_contents('php://input'), true);
        if (!$input || empty($input['display_name'])) {
            http_response_code(400);
            echo json_encode(['error' => '显示名不能为空']);
            exit;
        }
        $user = getCurrentUser();
        $db = getDB();
        $stmt = $db->prepare("UPDATE users SET display_name = :name WHERE id = :id");
        $stmt->bindValue(':name', $input['display_name'], SQLITE3_TEXT);
        $stmt->bindValue(':id', $user['id'], SQLITE3_INTEGER);
        $stmt->execute();
        echo json_encode(['ok' => true]);
        break;

    case 'change-password':
        if ($method !== 'POST') {
            http_response_code(405);
            echo json_encode(['error' => '方法不允许']);
            exit;
        }
        requireLogin();
        $input = json_decode(file_get_contents('php://input'), true);
        if (!$input || empty($input['old_password']) || empty($input['new_password'])) {
            http_response_code(400);
            echo json_encode(['error' => '请填写完整']);
            exit;
        }
        $user = getCurrentUser();
        if (!changePassword($user['id'], $input['old_password'], $input['new_password'])) {
            http_response_code(400);
            echo json_encode(['error' => '原密码错误']);
            exit;
        }
        echo json_encode(['ok' => true]);
        break;

    case 'admin-reset-password':
        if ($method !== 'POST') {
            http_response_code(405);
            echo json_encode(['error' => '方法不允许']);
            exit;
        }
        requireAdmin();
        $input = json_decode(file_get_contents('php://input'), true);
        if (!$input || empty($input['user_id']) || empty($input['new_password'])) {
            http_response_code(400);
            echo json_encode(['error' => '参数不完整']);
            exit;
        }
        $db = getDB();
        $hash = password_hash($input['new_password'], PASSWORD_DEFAULT);
        $stmt = $db->prepare("UPDATE users SET password_hash = :hash WHERE id = :id");
        $stmt->bindValue(':hash', $hash, SQLITE3_TEXT);
        $stmt->bindValue(':id', $input['user_id'], SQLITE3_INTEGER);
        $stmt->execute();
        echo json_encode(['ok' => true]);
        break;

    default:
        http_response_code(404);
        echo json_encode(['error' => '端点不存在']);
        break;
}
