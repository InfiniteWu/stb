<?php
/**
 * 导入 API
 * POST /api/import - 导入题库
 */

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => '方法不允许']);
    exit;
}

requireAdmin();
importData();

function importData() {
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    
    // 处理文件上传
    if (strpos($contentType, 'multipart/form-data') !== false) {
        if (!isset($_FILES['file'])) {
            http_response_code(400);
            echo json_encode(['error' => '未找到上传文件']);
            exit;
        }
        
        $file = $_FILES['file'];
        if ($file['error'] !== UPLOAD_ERR_OK) {
            http_response_code(400);
            echo json_encode(['error' => '文件上传失败']);
            exit;
        }
        
        $content = file_get_contents($file['tmp_name']);
        $input = json_decode($content, true);
        $bankId = $_POST['bank_id'] ?? null;
    } else {
        // 处理 JSON 请求体
        $input = json_decode(file_get_contents('php://input'), true);
        $bankId = $input['bank_id'] ?? null;
    }
    
    if (!$input || !isset($input['questions'])) {
        http_response_code(400);
        echo json_encode(['error' => '无效的导入数据']);
        exit;
    }
    
    $db = getDB();
    $errors = [];
    $imported = 0;
    
    // 开始事务
    $db->exec('BEGIN TRANSACTION');
    
    try {
        // 创建或使用已有题库
        if (!$bankId) {
            $bankName = $input['bankName'] ?? '导入题库 ' . date('Y-m-d H:i:s');
            $description = $input['description'] ?? '';
            
            $stmt = $db->prepare("INSERT INTO question_banks (name, description) VALUES (:name, :description)");
            $stmt->bindValue(':name', $bankName, SQLITE3_TEXT);
            $stmt->bindValue(':description', $description, SQLITE3_TEXT);
            $stmt->execute();
            $bankId = $db->lastInsertRowID();
        }
        
        // 导入题目
        foreach ($input['questions'] as $index => $question) {
            $validationError = validateQuestion($question, $index + 1);
            if ($validationError) {
                $errors[] = $validationError;
                continue;
            }
            
            $stmt = $db->prepare("INSERT INTO questions (bank_id, type, stem, options, answer, explanation) 
                                  VALUES (:bank_id, :type, :stem, :options, :answer, :explanation)");
            $stmt->bindValue(':bank_id', $bankId, SQLITE3_INTEGER);
            $stmt->bindValue(':type', $question['type'], SQLITE3_TEXT);
            $stmt->bindValue(':stem', $question['stem'], SQLITE3_TEXT);
            $stmt->bindValue(':options', json_encode($question['options'], JSON_UNESCAPED_UNICODE), SQLITE3_TEXT);
            $stmt->bindValue(':answer', json_encode($question['answer'], JSON_UNESCAPED_UNICODE), SQLITE3_TEXT);
            $stmt->bindValue(':explanation', $question['explanation'] ?? '', SQLITE3_TEXT);
            $stmt->execute();
            $imported++;
        }
        
        // 重算题库统计
        recountBank($bankId);
        
        $db->exec('COMMIT');
        
        echo json_encode([
            'ok' => true,
            'bank_id' => $bankId,
            'imported' => $imported,
            'errors' => $errors
        ], JSON_UNESCAPED_UNICODE);
        
    } catch (Exception $e) {
        $db->exec('ROLLBACK');
        http_response_code(500);
        echo json_encode(['error' => '导入失败: ' . $e->getMessage()]);
    }
}

/**
 * 验证题目数据
 */
function validateQuestion($question, $index) {
    if (empty($question['stem'])) {
        return "第 {$index} 题: 题干不能为空";
    }
    
    if (!in_array($question['type'] ?? '', ['single', 'multiple', 'truefalse'])) {
        return "第 {$index} 题: 无效的题目类型";
    }
    
    if (empty($question['options']) || !is_array($question['options']) || count($question['options']) < 2) {
        return "第 {$index} 题: 选项必须是不少于 2 项的数组";
    }
    
    if (!isset($question['answer'])) {
        return "第 {$index} 题: 答案不能为空";
    }
    
    $type = $question['type'];
    $optionsCount = count($question['options']);
    $answer = $question['answer'];
    
    if ($type === 'single' || $type === 'truefalse') {
        if (!is_int($answer) || $answer < 0 || $answer >= $optionsCount) {
            return "第 {$index} 题: 答案必须是有效的选项索引";
        }
    } elseif ($type === 'multiple') {
        if (!is_array($answer)) {
            return "第 {$index} 题: 多选题答案必须是数组";
        }
        foreach ($answer as $idx) {
            if (!is_int($idx) || $idx < 0 || $idx >= $optionsCount) {
                return "第 {$index} 题: 答案索引超出选项范围";
            }
        }
    }
    
    return null;
}
