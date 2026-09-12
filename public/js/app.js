/**
 * 二哥刷题宝 —— 桌面端主应用
 *
 * 本次重写修复的问题（编号对应迁移计划）：
 *   F1  全站 innerHTML 未转义 → 所有插值经 esc()（存储型 XSS）
 *   F2  loadQuestionForm 被调用但从未定义，'#/questions/new' 直接报错 → 已实现
 *   F3  练习详情用 `oi === correct_answer` 比较，多选题恒不成立 → 归一化为数组
 *   F4  initRouter 每次登录/登出都注册 hashchange → 只注册一次
 *   F5  initLoginForm 每次回登录页都加 submit 监听 → 只绑定一次
 *   F6  total_count 为 0 时显示 NaN% → 除零保护
 *   F7  跨题库错题练习把会话记到 questions[0] 的题库 → 交由服务端推导
 *   F8  s.sort() 原地修改数组且在前端判分 → 只上报 selected
 *   F9  deleteQuestion 从 hash 取 bank_id 取不到 → 重新触发当前路由
 *   F10 new URLSearchParams(undefined) → 显式判空
 *   F11 结果页不显示未答数；未校验 bankId
 *   F12 列表无分页；导入无进度 → 分页控件 + 分批进度条
 */
const App = {
    currentUser: null,

    /** 每页题数（题库详情） */
    QUESTIONS_PER_PAGE: 50,
    /** 每页练习记录数 */
    SESSIONS_PER_PAGE: 20,

    // ══════════════════════════════════════════════════════════
    // 启动与路由
    // ══════════════════════════════════════════════════════════

    async init() {
        // 把 index.html 里 data-icon 占位符替换为图标模块中的 SVG。
        // 这样做是为了让图标只有一份定义（public/js/icons.js），
        // 而不是像旧实现那样在 <symbol>、内联 <svg>、App.icons 里各存一份。
        this.hydrateIcons();

        // F4: hashchange 只注册一次
        window.addEventListener('hashchange', () => this.handleRoute());
        // F5: 登录表单只绑定一次
        this.bindLoginForm();

        try {
            const result = await API.getMe();
            this.currentUser = result.user;
            this.showMainApp();
            this.handleRoute();
        } catch (e) {
            this.showLoginPage();
        }
    },

    /** 用 Icons 模块填充所有 [data-icon] 占位符 */
    hydrateIcons(root) {
        const scope = root || document;
        scope.querySelectorAll('[data-icon]').forEach((el) => {
            const name = el.getAttribute('data-icon');
            const svg = Icons[name];
            if (svg) el.innerHTML = svg;
        });
    },

    showLoginPage() {
        document.getElementById('login-page').classList.remove('hidden');
        document.getElementById('main-app').classList.add('hidden');
    },

    showMainApp() {
        document.getElementById('login-page').classList.add('hidden');
        document.getElementById('main-app').classList.remove('hidden');
        this.updateUserInfo();
        this.updateAdminVisibility();
        this.initLogout();
    },

    updateUserInfo() {
        if (!this.currentUser) return;
        const name = this.currentUser.display_name || this.currentUser.username;
        document.getElementById('user-display-name').textContent = name;
        // textContent 而非 innerHTML：显示名是用户可控内容
        document.getElementById('user-avatar').textContent = name.charAt(0).toUpperCase();

        const badge = document.getElementById('user-role');
        badge.textContent = this.currentUser.role === 'admin' ? '管理员' : '普通用户';
        badge.className = 'role-badge ' + this.currentUser.role;
    },

    updateAdminVisibility() {
        const isAdmin = this.currentUser && this.currentUser.role === 'admin';
        document.querySelectorAll('.admin-only').forEach((el) => {
            el.style.display = isAdmin ? 'flex' : 'none';
        });
    },

    bindLoginForm() {
        const form = document.getElementById('login-form');
        if (!form || form.dataset.bound === '1') return;
        form.dataset.bound = '1';

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value;
            const btn = form.querySelector('button[type="submit"]');
            const originalText = btn ? btn.textContent : '';

            if (!username || !password) return;

            // 客户端要跑 600k 轮 PBKDF2（约 200ms），给出明确反馈
            if (btn) {
                btn.disabled = true;
                btn.textContent = '正在验证…';
            }

            try {
                const result = await API.login(username, password);
                this.currentUser = result.user;
                form.reset();
                this.showMainApp();
                window.location.hash = '#/';
            } catch (error) {
                form.reset();
                if (error.code === 'PASSWORD_RESET_REQUIRED') {
                    alert(error.message);
                } else {
                    alert(error.message);
                }
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = originalText;
                }
            }
        });
    },

    initLogout() {
        const btn = document.getElementById('logout-btn');
        if (!btn || btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.onclick = async () => {
            try {
                await API.logout();
            } catch (e) {
                /* 登出应幂等，忽略失败 */
            }
            this.currentUser = null;
            this.showLoginPage();
        };
    },

    handleRoute() {
        if (this._practiceKeyHandler) {
            document.removeEventListener('keydown', this._practiceKeyHandler);
            this._practiceKeyHandler = null;
        }

        const hash = window.location.hash || '#/';
        const fullPath = hash.slice(1);
        const path = fullPath.split('?')[0];

        document.querySelectorAll('.nav-item').forEach((el) => {
            el.classList.remove('active');
            const href = (el.getAttribute('href') || '').slice(1);
            if (href && (path === href || (href !== '/' && path.startsWith(href)))) {
                el.classList.add('active');
            }
        });

        if (path === '/' || path === '') this.loadDashboard();
        else if (path === '/banks') this.loadBanks();
        else if (path.match(/^\/banks\/\d+$/)) this.loadBankDetail(path.split('/')[2], 1);
        else if (path === '/questions/new') this.loadQuestionForm();
        else if (path.match(/^\/questions\/\d+\/edit$/)) this.loadQuestionForm(path.split('/')[2]);
        else if (path === '/practice/pick') this.loadPracticePick();
        else if (path === '/practice/do') this.loadPracticeDo();
        else if (path === '/practice/result') this.loadPracticeResult();
        else if (path === '/wrongbook') this.loadWrongBook();
        else if (path === '/sessions') this.loadSessions(1);
        else if (path.match(/^\/sessions\/\d+$/)) this.loadSessionDetail(path.split('/')[2]);
        else if (path === '/import') this.loadImport();
        else if (path === '/users') this.loadUsers();
        else if (path === '/profile') this.loadProfile();
        else this.load404();
    },

    /** 安全地取 hash 上的查询参数（F10：无 ? 时不再传 undefined） */
    hashParams() {
        const hash = window.location.hash || '';
        const qi = hash.indexOf('?');
        return new URLSearchParams(qi === -1 ? '' : hash.slice(qi + 1));
    },

    getTypeLabel(type) {
        const map = { single: '单选题', multiple: '多选题', truefalse: '判断题' };
        return map[type] || type;
    },

    /** 正确率显示；F6：total 为 0 时不再出现 NaN% */
    accuracyText(correct, total) {
        if (!total || total <= 0) return '—';
        return ((correct / total) * 100).toFixed(1) + '%';
    },

    escapeHtml: (v) => (window.esc ? esc(v) : String(v == null ? '' : v)),

    // ══════════════════════════════════════════════════════════
    // 仪表盘
    // ══════════════════════════════════════════════════════════

    async loadDashboard() {
        const c = document.getElementById('page-container');
        c.innerHTML = '<div class="loading">加载中...</div>';
        try {
            const data = await API.getDashboard();
            const perBank = data.today_wrong_per_bank || [];

            c.innerHTML = `
                <div class="page-header">
                    <div>
                        <h1>仪表盘</h1>
                        <div class="subtitle">今日学习概览</div>
                    </div>
                </div>
                <div class="dashboard-grid">
                    <div class="stat-card">
                        <div class="stat-icon teal">${Icons.target}</div>
                        <div class="stat-info">
                            <div class="stat-value tnum">${esc(data.today_practice_count)}</div>
                            <div class="stat-label">今日练习</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon green">${Icons['circle-check']}</div>
                        <div class="stat-info">
                            <div class="stat-value tnum">${this.accuracyText(data.today_correct_count, data.today_practice_count)}</div>
                            <div class="stat-label">今日正确率</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon red">${Icons['circle-x']}</div>
                        <div class="stat-info">
                            <div class="stat-value tnum">${esc(data.today_new_wrong)}</div>
                            <div class="stat-label">今日新增错题</div>
                        </div>
                    </div>
                </div>
                ${
                    perBank.length > 0
                        ? `<div class="card">
                             <div class="card-header"><h3>今日错题分布</h3></div>
                             <div class="card-body">
                               <div class="table-wrap"><table class="table">
                                 <thead><tr><th>题库</th><th>错题数</th></tr></thead>
                                 <tbody>${perBank
                                     .map(
                                         (i) =>
                                             `<tr><td>${esc(i.bank_name)}</td><td class="tnum">${esc(i.count)}</td></tr>`
                                     )
                                     .join('')}</tbody>
                               </table></div>
                             </div>
                           </div>`
                        : ''
                }
            `;
        } catch (error) {
            c.innerHTML = `<div class="error-msg">${esc(error.message)}</div>`;
        }
    },

    // ══════════════════════════════════════════════════════════
    // 题库
    // ══════════════════════════════════════════════════════════

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
                    ${isAdmin ? `<div class="header-actions"><button class="btn btn-primary" id="btn-create-bank">${Icons.plus} 新建题库</button></div>` : ''}
                </div>
                <div class="bank-grid">
                    ${
                        banks.length === 0
                            ? `<div class="empty-state">${Icons.inbox}<p>暂无题库</p></div>`
                            : banks
                                  .map(
                                      (bank) => `
                        <div class="bank-card" data-bank-id="${bank.id}">
                            <div class="bank-card-header">
                                <div class="bank-card-title">${esc(bank.name)}</div>
                                ${
                                    isAdmin
                                        ? `<div class="bank-card-actions">
                                             <button class="btn btn-sm btn-ghost" data-edit-bank="${bank.id}" title="编辑">${Icons.edit}</button>
                                             <button class="btn btn-sm btn-ghost" data-delete-bank="${bank.id}" title="删除">${Icons.trash}</button>
                                           </div>`
                                        : ''
                                }
                            </div>
                            <div class="bank-card-desc">${esc(bank.description || '暂无描述')}</div>
                            <div class="bank-card-stats">
                                <span class="bank-stat">总计 <span class="count tnum">${bank.question_count}</span></span>
                                <span class="bank-stat">单选 <span class="count tnum">${bank.single_count}</span></span>
                                <span class="bank-stat">多选 <span class="count tnum">${bank.multiple_count}</span></span>
                                <span class="bank-stat">判断 <span class="count tnum">${bank.truefalse_count}</span></span>
                            </div>
                        </div>`
                                  )
                                  .join('')
                    }
                </div>
            `;

            const createBtn = document.getElementById('btn-create-bank');
            if (createBtn) createBtn.onclick = () => this.showCreateBankModal();

            c.querySelectorAll('.bank-card').forEach((card) => {
                card.addEventListener('click', (e) => {
                    if (e.target.closest('button')) return;
                    window.location.hash = '#/banks/' + card.dataset.bankId;
                });
            });
            c.querySelectorAll('[data-edit-bank]').forEach((b) => {
                b.onclick = (e) => {
                    e.stopPropagation();
                    this.editBank(b.dataset.editBank);
                };
            });
            c.querySelectorAll('[data-delete-bank]').forEach((b) => {
                b.onclick = (e) => {
                    e.stopPropagation();
                    this.deleteBank(b.dataset.deleteBank);
                };
            });
        } catch (error) {
            c.innerHTML = `<div class="error-msg">${esc(error.message)}</div>`;
        }
    },

    showCreateBankModal() {
        const name = prompt('请输入题库名称:');
        if (!name || !name.trim()) return;
        API.createBank({ name: name.trim() })
            .then(() => this.loadBanks())
            .catch((e) => alert(e.message));
    },

    async editBank(id) {
        try {
            const bank = await API.getBank(id);
            const name = prompt('请输入题库名称:', bank.name);
            if (name === null) return;
            const description = prompt('请输入题库描述（可留空）:', bank.description || '');
            if (description === null) return;
            await API.updateBank(id, { name: name.trim(), description: description.trim() });
            this.loadBanks();
        } catch (e) {
            alert(e.message);
        }
    },

    async deleteBank(id) {
        if (!confirm('确定要删除这个题库吗？所有题目都会被删除。')) return;
        try {
            await API.deleteBank(id);
            this.loadBanks();
        } catch (e) {
            alert(e.message);
        }
    },

    async loadBankDetail(id, page) {
        const c = document.getElementById('page-container');
        c.innerHTML = '<div class="loading">加载中...</div>';
        try {
            const currentPage = page || 1;
            const [bank, listed] = await Promise.all([
                API.getBank(id),
                API.getQuestions({ bank_id: id, page: currentPage, per_page: this.QUESTIONS_PER_PAGE }),
            ]);
            const isAdmin = this.currentUser.role === 'admin';
            const totalPages = Math.max(1, Math.ceil(listed.total / listed.per_page));

            c.innerHTML = `
                <div class="page-header">
                    <div>
                        <h1>${esc(bank.name)}</h1>
                        <div class="subtitle">${esc(bank.description || '暂无描述')} · 共 ${listed.total} 题</div>
                    </div>
                    <div class="header-actions">
                        <button class="btn btn-secondary" id="btn-practice-here">开始练习</button>
                        ${isAdmin ? `<button class="btn btn-primary" id="btn-add-question">${Icons.plus} 添加题目</button>` : ''}
                    </div>
                </div>
                <div class="card"><div class="card-body">
                    <div class="table-wrap"><table class="table">
                        <thead><tr><th>ID</th><th>题型</th><th>题干</th>${isAdmin ? '<th>操作</th>' : ''}</tr></thead>
                        <tbody>
                            ${
                                listed.items.length === 0
                                    ? `<tr><td colspan="${isAdmin ? 4 : 3}"><div class="empty-state">${Icons.inbox}<p>暂无题目</p></div></td></tr>`
                                    : listed.items
                                          .map(
                                              (q) => `
                                <tr>
                                    <td class="tnum">${q.id}</td>
                                    <td><span class="type-badge ${q.type}">${esc(this.getTypeLabel(q.type))}</span></td>
                                    <td class="stem-cell">${esc(q.stem.length > 60 ? q.stem.slice(0, 60) + '…' : q.stem)}</td>
                                    ${
                                        isAdmin
                                            ? `<td class="actions-cell">
                                                 <button class="btn btn-sm btn-ghost" data-edit-q="${q.id}" title="编辑">${Icons.edit}</button>
                                                 <button class="btn btn-sm btn-ghost" data-del-q="${q.id}" title="删除">${Icons.trash}</button>
                                               </td>`
                                            : ''
                                    }
                                </tr>`
                                          )
                                          .join('')
                            }
                        </tbody>
                    </table></div>
                    ${this.paginationHtml(currentPage, totalPages, 'bank-page')}
                </div></div>
            `;

            document.getElementById('btn-practice-here').onclick = () => {
                window.location.hash = '#/practice/pick?bank_id=' + id;
            };
            const addBtn = document.getElementById('btn-add-question');
            if (addBtn) {
                addBtn.onclick = () => {
                    window.location.hash = '#/questions/new?bank_id=' + id;
                };
            }

            c.querySelectorAll('[data-edit-q]').forEach((b) => {
                b.onclick = () => {
                    window.location.hash = '#/questions/' + b.dataset.editQ + '/edit';
                };
            });
            c.querySelectorAll('[data-del-q]').forEach((b) => {
                b.onclick = () => this.deleteQuestion(b.dataset.delQ);
            });

            this.bindPagination('bank-page', (p) => this.loadBankDetail(id, p));
        } catch (error) {
            c.innerHTML = `<div class="error-msg">${esc(error.message)}</div>`;
        }
    },

    /** 分页控件（F12） */
    paginationHtml(page, totalPages, cls) {
        if (totalPages <= 1) return '';
        return `
            <div class="pagination ${cls}">
                <button class="btn btn-sm btn-secondary" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>${Icons['chevron-left']} 上一页</button>
                <span class="pagination-info tnum">第 ${page} / ${totalPages} 页</span>
                <button class="btn btn-sm btn-secondary" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>下一页 ${Icons['chevron-right']}</button>
            </div>`;
    },

    bindPagination(cls, onGo) {
        document.querySelectorAll(`.pagination.${cls} button[data-page]`).forEach((btn) => {
            btn.onclick = () => {
                const p = parseInt(btn.dataset.page, 10);
                if (p >= 1) onGo(p);
            };
        });
    },

    /**
     * F9：删除后重新触发当前路由。
     * 旧实现从 window.location.hash.split('?')[1] 取 bank_id，
     * 但列表页 URL 是 #/banks/:id（没有查询串），永远取不到，于是删完不刷新。
     */
    async deleteQuestion(id) {
        if (!confirm('确定要删除这道题目吗？')) return;
        try {
            await API.deleteQuestion(id);
            this.handleRoute();
        } catch (e) {
            alert(e.message);
        }
    },

    // ══════════════════════════════════════════════════════════
    // 题目新建 / 编辑（F2：此前该路由指向一个不存在的方法）
    // ══════════════════════════════════════════════════════════

    async loadQuestionForm(id) {
        const c = document.getElementById('page-container');
        c.innerHTML = '<div class="loading">加载中...</div>';

        try {
            const banks = await API.getBanks();
            if (banks.length === 0) {
                c.innerHTML = `<div class="error-msg">还没有题库，请先创建一个题库。</div>`;
                return;
            }

            const isEdit = !!id;
            let question = null;
            if (isEdit) {
                question = await API.getQuestion(id);
            }

            const bankIdFromHash = this.hashParams().get('bank_id');
            const selectedBankId = question
                ? question.bank_id
                : bankIdFromHash || banks[0].id;

            const type = question ? question.type : 'single';
            const options = question ? question.options : ['', '', '', ''];
            const answer = question ? question.answer : 0;
            const answerSet = Array.isArray(answer) ? answer : [answer];

            c.innerHTML = `
                <div class="page-header">
                    <div><h1>${isEdit ? '编辑题目' : '添加题目'}</h1></div>
                    <div class="header-actions">
                        <button class="btn btn-secondary" id="btn-cancel">返回</button>
                    </div>
                </div>
                <form id="question-form" class="card"><div class="card-body">
                    <div class="form-row">
                        <div class="form-group">
                            <label for="q-bank">所属题库</label>
                            <select id="q-bank" class="form-input">
                                ${banks
                                    .map(
                                        (b) =>
                                            `<option value="${b.id}" ${b.id === selectedBankId ? 'selected' : ''}>${esc(b.name)}</option>`
                                    )
                                    .join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="q-type">题型</label>
                            <select id="q-type" class="form-input">
                                <option value="single" ${type === 'single' ? 'selected' : ''}>单选题</option>
                                <option value="multiple" ${type === 'multiple' ? 'selected' : ''}>多选题</option>
                                <option value="truefalse" ${type === 'truefalse' ? 'selected' : ''}>判断题</option>
                            </select>
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="q-stem">题干</label>
                        <textarea id="q-stem" class="form-input" rows="3" required>${esc(question ? question.stem : '')}</textarea>
                    </div>

                    <div class="form-group">
                        <label>选项（勾选正确答案）</label>
                        <div id="q-options"></div>
                        <button type="button" class="btn btn-sm btn-secondary" id="btn-add-option">${Icons.plus} 增加选项</button>
                        <span class="hint">至少 2 项；判断题固定为「对 / 错」</span>
                    </div>

                    <div class="form-group">
                        <label for="q-explanation">解析（可选）</label>
                        <textarea id="q-explanation" class="form-input" rows="2">${esc(question ? question.explanation : '')}</textarea>
                    </div>

                    <button type="submit" class="btn btn-primary btn-lg">${isEdit ? '保存修改' : '创建题目'}</button>
                </form>
            `;

            const typeEl = document.getElementById('q-type');
            const optionsEl = document.getElementById('q-options');

            const renderOptions = () => {
                const t = typeEl.value;
                const isTrueFalse = t === 'truefalse';

                // 判断题固定两个选项，避免出现「对/错/也许」这类无意义数据
                const list = isTrueFalse ? ['对', '错'] : options;

                optionsEl.innerHTML = list
                    .map(
                        (opt, i) => `
                    <div class="option-row">
                        <label class="option-item ${answerSet.indexOf(i) >= 0 ? 'selected' : ''}">
                            <input type="${t === 'multiple' ? 'checkbox' : 'radio'}" name="q-answer" value="${i}"
                                   ${answerSet.indexOf(i) >= 0 ? 'checked' : ''}>
                            <span class="option-letter">${String.fromCharCode(65 + i)}</span>
                            <input type="text" class="form-input option-input" data-opt-index="${i}"
                                   value="${esc(opt)}" placeholder="选项内容" ${isTrueFalse ? 'readonly' : ''}>
                        </label>
                        ${
                            !isTrueFalse && list.length > 2
                                ? `<button type="button" class="btn btn-sm btn-ghost" data-remove-option="${i}" title="删除">${Icons.x}</button>`
                                : ''
                        }
                    </div>`
                    )
                    .join('');

                optionsEl.querySelectorAll('.option-input').forEach((inp) => {
                    inp.addEventListener('input', () => {
                        options[parseInt(inp.dataset.optIndex, 10)] = inp.value;
                    });
                });
                optionsEl.querySelectorAll('input[name="q-answer"]').forEach((inp) => {
                    inp.addEventListener('change', () => {
                        const idx = parseInt(inp.value, 10);
                        if (typeEl.value === 'multiple') {
                            const pos = answerSet.indexOf(idx);
                            if (inp.checked && pos < 0) answerSet.push(idx);
                            if (!inp.checked && pos >= 0) answerSet.splice(pos, 1);
                        } else {
                            answerSet.length = 0;
                            answerSet.push(idx);
                        }
                        optionsEl.querySelectorAll('.option-item').forEach((item, i) => {
                            item.classList.toggle('selected', answerSet.indexOf(i) >= 0);
                        });
                    });
                });
                optionsEl.querySelectorAll('[data-remove-option]').forEach((b) => {
                    b.onclick = () => {
                        const idx = parseInt(b.dataset.removeOption, 10);
                        options.splice(idx, 1);
                        for (let i = answerSet.length - 1; i >= 0; i--) {
                            if (answerSet[i] === idx) answerSet.splice(i, 1);
                            else if (answerSet[i] > idx) answerSet[i]--;
                        }
                        renderOptions();
                    };
                });
            };

            typeEl.addEventListener('change', () => {
                answerSet.length = 0;
                answerSet.push(0);
                renderOptions();
            });

            document.getElementById('btn-add-option').onclick = () => {
                if (typeEl.value === 'truefalse') return;
                if (options.length >= 12) {
                    alert('最多 12 个选项');
                    return;
                }
                options.push('');
                renderOptions();
            };

            document.getElementById('btn-cancel').onclick = () => window.history.back();

            document.getElementById('question-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const stem = document.getElementById('q-stem').value.trim();
                if (!stem) {
                    alert('题干不能为空');
                    return;
                }

                const t = typeEl.value;
                const finalOptions =
                    t === 'truefalse' ? ['对', '错'] : options.map((o) => o.trim());

                if (finalOptions.some((o) => !o)) {
                    alert('选项内容不能为空');
                    return;
                }
                if (answerSet.length === 0) {
                    alert('请勾选正确答案');
                    return;
                }

                const payload = {
                    bank_id: parseInt(document.getElementById('q-bank').value, 10),
                    type: t,
                    stem: stem,
                    options: finalOptions,
                    answer: t === 'multiple' ? answerSet.slice().sort((a, b) => a - b) : answerSet[0],
                    explanation: document.getElementById('q-explanation').value.trim(),
                };

                try {
                    if (isEdit) {
                        await API.updateQuestion(id, payload);
                    } else {
                        await API.createQuestion(payload);
                    }
                    window.location.hash = '#/banks/' + payload.bank_id;
                } catch (err) {
                    alert(err.message);
                }
            });

            renderOptions();
        } catch (error) {
            c.innerHTML = `<div class="error-msg">${esc(error.message)}</div>`;
        }
    },

    // ══════════════════════════════════════════════════════════
    // 练习
    // ══════════════════════════════════════════════════════════

    async loadPracticePick() {
        const c = document.getElementById('page-container');
        const bankId = this.hashParams().get('bank_id');

        if (!bankId) {
            try {
                const banks = await API.getBanks();
                c.innerHTML = `
                    <div class="page-header"><div><h1>选择题库</h1><div class="subtitle">选择要练习的题库</div></div></div>
                    ${
                        banks.length === 0
                            ? `<div class="empty-state">${Icons.inbox}<p>暂无题库</p></div>`
                            : `<div class="bank-grid">${banks
                                  .map(
                                      (bank) => `
                        <div class="bank-card" data-bank-id="${bank.id}">
                            <div class="bank-card-title">${esc(bank.name)}</div>
                            <div class="bank-card-desc">共 ${bank.question_count} 题</div>
                        </div>`
                                  )
                                  .join('')}</div>`
                    }
                `;
                c.querySelectorAll('.bank-card').forEach((card) => {
                    card.onclick = () => {
                        window.location.hash = '#/practice/pick?bank_id=' + card.dataset.bankId;
                    };
                });
            } catch (error) {
                c.innerHTML = `<div class="error-msg">${esc(error.message)}</div>`;
            }
            return;
        }

        try {
            const bank = await API.getBank(bankId);
            c.innerHTML = `
                <div class="page-header"><div><h1>练习设置</h1><div class="subtitle">${esc(bank.name)}</div></div></div>
                <div class="card"><div class="card-body">
                    <form id="practice-form">
                        <div class="form-row">
                            <div class="form-group">
                                <label for="p-single">单选题数量</label>
                                <input type="number" id="p-single" name="single_count" value="0" min="0" max="${bank.single_count}" class="form-input">
                                <span class="hint">题库共有 ${bank.single_count} 题</span>
                            </div>
                            <div class="form-group">
                                <label for="p-multiple">多选题数量</label>
                                <input type="number" id="p-multiple" name="multiple_count" value="0" min="0" max="${bank.multiple_count}" class="form-input">
                                <span class="hint">题库共有 ${bank.multiple_count} 题</span>
                            </div>
                            <div class="form-group">
                                <label for="p-truefalse">判断题数量</label>
                                <input type="number" id="p-truefalse" name="truefalse_count" value="0" min="0" max="${bank.truefalse_count}" class="form-input">
                                <span class="hint">题库共有 ${bank.truefalse_count} 题</span>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="checkbox-label"><input type="checkbox" id="p-shuffle"> 打乱选项顺序</label>
                        </div>
                        <button type="submit" class="btn btn-primary btn-lg">开始练习</button>
                    </form>
                </div></div>
            `;

            document.getElementById('practice-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const data = {
                    bank_id: parseInt(bankId, 10),
                    single_count: parseInt(document.getElementById('p-single').value, 10) || 0,
                    multiple_count: parseInt(document.getElementById('p-multiple').value, 10) || 0,
                    truefalse_count: parseInt(document.getElementById('p-truefalse').value, 10) || 0,
                    shuffle_options: document.getElementById('p-shuffle').checked,
                    mode: 'random',
                };

                const total = data.single_count + data.multiple_count + data.truefalse_count;
                if (total === 0) {
                    alert('请至少选择一道题目');
                    return;
                }
                if (total > 100) {
                    alert('单次最多练习 100 道题');
                    return;
                }

                try {
                    window.practiceData = await API.pickQuestions(data);
                    window.location.hash = '#/practice/do';
                } catch (error) {
                    alert(error.message);
                }
            });
        } catch (error) {
            c.innerHTML = `<div class="error-msg">${esc(error.message)}</div>`;
        }
    },

    async loadPracticeDo() {
        const c = document.getElementById('page-container');
        const data = window.practiceData;
        if (!data || !data.questions || data.questions.length === 0) {
            c.innerHTML = '<div class="error-msg">没有练习数据</div>';
            return;
        }

        let idx = 0;
        const answers = {};
        const total = data.questions.length;
        const self = this;

        const render = () => {
            const q = data.questions[idx];
            const a = answers[q.id];
            const sel = a ? a.selected : null;

            let navHtml = '';
            for (let i = 0; i < total; i++) {
                const qid = data.questions[i].id;
                const answered = answers[qid] !== undefined && answers[qid].selected !== null;
                const cls =
                    (i === idx ? 'nav-q current' : 'nav-q') + (answered ? ' answered' : '');
                navHtml += `<button class="${cls}" data-idx="${i}">${i + 1}</button>`;
            }

            const isSelected = (i) =>
                sel === i || (Array.isArray(sel) && sel.indexOf(i) >= 0);

            c.innerHTML = `
                <div class="practice-layout">
                    <div class="practice-main">
                        <div class="practice-progress">
                            <div class="progress-header">
                                <span class="progress-label">第 ${idx + 1} / ${total} 题</span>
                                <span class="progress-count tnum">${Math.round(((idx + 1) / total) * 100)}%</span>
                            </div>
                            <div class="progress-bar"><div class="progress-fill" style="width:${((idx + 1) / total) * 100}%"></div></div>
                        </div>
                        <div class="practice-question">
                            <div class="question-type-badge">${esc(this.getTypeLabel(q.type))}</div>
                            <div class="question-stem">${esc(q.stem)}</div>
                            <div class="question-options">
                                ${q.options
                                    .map(
                                        (opt, i) => `
                                    <label class="option-item ${isSelected(i) ? 'selected' : ''}">
                                        <input type="${q.type === 'multiple' ? 'checkbox' : 'radio'}" name="answer" value="${i}" ${isSelected(i) ? 'checked' : ''}>
                                        <span class="option-letter">${String.fromCharCode(65 + i)}</span>
                                        <span class="option-text">${esc(opt)}</span>
                                    </label>
                                `
                                    )
                                    .join('')}
                            </div>
                        </div>
                        <div class="practice-actions">
                            <button class="btn btn-secondary" ${idx === 0 ? 'disabled' : ''} id="btn-prev">${Icons['arrow-left']} 上一题</button>
                            <button class="btn btn-ghost" id="btn-dontknow">不会</button>
                            <button class="btn btn-secondary" ${idx === total - 1 ? 'disabled' : ''} id="btn-next">下一题 ${Icons['arrow-right']}</button>
                        </div>
                    </div>
                    <div class="practice-sidebar">
                        <div class="sidebar-title">答题卡</div>
                        <div class="question-nav">${navHtml}</div>
                        <div class="sidebar-stats">
                            <span class="stat-answered">已答: <b class="tnum" id="stat-answered">0</b></span>
                            <span class="stat-unanswered">未答: <b class="tnum" id="stat-unanswered">${total}</b></span>
                        </div>
                        <button class="btn btn-primary btn-block" id="btn-submit">提交试卷</button>
                    </div>
                </div>
            `;

            const answeredCount = Object.keys(answers).filter(
                (k) => answers[k] && answers[k].selected !== null
            ).length;
            document.getElementById('stat-answered').textContent = answeredCount;
            document.getElementById('stat-unanswered').textContent = total - answeredCount;

            c.querySelectorAll('.option-item input').forEach((input) => {
                input.addEventListener('change', (e) => {
                    const cur = data.questions[idx];
                    const v = parseInt(e.target.value, 10);
                    if (cur.type === 'multiple') {
                        if (!answers[cur.id]) answers[cur.id] = { selected: [] };
                        const arr = answers[cur.id].selected;
                        if (e.target.checked) {
                            if (arr.indexOf(v) < 0) arr.push(v);
                        } else {
                            answers[cur.id].selected = arr.filter((x) => x !== v);
                        }
                    } else {
                        answers[cur.id] = { selected: v };
                    }
                    render();
                });
            });

            c.querySelectorAll('.nav-q').forEach((btn) => {
                btn.addEventListener('click', () => {
                    idx = parseInt(btn.dataset.idx, 10);
                    render();
                });
            });

            document.getElementById('btn-prev').addEventListener('click', () => self.prevQ());
            document.getElementById('btn-next').addEventListener('click', () => self.nextQ());
            document.getElementById('btn-dontknow').addEventListener('click', () => self.markDontKnow());
            document.getElementById('btn-submit').addEventListener('click', () => self.submitPractice());

            // 点击整行即可选中，而不只是点中小圆点
            c.querySelectorAll('.option-item').forEach((item) => {
                item.addEventListener('click', (e) => {
                    if (e.target.tagName === 'INPUT') return;
                    const input = item.querySelector('input');
                    if (input) input.click();
                });
            });
        };

        this.nextQ = () => {
            if (idx < total - 1) {
                idx++;
                render();
            }
        };
        this.prevQ = () => {
            if (idx > 0) {
                idx--;
                render();
            }
        };
        /** 「不会」= 未作答，服务端会计入未答而非答错（旧实现计为答错） */
        this.markDontKnow = () => {
            const q = data.questions[idx];
            answers[q.id] = { selected: null };
            if (idx < total - 1) idx++;
            render();
        };

        this._practiceKeyHandler = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                self.prevQ();
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                self.nextQ();
            }
        };
        document.addEventListener('keydown', this._practiceKeyHandler);

        this.submitPractice = async () => {
            // F8：只上报 selected，判分交给服务端
            const payload = data.questions.map((q) => {
                const a = answers[q.id];
                const item = {
                    question_id: q.id,
                    selected: a ? a.selected : null,
                };
                if (q.shuffle_token) item.shuffle_token = q.shuffle_token;
                return item;
            });

            document.removeEventListener('keydown', self._practiceKeyHandler);

            try {
                window.practiceResult = await API.submitPractice({
                    mode: data.mode || 'random',
                    answers: payload,
                });
                window.location.hash = '#/practice/result';
            } catch (error) {
                alert(error.message);
                document.addEventListener('keydown', self._practiceKeyHandler);
            }
        };

        render();
    },

    async loadPracticeResult() {
        const c = document.getElementById('page-container');
        const r = window.practiceResult;
        if (!r) {
            c.innerHTML = '<div class="error-msg">没有练习结果</div>';
            return;
        }

        const pct = Math.round((r.accuracy || 0) * 100);
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
                            <div class="result-ring-value tnum">${pct}%</div>
                            <div class="result-ring-label">正确率</div>
                        </div>
                    </div>
                    <div class="result-stats">
                        <div class="result-stat"><div class="result-stat-value tnum">${r.total_count}</div><div class="result-stat-label">总题数</div></div>
                        <div class="result-stat"><div class="result-stat-value correct tnum">${r.correct_count}</div><div class="result-stat-label">正确</div></div>
                        <div class="result-stat"><div class="result-stat-value wrong tnum">${r.wrong_count}</div><div class="result-stat-label">错误</div></div>
                        <div class="result-stat"><div class="result-stat-value unanswered tnum">${r.unanswered_count}</div><div class="result-stat-label">未答</div></div>
                    </div>
                </div>
                <div class="result-actions">
                    <button class="btn btn-secondary" id="btn-result-home">${Icons['arrow-left']} 返回首页</button>
                    <button class="btn btn-primary" id="btn-view-detail">查看详情</button>
                </div>
            </div>
        `;

        document.getElementById('btn-result-home').onclick = () => {
            window.location.hash = '#/';
        };

        document.getElementById('btn-view-detail').onclick = () => {
            window.location.hash = '#/sessions/' + r.session_id;
        };

        setTimeout(() => {
            const ring = c.querySelector('.result-ring-fill');
            if (ring) ring.style.strokeDashoffset = offset;
        }, 100);
    },

    // ══════════════════════════════════════════════════════════
    // 错题本
    // ══════════════════════════════════════════════════════════

    async loadWrongBook() {
        const c = document.getElementById('page-container');
        c.innerHTML = '<div class="loading">加载中...</div>';
        try {
            const records = await API.getWrongBook();
            c.innerHTML = `
                <div class="page-header">
                    <div><h1>错题本</h1><div class="subtitle">共 ${records.length} 道错题</div></div>
                    ${
                        records.length > 0
                            ? `<div class="header-actions"><button class="btn btn-primary" id="btn-wrong-practice">练习错题</button></div>`
                            : ''
                    }
                </div>
                <div class="card"><div class="card-body">
                    ${
                        records.length === 0
                            ? `<div class="empty-state">${Icons['circle-check']}<p>暂无错题，继续加油！</p></div>`
                            : `<div class="table-wrap"><table class="table">
                        <thead><tr><th>题型</th><th>题干</th><th>题库</th><th>错误</th><th>连续正确</th><th>操作</th></tr></thead>
                        <tbody>${records
                            .map(
                                (r) => `
                            <tr>
                                <td><span class="type-badge ${r.type}">${esc(this.getTypeLabel(r.type))}</span></td>
                                <td class="stem-cell">${esc(r.stem.length > 50 ? r.stem.slice(0, 50) + '…' : r.stem)}</td>
                                <td>${esc(r.bank_name)}</td>
                                <td class="tnum">${esc(r.error_count)}</td>
                                <td class="tnum">${esc(r.correct_count || 0)} / 5</td>
                                <td><button class="btn btn-sm btn-ghost" data-remove-wrong="${r.id}">移除</button></td>
                            </tr>`
                            )
                            .join('')}</tbody>
                    </table></div>`
                    }
                </div></div>
            `;

            const btn = document.getElementById('btn-wrong-practice');
            if (btn) btn.onclick = () => this.startWrongPractice();

            c.querySelectorAll('[data-remove-wrong]').forEach((b) => {
                b.onclick = () => this.removeWrong(b.dataset.removeWrong);
            });
        } catch (error) {
            c.innerHTML = `<div class="error-msg">${esc(error.message)}</div>`;
        }
    },

    async startWrongPractice() {
        try {
            const data = await API.pickWrongQuestions({ count: 20 });
            if (!data.questions || data.questions.length === 0) {
                alert('错题本为空');
                return;
            }
            // F7：不再伪造 bank_id —— 跨题库练习的归属由服务端推导
            window.practiceData = { questions: data.questions, mode: 'wrongbook' };
            window.location.hash = '#/practice/do';
        } catch (error) {
            alert(error.message);
        }
    },

    async removeWrong(id) {
        if (!confirm('确定要从错题本中移除吗？')) return;
        try {
            await API.removeWrong(id);
            this.loadWrongBook();
        } catch (e) {
            alert(e.message);
        }
    },

    // ══════════════════════════════════════════════════════════
    // 练习记录
    // ══════════════════════════════════════════════════════════

    async loadSessions(page) {
        const c = document.getElementById('page-container');
        c.innerHTML = '<div class="loading">加载中...</div>';
        try {
            const currentPage = page || 1;
            const data = await API.getSessions({
                page: currentPage,
                per_page: this.SESSIONS_PER_PAGE,
            });
            const totalPages = Math.max(1, Math.ceil(data.total / data.per_page));

            c.innerHTML = `
                <div class="page-header"><div><h1>练习记录</h1><div class="subtitle">共 ${data.total} 条记录</div></div></div>
                <div class="card"><div class="card-body">
                    ${
                        data.sessions.length === 0
                            ? `<div class="empty-state">${Icons.inbox}<p>暂无练习记录</p></div>`
                            : `<div class="table-wrap"><table class="table">
                        <thead><tr><th>时间</th><th>题库</th><th>总题数</th><th>正确</th><th>错误</th><th>未答</th><th>正确率</th><th>操作</th></tr></thead>
                        <tbody>${data.sessions
                            .map(
                                (s) => `
                            <tr>
                                <td class="tnum">${esc(s.submitted_at)}</td>
                                <td>${esc(s.bank_name)}</td>
                                <td class="tnum">${s.total_count}</td>
                                <td class="text-success tnum">${s.correct_count}</td>
                                <td class="text-danger tnum">${s.wrong_count}</td>
                                <td class="text-secondary tnum">${s.unanswered_count || 0}</td>
                                <td class="tnum">${this.accuracyText(s.correct_count, s.total_count)}</td>
                                <td><button class="btn btn-sm btn-secondary" data-session="${s.id}">详情</button></td>
                            </tr>`
                            )
                            .join('')}</tbody>
                    </table></div>
                    ${this.paginationHtml(currentPage, totalPages, 'session-page')}`
                    }
                </div></div>
            `;

            c.querySelectorAll('[data-session]').forEach((b) => {
                b.onclick = () => {
                    window.location.hash = '#/sessions/' + b.dataset.session;
                };
            });
            this.bindPagination('session-page', (p) => this.loadSessions(p));
        } catch (error) {
            c.innerHTML = `<div class="error-msg">${esc(error.message)}</div>`;
        }
    },

    async loadSessionDetail(id) {
        const c = document.getElementById('page-container');
        c.innerHTML = '<div class="loading">加载中...</div>';
        try {
            const data = await API.getSession(id);
            let idx = 0;
            const total = data.answers.length;
            const self = this;

            if (total === 0) {
                c.innerHTML = '<div class="empty-state"><p>这次练习没有作答明细</p></div>';
                return;
            }

            /** F3：正确答案与用户选择都可能是数组，必须归一化后再比较 */
            const toIndexArray = (v) => {
                if (v === null || v === undefined) return [];
                return Array.isArray(v) ? v : [v];
            };

            const renderDetail = () => {
                const a = data.answers[idx];
                const correctIdxs = toIndexArray(a.correct_answer);
                const selectedIdxs = toIndexArray(a.selected_answer);
                const unanswered = a.is_correct === null && selectedIdxs.length === 0;

                let navHtml = '';
                for (let i = 0; i < total; i++) {
                    const ans = data.answers[i];
                    let cls = 'nav-q';
                    if (i === idx) cls += ' current';
                    else if (ans.is_correct === 1) cls += ' correct';
                    else if (ans.is_correct === 0) cls += ' wrong';
                    navHtml += `<button class="${cls}" data-idx="${i}">${i + 1}</button>`;
                }

                const statusText = unanswered ? '未作答' : a.is_correct ? '正确' : '错误';
                const statusCls = unanswered ? 'unanswered' : a.is_correct ? 'correct' : 'wrong';

                c.innerHTML = `
                    <div class="page-header">
                        <div><h1>练习详情</h1></div>
                        <button class="btn btn-secondary" id="btn-back">${Icons['arrow-left']} 返回列表</button>
                    </div>
                    <div class="session-info">
                        <div class="session-info-item"><div class="session-info-label">练习时间</div><div class="session-info-value tnum">${esc(data.session.submitted_at)}</div></div>
                        <div class="session-info-item"><div class="session-info-label">题库</div><div class="session-info-value">${esc(data.session.bank_name)}</div></div>
                        <div class="session-info-item"><div class="session-info-label">正确率</div><div class="session-info-value tnum">${this.accuracyText(data.session.correct_count, data.session.total_count)}</div></div>
                        <div class="session-info-item"><div class="session-info-label">正确/错误/未答</div><div class="session-info-value tnum">${data.session.correct_count} / ${data.session.wrong_count} / ${data.session.unanswered_count || 0}</div></div>
                    </div>
                    <div class="practice-layout">
                        <div class="practice-main">
                            <div class="practice-progress">
                                <div class="progress-header">
                                    <span class="progress-label">第 ${idx + 1} / ${total} 题</span>
                                </div>
                                <div class="progress-bar"><div class="progress-fill" style="width:${((idx + 1) / total) * 100}%"></div></div>
                            </div>
                            <div class="answer-card ${statusCls}">
                                <div class="answer-card-header">
                                    <span class="answer-status-badge ${statusCls}">
                                        ${unanswered ? Icons['help-circle'] + ' 未作答' : a.is_correct ? Icons.check + ' 正确' : Icons.x + ' 错误'}
                                    </span>
                                    <span class="question-type-badge">${esc(this.getTypeLabel(a.type))}</span>
                                </div>
                                <div class="answer-card-stem">${esc(a.stem)}</div>
                                <div class="answer-options">
                                    ${a.options
                                        .map((opt, oi) => {
                                            const isCorrect = correctIdxs.indexOf(oi) >= 0;
                                            const isSelected = selectedIdxs.indexOf(oi) >= 0;
                                            let cls = 'answer-option';
                                            if (isCorrect) cls += ' correct';
                                            if (isSelected && !isCorrect) cls += ' wrong-selected';
                                            if (isSelected) cls += ' selected';
                                            const mark = isCorrect
                                                ? Icons.check
                                                : isSelected
                                                  ? Icons.x
                                                  : '';
                                            return `<div class="${cls}"><strong>${String.fromCharCode(65 + oi)}.</strong> <span class="answer-option-text">${esc(opt)}</span> ${mark}</div>`;
                                        })
                                        .join('')}
                                </div>
                                ${a.explanation ? `<div class="answer-explanation"><strong>解析：</strong>${esc(a.explanation)}</div>` : ''}
                            </div>
                            <div class="practice-actions">
                                <button class="btn btn-secondary" ${idx === 0 ? 'disabled' : ''} id="btn-prev">${Icons['arrow-left']} 上一题</button>
                                <button class="btn btn-primary" ${idx === total - 1 ? 'disabled' : ''} id="btn-next">下一题 ${Icons['arrow-right']}</button>
                            </div>
                        </div>
                        <div class="practice-sidebar">
                            <div class="sidebar-title">答题卡</div>
                            <div class="question-nav">${navHtml}</div>
                            <div class="sidebar-stats">
                                <span class="text-success">正确: <b class="tnum">${data.session.correct_count}</b></span>
                                <span class="text-danger">错误: <b class="tnum">${data.session.wrong_count}</b></span>
                                <span class="text-secondary">未答: <b class="tnum">${data.session.unanswered_count || 0}</b></span>
                            </div>
                        </div>
                    </div>
                `;

                document.getElementById('btn-back').onclick = () => {
                    window.location.hash = '#/sessions';
                };
                c.querySelectorAll('.nav-q').forEach((btn) => {
                    btn.addEventListener('click', () => {
                        idx = parseInt(btn.dataset.idx, 10);
                        renderDetail();
                    });
                });
                document.getElementById('btn-prev').addEventListener('click', () => {
                    if (idx > 0) {
                        idx--;
                        renderDetail();
                    }
                });
                document.getElementById('btn-next').addEventListener('click', () => {
                    if (idx < total - 1) {
                        idx++;
                        renderDetail();
                    }
                });
            };

            renderDetail();
        } catch (error) {
            c.innerHTML = `<div class="error-msg">${esc(error.message)}</div>`;
        }
    },

    // ══════════════════════════════════════════════════════════
    // 导入（F12：分批 + 进度）
    // ══════════════════════════════════════════════════════════

    async loadImport() {
        const c = document.getElementById('page-container');
        c.innerHTML = `
            <div class="page-header"><div><h1>导入题库</h1><div class="subtitle">支持 JSON 文件或直接粘贴 JSON 数据</div></div></div>
            <div class="card"><div class="card-body">
                <form id="import-form">
                    <div class="form-group">
                        <label>导入方式</label>
                        <div class="radio-row">
                            <label class="radio-label"><input type="radio" name="method" value="file" checked> 上传文件</label>
                            <label class="radio-label"><input type="radio" name="method" value="json"> 粘贴 JSON</label>
                        </div>
                    </div>
                    <div id="file-upload" class="form-group">
                        <label for="import-file">选择 JSON 文件</label>
                        <input type="file" id="import-file" accept=".json,application/json" class="form-input">
                    </div>
                    <div id="json-input" class="form-group hidden">
                        <label for="import-json">JSON 数据</label>
                        <textarea id="import-json" class="form-input" rows="10" placeholder='{"bankName": "题库名称", "questions": [...]}'></textarea>
                    </div>
                    <button type="submit" class="btn btn-primary btn-lg" id="btn-do-import">${Icons.upload} 开始导入</button>
                </form>
                <div id="import-progress" class="import-progress hidden">
                    <div class="progress-bar"><div class="progress-fill" id="import-bar" style="width:0%"></div></div>
                    <div class="hint" id="import-status">准备中…</div>
                </div>
            </div></div>
            <div class="card"><div class="card-header"><h3>JSON 格式</h3></div><div class="card-body">
                <pre class="code-block">{
  "bankName": "题库名称",
  "description": "可选描述",
  "questions": [
    { "type": "single",    "stem": "题干", "options": ["A","B"], "answer": 0,     "explanation": "解析" },
    { "type": "multiple",  "stem": "题干", "options": ["A","B","C"], "answer": [0,2] },
    { "type": "truefalse", "stem": "题干", "options": ["对","错"],  "answer": 1 }
  ]
}</pre>
                <div class="hint">answer 为选项下标（从 0 开始）；多选题为下标数组。系统会分批提交，每批最多 ${API.IMPORT_BATCH_SIZE} 题。</div>
            </div></div>
        `;

        document.querySelectorAll('input[name="method"]').forEach((r) => {
            r.addEventListener('change', (e) => {
                document.getElementById('file-upload').classList.toggle('hidden', e.target.value !== 'file');
                document.getElementById('json-input').classList.toggle('hidden', e.target.value !== 'json');
            });
        });

        document.getElementById('import-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const method = document.querySelector('input[name="method"]:checked').value;

            let parsed;
            try {
                if (method === 'file') {
                    const file = document.getElementById('import-file').files[0];
                    if (!file) {
                        alert('请选择文件');
                        return;
                    }
                    parsed = JSON.parse(await file.text());
                } else {
                    const text = document.getElementById('import-json').value.trim();
                    if (!text) {
                        alert('请输入 JSON');
                        return;
                    }
                    parsed = JSON.parse(text);
                }
            } catch (err) {
                alert('JSON 解析失败：' + err.message);
                return;
            }

            if (!parsed || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
                alert('JSON 结构不正确：缺少非空的 questions 数组');
                return;
            }

            const bankName = parsed.bankName || parsed.bank_name || '导入题库';
            const progress = document.getElementById('import-progress');
            const bar = document.getElementById('import-bar');
            const status = document.getElementById('import-status');
            const submitBtn = document.getElementById('btn-do-import');

            progress.classList.remove('hidden');
            submitBtn.disabled = true;

            try {
                const result = await API.importQuestions(
                    bankName,
                    parsed.description || '',
                    parsed.questions,
                    (done, all) => {
                        bar.style.width = Math.round((done / all) * 100) + '%';
                        status.textContent = `已提交 ${done} / ${all} 题…`;
                    }
                );

                bar.style.width = '100%';
                status.textContent = `完成：成功导入 ${result.imported} 题`;

                if (result.errors && result.errors.length) {
                    const preview = result.errors
                        .slice(0, 10)
                        .map((x) => x.error)
                        .join('\n');
                    alert(
                        `导入完成，${result.imported} 题成功，${result.errors.length} 题失败：\n\n${preview}` +
                            (result.errors.length > 10 ? '\n…' : '')
                    );
                } else {
                    alert(`导入成功！共 ${result.imported} 道题目`);
                }

                if (result.bank_id) window.location.hash = '#/banks/' + result.bank_id;
            } catch (err) {
                alert('导入失败：' + err.message);
            } finally {
                submitBtn.disabled = false;
            }
        });
    },

    // ══════════════════════════════════════════════════════════
    // 用户管理
    // ══════════════════════════════════════════════════════════

    async loadUsers() {
        const c = document.getElementById('page-container');
        c.innerHTML = '<div class="loading">加载中...</div>';
        try {
            const users = await API.getUsers();
            c.innerHTML = `
                <div class="page-header">
                    <div><h1>用户管理</h1><div class="subtitle">共 ${users.length} 个用户</div></div>
                    <div class="header-actions"><button class="btn btn-primary" id="btn-add-user">${Icons['user-plus']} 添加用户</button></div>
                </div>
                <div class="card"><div class="card-body">
                    <div class="table-wrap"><table class="table">
                        <thead><tr><th>ID</th><th>用户名</th><th>显示名</th><th>角色</th><th>创建时间</th><th>操作</th></tr></thead>
                        <tbody>${users
                            .map(
                                (u) => `
                            <tr>
                                <td class="tnum">${u.id}</td>
                                <td>${esc(u.username)}</td>
                                <td>${esc(u.display_name)}</td>
                                <td><span class="role-badge ${u.role}">${u.role === 'admin' ? '管理员' : '普通用户'}</span></td>
                                <td class="tnum">${esc(u.created_at)}</td>
                                <td class="actions-cell">
                                    ${
                                        u.role !== 'admin'
                                            ? `<button class="btn btn-sm btn-ghost" data-reset-pw="${u.id}" title="重置密码">${Icons.key}</button>
                                               <button class="btn btn-sm btn-ghost" data-del-user="${u.id}" title="删除">${Icons.trash}</button>`
                                            : '<span class="text-secondary">—</span>'
                                    }
                                </td>
                            </tr>`
                            )
                            .join('')}</tbody>
                    </table></div>
                </div></div>
            `;

            document.getElementById('btn-add-user').onclick = () => this.showCreateUserModal();
            c.querySelectorAll('[data-reset-pw]').forEach((b) => {
                b.onclick = () => this.resetPassword(b.dataset.resetPw);
            });
            c.querySelectorAll('[data-del-user]').forEach((b) => {
                b.onclick = () => this.deleteUser(b.dataset.delUser);
            });
        } catch (error) {
            c.innerHTML = `<div class="error-msg">${esc(error.message)}</div>`;
        }
    },

    async showCreateUserModal() {
        const username = prompt('请输入用户名:');
        if (!username || !username.trim()) return;
        const displayName = prompt('请输入显示名:', username.trim());
        if (!displayName || !displayName.trim()) return;
        const password = prompt('请输入密码（至少 6 位）:');
        if (!password) return;

        try {
            await API.createUser({
                username: username.trim(),
                display_name: displayName.trim(),
                password: password,
                role: 'user',
            });
            this.loadUsers();
        } catch (error) {
            alert(error.message);
        }
    },

    async resetPassword(id) {
        const password = prompt('请输入新密码（至少 6 位）:');
        if (!password) return;
        try {
            await API.resetPassword(id, password);
            alert('密码重置成功，该用户已登录的会话已失效');
        } catch (error) {
            alert(error.message);
        }
    },

    async deleteUser(id) {
        if (!confirm('确定要删除这个用户吗？其错题本与练习记录也会一并删除。')) return;
        try {
            await API.deleteUser(id);
            this.loadUsers();
        } catch (error) {
            alert(error.message);
        }
    },

    // ══════════════════════════════════════════════════════════
    // 个人设置
    // ══════════════════════════════════════════════════════════

    loadProfile() {
        const c = document.getElementById('page-container');
        const u = this.currentUser;
        c.innerHTML = `
            <div class="page-header"><div><h1>个人设置</h1></div></div>
            <div class="card"><div class="card-body">
                <form id="profile-form">
                    <div class="form-group">
                        <label>用户名</label>
                        <input type="text" class="form-input" value="${esc(u.username)}" disabled>
                        <span class="hint">用户名不可修改</span>
                    </div>
                    <div class="form-group">
                        <label>角色</label>
                        <input type="text" class="form-input" value="${u.role === 'admin' ? '管理员' : '普通用户'}" disabled>
                    </div>
                    <div class="form-group">
                        <label for="profile-display-name">显示名</label>
                        <input type="text" id="profile-display-name" class="form-input" value="${esc(u.display_name)}" required maxlength="32">
                    </div>
                    <button type="submit" class="btn btn-primary">保存修改</button>
                </form>
            </div></div>

            <div class="card"><div class="card-body">
                <h3 class="card-section-title">修改密码</h3>
                <form id="password-form">
                    <div class="form-group">
                        <label for="old-password">当前密码</label>
                        <input type="password" id="old-password" class="form-input" required autocomplete="current-password">
                    </div>
                    <div class="form-group">
                        <label for="new-password">新密码</label>
                        <input type="password" id="new-password" class="form-input" required autocomplete="new-password">
                        <span class="hint">至少 6 位；修改后其它设备将被强制重新登录</span>
                    </div>
                    <button type="submit" class="btn btn-primary" id="btn-change-pw">修改密码</button>
                </form>
            </div></div>
        `;

        document.getElementById('profile-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('profile-display-name').value.trim();
            if (!name) {
                alert('显示名不能为空');
                return;
            }
            try {
                const res = await API.updateProfile(name);
                this.currentUser.display_name = name;
                if (res && res.user) this.currentUser = res.user;
                this.updateUserInfo();
                alert('保存成功');
            } catch (error) {
                alert(error.message);
            }
        });

        document.getElementById('password-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const oldPwd = document.getElementById('old-password').value;
            const newPwd = document.getElementById('new-password').value;
            if (!oldPwd || !newPwd) {
                alert('请填写完整');
                return;
            }
            if (newPwd.length < 6) {
                alert('新密码至少 6 位');
                return;
            }

            const btn = document.getElementById('btn-change-pw');
            btn.disabled = true;
            btn.textContent = '正在处理…';

            try {
                // 需要跑两次 600k 轮 PBKDF2（旧口令 + 新口令），耗时较明显
                await API.changePassword(oldPwd, newPwd);
                alert('密码修改成功');
                document.getElementById('old-password').value = '';
                document.getElementById('new-password').value = '';
            } catch (error) {
                alert(error.message);
            } finally {
                btn.disabled = false;
                btn.textContent = '修改密码';
            }
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
    },
};

document.addEventListener('DOMContentLoaded', () => App.init());
