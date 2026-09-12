const App = {
    currentUser: null,
    practiceData: null,
    practiceResult: null,
    touchStartX: 0,
    touchStartY: 0,

    init() {
        this.checkAuth();
        window.addEventListener('hashchange', () => this.route());
        document.getElementById('header-back').addEventListener('click', () => { window.history.back(); });
        this.route();
    },

    checkAuth() {
        const hash = window.location.hash || '#/';
        if (hash !== '#/login') {
            API.getMe().then(r => {
                this.currentUser = r.user;
                this.updateTabBar();
            }).catch(() => {
                window.location.hash = '#/login';
            });
        }
    },

    route() {
        const hash = window.location.hash || '#/';
        const path = hash.slice(1).split('?')[0];

        if (path !== '/login' && !this.currentUser) {
            API.getMe().then(r => {
                this.currentUser = r.user;
                this.handleRoute(path);
            }).catch(() => {
                window.location.hash = '#/login';
            });
            return;
        }
        this.handleRoute(path);
    },

    handleRoute(path) {
        const page = document.getElementById('page');
        const header = document.getElementById('header');
        const tabbar = document.getElementById('tabbar');
        const back = document.getElementById('header-back');
        const title = document.getElementById('header-title');

        // Tab bar visibility
        const noTab = ['/login', '/practice/do'].includes(path) || path.startsWith('/sessions/');
        tabbar.style.display = noTab ? 'none' : 'flex';

        // Header
        const noHeader = ['/login'].includes(path);
        header.style.display = noHeader ? 'none' : 'flex';

        // Back button
        const noBack = ['/', '/login', '/practice/pick', '/wrongbook', '/sessions', '/profile'].includes(path) || path.startsWith('/sessions/');
        const showBack = !noBack;
        back.style.display = showBlock(showBack);
        back.onclick = () => {
            if (path === '/practice/do' || path === '/practice/result' || path.startsWith('/sessions/')) {
                window.location.hash = '#/';
            } else {
                window.history.back();
            }
        };

        // Active tab
        document.querySelectorAll('.m-tab').forEach(t => {
            t.classList.toggle('active', t.getAttribute('href') === '#' + path ||
                (path === '/' && t.getAttribute('href') === '#/'));
        });

        // Route
        if (path === '/' || path === '') { this.renderDashboard(page, title); }
        else if (path === '/login') { this.renderLogin(page, header); }
        else if (path === '/practice/pick') { this.renderPracticePick(page, title); }
        else if (path === '/practice/do') { this.renderPracticeDo(page, title); }
        else if (path === '/practice/result') { this.renderPracticeResult(page, title); }
        else if (path === '/wrongbook') { this.renderWrongBook(page, title); }
        else if (path === '/sessions') { this.renderSessions(page, title); }
        else if (path.match(/^\/sessions\/\d+$/)) { this.renderSessionDetail(path.split('/')[2], page, title); }
        else if (path === '/profile') { this.renderProfile(page, title); }
        else { page.innerHTML = '<div class="m-empty"><p>页面不存在</p></div>'; }

        page.scrollTop = 0;
    },

    // ========== Login ==========
    renderLogin(page, header) {
        header.style.display = 'none';
        document.getElementById('tabbar').style.display = 'none';
        page.style.padding = '0';
        page.innerHTML = `
            <div class="m-login">
                <div class="m-login-card">
                    <div class="m-login-title">刷题宝</div>
                    <div class="m-login-subtitle">登录你的账号</div>
                    <form id="login-form">
                        <div class="m-field">
                            <label>用户名</label>
                            <input type="text" id="login-user" class="m-input" placeholder="请输入用户名" autocomplete="username" required>
                        </div>
                        <div class="m-field">
                            <label>密码</label>
                            <input type="password" id="login-pass" class="m-input" placeholder="请输入密码" autocomplete="current-password" required>
                        </div>
                        <button type="submit" class="m-btn m-btn-primary">登录</button>
                    </form>
                </div>
            </div>`;
        page.style.padding = '0';
        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const u = document.getElementById('login-user').value.trim();
            const p = document.getElementById('login-pass').value;
            if (!u || !p) return;
            try {
                const r = await API.login(u, p);
                this.currentUser = r.user;
                this.updateTabBar();
                page.style.padding = '';
                window.location.hash = '#/';
            } catch (err) { alert(err.message); }
        });
    },

    // ========== Dashboard ==========
    async renderDashboard(page, titleEl) {
        titleEl.textContent = '刷题宝';
        page.innerHTML = '<div class="m-loading"><div class="m-spinner"></div>加载中...</div>';
        try {
            const d = await API.getDashboard();
            page.innerHTML = `
                <div class="m-stats">
                    <div class="m-stat-card">
                        <div class="m-stat-icon teal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>
                        <div class="m-stat-value">${d.today_practice_count}</div>
                        <div class="m-stat-label">今日练习</div>
                    </div>
                    <div class="m-stat-card">
                        <div class="m-stat-icon green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
                        <div class="m-stat-value">${d.today_practice_count > 0 ? (d.today_accuracy * 100).toFixed(0) + '%' : '-'}</div>
                        <div class="m-stat-label">今日正确率</div>
                    </div>
                    <div class="m-stat-card">
                        <div class="m-stat-icon red"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
                        <div class="m-stat-value">${d.today_new_wrong}</div>
                        <div class="m-stat-label">今日错题</div>
                    </div>
                </div>
                ${d.today_wrong_per_bank.length > 0 ? `
                <div class="m-card m-mt-16">
                    <div class="m-card-header">今日错题分布</div>
                    ${d.today_wrong_per_bank.map(i => `
                        <div class="m-list-item">
                            <div class="m-list-item-content">
                                <div class="m-list-item-title">${i.bank_name}</div>
                            </div>
                            <div class="m-list-item-right m-text-danger">${i.count} 题</div>
                        </div>
                    `).join('')}
                </div>` : ''}
                <div class="m-card m-mt-16">
                    <a href="#/practice/pick" style="display:block;padding:16px;text-decoration:none;color:inherit;">
                        <div class="m-flex" style="align-items:center;gap:12px;">
                            <div style="width:44px;height:44px;border-radius:12px;background:var(--primary);color:white;display:flex;align-items:center;justify-content:center;">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:22px;height:22px;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                            </div>
                            <div><div class="m-fw-600">开始练习</div><div class="m-text-sm m-text-muted">选择题库开始刷题</div></div>
                            <div style="margin-left:auto;color:var(--gray-300);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;"><polyline points="9 18 15 12 9 6"/></svg></div>
                        </div>
                    </a>
                </div>`;
        } catch (err) { page.innerHTML = `<div class="m-empty"><p>${err.message}</p></div>`; }
    },

    // ========== Practice Pick ==========
    async renderPracticePick(page, titleEl) {
        titleEl.textContent = '选择题库';
        page.innerHTML = '<div class="m-loading"><div class="m-spinner"></div>加载中...</div>';
        try {
            const banks = await API.getBanks();
            page.innerHTML = banks.map(b => `
                <div class="m-card m-mb-12" style="cursor:pointer" data-id="${b.id}">
                    <div class="m-card-body">
                        <div class="m-flex-between m-mb-12">
                            <div class="m-fw-600" style="font-size:16px;">${b.name}</div>
                            <div class="m-text-sm m-text-muted">${b.question_count} 题</div>
                        </div>
                        <div class="m-flex m-gap-8" style="flex-wrap:wrap;">
                            <span class="m-badge m-badge-single">单选 ${b.single_count}</span>
                            <span class="m-badge m-badge-multiple">多选 ${b.multiple_count}</span>
                            <span class="m-badge m-badge-truefalse">判断 ${b.truefalse_count}</span>
                        </div>
                        <div class="m-mt-12">
                            <div class="m-config-row" id="config-${b.id}" style="display:none;">
                                <div class="m-config-item">
                                    <div class="m-config-label">单选</div>
                                    <div class="m-counter">
                                        <button class="m-counter-btn" data-bank="${b.id}" data-type="single" data-action="dec">-</button>
                                        <span class="m-counter-value" id="sv-${b.id}">10</span>
                                        <button class="m-counter-btn" data-bank="${b.id}" data-type="single" data-action="inc">+</button>
                                    </div>
                                </div>
                                <div class="m-config-item">
                                    <div class="m-config-label">多选</div>
                                    <div class="m-counter">
                                        <button class="m-counter-btn" data-bank="${b.id}" data-type="multiple" data-action="dec">-</button>
                                        <span class="m-counter-value" id="mv-${b.id}">0</span>
                                        <button class="m-counter-btn" data-bank="${b.id}" data-type="multiple" data-action="inc">+</button>
                                    </div>
                                </div>
                                <div class="m-config-item">
                                    <div class="m-config-label">判断</div>
                                    <div class="m-counter">
                                        <button class="m-counter-btn" data-bank="${b.id}" data-type="truefalse" data-action="dec">-</button>
                                        <span class="m-counter-value" id="tv-${b.id}">0</span>
                                        <button class="m-counter-btn" data-bank="${b.id}" data-type="truefalse" data-action="inc">+</button>
                                    </div>
                                </div>
                            </div>
                            <button class="m-btn m-btn-primary m-btn-sm start-practice m-hidden" id="start-${b.id}" data-id="${b.id}" style="margin-top:12px;">开始练习</button>
                        </div>
                    </div>
                </div>
            `).join('');

            // State
            const state = {};
            banks.forEach(b => { state[b.id] = { single: 10, multiple: 0, truefalse: 0 }; });

            // Toggle config
            page.querySelectorAll('.m-card[data-id]').forEach(card => {
                card.addEventListener('click', (e) => {
                    if (e.target.closest('.m-counter-btn') || e.target.closest('.start-practice')) return;
                    const id = card.dataset.id;
                    const cfg = document.getElementById('config-' + id);
                    const btn = document.getElementById('start-' + id);
                    const isOpen = cfg.style.display !== 'none';
                    cfg.style.display = isOpen ? 'none' : 'grid';
                    btn.classList.toggle('m-hidden', isOpen);
                });
            });

            // Counter
            page.querySelectorAll('.m-counter-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.bank;
                    const type = btn.dataset.type;
                    const inc = btn.dataset.action === 'inc';
                    state[id][type] = Math.max(0, state[id][type] + (inc ? 1 : -1));
                    document.getElementById(type[0] + 'v-' + id).textContent = state[id][type];
                });
            });

            // Start
            page.querySelectorAll('.start-practice').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const id = btn.dataset.id;
                    const s = state[id];
                    if (s.single + s.multiple + s.truefalse === 0) { alert('请至少选择一道题'); return; }
                    try {
                        this.practiceData = await API.pickQuestions({
                            bank_id: parseInt(id),
                            single_count: s.single,
                            multiple_count: s.multiple,
                            truefalse_count: s.truefalse,
                            mode: 'random'
                        });
                        window.location.hash = '#/practice/do';
                    } catch (err) { alert(err.message); }
                });
            });
        } catch (err) { page.innerHTML = `<div class="m-empty"><p>${err.message}</p></div>`; }
    },

    // ========== Practice Do ==========
    renderPracticeDo(page, titleEl) {
        titleEl.textContent = '答题';
        const data = this.practiceData;
        if (!data || !data.questions.length) { page.innerHTML = '<div class="m-empty"><p>没有练习数据</p></div>'; return; }

        const state = { idx: 0 };
        const answers = {};
        const total = data.questions.length;
        const self = this;

        const render = () => {
            const q = data.questions[state.idx];
            const sel = answers[q.id] !== undefined ? answers[q.id].selected : null;

            page.innerHTML = `
                <div class="m-practice-header">
                    <span>第 ${state.idx + 1} / ${total} 题</span>
                    <span style="cursor:pointer;color:var(--primary);" id="show-sheet">答题卡</span>
                </div>
                <div class="m-progress-bar"><div class="m-progress-fill" style="width:${((state.idx + 1) / total) * 100}%"></div></div>
                <div class="m-question-card">
                    <div class="m-question-stem">${q.stem}</div>
                    <div class="m-question-options">
                        ${q.options.map((opt, i) => `
                            <div class="m-option ${sel === i || (Array.isArray(sel) && sel.includes(i)) ? 'selected' : ''}" data-idx="${i}">
                                <div class="m-option-letter">${String.fromCharCode(65 + i)}</div>
                                <div class="m-option-text">${opt}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="m-practice-bar">
                    <button class="m-btn m-btn-secondary" id="btn-prev" ${state.idx === 0 ? 'disabled' : ''}>上一题</button>
                    <button class="m-btn m-btn-primary" id="btn-submit" style="background:var(--success);">提交</button>
                    <button class="m-btn m-btn-secondary" id="btn-next" ${state.idx === total - 1 ? 'disabled' : ''}>下一题</button>
                </div>`;

            // Option click
            page.querySelectorAll('.m-option').forEach(opt => {
                opt.addEventListener('click', () => {
                    const i = parseInt(opt.dataset.idx);
                    if (q.type === 'multiple') {
                        if (!answers[q.id]) answers[q.id] = { selected: [] };
                        const arr = answers[q.id].selected;
                        const pos = arr.indexOf(i);
                        if (pos > -1) arr.splice(pos, 1); else arr.push(i);
                    } else {
                        answers[q.id] = { selected: i };
                    }
                    render();
                });
            });

            // Navigation
            document.getElementById('btn-prev').addEventListener('click', () => { if (state.idx > 0) { state.idx--; render(); } });
            document.getElementById('btn-next').addEventListener('click', () => { if (state.idx < total - 1) { state.idx++; render(); } });
            document.getElementById('btn-submit').addEventListener('click', () => { self.submitPractice(data, answers); });

            // Show answer sheet
            document.getElementById('show-sheet').addEventListener('click', () => self.showSheet(data, answers, total, state, render));

            // Swipe
            self.enableSwipe(page, () => { if (state.idx < total - 1) { state.idx++; render(); } }, () => { if (state.idx > 0) { state.idx--; render(); } });
        };
        render();
    },

    showSheet(data, answers, total, state, rerender) {
        let navHtml = '';
        for (let i = 0; i < total; i++) {
            const q = data.questions[i];
            const a = answers[q.id];
            let cls = 'm-sheet-btn';
            if (a !== undefined) cls += ' answered';
            if (i === state.idx) cls += ' current';
            navHtml += `<button class="${cls}" data-idx="${i}">${i + 1}</button>`;
        }

        const answeredCount = Object.keys(answers).length;

        const mask = document.createElement('div');
        mask.className = 'm-drawer-mask';
        const drawer = document.createElement('div');
        drawer.className = 'm-drawer';
        drawer.innerHTML = `
            <div class="m-drawer-header">
                <span class="m-drawer-title">答题卡</span>
                <button class="m-drawer-close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
            <div class="m-drawer-body">
                <div class="m-sheet-legend">
                    <span class="m-sheet-legend-item"><span class="m-sheet-dot current"></span>当前</span>
                    <span class="m-sheet-legend-item"><span class="m-sheet-dot answered"></span>已答</span>
                    <span class="m-sheet-legend-item"><span class="m-sheet-dot"></span>未答</span>
                </div>
                <div class="m-sheet-grid">${navHtml}</div>
            </div>
            <div class="m-sheet-footer">
                <span class="m-text-sm m-text-muted">已答 ${answeredCount}/${total} 题</span>
                <button class="m-btn m-btn-primary" id="drawer-submit">提交试卷</button>
            </div>`;

        document.body.appendChild(mask);
        document.body.appendChild(drawer);

        const close = () => { mask.classList.remove('open'); drawer.classList.remove('open'); setTimeout(() => { mask.remove(); drawer.remove(); }, 300); };
        mask.addEventListener('click', close);
        drawer.querySelector('.m-drawer-close').addEventListener('click', close);
        drawer.querySelectorAll('.m-sheet-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                state.idx = parseInt(btn.dataset.idx);
                close();
                rerender();
            });
        });
        drawer.querySelector('#drawer-submit').addEventListener('click', () => { close(); self.submitPractice(data, answers); });

        requestAnimationFrame(() => { mask.classList.add('open'); drawer.classList.add('open'); });
    },

    enableSwipe(el, onSwipeLeft, onSwipeRight) {
        const h = (e) => {
            const t = e.touches[0];
            const dx = t.clientX - this.touchStartX;
            const dy = t.clientY - this.touchStartY;
            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
                if (dx < 0) onSwipeLeft(); else onSwipeRight();
                el.removeEventListener('touchend', h);
            }
        };
        el.ontouchstart = (e) => { this.touchStartX = e.touches[0].clientX; this.touchStartY = e.touches[0].clientY; };
        el.ontouchend = h;
    },

    async submitPractice(data, answers) {
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
        try {
            this.practiceResult = await API.submitPractice({
                bank_id: data.questions[0].bank_id,
                mode: data.isWrongBook ? 'wrongbook' : 'random',
                total_count: data.questions.length,
                answers: formatted
            });
            window.location.hash = '#/practice/result';
        } catch (err) { alert(err.message); }
    },

    // ========== Practice Result ==========
    renderPracticeResult(page, titleEl) {
        titleEl.textContent = '练习结果';
        document.getElementById('tabbar').style.display = 'none';
        const r = this.practiceResult;
        if (!r) { page.innerHTML = '<div class="m-empty"><p>没有结果</p></div>'; return; }

        const pct = Math.round(r.accuracy * 100);
        const circ = 2 * Math.PI * 70;
        const offset = circ - (pct / 100) * circ;

        page.innerHTML = `
            <div class="m-text-center m-mb-16" style="padding-top:24px;">
                <div class="m-result-ring">
                    <svg width="160" height="160">
                        <circle class="m-result-ring-bg" cx="80" cy="80" r="70"/>
                        <circle class="m-result-ring-fill" cx="80" cy="80" r="70"
                            stroke-dasharray="${circ}" stroke-dashoffset="${circ}"
                            style="transition-delay:0.3s"/>
                    </svg>
                    <div class="m-result-ring-text">
                        <div class="m-result-ring-value">${pct}%</div>
                        <div class="m-result-ring-label">正确率</div>
                    </div>
                </div>
                <div class="m-result-stats">
                    <div class="m-result-stat"><div class="m-result-stat-value">${r.total_count}</div><div class="m-result-stat-label">总题</div></div>
                    <div class="m-result-stat"><div class="m-result-stat-value correct">${r.correct_count}</div><div class="m-result-stat-label">正确</div></div>
                    <div class="m-result-stat"><div class="m-result-stat-value wrong">${r.wrong_count}</div><div class="m-result-stat-label">错误</div></div>
                </div>
            </div>
            <div class="m-result-actions">
                <button class="m-btn m-btn-secondary" id="result-back">返回首页</button>
                <button class="m-btn m-btn-primary" id="result-detail">查看详情</button>
            </div>`;

        setTimeout(() => {
            const ring = page.querySelector('.m-result-ring-fill');
            if (ring) ring.style.strokeDashoffset = offset;
        }, 100);

        document.getElementById('result-back').addEventListener('click', () => { window.location.hash = '#/'; });
        document.getElementById('result-detail').addEventListener('click', () => {
            window.location.hash = '#/sessions/' + r.session_id;
        });
    },

    // ========== Wrong Book ==========
    async renderWrongBook(page, titleEl) {
        titleEl.textContent = '错题本';
        page.innerHTML = '<div class="m-loading"><div class="m-spinner"></div>加载中...</div>';
        try {
            const records = await API.getWrongBook();
            if (records.length === 0) {
                page.innerHTML = '<div class="m-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg><p>暂无错题</p></div>';
                return;
            }
            page.innerHTML = `
                <div class="m-flex-between m-mb-16">
                    <div class="m-text-sm m-text-muted">共 ${records.length} 道错题</div>
                    <button class="m-btn m-btn-primary m-btn-sm" id="wrong-practice">练习错题</button>
                </div>
                ${records.map(r => `
                    <div class="m-wrong-item">
                        <div class="m-wrong-header">
                            <span class="m-badge ${r.type === 'single' ? 'm-badge-single' : r.type === 'multiple' ? 'm-badge-multiple' : 'm-badge-truefalse'}">${r.type === 'single' ? '单选' : r.type === 'multiple' ? '多选' : '判断'}</span>
                            <span class="m-text-sm m-text-muted">${r.bank_name}</span>
                        </div>
                        <div class="m-wrong-stem">${r.stem}</div>
                        <div class="m-wrong-footer">
                            <span class="m-wrong-meta">错 ${r.error_count} 次 · 对 ${r.correct_count || 0}/5</span>
                            <button class="m-btn m-btn-secondary m-btn-sm" onclick="App.removeWrong(${r.id})">移除</button>
                        </div>
                    </div>
                `).join('')}`;

            document.getElementById('wrong-practice').addEventListener('click', async () => {
                try {
                    const data = await API.pickWrongQuestions({ count: 20 });
                    if (!data.questions.length) { alert('错题本为空'); return; }
                    this.practiceData = { ...data, bank_id: 0, isWrongBook: true };
                    window.location.hash = '#/practice/do';
                } catch (err) { alert(err.message); }
            });
        } catch (err) { page.innerHTML = `<div class="m-empty"><p>${err.message}</p></div>`; }
    },

    async removeWrong(id) {
        if (!confirm('确定移除？')) return;
        await API.removeWrong(id);
        this.renderWrongBook(document.getElementById('page'), document.getElementById('header-title'));
    },

    // ========== Sessions ==========
    async renderSessions(page, titleEl) {
        titleEl.textContent = '练习记录';
        page.innerHTML = '<div class="m-loading"><div class="m-spinner"></div>加载中...</div>';
        try {
            const data = await API.getSessions();
            if (!data.sessions.length) {
                page.innerHTML = '<div class="m-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p>暂无练习记录</p></div>';
                return;
            }
            page.innerHTML = data.sessions.map(s => `
                <div class="m-session-item" onclick="window.location.hash='#/sessions/${s.id}'">
                    <div class="m-session-top">
                        <span class="m-session-time">${s.submitted_at}</span>
                        <span class="m-text-sm">${s.total_count} 题</span>
                    </div>
                    <div class="m-session-stats">
                        <span class="correct">正确 ${s.correct_count}</span>
                        <span class="wrong">错误 ${s.wrong_count}</span>
                        <span class="m-text-muted">${(s.correct_count / s.total_count * 100).toFixed(0)}%</span>
                    </div>
                </div>
            `).join('');
        } catch (err) { page.innerHTML = `<div class="m-empty"><p>${err.message}</p></div>`; }
    },

    // ========== Session Detail ==========
    async renderSessionDetail(id, page, titleEl) {
        titleEl.textContent = '答题详情';
        page.innerHTML = '<div class="m-loading"><div class="m-spinner"></div>加载中...</div>';
        try {
            const data = await API.getSession(id);
            let idx = 0;
            const answers = data.answers;
            const total = answers.length;

            const renderDetail = () => {
                const a = answers[idx];
                page.innerHTML = `
                    <div class="m-practice-header">
                        <span>第 ${idx + 1} / ${total} 题</span>
                        <span class="m-badge ${a.is_correct ? 'm-badge-correct' : 'm-badge-wrong'}">${a.is_correct ? '正确' : '错误'}</span>
                    </div>
                    <div class="m-progress-bar"><div class="m-progress-fill" style="width:${((idx + 1) / total) * 100}%"></div></div>
                    <div class="m-review-card ${a.is_correct ? 'correct' : 'wrong'}">
                        <div class="m-review-stem">${a.stem}</div>
                        ${a.options.map((opt, oi) => {
                            let cls = 'm-review-option';
                            if (oi === a.selected_answer) cls += a.is_correct ? ' correct' : ' wrong-selected';
                            if (oi === a.correct_answer && !a.is_correct) cls += ' correct';
                            return `<div class="${cls}">${String.fromCharCode(65 + oi)}. ${opt}</div>`;
                        }).join('')}
                        ${a.explanation ? `<div class="m-review-explanation"><strong>解析：</strong>${a.explanation}</div>` : ''}
                    </div>
                    <div class="m-practice-bar">
                        <button class="m-btn m-btn-secondary" id="det-prev" ${idx === 0 ? 'disabled' : ''}>上一题</button>
                        <button class="m-btn m-btn-primary" id="det-next">${idx === total - 1 ? '返回' : '下一题'}</button>
                    </div>`;

                document.getElementById('det-prev').addEventListener('click', () => { if (idx > 0) { idx--; renderDetail(); } });
                document.getElementById('det-next').addEventListener('click', () => {
                    if (idx < total - 1) { idx++; renderDetail(); }
                    else { window.location.hash = '#/sessions'; }
                });
            };
            renderDetail();
            this.enableSwipe(page, () => { if (idx < total - 1) { idx++; renderDetail(); } }, () => { if (idx > 0) { idx--; renderDetail(); } });
        } catch (err) { page.innerHTML = `<div class="m-empty"><p>${err.message}</p></div>`; }
    },

    // ========== Profile ==========
    renderProfile(page, titleEl) {
        titleEl.textContent = '我的';
        const u = this.currentUser;
        if (!u) return;
        page.innerHTML = `
            <div class="m-profile-header">
                <div class="m-profile-avatar">${(u.display_name || u.username)[0]}</div>
                <div class="m-profile-name">${u.display_name}</div>
                <div class="m-profile-role">${u.role === 'admin' ? '管理员' : '普通用户'}</div>
            </div>
            <div class="m-section-title">个人设置</div>
            <div class="m-card">
                <div class="m-card-body">
                    <form id="profile-form">
                        <div class="m-field">
                            <label>显示名</label>
                            <input type="text" id="p-name" class="m-input" value="${u.display_name}">
                        </div>
                        <button type="submit" class="m-btn m-btn-primary">保存</button>
                    </form>
                </div>
            </div>
            <div class="m-section-title m-mt-16">修改密码</div>
            <div class="m-card">
                <div class="m-card-body">
                    <form id="pwd-form">
                        <div class="m-field">
                            <label>当前密码</label>
                            <input type="password" id="p-oldpwd" class="m-input">
                        </div>
                        <div class="m-field">
                            <label>新密码</label>
                            <input type="password" id="p-newpwd" class="m-input">
                        </div>
                        <button type="submit" class="m-btn m-btn-primary">修改密码</button>
                    </form>
                </div>
            </div>
            <button class="m-btn m-btn-secondary m-mt-16" id="logout-btn" style="color:var(--danger);">退出登录</button>`;

        document.getElementById('profile-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('p-name').value.trim();
            if (!name) return;
            try { await API.updateProfile(name); this.currentUser.display_name = name; alert('保存成功'); } catch (err) { alert(err.message); }
        });
        document.getElementById('pwd-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const o = document.getElementById('p-oldpwd').value;
            const n = document.getElementById('p-newpwd').value;
            if (!o || !n) return;
            try { await API.changePassword(o, n); alert('修改成功'); document.getElementById('p-oldpwd').value = ''; document.getElementById('p-newpwd').value = ''; } catch (err) { alert(err.message); }
        });
        document.getElementById('logout-btn').addEventListener('click', async () => {
            await API.logout();
            this.currentUser = null;
            window.location.hash = '#/login';
        });
    },

    updateTabBar() {
        document.querySelectorAll('.m-tab').forEach(t => {
            const href = t.getAttribute('href');
            t.classList.toggle('active', href === (window.location.hash || '#/'));
        });
    }
};

function showBlock(v) { return v ? '' : 'none'; }

document.addEventListener('DOMContentLoaded', () => App.init());
