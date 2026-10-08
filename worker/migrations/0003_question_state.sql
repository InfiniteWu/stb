-- ═══════════════════════════════════════════════════════════════
-- 用户答题状态：记录每位用户哪些题目已经作答过。
--
-- 语义：只有真正给出选项的提交才记为「已答」；
-- 交卷时留空的题目（selected_answer 为 NULL）不记，下次「仅未答」仍可抽到。
-- 前端「清空答题状态」即删除该用户在该题库下的全部行。
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE user_question_state (
    user_id      INTEGER NOT NULL,
    question_id  INTEGER NOT NULL,
    bank_id      INTEGER NOT NULL,
    answered_at  TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    PRIMARY KEY (user_id, question_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
    FOREIGN KEY (bank_id) REFERENCES question_banks(id) ON DELETE CASCADE
);

-- 状态查询：WHERE user_id = ? AND bank_id = ? / 按库汇总
CREATE INDEX idx_uqs_user_bank ON user_question_state(user_id, bank_id);
