<?php
$uri = $_SERVER['REQUEST_URI'];
$path = parse_url($uri, PHP_URL_PATH);

// API routes
if (strpos($path, '/api/') === 0) {
    require __DIR__ . '/../api/index.php';
    exit;
}

// Static files: let PHP built-in server handle them
$file = __DIR__ . $path;
if (is_file($file)) {
    return false;
}

// Directory with trailing slash → serve index file inside it
if (is_dir($file)) {
    if (substr($path, -1) !== '/') {
        header('Location: ' . $path . '/');
        exit;
    }
    $index = $file . 'index.html';
    if (is_file($index)) {
        require $index;
        exit;
    }
}

// SPA fallback: serve root index.html
require __DIR__ . '/index.html';
