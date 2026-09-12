/**
 * API 封装模块
 */
const API = {
    baseUrl: '/api',

    async request(method, path, data = null) {
        const url = this.baseUrl + path;
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin'
        };

        if (data) {
            options.body = JSON.stringify(data);
        }

        try {
            const response = await fetch(url, options);
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || '请求失败');
            }

            return result;
        } catch (error) {
            if (error.message === 'Failed to fetch') {
                throw new Error('网络连接失败');
            }
            throw error;
        }
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

    // 认证相关
    login(username, password) {
        return this.post('/auth/login', { username, password });
    },

    logout() {
        return this.post('/auth/logout');
    },

    getMe() {
        return this.get('/auth/me');
    },

    // 题库相关
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

    exportBank(id) {
        return this.get('/banks/' + id + '/export');
    },

    recountBank(id) {
        return this.post('/banks/' + id + '/recount');
    },

    // 题目相关
    getQuestions(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.get('/questions' + (query ? '?' + query : ''));
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

    // 练习相关
    pickQuestions(data) {
        return this.post('/practice/pick', data);
    },

    pickWrongQuestions(data) {
        return this.post('/practice/pick-wrong', data);
    },

    submitPractice(data) {
        return this.post('/practice/submit', data);
    },

    // 练习记录
    getSessions(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.get('/sessions' + (query ? '?' + query : ''));
    },

    getSession(id) {
        return this.get('/sessions/' + id);
    },

    // 答题记录
    addRecord(data) {
        return this.post('/records', data);
    },

    // 错题本
    getWrongBook(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.get('/wrongbook' + (query ? '?' + query : ''));
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

    // 导入
    importData(data, bankId = null) {
        const formData = new FormData();
        if (data instanceof File) {
            formData.append('file', data);
            if (bankId) formData.append('bank_id', bankId);
        } else {
            formData.append('data', JSON.stringify(data));
            if (bankId) formData.append('bank_id', bankId);
        }

        return fetch(this.baseUrl + '/import', {
            method: 'POST',
            credentials: 'same-origin',
            body: formData
        }).then(r => r.json());
    },

    // 用户管理
    getUsers() {
        return this.get('/users');
    },

    getUser(id) {
        return this.get('/users/' + id);
    },

    createUser(data) {
        return this.post('/users', data);
    },

    updateUser(id, data) {
        return this.put('/users/' + id, data);
    },

    deleteUser(id) {
        return this.delete('/users/' + id);
    },

    resetPassword(id, password) {
        return this.post('/users/' + id + '/reset-password', { password });
    },

    // 仪表盘
    getDashboard() {
        return this.get('/dashboard');
    },

    // 个人设置
    updateProfile(displayName) {
        return this.post('/auth/update-profile', { display_name: displayName });
    },

    changePassword(oldPassword, newPassword) {
        return this.post('/auth/change-password', { old_password: oldPassword, new_password: newPassword });
    },

    adminResetPassword(userId, newPassword) {
        return this.post('/auth/admin-reset-password', { user_id: userId, new_password: newPassword });
    }
};
