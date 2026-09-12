<?php
/**
 * PHP 内置服务器路由器
 * 用法: php -S 127.0.0.1:2026 router.php
 *
 * 安全修复 (2026-09-12)：
 * 原实现把 urldecode() 后的 $uri 直接拼到 __DIR__ . '/public' 上再 readfile()，
 * 导致目录穿越 —— /../data/shuatibao.db 可下载整个数据库（含密码哈希），
 * /../api/auth.php 可读取 PHP 源码。
 * 现改为 realpath() 前缀校验 + 扩展名白名单。
 *
 * 归档说明 (2026-09-12)：本文件已随 PHP 后端整体移入 legacy/php/。
 * public/ 静态资源仍留在仓库根，因此这里显式指回，保证 PHP 版在过渡期内
 * 依然可直接 `./run.sh` 启动。新架构见 worker/。
 */

// public/ 位于仓库根（与 legacy/ 分离）
define('PUBLIC_DIR', dirname(__DIR__, 2) . '/public');

$uri = urldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));

/**
 * 安全地提供 $baseDir 内的静态文件。
 * 三重校验：真实路径存在、位于 $baseDir 之内、扩展名在白名单内。
 */
function serveStaticFile(string $baseDir, string $relativePath): bool {
    static $mimeTypes = [
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

    $base = realpath($baseDir);
    if ($base === false) {
        return false;
    }

    // realpath() 会解析掉所有 ../ 与符号链接；解析失败即视为不存在。
    $target = realpath($base . '/' . ltrim($relativePath, '/'));
    if ($target === false || !is_file($target)) {
        return false;
    }

    // 关键校验：解析后的真实路径必须仍落在 $baseDir 之内。
    if ($target !== $base && strpos($target, $base . DIRECTORY_SEPARATOR) !== 0) {
        error_log('router: 拦截越权静态文件请求 ' . $_SERVER['REQUEST_URI']);
        $GLOBALS['__static_blocked'] = true;
        return false;
    }

    // 扩展名白名单：.php / .db / .env 等一律不经 HTTP 提供。
    $ext = strtolower(pathinfo($target, PATHINFO_EXTENSION));
    if (!isset($mimeTypes[$ext])) {
        return false;
    }

    header('Content-Type: ' . $mimeTypes[$ext]);
    readfile($target);
    return true;
}

/**
 * 若上一步的静态文件请求因越权被拦下，立即以 403 终止，
 * 不再回落到 SPA fallback（避免把攻击请求伪装成正常页面）。
 */
function denyIfBlocked(): void {
    if (empty($GLOBALS['__static_blocked'])) {
        return;
    }
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo '403 Forbidden';
    exit;
}

// API 路由
if (preg_match('#^/api(/|$)#', $uri)) {
    $apiFile = __DIR__ . '/api/index.php';
    if (file_exists($apiFile)) {
        require $apiFile;
        return true;
    }
}

// 移动端页面与静态文件
if (preg_match('#^/mobile(/|$)#', $uri)) {
    $mobileRelative = preg_replace('#^/mobile#', '', $uri);
    if (serveStaticFile(PUBLIC_DIR . '/mobile', $mobileRelative)) {
        return true;
    }
    denyIfBlocked();

    $mobileFile = PUBLIC_DIR . '/mobile/index.html';
    if (file_exists($mobileFile)) {
        header('Content-Type: text/html; charset=utf-8');
        readfile($mobileFile);
        return true;
    }
}

// 静态文件 (从 public/ 目录提供)
if ($uri !== '/') {
    if (serveStaticFile(PUBLIC_DIR, $uri)) {
        return true;
    }
    denyIfBlocked();
}

// SPA fallback - 返回 index.html
$indexFile = PUBLIC_DIR . '/index.html';
if (file_exists($indexFile)) {
    header('Content-Type: text/html; charset=utf-8');
    readfile($indexFile);
    return true;
}

http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
echo '404 Not Found';
