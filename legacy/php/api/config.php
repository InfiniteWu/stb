<?php
/**
 * 配置文件
 */

// 错误报告
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);

// 时区
date_default_timezone_set('Asia/Shanghai');

// 数据库路径
// 归档后目录结构为 legacy/{php/api,data}/，故上溯两层指向 legacy/data/。
define('DB_PATH', dirname(__DIR__, 2) . '/data/shuatibao.db');

// Session 配置
define('SESSION_LIFETIME', 86400 * 7); // 7天

// 跨域配置（开发环境）
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, X-User-Id');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');

// 处理 OPTIONS 预检请求
if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// 设置响应头
if (php_sapi_name() !== 'cli') {
    header('Content-Type: application/json; charset=utf-8');
}
