<?php
/**
 * API 路由入口
 */

require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/db.php';

// 初始化数据库
initDB();

// 获取请求信息
$method = $_SERVER['REQUEST_METHOD'];
$uri = $_SERVER['REQUEST_URI'];

// 移除查询字符串
if (($pos = strpos($uri, '?')) !== false) {
    $uri = substr($uri, 0, $pos);
}

// 移除 /api/ 前缀
$uri = preg_replace('#^/api#', '', $uri);

// 分割路径
$segments = array_values(array_filter(explode('/', $uri)));

// 路由分发
$resource = $segments[0] ?? '';
$id = $segments[1] ?? null;
$action = $segments[2] ?? null;

try {
    switch ($resource) {
        case 'auth':
            require __DIR__ . '/auth_api.php';
            break;
            
        case 'banks':
            require __DIR__ . '/banks.php';
            break;
            
        case 'questions':
            require __DIR__ . '/questions.php';
            break;
            
        case 'practice':
            require __DIR__ . '/practice.php';
            break;
            
        case 'sessions':
            require __DIR__ . '/sessions.php';
            break;
            
        case 'records':
            require __DIR__ . '/records.php';
            break;
            
        case 'wrongbook':
            require __DIR__ . '/wrongbook.php';
            break;
            
        case 'import':
            require __DIR__ . '/import.php';
            break;
            
        case 'users':
            require __DIR__ . '/users.php';
            break;
            
        case 'dashboard':
            require __DIR__ . '/dashboard.php';
            break;
            
        default:
            http_response_code(404);
            echo json_encode(['error' => 'API 端点不存在']);
            break;
    }
} catch (Exception $e) {
    error_log('API 错误: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => '服务器内部错误']);
}
