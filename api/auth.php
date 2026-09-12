<?php
/**
 * 认证中间件
 * 基于 Session 的用户认证
 */

require_once __DIR__ . '/db.php';

/**
 * 启动 Session
 */
function startSession() {
    if (session_status() === PHP_SESSION_NONE) {
        session_set_cookie_params([
            'lifetime' => SESSION_LIFETIME,
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Lax'
        ]);
        session_start();
    }
}

/**
 * 获取当前登录用户
 * @return array|null 用户信息或 null
 */
function getCurrentUser() {
    startSession();
    
    if (!isset($_SESSION['user_id'])) {
        return null;
    }
    
    $db = getDB();
    $stmt = $db->prepare("SELECT id, username, display_name, role FROM users WHERE id = :id");
    $stmt->bindValue(':id', $_SESSION['user_id'], SQLITE3_INTEGER);
    $result = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    
    return $result ?: null;
}

/**
 * 检查用户是否已登录
 * @return bool
 */
function isLoggedIn() {
    return getCurrentUser() !== null;
}

/**
 * 检查用户是否是管理员
 * @return bool
 */
function isAdmin() {
    $user = getCurrentUser();
    return $user && $user['role'] === 'admin';
}

/**
 * 要求用户登录
 */
function requireLogin() {
    if (!isLoggedIn()) {
        http_response_code(401);
        echo json_encode(['error' => '请先登录']);
        exit;
    }
}

/**
 * 要求管理员权限
 */
function requireAdmin() {
    requireLogin();
    if (!isAdmin()) {
        http_response_code(403);
        echo json_encode(['error' => '需要管理员权限']);
        exit;
    }
}

/**
 * 用户登录
 * @param string $username
 * @param string $password
 * @return array|null 用户信息或 null
 */
function login($username, $password) {
    $db = getDB();
    
    $stmt = $db->prepare("SELECT id, username, password_hash, display_name, role FROM users WHERE username = :username");
    $stmt->bindValue(':username', $username, SQLITE3_TEXT);
    $result = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    
    if (!$result) {
        return null;
    }
    
    if (!password_verify($password, $result['password_hash'])) {
        return null;
    }
    
    // 设置 session
    startSession();
    $_SESSION['user_id'] = $result['id'];
    
    return [
        'id' => $result['id'],
        'username' => $result['username'],
        'display_name' => $result['display_name'],
        'role' => $result['role']
    ];
}

/**
 * 用户登出
 */
function logout() {
    startSession();
    session_destroy();
}

/**
 * 修改密码
 * @param int $userId
 * @param string $oldPassword
 * @param string $newPassword
 * @return bool
 */
function changePassword($userId, $oldPassword, $newPassword) {
    $db = getDB();
    
    $stmt = $db->prepare("SELECT password_hash FROM users WHERE id = :id");
    $stmt->bindValue(':id', $userId, SQLITE3_INTEGER);
    $result = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    
    if (!$result) {
        return false;
    }
    
    if (!password_verify($oldPassword, $result['password_hash'])) {
        return false;
    }
    
    $newHash = password_hash($newPassword, PASSWORD_DEFAULT);
    $stmt = $db->prepare("UPDATE users SET password_hash = :hash WHERE id = :id");
    $stmt->bindValue(':hash', $newHash, SQLITE3_TEXT);
    $stmt->bindValue(':id', $userId, SQLITE3_INTEGER);
    $stmt->execute();
    
    return true;
}
