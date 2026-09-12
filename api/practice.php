<?php
/**
 * 练习 API
 * POST /api/practice/pick - 抽题
 * POST /api/practice/submit - 提交答案
 */

$method = $_SERVER['REQUEST_METHOD'];
$action = $segments[1] ?? null;

switch ($action) {
    case 'pick':
        if ($method !== 'POST') {
            http_response_code(405);
            echo json_encode(['error' => '方法不允许']);
            exit;
        }
        requireLogin();
        pickQuestions();
        break;

    case 'pick-wrong':
        if ($method !== 'POST') {
            http_response_code(405);
            echo json_encode(['error' => '方法不允许']);
            exit;
        }
        requireLogin();
        pickWrongQuestions();
        break;

    case 'submit':
        if ($method !== 'POST') {
            http_response_code(405);
            echo json_encode(['error' => '方法不允许']);
            exit;
        }
        requireLogin();
        submitPractice();
        break;

    default:
        http_response_code(404);
        echo json_encode(['error' => '端点不存在']);
}

/**
 * 抽题
 */
function pickQuestions() {
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input || !isset($input['bank_id'])) {
        http_response_code(400);
        echo json_encode(['error' => '缺少题库 ID']);
        exit;
    }
    
    $bankId = $input['bank_id'];
    $singleCount = $input['single_count'] ?? 0;
    $multipleCount = $input['multiple_count'] ?? 0;
    $truefalseCount = $input['truefalse_count'] ?? 0;
    $shuffleOptions = $input['shuffle_options'] ?? false;
    
    $db = getDB();
    $questions = [];
    
    // 按题型分别抽取
    $types = [
        'single' => $singleCount,
        'multiple' => $multipleCount,
        'truefalse' => $truefalseCount
    ];
    
    foreach ($types as $type => $count) {
        if ($count <= 0) continue;
        
        $stmt = $db->prepare("SELECT * FROM questions WHERE bank_id = :bank_id AND type = :type ORDER BY RANDOM() LIMIT :count");
        $stmt->bindValue(':bank_id', $bankId, SQLITE3_INTEGER);
        $stmt->bindValue(':type', $type, SQLITE3_TEXT);
        $stmt->bindValue(':count', $count, SQLITE3_INTEGER);
        $result = $stmt->execute();
        
        while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
            $row['options'] = json_decode($row['options'], true);
            $row['answer'] = json_decode($row['answer'], true);
            
            // 打乱选项
            if ($shuffleOptions && !empty($row['options'])) {
                $options = $row['options'];
                $answer = $row['answer'];
                
                // 创建索引数组并打乱
                $indices = array_keys($options);
                shuffle($indices);
                
                $shuffledOptions = [];
                $newAnswer = null;
                
                foreach ($indices as $newIndex => $oldIndex) {
                    $shuffledOptions[$newIndex] = $options[$oldIndex];
                    if (is_array($answer)) {
                        // 多选题
                        if (in_array($oldIndex, $answer)) {
                            $newAnswer[] = $newIndex;
                        }
                    } else {
                        // 单选或判断
                        if ($oldIndex === $answer) {
                            $newAnswer = $newIndex;
                        }
                    }
                }
                
                $row['options'] = $shuffledOptions;
                $row['answer'] = $newAnswer;
            }
            
            $questions[] = $row;
        }
    }
    
    // 整体打乱顺序
    if (($input['mode'] ?? 'random') === 'random') {
        shuffle($questions);
    }
    
    echo json_encode([
        'questions' => $questions,
        'total' => count($questions)
    ], JSON_UNESCAPED_UNICODE);
}

/**
 * 从错题本抽题
 */
function pickWrongQuestions() {
    $input = json_decode(file_get_contents('php://input'), true);
    $user = getCurrentUser();
    $db = getDB();

    $count = intval($input['count'] ?? 10);
    $bankId = $input['bank_id'] ?? null;

    $conditions = ['wb.user_id = :user_id', "wb.status = 'active'"];
    $params = [':user_id' => $user['id']];

    if ($bankId) {
        $conditions[] = 'wb.bank_id = :bank_id';
        $params[':bank_id'] = $bankId;
    }

    $sql = "SELECT q.*, qb.name as bank_name
            FROM wrong_book wb
            JOIN questions q ON wb.question_id = q.id
            JOIN question_banks qb ON wb.bank_id = qb.id
            WHERE " . implode(' AND ', $conditions) . "
            ORDER BY RANDOM() LIMIT :count";

    $stmt = $db->prepare($sql);
    foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value, SQLITE3_INTEGER);
    }
    $stmt->bindValue(':count', $count, SQLITE3_INTEGER);
    $result = $stmt->execute();

    $questions = [];
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $row['options'] = json_decode($row['options'], true);
        $row['answer'] = json_decode($row['answer'], true);
        $questions[] = $row;
    }

    echo json_encode([
        'questions' => $questions,
        'total' => count($questions)
    ], JSON_UNESCAPED_UNICODE);
}

/**
 * 提交练习
 */
function submitPractice() {
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input || !isset($input['bank_id']) || !isset($input['answers'])) {
        http_response_code(400);
        echo json_encode(['error' => '缺少必填字段']);
        exit;
    }
    
    $user = getCurrentUser();
    $db = getDB();
    
    // 创建练习会话
    $stmt = $db->prepare("INSERT INTO practice_sessions (user_id, bank_id, mode, total_count) 
                          VALUES (:user_id, :bank_id, :mode, :total_count)");
    $stmt->bindValue(':user_id', $user['id'], SQLITE3_INTEGER);
    $stmt->bindValue(':bank_id', $input['bank_id'], SQLITE3_INTEGER);
    $stmt->bindValue(':mode', $input['mode'] ?? 'random', SQLITE3_TEXT);
    $stmt->bindValue(':total_count', $input['total_count'] ?? count($input['answers']), SQLITE3_INTEGER);
    $stmt->execute();
    
    $sessionId = $db->lastInsertRowID();
    
    // 逐题记录答案
    $correctCount = 0;
    $wrongCount = 0;
    $unansweredCount = 0;
    
    foreach ($input['answers'] as $questionId => $answerData) {
        $selected = $answerData['selected'] ?? null;
        $isCorrect = $answerData['is_correct'] ?? false;
        
        // 获取正确答案
        $stmt = $db->prepare("SELECT answer FROM questions WHERE id = :id");
        $stmt->bindValue(':id', $questionId, SQLITE3_INTEGER);
        $result = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
        $correctAnswer = $result ? json_decode($result['answer'], true) : null;
        
        // 记录答案
        $stmt = $db->prepare("INSERT INTO practice_answers (session_id, question_id, selected_answer, correct_answer, is_correct) 
                              VALUES (:session_id, :question_id, :selected_answer, :correct_answer, :is_correct)");
        $stmt->bindValue(':session_id', $sessionId, SQLITE3_INTEGER);
        $stmt->bindValue(':question_id', $questionId, SQLITE3_INTEGER);
        $stmt->bindValue(':selected_answer', $selected !== null ? json_encode($selected, JSON_UNESCAPED_UNICODE) : null, SQLITE3_TEXT);
        $stmt->bindValue(':correct_answer', json_encode($correctAnswer, JSON_UNESCAPED_UNICODE), SQLITE3_TEXT);
        $stmt->bindValue(':is_correct', $isCorrect ? 1 : 0, SQLITE3_INTEGER);
        $stmt->execute();

        if ($isCorrect) {
            $correctCount++;
            // 检查该题是否在错题本中，如果是则检查连续答对次数
            $stmt = $db->prepare("SELECT id FROM wrong_book WHERE user_id = :user_id AND question_id = :question_id AND status = 'active'");
            $stmt->bindValue(':user_id', $user['id'], SQLITE3_INTEGER);
            $stmt->bindValue(':question_id', $questionId, SQLITE3_INTEGER);
            $wrongEntry = $stmt->execute()->fetchArray(SQLITE3_ASSOC);

            if ($wrongEntry) {
                // 查看最近5次该题的答题记录是否全部正确
                $stmt = $db->prepare("SELECT is_correct FROM practice_answers pa
                                      JOIN practice_sessions ps ON pa.session_id = ps.id
                                      WHERE ps.user_id = :user_id AND pa.question_id = :question_id
                                      ORDER BY pa.id DESC LIMIT 5");
                $stmt->bindValue(':user_id', $user['id'], SQLITE3_INTEGER);
                $stmt->bindValue(':question_id', $questionId, SQLITE3_INTEGER);
                $recent = $stmt->execute();
                $allCorrect = true;
                $recentCount = 0;
                while ($row = $recent->fetchArray(SQLITE3_ASSOC)) {
                    $recentCount++;
                    if (!$row['is_correct']) { $allCorrect = false; break; }
                }
                if ($allCorrect && $recentCount >= 5) {
                    $stmt = $db->prepare("UPDATE wrong_book SET status = 'removed', removed_at = datetime('now','localtime')
                                          WHERE id = :id");
                    $stmt->bindValue(':id', $wrongEntry['id'], SQLITE3_INTEGER);
                    $stmt->execute();
                }
            }
        } else {
            $wrongCount++;
            // 自动添加到错题本
            $stmt = $db->prepare("INSERT OR IGNORE INTO wrong_book (user_id, question_id, bank_id) 
                                  VALUES (:user_id, :question_id, :bank_id)");
            $stmt->bindValue(':user_id', $user['id'], SQLITE3_INTEGER);
            $stmt->bindValue(':question_id', $questionId, SQLITE3_INTEGER);
            $stmt->bindValue(':bank_id', $input['bank_id'], SQLITE3_INTEGER);
            $stmt->execute();
        }
    }
    
    // 更新练习会话统计
    $totalCount = $correctCount + $wrongCount + $unansweredCount;
    $stmt = $db->prepare("UPDATE practice_sessions SET 
        total_count = :total_count, correct_count = :correct_count, 
        wrong_count = :wrong_count, unanswered_count = :unanswered_count 
        WHERE id = :id");
    $stmt->bindValue(':total_count', $totalCount, SQLITE3_INTEGER);
    $stmt->bindValue(':correct_count', $correctCount, SQLITE3_INTEGER);
    $stmt->bindValue(':wrong_count', $wrongCount, SQLITE3_INTEGER);
    $stmt->bindValue(':unanswered_count', $unansweredCount, SQLITE3_INTEGER);
    $stmt->bindValue(':id', $sessionId, SQLITE3_INTEGER);
    $stmt->execute();
    
    $accuracy = $totalCount > 0 ? round($correctCount / $totalCount, 2) : 0;
    
    echo json_encode([
        'session_id' => $sessionId,
        'total_count' => $totalCount,
        'correct_count' => $correctCount,
        'wrong_count' => $wrongCount,
        'unanswered_count' => $unansweredCount,
        'accuracy' => $accuracy,
        'submitted_at' => date('Y-m-d H:i:s')
    ]);
}
