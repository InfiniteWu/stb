/**
 * API 封装
 *
 * 与旧版的契约差异：
 *   - 登录改为两步：challenge 取盐 → 本地拉伸 → login 提交 verifier
 *   - getQuestions 返回 { items, total, page, per_page } 而非裸数组
 *   - submitPractice 不再提交 is_correct / bank_id，判分在服务端
 *   - importData 改为分批提交（免费版每次 Worker 调用仅 50 次查询额度）
 */
const API = {
    baseUrl: '/api',

    /** 后端单批导入上限，与 worker/src/routes/import.ts 的 MAX_IMPORT_BATCH 一致 */
    IMPORT_BATCH_SIZE: 30,

    async request(method, path, data) {
        const options = {
            method: method,
            headers: {},
            credentials: 'same-origin',
        };

        if (data !== undefined && data !== null) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(data);
        }

        let response;
        try {
            response = await fetch(this.baseUrl + path, options);
        } catch (e) {
            throw new Error('网络连接失败');
        }

        let result = null;
        const text = await response.text();
        if (text) {
            try {
                result = JSON.parse(text);
            } catch (e) {
                result = null;
            }
        }

        if (!response.ok) {
            const err = new Error((result && result.error) || '请求失败');
            err.status = response.status;
            err.code = result && result.code;
            throw err;
        }

        return result;
    },

    get(path) {
        return this.request('GET', path);
    },
    post(path, data) {
        return this.request('POST', path, data);
    },
    put(path, data) {
        return this.request('PUT', path, data);
    },
    delete(path) {
        return this.request('DELETE', path);
    },

    /** 把对象拼成查询串，跳过空值 */
    qs(params) {
        const usp = new URLSearchParams();
        Object.keys(params || {}).forEach((k) => {
            const v = params[k];
            if (v !== undefined && v !== null && v !== '') usp.set(k, v);
        });
        const s = usp.toString();
        return s ? '?' + s : '';
    },

    // ── 认证 ────────────────────────────────────────────────
    /** 第一步：取 KDF 参数 */
    authChallenge(username) {
        return this.post('/auth/challenge', { username: username });
    },

    /** 第二步：提交拉伸结果 */
    authLogin(username, verifier, remember) {
        const body = { username: username, verifier: verifier };
        // 只在明确指定时才带上该字段：缺省由服务端按 true 处理，
        // 桌面端登录不传，线上行为因此完全不变
        if (typeof remember === 'boolean') body.remember = remember;
        return this.post('/auth/login', body);
    },

    /**
     * 完整登录流程。
     *
     * remember 省略时由服务端按 true 处理（7 天持久 Cookie）；
     * 传 false 则下发会话 Cookie —— 关掉浏览器下次要重新登录。
     */
    async login(username, password, remember) {
        const ch = await this.authChallenge(username);
        if (ch.needsReset) {
            const err = new Error(ch.error || '该账号需要重置密码');
            err.code = 'PASSWORD_RESET_REQUIRED';
            throw err;
        }
        const verifier = await KDF.stretchPassword(password, ch.salt, ch.iterations);
        return this.authLogin(username, verifier, remember);
    },

    logout() {
        return this.post('/auth/logout', {});
    },
    getMe() {
        return this.get('/auth/me');
    },
    updateProfile(displayName) {
        return this.post('/auth/update-profile', { display_name: displayName });
    },
    /** 改密码：旧口令用服务端盐拉伸，新口令用客户端新盐 */
    async changePassword(oldPassword, newPassword) {
        const me = await this.getMe();
        const ch = await this.authChallenge(me.user.username);
        const currentVerifier = await KDF.stretchPassword(
            oldPassword,
            ch.salt,
            ch.iterations
        );
        const next = await KDF.makeKdfPayload(newPassword);
        return this.post('/auth/change-password', {
            current_verifier: currentVerifier,
            next: next,
        });
    },

    // ── 题库 ────────────────────────────────────────────────
    /** 登录页品牌数据条：无需登录的聚合数字 */
    getPublicStats() {
        return this.get('/public/stats');
    },
    getBanks() {
        return this.get('/banks');
    },
    getBank(id) {
        return this.get('/banks/' + id);
    },
    createBank(data) {
        return this.post('/banks', data);
    },
    updateBank(id, data) {
        return this.put('/banks/' + id, data);
    },
    deleteBank(id) {
        return this.delete('/banks/' + id);
    },
    recountBank(id) {
        return this.post('/banks/' + id + '/recount', {});
    },
    /** 分页导出，客户端循环拼装 */
    exportBank(id, page, perPage) {
        return this.get('/banks/' + id + '/export' + this.qs({ page: page, per_page: perPage }));
    },

    // ── 题目 ────────────────────────────────────────────────
    getQuestions(params) {
        return this.get('/questions' + this.qs(params));
    },
    getQuestion(id) {
        return this.get('/questions/' + id);
    },
    createQuestion(data) {
        return this.post('/questions', data);
    },
    updateQuestion(id, data) {
        return this.put('/questions/' + id, data);
    },
    deleteQuestion(id) {
        return this.delete('/questions/' + id);
    },

    // ── 练习 ────────────────────────────────────────────────
    pickQuestions(data) {
        return this.post('/practice/pick', data);
    },
    pickWrongQuestions(data) {
        return this.post('/practice/pick-wrong', data);
    },
    /**
     * 提交作答。
     * answers: [{ question_id, selected, shuffle_token? }]
     * selected 为下标（单选/判断）、下标数组（多选）或 null（未作答）。
     * 不再提交 is_correct —— 对错由服务端裁定。
     */
    submitPractice(data) {
        return this.post('/practice/submit', data);
    },

    // ── 练习记录 ────────────────────────────────────────────
    getSessions(params) {
        return this.get('/sessions' + this.qs(params));
    },
    getSession(id) {
        return this.get('/sessions/' + id);
    },

    // ── 错题本 ──────────────────────────────────────────────
    getWrongBook(params) {
        return this.get('/wrongbook' + this.qs(params));
    },
    getTodayWrong() {
        return this.get('/wrongbook/today');
    },
    addWrong(data) {
        return this.post('/wrongbook', data);
    },
    removeWrong(id) {
        return this.put('/wrongbook/' + id + '/remove');
    },

    // ── 导入 ────────────────────────────────────────────────
    /**
     * 分批导入。onProgress(imported, total) 用于展示进度。
     * 第一批负责建库，后续批次复用返回的 bank_id。
     */
    async importQuestions(bankName, description, questions, onProgress) {
        const batchSize = this.IMPORT_BATCH_SIZE;
        let bankId = null;
        let imported = 0;
        const errors = [];

        for (let offset = 0; offset < questions.length; offset += batchSize) {
            const chunk = questions.slice(offset, offset + batchSize);
            const payload = {
                start_index: offset,
                questions: chunk,
            };
            if (bankId === null) {
                payload.bankName = bankName;
                payload.description = description || '';
            } else {
                payload.bank_id = bankId;
            }

            const res = await this.post('/import', payload);
            bankId = res.bank_id;
            imported += res.imported || 0;
            if (res.errors && res.errors.length) {
                for (let i = 0; i < res.errors.length; i++) errors.push(res.errors[i]);
            }
            if (onProgress) onProgress(Math.min(offset + batchSize, questions.length), questions.length);
        }

        return { bank_id: bankId, imported: imported, errors: errors };
    },

    // ── 用户管理 ────────────────────────────────────────────
    getUsers() {
        return this.get('/users');
    },
    async createUser(data) {
        const kdf = await KDF.makeKdfPayload(data.password);
        return this.post('/users', {
            username: data.username,
            display_name: data.display_name,
            role: data.role,
            kdf: kdf,
        });
    },
    updateUser(id, data) {
        return this.put('/users/' + id, data);
    },
    deleteUser(id) {
        return this.delete('/users/' + id);
    },
    async resetPassword(id, newPassword) {
        const kdf = await KDF.makeKdfPayload(newPassword);
        return this.post('/users/' + id + '/reset-password', { kdf: kdf });
    },

    // ── 仪表盘 ──────────────────────────────────────────────
    getDashboard() {
        return this.get('/dashboard');
    },
};
