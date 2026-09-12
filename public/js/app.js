/**
 * 刷题宝 - 主应用
 */
const App = {
    currentUser: null,

    // SVG 图标模板
    icons: {
        check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
        x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
        trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
        arrowLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
        arrowRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
        plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
        alertCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
        inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
        refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
        dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
        book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
        fileText: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
        upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
        users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    },

    async init() {
        try {
            const result = await API.getMe();
            this.currentUser = result.user;
            this.showMainApp();
            this.initRouter();
        } catch (e) {
            this.showLoginPage();
        }
    },

    showLoginPage() {
        document.getElementById('login-page').classList.remove('hidden');
        document.getElementById('main-app').classList.add('hidden');
        initParticles();
        this.initLoginForm();
    },

    showMainApp() {
        stopParticles();
        document.getElementById('login-page').classList.add('hidden');
        document.getElementById('main-app').classList.remove('hidden');
        this.updateUserInfo();
        this.updateAdminVisibility();
        this.initLogout();
    },

    updateUserInfo() {
        if (!this.currentUser) return;
        document.getElementById('user-display-name').textContent = this.currentUser.display_name;
        document.getElementById('user-avatar').textContent = this.currentUser.display_name.charAt(0).toUpperCase();
        const badge = document.getElementById('user-role');
        badge.textContent = this.currentUser.role === 'admin' ? '管理员' : '普通用户';
        badge.className = 'role-badge ' + this.currentUser.role;
    },

    updateAdminVisibility() {
        const isAdmin = this.currentUser && this.currentUser.role === 'admin';
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = isAdmin ? 'flex' : 'none';
        });
    },

    initLoginForm() {
        const form = document.getElementById('login-form');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            try {
                const result = await API.login(username, password);
                this.currentUser = result.user;
                this.showMainApp();
                window.location.hash = '#/';
                this.initRouter();
            } catch (error) {
                alert(error.message);
            }
        });
    },

    initLogout() {
        document.getElementById('logout-btn').onclick = async () => {
            await API.logout();
            this.currentUser = null;
            this.showLoginPage();
        };
    },

    initRouter() {
        window.addEventListener('hashchange', () => this.handleRoute());
        this.handleRoute();
    },

    handleRoute() {
        if (this._practiceKeyHandler) {
            document.removeEventListener('keydown', this._practiceKeyHandler);
            this._practiceKeyHandler = null;
        }
        const hash = window.location.hash || '#/';
        const fullPath = hash.slice(1);
        const path = fullPath.split('?')[0];

        document.querySelectorAll('.nav-item').forEach(el => {
            el.classList.remove('active');
            const href = el.getAttribute('href').slice(1);
            if (path === href || (href !== '/' && path.startsWith(href))) {
                el.classList.add('active');
            }
        });

        if (path === '/' || path === '') this.loadDashboard();
        else if (path === '/banks') this.loadBanks();
        else if (path.startsWith('/banks/')) this.loadBankDetail(path.split('/')[2]);
        else if (path === '/questions/new') this.loadQuestionForm();
        else if (path.match(/^\/questions\/\d+\/edit$/)) this.loadQuestionForm(path.split('/')[2]);
        else if (path === '/practice/pick') this.loadPracticePick();
        else if (path === '/practice/do') this.loadPracticeDo();
        else if (path === '/practice/result') this.loadPracticeResult();
        else if (path === '/wrongbook') this.loadWrongBook();
        else if (path === '/sessions') this.loadSessions();
        else if (path.match(/^\/sessions\/\d+$/)) this.loadSessionDetail(path.split('/')[2]);
        else if (path === '/import') this.loadImport();
        else if (path === '/users') this.loadUsers();
        else if (path === '/profile') this.loadProfile();
        else this.load404();
    },

    // ========== 页面渲染 ==========

    async loadDashboard() {
        const c = document.getElementById('page-container');
        c.innerHTML = '<div class="loading">加载中...</div>';
        try {
            const data = await API.getDashboard();
            c.innerHTML = `
                <div class="page-header">
                    <div>
                        <h1>仪表盘</h1>
                        <div class="subtitle">今日学习概览</div>
                    </div>
                </div>
                <div class="dashboard-grid">
                    <div class="stat-card">
                        <div class="stat-icon teal">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                        </div>
                        <div class="stat-info">
                            <div class="stat-value">${data.today_practice_count}</div>
                            <div class="stat-label">今日练习</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon green">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        </div>
                        <div class="stat-info">
                            <div class="stat-value">${(data.today_accuracy * 100).toFixed(1)}%</div>
                            <div class="stat-label">今日正确率</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon red">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                        </div>
                        <div class="stat-info">
                            <div class="stat-value">${data.today_new_wrong}</div>
                            <div class="stat-label">今日新增错题</div>
                        </div>
                    </div>
                </div>
                ${data.today_wrong_per_bank.length > 0 ? `
                    <div class="card">
                        <div class="card-header"><h3>今日错题分布</h3></div>
                        <div class="card-body">
                            <div class="table-wrap"><table class="table">
                                <thead><tr><th>题库</th><th>错题数</th></tr></thead>
                                <tbody>${data.today_wrong_per_bank.map(i => `<tr><td>${i.bank_name}</td><td>${i.count}</td></tr>`).join('')}</tbody>
                            </table></div>
                        </div>
                    </div>
                ` : ''}
            `;
        } catch (error) { c.innerHTML = `<div class="error-msg">${error.message}</div>`; }
    },

    async loadBanks() {
        const c = document.getElementById('page-container');
        c.innerHTML = '<div class="loading">加载中...</div>';
        try {
            const banks = await API.getBanks();
            const isAdmin = this.currentUser.role === 'admin';
            c.innerHTML = `
                <div class="page-header">
                    <div>
                        <h1>题库管理</h1>
                        <div class="subtitle">共 ${banks.length} 个题库</div>
                    </div>
                    ${isAdmin ? `<div class="header-actions"><button class="btn btn-primary" onclick="App.showCreateBankModal()">${this.icons.plus} 新建题库</button></div>` : ''}
                </div>
                <div class="bank-grid">
                    ${banks.length === 0 ? '<div class="empty-state"><p>暂无题库</p></div>' : banks.map(bank => `
                        <div class="bank-card" onclick="window.location.hash='#/banks/${bank.id}'">
                            <div class="bank-card-header">
                                <div class="bank-card-title">${bank.name}</div>
                                ${isAdmin ? `
                                    <div class="bank-card-actions">
                                        <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();App.editBank(${bank.id})" title="编辑">${this.icons.edit}</button>
                                        <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();App.deleteBank(${bank.id})" title="删除" style="color:var(--danger)">${this.icons.trash}</button>
                                    </div>
                                ` : ''}
                            </div>
                            <div class="bank-card-desc">${bank.description || '暂无描述'}</div>
                            <div class="bank-card-stats">
                                <span class="bank-stat">总计 <span class="count">${bank.question_count}</span></span>
                                <span class="bank-stat">单选 <span class="count">${bank.single_count}</span></span>
                                <span class="bank-stat">多选 <span class="count">${bank.multiple_count}</span></span>
                                <span class="bank-stat">判断 <span class="count">${bank.truefalse_count}</span></span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        } catch (error) { c.innerHTML = `<div class="error-msg">${error.message}</div>`; }
    },

    async loadBankDetail(id) {
        const c = document.getElementById('page-container');
        c.innerHTML = '<div class="loading">加载中...</div>';
        try {
            const [bank, questions] = await Promise.all([API.getBank(id), API.getQuestions({ bank_id: id })]);
            const isAdmin = this.currentUser.role === 'admin';
            c.innerHTML = `
                <div class="page-header">
                    <div>
                        <h1>${bank.name}</h1>
                        <div class="subtitle">${bank.description || '暂无描述'}</div>
                    </div>
                    <div class="header-actions">
                        <button class="btn btn-secondary" onclick="window.location.hash='#/practice/pick?bank_id=${id}'">开始练习</button>
                        ${isAdmin ? `<button class="btn btn-primary" onclick="window.location.hash='#/questions/new?bank_id=${id}'">${this.icons.plus} 添加题目</button>` : ''}
                    </div>
                </div>
                <div class="card"><div class="card-body">
                    <div class="table-wrap"><table class="table">
                        <thead><tr><th>ID</th><th>题型</th><th>题干</th>${isAdmin ? '<th>操作</th>' : ''}</tr></thead>
                        <tbody>
                            ${questions.length === 0 ? `<tr><td colspan="${isAdmin ? 4 : 3}"><div class="empty-state"><p>暂无题目</p></div></td></tr>` :
                            questions.map(q => `
                                <tr>
                                    <td>${q.id}</td>
                                    <td><span class="type-badge ${q.type}">${this.getTypeLabel(q.type)}</span></td>
                                    <td class="stem-cell">${q.stem.substring(0, 60)}${q.stem.length > 60 ? '...' : ''}</td>
                                    ${isAdmin ? `<td class="actions-cell">
                                        <button class="btn btn-sm btn-ghost" onclick="window.location.hash='#/questions/${q.id}/edit'" title="编辑">${this.icons.edit}</button>
                                        <button class="btn btn-sm btn-ghost" onclick="App.deleteQuestion(${q.id})" title="删除" style="color:var(--danger)">${this.icons.trash}</button>
                                    </td>` : ''}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table></div>
                </div></div>
            `;
        } catch (error) { c.innerHTML = `<div class="error-msg">${error.message}</div>`; }
    },

    getTypeLabel(type) {
        return { single: '单选题', multiple: '多选题', truefalse: '判断题' }[type] || type;
    },

    showCreateBankModal() {
        const name = prompt('请输入题库名称:');
        if (name) API.createBank({ name }).then(() => this.loadBanks()).catch(e => alert(e.message));
    },

    async editBank(id) {
        const bank = await API.getBank(id);
        const name = prompt('请输入题库名称:', bank.name);
        if (name) { await API.updateBank(id, { name, description: bank.description }); this.loadBanks(); }
    },

    async deleteBank(id) {
        if (confirm('确定要删除这个题库吗？所有题目都会被删除。')) { await API.deleteBank(id); this.loadBanks(); }
    },

    async deleteQuestion(id) {
        if (confirm('确定要删除这道题目吗？')) {
            await API.deleteQuestion(id);
            const bankId = new URLSearchParams(window.location.hash.split('?')[1]).get('bank_id');
            if (bankId) this.loadBankDetail(bankId);
        }
    },

    // ========== 练习 ==========

    async loadPracticePick() {
        const c = document.getElementById('page-container');
        const params = new URLSearchParams(window.location.hash.split('?')[1]);
        const bankId = params.get('bank_id');

        if (!bankId) {
            try {
                const banks = await API.getBanks();
                c.innerHTML = `
                    <div class="page-header"><div><h1>选择题库</h1><div class="subtitle">选择要练习的题库</div></div></div>
                    <div class="bank-grid">${banks.map(bank => `
                        <div class="bank-card" onclick="window.location.hash='#/practice/pick?bank_id=${bank.id}'">
                            <div class="bank-card-title">${bank.name}</div>
                            <div class="bank-card-desc">共 ${bank.question_count} 题</div>
                        </div>
                    `).join('')}</div>
                `;
            } catch (error) { c.innerHTML = `<div class="error-msg">${error.message}</div>`; }
            return;
        }

        try {
            const bank = await API.getBank(bankId);
            c.innerHTML = `
                <div class="page-header"><div><h1>练习设置 - ${bank.name}</h1></div></div>
                <div class="card"><div class="card-body">
                    <form id="practice-form">
                        <div class="form-row">
                            <div class="form-group">
                                <label>单选题数量</label>
                                <input type="number" name="single_count" value="0" min="0" max="${bank.single_count}" class="form-input">
                                <span class="hint">共 ${bank.single_count} 题</span>
                            </div>
                            <div class="form-group">
                                <label>多选题数量</label>
                                <input type="number" name="multiple_count" value="0" min="0" max="${bank.multiple_count}" class="form-input">
                                <span class="hint">共 ${bank.multiple_count} 题</span>
                            </div>
                            <div class="form-group">
                                <label>判断题数量</label>
                                <input type="number" name="truefalse_count" value="0" min="0" max="${bank.truefalse_count}" class="form-input">
                                <span class="hint">共 ${bank.truefalse_count} 题</span>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="checkbox-label"><input type="checkbox" name="shuffle_options"> 打乱选项顺序</label>
                        </div>
                        <button type="submit" class="btn btn-primary btn-lg">开始练习</button>
                    </form>
                </div></div>
            `;
            document.getElementById('practice-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const fd = new FormData(e.target);
                const data = {
                    bank_id: parseInt(bankId),
                    single_count: parseInt(fd.get('single_count')) || 0,
                    multiple_count: parseInt(fd.get('multiple_count')) || 0,
                    truefalse_count: parseInt(fd.get('truefalse_count')) || 0,
                    shuffle_options: fd.has('shuffle_options'),
                    mode: 'random'
                };
                if (data.single_count + data.multiple_count + data.truefalse_count === 0) { alert('请至少选择一道题目'); return; }
                try {
                    window.practiceData = await API.pickQuestions(data);
                    window.location.hash = '#/practice/do';
                } catch (error) { alert(error.message); }
            });
        } catch (error) { c.innerHTML = `<div class="error-msg">${error.message}</div>`; }
    },

    async loadPracticeDo() {
        const c = document.getElementById('page-container');
        const data = window.practiceData;
        if (!data || !data.questions || data.questions.length === 0) { c.innerHTML = '<div class="error-msg">没有练习数据</div>'; return; }

        let idx = 0;
        const answers = {};
        const total = data.questions.length;
        const self = this;

        const render = () => {
            const q = data.questions[idx];
            const sel = answers[q.id] !== undefined ? answers[q.id].selected : null;

            let navHtml = '';
            for (let i = 0; i < total; i++) {
                const qid = data.questions[i].id;
                const answered = answers[qid] !== undefined;
                const cur = i === idx;
                const cls = cur ? 'nav-q current' : (answered ? 'nav-q answered' : 'nav-q');
                navHtml += `<button class="${cls}" data-idx="${i}">${i + 1}</button>`;
            }

            c.innerHTML = `
                <div class="practice-layout">
                    <div class="practice-main">
                        <div class="practice-progress">
                            <div class="progress-header">
                                <span class="progress-label">第 ${idx + 1} / ${total} 题</span>
                                <span class="progress-count">${Math.round(((idx + 1) / total) * 100)}%</span>
                            </div>
                            <div class="progress-bar"><div class="progress-fill" style="width:${((idx + 1) / total) * 100}%"></div></div>
                        </div>
                        <div class="practice-question">
                            <div class="question-type-badge">${this.getTypeLabel(q.type)}</div>
                            <div class="question-stem">${q.stem}</div>
                            <div class="question-options">
                                ${q.options.map((opt, i) => `
                                    <label class="option-item ${sel === i || (Array.isArray(sel) && sel.includes(i)) ? 'selected' : ''}">
                                        <input type="${q.type === 'multiple' ? 'checkbox' : 'radio'}" name="answer" value="${i}" ${sel === i || (Array.isArray(sel) && sel.includes(i)) ? 'checked' : ''}>
                                        <span class="option-letter">${String.fromCharCode(65 + i)}</span>
                                        <span class="option-text">${opt}</span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                        <div class="practice-actions">
                            <button class="btn btn-secondary" ${idx === 0 ? 'disabled' : ''} id="btn-prev">${self.icons.arrowLeft} 上一题</button>
                            <button class="btn btn-ghost" id="btn-dontknow">不会</button>
                            <button class="btn btn-secondary" ${idx === total - 1 ? 'disabled' : ''} id="btn-next">下一题 ${self.icons.arrowRight}</button>
                        </div>
                    </div>
                    <div class="practice-sidebar">
                        <div class="sidebar-title">答题卡</div>
                        <div class="question-nav">${navHtml}</div>
                        <div class="sidebar-stats">
                            <span class="stat-answered">已答: <b id="stat-answered">0</b></span>
                            <span class="stat-unanswered">未答: <b id="stat-unanswered">${total}</b></span>
                        </div>
                        <button class="btn btn-primary btn-block" id="btn-submit">提交试卷</button>
                    </div>
                </div>
            `;

            document.getElementById('stat-answered').textContent = Object.keys(answers).length;
            document.getElementById('stat-unanswered').textContent = total - Object.keys(answers).length;

            c.querySelectorAll('.option-item input').forEach(input => {
                input.addEventListener('change', (e) => {
                    const q = data.questions[idx];
                    if (q.type === 'multiple') {
                        if (!answers[q.id]) answers[q.id] = { selected: [] };
                        const v = parseInt(e.target.value);
                        if (e.target.checked) answers[q.id].selected.push(v);
                        else answers[q.id].selected = answers[q.id].selected.filter(x => x !== v);
                    } else {
                        answers[q.id] = { selected: parseInt(e.target.value) };
                    }
                    render();
                });
            });

            document.querySelectorAll('.nav-q').forEach(btn => {
                btn.addEventListener('click', () => {
                    idx = parseInt(btn.dataset.idx);
                    render();
                });
            });

            document.getElementById('btn-prev').addEventListener('click', () => self.prevQ());
            document.getElementById('btn-next').addEventListener('click', () => self.nextQ());
            document.getElementById('btn-dontknow').addEventListener('click', () => self.markDontKnow());
            document.getElementById('btn-submit').addEventListener('click', () => self.submitPractice());

            c.querySelectorAll('.option-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (e.target.tagName === 'INPUT') return;
                    const input = item.querySelector('input');
                    if (input) input.click();
                });
            });
        };

        this.nextQ = () => { if (idx < total - 1) { idx++; render(); } };
        this.prevQ = () => { if (idx > 0) { idx--; render(); } };
        this.markDontKnow = () => {
            const q = data.questions[idx];
            if (answers[q.id] === undefined) {
                answers[q.id] = { selected: null, is_wrong: true };
            }
            if (idx < total - 1) { idx++; render(); }
            else { render(); }
        };

        this._practiceKeyHandler = (e) => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); self.prevQ(); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); self.nextQ(); }
        };
        document.removeEventListener('keydown', self._prevKeyHandler);
        document.addEventListener('keydown', self._practiceKeyHandler);
        self._prevKeyHandler = self._practiceKeyHandler;

        this.submitPractice = async () => {
            const formatted = {};
            data.questions.forEach(q => {
                const a = answers[q.id];
                const s = a ? a.selected : null;
                let ok = false;
                if (s !== null) {
                    if (q.type === 'multiple') ok = JSON.stringify(s.sort()) === JSON.stringify(q.answer.sort());
                    else ok = s === q.answer;
                }
                formatted[q.id] = { selected: s, is_correct: ok };
            });
            document.removeEventListener('keydown', self._practiceKeyHandler);
            try {
                window.practiceResult = await API.submitPractice({ bank_id: data.questions[0].bank_id, mode: 'random', total_count: total, answers: formatted });
                window.location.hash = '#/practice/result';
            } catch (error) { alert(error.message); }
        };
        render();
    },

    async loadPracticeResult() {
        const c = document.getElementById('page-container');
        const r = window.practiceResult;
        if (!r) { c.innerHTML = '<div class="error-msg">没有练习结果</div>'; return; }

        const pct = Math.round(r.accuracy * 100);
        const circumference = 2 * Math.PI * 54;
        const offset = circumference - (pct / 100) * circumference;

        c.innerHTML = `
            <div class="page-header"><div><h1>练习结果</h1></div></div>
            <div class="result-container">
                <div class="result-hero">
                    <div class="result-ring">
                        <svg width="140" height="140">
                            <circle class="result-ring-bg" cx="70" cy="70" r="54"/>
                            <circle class="result-ring-fill" cx="70" cy="70" r="54"
                                stroke-dasharray="${circumference}" stroke-dashoffset="${circumference}"
                                style="transition-delay:0.3s"/>
                        </svg>
                        <div class="result-ring-text">
                            <div class="result-ring-value">${pct}%</div>
                            <div class="result-ring-label">正确率</div>
                        </div>
                    </div>
                    <div class="result-stats">
                        <div class="result-stat"><div class="result-stat-value">${r.total_count}</div><div class="result-stat-label">总题数</div></div>
                        <div class="result-stat"><div class="result-stat-value correct">${r.correct_count}</div><div class="result-stat-label">正确</div></div>
                        <div class="result-stat"><div class="result-stat-value wrong">${r.wrong_count}</div><div class="result-stat-label">错误</div></div>
                    </div>
                </div>
                <div class="result-actions">
                    <button class="btn btn-secondary" onclick="window.history.back()">${this.icons.arrowLeft} 返回</button>
                    <button class="btn btn-primary" onclick="window.location.hash='#/sessions/${r.session_id}'">查看详情</button>
                </div>
            </div>
        `;
        // 动画
        setTimeout(() => {
            const ring = c.querySelector('.result-ring-fill');
            if (ring) ring.style.strokeDashoffset = offset;
        }, 100);
    },

    // ========== 错题本 ==========

    async loadWrongBook() {
        const c = document.getElementById('page-container');
        c.innerHTML = '<div class="loading">加载中...</div>';
        try {
            const records = await API.getWrongBook();
            c.innerHTML = `
                <div class="page-header">
                    <div><h1>错题本</h1><div class="subtitle">共 ${records.length} 道错题</div></div>
                    ${records.length > 0 ? `<button class="btn btn-primary" onclick="App.startWrongPractice()">开始练习</button>` : ''}
                </div>
                <div class="card"><div class="card-body">
                    ${records.length === 0 ? '<div class="empty-state"><p>暂无错题，继续加油！</p></div>' :
                    `<div class="table-wrap"><table class="table">
                        <thead><tr><th>题型</th><th>题干</th><th>题库</th><th>错误次数</th><th>连续正确</th><th>操作</th></tr></thead>
                        <tbody>${records.map(r => `
                            <tr>
                                <td><span class="type-badge ${r.type}">${this.getTypeLabel(r.type)}</span></td>
                                <td class="stem-cell">${r.stem.substring(0, 50)}${r.stem.length > 50 ? '...' : ''}</td>
                                <td>${r.bank_name}</td>
                                <td>${r.error_count}</td>
                                <td>${r.correct_count || 0} / 5</td>
                                <td><button class="btn btn-sm btn-ghost" onclick="App.removeWrong(${r.id})">移除</button></td>
                            </tr>
                        `).join('')}</tbody>
                    </table></div>`}
                </div></div>
            `;
        } catch (error) { c.innerHTML = `<div class="error-msg">${error.message}</div>`; }
    },

    async startWrongPractice() {
        try {
            const data = await API.pickWrongQuestions({ count: 20 });
            if (!data.questions || data.questions.length === 0) { alert('错题本为空'); return; }
            window.practiceData = { ...data, bank_id: data.questions[0].bank_id, isWrongBook: true };
            window.location.hash = '#/practice/do';
        } catch (error) { alert(error.message); }
    },

    async removeWrong(id) {
        if (confirm('确定要从错题本中移除吗？')) { await API.removeWrong(id); this.loadWrongBook(); }
    },

    // ========== 练习记录 ==========

    async loadSessions() {
        const c = document.getElementById('page-container');
        c.innerHTML = '<div class="loading">加载中...</div>';
        try {
            const data = await API.getSessions();
            c.innerHTML = `
                <div class="page-header"><div><h1>练习记录</h1><div class="subtitle">共 ${data.total} 条记录</div></div></div>
                <div class="card"><div class="card-body">
                    ${data.sessions.length === 0 ? '<div class="empty-state"><p>暂无练习记录</p></div>' :
                    `<div class="table-wrap"><table class="table">
                        <thead><tr><th>时间</th><th>题库</th><th>总题数</th><th>正确</th><th>错误</th><th>正确率</th><th>操作</th></tr></thead>
                        <tbody>${data.sessions.map(s => `
                            <tr>
                                <td>${s.submitted_at}</td>
                                <td>${s.bank_id}</td>
                                <td>${s.total_count}</td>
                                <td class="text-success">${s.correct_count}</td>
                                <td class="text-danger">${s.wrong_count}</td>
                                <td>${(s.correct_count / s.total_count * 100).toFixed(1)}%</td>
                                <td><button class="btn btn-sm btn-secondary" onclick="window.location.hash='#/sessions/${s.id}'">详情</button></td>
                            </tr>
                        `).join('')}</tbody>
                    </table></div>`}
                </div></div>
            `;
        } catch (error) { c.innerHTML = `<div class="error-msg">${error.message}</div>`; }
    },

    async loadSessionDetail(id) {
        const c = document.getElementById('page-container');
        c.innerHTML = '<div class="loading">加载中...</div>';
        try {
            const data = await API.getSession(id);
            let idx = 0;
            const total = data.answers.length;
            const self = this;

            const renderDetail = () => {
                const a = data.answers[idx];
                const correctIdx = a.correct_answer;
                const selectedIdx = a.selected_answer;

                let navHtml = '';
                for (let i = 0; i < total; i++) {
                    const ans = data.answers[i];
                    const cur = i === idx;
                    let cls = 'nav-q';
                    if (cur) cls += ' current';
                    else if (ans.is_correct) cls += ' correct';
                    else cls += ' wrong';
                    navHtml += `<button class="${cls}" data-idx="${i}">${i + 1}</button>`;
                }

                c.innerHTML = `
                    <div class="page-header">
                        <div><h1>练习详情</h1></div>
                        <button class="btn btn-secondary" onclick="window.location.hash='#/sessions'">${self.icons.arrowLeft} 返回列表</button>
                    </div>
                    <div class="session-info">
                        <div class="session-info-item"><div class="session-info-label">练习时间</div><div class="session-info-value">${data.session.submitted_at}</div></div>
                        <div class="session-info-item"><div class="session-info-label">正确率</div><div class="session-info-value">${(data.session.correct_count / data.session.total_count * 100).toFixed(1)}%</div></div>
                        <div class="session-info-item"><div class="session-info-label">正确/错误</div><div class="session-info-value">${data.session.correct_count} / ${data.session.wrong_count}</div></div>
                    </div>
                    <div class="practice-layout">
                        <div class="practice-main">
                            <div class="practice-progress">
                                <div class="progress-header">
                                    <span class="progress-label">第 ${idx + 1} / ${total} 题</span>
                                </div>
                                <div class="progress-bar"><div class="progress-fill" style="width:${((idx + 1) / total) * 100}%"></div></div>
                            </div>
                            <div class="answer-card ${a.is_correct ? 'correct' : 'wrong'}">
                                <div class="answer-card-header">
                                    <span class="answer-status-badge ${a.is_correct ? 'correct' : 'wrong'}">${a.is_correct ? self.icons.check + ' 正确' : self.icons.x + ' 错误'}</span>
                                </div>
                                <div class="answer-card-stem">${a.stem}</div>
                                <div class="answer-options">
                                    ${a.options.map((opt, oi) => {
                                        let cls = 'answer-option';
                                        if (oi === selectedIdx) cls += ' selected';
                                        if (oi === correctIdx) cls += ' correct';
                                        if (oi === selectedIdx && !a.is_correct) cls += ' wrong-selected';
                                        return `<div class="${cls}"><strong>${String.fromCharCode(65 + oi)}.</strong> ${opt}</div>`;
                                    }).join('')}
                                </div>
                                ${a.explanation ? `<div class="answer-explanation"><strong>解析：</strong>${a.explanation}</div>` : ''}
                            </div>
                            <div class="practice-actions">
                                <button class="btn btn-secondary" ${idx === 0 ? 'disabled' : ''} id="btn-prev">${self.icons.arrowLeft} 上一题</button>
                                <button class="btn btn-primary" ${idx === total - 1 ? 'disabled' : ''} id="btn-next">下一题 ${self.icons.arrowRight}</button>
                            </div>
                        </div>
                        <div class="practice-sidebar">
                            <div class="sidebar-title">答题卡</div>
                            <div class="question-nav">${navHtml}</div>
                            <div class="sidebar-stats">
                                <span style="color:var(--success)">正确: ${data.session.correct_count}</span>
                                <span style="color:var(--danger)">错误: ${data.session.wrong_count}</span>
                            </div>
                        </div>
                    </div>
                `;

                document.querySelectorAll('.nav-q').forEach(btn => {
                    btn.addEventListener('click', () => { idx = parseInt(btn.dataset.idx); renderDetail(); });
                });
                document.getElementById('btn-prev').addEventListener('click', () => { if (idx > 0) { idx--; renderDetail(); } });
                document.getElementById('btn-next').addEventListener('click', () => { if (idx < total - 1) { idx++; renderDetail(); } });
            };

            renderDetail();
        } catch (error) { c.innerHTML = `<div class="error-msg">${error.message}</div>`; }
    },

    // ========== 导入 ==========

    async loadImport() {
        const c = document.getElementById('page-container');
        c.innerHTML = `
            <div class="page-header"><div><h1>导入题库</h1><div class="subtitle">支持 JSON 文件或直接粘贴 JSON 数据</div></div></div>
            <div class="card"><div class="card-body">
                <form id="import-form">
                    <div class="form-group">
                        <label>导入方式</label>
                        <div style="display:flex;gap:20px;margin-top:6px">
                            <label class="radio-label"><input type="radio" name="method" value="file" checked> 上传文件</label>
                            <label class="radio-label"><input type="radio" name="method" value="json"> 粘贴 JSON</label>
                        </div>
                    </div>
                    <div id="file-upload" class="form-group">
                        <label>选择 JSON 文件</label>
                        <input type="file" name="file" accept=".json" class="form-input">
                    </div>
                    <div id="json-input" class="form-group hidden">
                        <label>JSON 数据</label>
                        <textarea name="json" class="form-input" rows="10" placeholder='{"bankName": "题库名称", "questions": [...]}'></textarea>
                    </div>
                    <button type="submit" class="btn btn-primary btn-lg">${this.icons.upload} 开始导入</button>
                </form>
            </div></div>
        `;
        document.querySelectorAll('input[name="method"]').forEach(r => {
            r.addEventListener('change', e => {
                document.getElementById('file-upload').classList.toggle('hidden', e.target.value !== 'file');
                document.getElementById('json-input').classList.toggle('hidden', e.target.value !== 'json');
            });
        });
        document.getElementById('import-form').addEventListener('submit', async e => {
            e.preventDefault();
            const fd = new FormData(e.target);
            try {
                let result;
                if (fd.get('method') === 'file') {
                    const file = fd.get('file');
                    if (!file.name) { alert('请选择文件'); return; }
                    result = await API.importData(file);
                } else {
                    const json = fd.get('json');
                    if (!json) { alert('请输入 JSON'); return; }
                    result = await API.importData(JSON.parse(json));
                }
                if (result.ok) {
                    alert(`导入成功！共导入 ${result.imported} 道题目`);
                    if (result.errors && result.errors.length > 0) alert('部分题目导入失败：\n' + result.errors.join('\n'));
                } else { alert('导入失败：' + result.error); }
            } catch (error) { alert('导入失败：' + error.message); }
        });
    },

    // ========== 用户管理 ==========

    async loadUsers() {
        const c = document.getElementById('page-container');
        c.innerHTML = '<div class="loading">加载中...</div>';
        try {
            const users = await API.getUsers();
            c.innerHTML = `
                <div class="page-header">
                    <div><h1>用户管理</h1><div class="subtitle">共 ${users.length} 个用户</div></div>
                    <div class="header-actions"><button class="btn btn-primary" onclick="App.showCreateUserModal()">${this.icons.plus} 添加用户</button></div>
                </div>
                <div class="card"><div class="card-body">
                    <div class="table-wrap"><table class="table">
                        <thead><tr><th>ID</th><th>用户名</th><th>显示名</th><th>角色</th><th>创建时间</th><th>操作</th></tr></thead>
                        <tbody>${users.map(u => `
                            <tr>
                                <td>${u.id}</td>
                                <td>${u.username}</td>
                                <td>${u.display_name}</td>
                                <td><span class="role-badge ${u.role}">${u.role === 'admin' ? '管理员' : '普通用户'}</span></td>
                                <td>${u.created_at}</td>
                                <td class="actions-cell">
                                    ${u.role !== 'admin' ? `
                                        <button class="btn btn-sm btn-ghost" onclick="App.resetPassword(${u.id})" title="重置密码">${this.icons.refresh}</button>
                                        <button class="btn btn-sm btn-ghost" onclick="App.deleteUser(${u.id})" title="删除" style="color:var(--danger)">${this.icons.trash}</button>
                                    ` : '<span style="color:var(--gray-400);font-size:13px">-</span>'}
                                </td>
                            </tr>
                        `).join('')}</tbody>
                    </table></div>
                </div></div>
            `;
        } catch (error) { c.innerHTML = `<div class="error-msg">${error.message}</div>`; }
    },

    async showCreateUserModal() {
        const username = prompt('请输入用户名:');
        if (!username) return;
        const displayName = prompt('请输入显示名:', username);
        if (!displayName) return;
        const password = prompt('请输入密码:');
        if (!password) return;
        try {
            await API.createUser({ username, display_name: displayName, password, role: 'user' });
            this.loadUsers();
        } catch (error) { alert(error.message); }
    },

    async resetPassword(id) {
        const password = prompt('请输入新密码:');
        if (!password) return;
        try { await API.resetPassword(id, password); alert('密码重置成功'); } catch (error) { alert(error.message); }
    },

    async deleteUser(id) {
        if (confirm('确定要删除这个用户吗？')) {
            try { await API.deleteUser(id); this.loadUsers(); } catch (error) { alert(error.message); }
        }
    },

    loadProfile() {
        const c = document.getElementById('page-container');
        const u = this.currentUser;
        c.innerHTML = `
            <div class="page-header"><div><h1>个人设置</h1></div></div>
            <div class="card"><div class="card-body">
                <form id="profile-form">
                    <div class="form-group">
                        <label>用户名</label>
                        <input type="text" class="form-input" value="${u.username}" disabled style="background:var(--gray-50)">
                        <span class="hint">用户名不可修改</span>
                    </div>
                    <div class="form-group">
                        <label>角色</label>
                        <input type="text" class="form-input" value="${u.role === 'admin' ? '管理员' : '普通用户'}" disabled style="background:var(--gray-50)">
                    </div>
                    <div class="form-group">
                        <label>显示名</label>
                        <input type="text" id="profile-display-name" class="form-input" value="${u.display_name}" required>
                    </div>
                    <button type="submit" class="btn btn-primary">保存修改</button>
                </form>
            </div></div>

            <div class="card" style="margin-top:24px"><div class="card-body">
                <h3 style="margin-bottom:20px;font-size:16px">修改密码</h3>
                <form id="password-form">
                    <div class="form-group">
                        <label>当前密码</label>
                        <input type="password" id="old-password" class="form-input" required>
                    </div>
                    <div class="form-group">
                        <label>新密码</label>
                        <input type="password" id="new-password" class="form-input" required>
                    </div>
                    <button type="submit" class="btn btn-primary">修改密码</button>
                </form>
            </div></div>
        `;

        document.getElementById('profile-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('profile-display-name').value.trim();
            if (!name) { alert('显示名不能为空'); return; }
            try {
                await API.updateProfile(name);
                this.currentUser.display_name = name;
                this.updateUserInfo();
                alert('保存成功');
            } catch (error) { alert(error.message); }
        });

        document.getElementById('password-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const oldPwd = document.getElementById('old-password').value;
            const newPwd = document.getElementById('new-password').value;
            if (!oldPwd || !newPwd) { alert('请填写完整'); return; }
            if (newPwd.length < 6) { alert('新密码至少6位'); return; }
            try {
                await API.changePassword(oldPwd, newPwd);
                alert('密码修改成功');
                document.getElementById('old-password').value = '';
                document.getElementById('new-password').value = '';
            } catch (error) { alert(error.message); }
        });
    },

    load404() {
        document.getElementById('page-container').innerHTML = `
            <div class="error-page">
                <div class="error-page-code">404</div>
                <div class="error-page-text">页面不存在</div>
                <a href="#/" class="btn btn-primary">返回首页</a>
            </div>
        `;
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
