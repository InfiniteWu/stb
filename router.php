<?php
/**
 * PHP 内置服务器路由器
 * 用法: php -S 127.0.0.1:2026 router.php
 */

$uri = urldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
$method = $_SERVER['REQUEST_METHOD'];

// API 路由
if (preg_match('#^/api/(.*)#', $uri, $matches)) {
    $apiFile = __DIR__ . '/api/index.php';
    if (file_exists($apiFile)) {
        require $apiFile;
        return true;
    }
}

// 移动端页面与静态文件
if (preg_match('#^/mobile(/|$)#', $uri)) {
    $mobileStatic = __DIR__ . '/public/mobile' . preg_replace('#^/mobile#', '', $uri);
    if (file_exists($mobileStatic) && is_file($mobileStatic)) {
        $ext = pathinfo($mobileStatic, PATHINFO_EXTENSION);
        $mimeTypes = [
            'css' => 'text/css',
            'js' => 'application/javascript',
            'json' => 'application/json',
            'png' => 'image/png',
            'jpg' => 'image/jpeg',
            'jpeg' => 'image/jpeg',
            'gif' => 'image/gif',
            'svg' => 'image/svg+xml',
            'ico' => 'image/x-icon',
            'woff' => 'font/woff',
            'woff2' => 'font/woff2',
            'ttf' => 'font/ttf',
        ];
        if (isset($mimeTypes[$ext])) {
            header('Content-Type: ' . $mimeTypes[$ext]);
        }
        readfile($mobileStatic);
        return true;
    }

    $mobileFile = __DIR__ . '/public/mobile/index.html';
    if (file_exists($mobileFile)) {
        header('Content-Type: text/html; charset=utf-8');
        readfile($mobileFile);
        return true;
    }
}

// 静态文件 (从 public/ 目录提供)
if ($uri !== '/') {
    $staticFile = __DIR__ . '/public' . $uri;
    if (file_exists($staticFile) && is_file($staticFile)) {
        $ext = pathinfo($staticFile, PATHINFO_EXTENSION);
        $mimeTypes = [
            'css' => 'text/css',
            'js' => 'application/javascript',
            'json' => 'application/json',
            'png' => 'image/png',
            'jpg' => 'image/jpeg',
            'jpeg' => 'image/jpeg',
            'gif' => 'image/gif',
            'svg' => 'image/svg+xml',
            'ico' => 'image/x-icon',
            'woff' => 'font/woff',
            'woff2' => 'font/woff2',
            'ttf' => 'font/ttf',
        ];
        if (isset($mimeTypes[$ext])) {
            header('Content-Type: ' . $mimeTypes[$ext]);
        }
        readfile($staticFile);
        return true;
    }
}

// SPA fallback - 返回 index.html
$indexFile = __DIR__ . '/public/index.html';
if (file_exists($indexFile)) {
    header('Content-Type: text/html; charset=utf-8');
    readfile($indexFile);
    return true;
}

http_response_code(404);
echo '404 Not Found';
