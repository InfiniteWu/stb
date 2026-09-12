<?php
/**
 * public/ 目录的 PHP 内置服务器路由器
 *
 * 用法: php -S 127.0.0.1:2026 public/router.php   （从仓库根目录启动，docroot = 仓库根）
 * 注意: run.sh 使用的是根目录的 router.php，本文件并非默认入口，但仍须保持安全。
 *
 * 安全修复 (2026-09-12)：
 * 原实现用 is_file(__DIR__ . $path) 判断后 `return false`，把请求交还给 PHP 内置服务器。
 * 但内置服务器是按 **docroot**（启动时的 cwd，即仓库根）解析原始请求路径的，
 * 而不是按 __DIR__（public/）。于是 /../data/shuatibao.db 通过校验后被内置服务器
 * 按仓库根解析，直接吐出整个数据库文件。
 *
 * 修复要点有两个，缺一不可：
 *   1. realpath() 前缀校验，确保真实路径仍在 public/ 之内；
 *   2. **绝不再 `return false`**，一律自己 readfile() 已校验的绝对路径，
 *      彻底切断内置服务器对原始路径的二次解析。
 */

$uri = $_SERVER['REQUEST_URI'];
$path = parse_url($uri, PHP_URL_PATH);

// API routes
if (strpos($path, '/api/') === 0) {
    require __DIR__ . '/../api/index.php';
    exit;
}

$mimeTypes = [
    'html'  => 'text/html; charset=utf-8',
    'css'   => 'text/css; charset=utf-8',
    'js'    => 'application/javascript; charset=utf-8',
    'json'  => 'application/json; charset=utf-8',
    'map'   => 'application/json; charset=utf-8',
    'png'   => 'image/png',
    'jpg'   => 'image/jpeg',
    'jpeg'  => 'image/jpeg',
    'gif'   => 'image/gif',
    'webp'  => 'image/webp',
    'svg'   => 'image/svg+xml',
    'ico'   => 'image/x-icon',
    'woff'  => 'font/woff',
    'woff2' => 'font/woff2',
    'ttf'   => 'font/ttf',
    'txt'   => 'text/plain; charset=utf-8',
];

$base   = realpath(__DIR__);
$target = realpath(__DIR__ . '/' . ltrim(urldecode($path), '/'));

// 越权路径：明确拒绝，且不得回落到任何 fallback。
if ($target !== false
    && $target !== $base
    && strpos($target, $base . DIRECTORY_SEPARATOR) !== 0) {
    error_log('router(public): 拦截越权静态文件请求 ' . $_SERVER['REQUEST_URI']);
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo '403 Forbidden';
    exit;
}

// 静态文件：自行提供，避免内置服务器按 docroot 重新解析原始路径。
if ($target !== false && is_file($target)) {
    $ext = strtolower(pathinfo($target, PATHINFO_EXTENSION));
    if (isset($mimeTypes[$ext])) {
        header('Content-Type: ' . $mimeTypes[$ext]);
        readfile($target);
        exit;
    }
    // 白名单之外的扩展名（.php / .db 等）一律不提供
}

// Directory with trailing slash → serve index file inside it
if ($target !== false && is_dir($target)) {
    if (substr($path, -1) !== '/') {
        header('Location: ' . $path . '/');
        exit;
    }
    $index = rtrim($target, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'index.html';
    if (is_file($index)) {
        header('Content-Type: text/html; charset=utf-8');
        readfile($index);
        exit;
    }
}

// SPA fallback: serve root index.html
header('Content-Type: text/html; charset=utf-8');
readfile(__DIR__ . '/index.html');
