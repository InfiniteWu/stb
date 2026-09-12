/**
 * 二哥刷题宝 —— 移动端应用
 *
 * 本次重写修复的问题（编号对应迁移计划）：
 *   M1  innerHTML 未转义（存储型 XSS）→ 全部经 esc()
 *   M2  练习详情用 `oi === correct_answer` 比较，多选题恒不成立 → 归一化为数组
 *   M3  total_count 为 0 时显示 NaN% → 除零保护
 *   M4  前端判分 + 用 questions[0].bank_id 作会话归属 → 只上报 selected，服务端推导
 *   M5  checkAuth 与 route 首屏各发一次 getMe → 合并为一次
 *   M6  无「不会」按钮、无未答统计 → 与桌面端对齐
 */
const App = {
    currentUser: null,
    practiceData: null,
    practiceResult: null,
    touchStartX: 0,
    touchStartY: 0,

    // ══════════════════════════════════════════════════════════
    // 启动与路由
    // ══════════════════════════════════════════════════════════

    init() {
        this.hydrateIcons();
        window.addEventListener('hashchange', () => this.route());
        document.getElementById('header-back').addEventListener('click', () => window.history.back());

        // M5：首屏只请求一次 getMe，此前 checkAuth 与 route 各发一次
        this.bootstrap();
    },

    hydrateIcons(root) {
        const scope = root || document;
        scope.querySelectorAll('[data-icon]').forEach((el) => {
            const svg = Icons[el.getAttribute('data-icon')];
            if (svg) el.innerHTML = svg;
        });
    },

    async bootstrap() {
        const hash = window.location.hash || '#/';
        const path = hash.slice(1).split('?')[0];

        if (path !== '/login') {
            try {
                const r = await API.getMe();
                this.currentUser = r.user;
            } catch (e) {
                window.location.hash = '#/login';
                return;
            }
        }
        this.updateTabBar();
        this.handleRoute(path);
    },

    route() {
        const hash = window.location.hash || '#/';
        const path = hash.slice(1).split('?')[0];

        if (path !== '/login' && !this.currentUser) {
            API.getMe()
                .then((r) => {
                    this.currentUser = r.user;
                    this.handleRoute(path);
                })
                .catch(() => {
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

        const noTab = ['/login', '/practice/do'].indexOf(path) >= 0 || path.startsWith('/sessions/');
        tabbar.style.display = noTab ? 'none' : 'flex';

        const noHeader = path === '/login';
        header.style.display = noHeader ? 'none' : 'flex';

        // 详情页此前被排除在「显示返回箭头」之外，导致进去后无法中途退出，
        // 只能一路翻到最后一题才有返回按钮。现在恢复箭头。
        const noBack =
            ['/', '/login', '/practice/pick', '/wrongbook', '/sessions', '/profile'].indexOf(path) >= 0;
        back.style.display = noBack ? 'none' : '';

        back.onclick = () => {
            if (path.startsWith('/sessions/')) {
                // 回练习记录列表，而不是退回首页
                window.location.hash = '#/sessions';
            } else if (path === '/practice/do' || path === '/practice/result') {
                window.location.hash = '#/';
            } else {
                window.history.back();
            }
        };

        document.querySelectorAll('.m-tab').forEach((t) => {
            const href = t.getAttribute('href');
            t.classList.toggle('active', href === '#' + path || (path === '/' && href === '#/'));
        });

        page.style.padding = '';
        page.classList.remove('m-page--with-submit');
        page.classList.remove('m-page--with-actions');

        if (path === '/' || path === '') this.renderDashboard(page, title);
        else if (path === '/login') this.renderLogin(page, header);
        else if (path === '/practice/pick') this.renderPracticePick(page, title);
        else if (path === '/practice/do') this.renderPracticeDo(page, title);
        else if (path === '/practice/result') this.renderPracticeResult(page, title);
        else if (path === '/wrongbook') this.renderWrongBook(page, title);
        else if (path === '/sessions') this.renderSessions(page, title);
        else if (path.match(/^\/sessions\/\d+$/)) this.renderSessionDetail(path.split('/')[2], page, title);
        else if (path === '/profile') this.renderProfile(page, title);
        else page.innerHTML = '<div class="m-empty"><p>页面不存在</p></div>';

        this.hydrateIcons(page);
    },

    /** M3：total 为 0 时不再出现 NaN% */
    accuracyText(correct, total) {
        if (!total || total <= 0) return '—';
        return ((correct / total) * 100).toFixed(0) + '%';
    },

    // ══════════════════════════════════════════════════════════
    // 登录
    // ══════════════════════════════════════════════════════════

    renderLogin(page, header) {
        header.style.display = 'none';
        document.getElementById('tabbar').style.display = 'none';
        page.innerHTML = `
            <div class="m-login">
                <div class="m-login-card">
                    <div class="m-login-brand"><span data-icon="brand"></span></div>
                    <div class="m-login-title">二哥刷题宝</div>
                    <div class="m-login-subtitle">登录你的账号</div>
                    <form id="login-form">
                        <div class="m-field">
                            <label for="login-user">用户名</label>
                            <input type="text" id="login-user" class="m-input" placeholder="请输入用户名"
                                   autocomplete="username" required>
                        </div>
                        <div class="m-field">
                            <label for="login-pass">密码</label>
                            <input type="password" id="login-pass" class="m-input" placeholder="请输入密码"
                                   autocomplete="current-password" required>
                        </div>
                        <button type="submit" class="m-btn m-btn-primary" id="login-submit">登录</button>
                    </form>
                </div>
            </div>`;
        this.hydrateIcons(page);

        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const u = document.getElementById('login-user').value.trim();
            const p = document.getElementById('login-pass').value;
            if (!u || !p) return;

            const btn = document.getElementById('login-submit');
            btn.disabled = true;
            btn.textContent = '正在验证…';

            try {
                const r = await API.login(u, p);
                this.currentUser = r.user;
                this.updateTabBar();
                window.location.hash = '#/';
            } catch (err) {
                alert(err.message);
            } finally {
                btn.disabled = false;
                btn.textContent = '登录';
            }
        });
    },

    // ══════════════════════════════════════════════════════════
    // 仪表盘
    // ══════════════════════════════════════════════════════════

    async renderDashboard(page, titleEl) {
        titleEl.textContent = '二哥刷题宝';
        page.innerHTML = '<div class="m-loading"><div class="m-spinner"></div>加载中...</div>';
        try {
            const d = await API.getDashboard();
            const perBank = d.today_wrong_per_bank || [];

            page.innerHTML = `
                <div class="m-stats">
                    <div class="m-stat-card">
                        <div class="m-stat-icon teal"><span data-icon="target"></span></div>
                        <div class="m-stat-value tnum">${esc(d.today_practice_count)}</div>
                        <div class="m-stat-label">今日练习</div>
                    </div>
                    <div class="m-stat-card">
                        <div class="m-stat-icon green"><span data-icon="circle-check"></span></div>
                        <div class="m-stat-value tnum">${this.accuracyText(d.today_correct_count, d.today_practice_count)}</div>
                        <div class="m-stat-label">今日正确率</div>
                    </div>
                    <div class="m-stat-card">
                        <div class="m-stat-icon red"><span data-icon="circle-x"></span></div>
                        <div class="m-stat-value tnum">${esc(d.today_new_wrong)}</div>
                        <div class="m-stat-label">今日错题</div>
                    </div>
                </div>
                ${
                    perBank.length > 0
                        ? `<div class="m-card m-mt-16">
                             <div class="m-card-header">今日错题分布</div>
                             ${perBank
                                 .map(
                                     (i) => `
                                 <div class="m-list-item">
                                     <div class="m-list-item-content">
                                         <div class="m-list-item-title">${esc(i.bank_name)}</div>
                                     </div>
                                     <div class="m-list-item-right m-text-danger tnum">${esc(i.count)} 题</div>
                                 </div>`
                                 )
                                 .join('')}
                           </div>`
                        : ''
                }
                <div class="m-card m-mt-16">
                    <a href="#/practice/pick" class="m-entry-link">
                        <div class="m-entry-icon"><span data-icon="edit"></span></div>
                        <div>
                            <div class="m-fw-600">开始练习</div>
                            <div class="m-text-sm m-text-muted">选择题库开始刷题</div>
                        </div>
                        <div class="m-entry-arrow"><span data-icon="chevron-right"></span></div>
                    </a>
                </div>`;
            this.hydrateIcons(page);
        } catch (err) {
            page.innerHTML = `<div class="m-empty"><p>${esc(err.message)}</p></div>`;
        }
    },

    // ══════════════════════════════════════════════════════════
    // 选择题库与练习配置
    // ══════════════════════════════════════════════════════════

    async renderPracticePick(page, titleEl) {
        titleEl.textContent = '选择题库';
        page.innerHTML = '<div class="m-loading"><div class="m-spinner"></div>加载中...</div>';
        try {
            const banks = await API.getBanks();

            if (banks.length === 0) {
                page.innerHTML = '<div class="m-empty"><p>暂无题库</p></div>';
                return;
            }

            page.innerHTML = banks
                .map(
                    (b) => `
                <div class="m-card m-mb-12" data-id="${b.id}">
                    <div class="m-card-body">
                        <div class="m-flex-between m-mb-12">
                            <div class="m-fw-600 m-bank-name">${esc(b.name)}</div>
                            <div class="m-text-sm m-text-muted tnum">${b.question_count} 题</div>
                        </div>
                        <div class="m-flex m-gap-8 m-wrap">
                            <span class="m-badge">单选 ${b.single_count}</span>
                            <span class="m-badge">多选 ${b.multiple_count}</span>
                            <span class="m-badge">判断 ${b.truefalse_count}</span>
                        </div>
                        <div class="m-mt-12">
                            <div class="m-config-row" id="config-${b.id}" style="display:none;">
                                <div class="m-config-item">
                                    <div class="m-config-label">单选</div>
                                    <div class="m-counter">
                                        <button class="m-counter-btn" data-bank="${b.id}" data-type="single" data-action="dec">−</button>
                                        <span class="m-counter-value tnum" id="sv-${b.id}">10</span>
                                        <button class="m-counter-btn" data-bank="${b.id}" data-type="single" data-action="inc">+</button>
                                    </div>
                                </div>
                                <div class="m-config-item">
                                    <div class="m-config-label">多选</div>
                                    <div class="m-counter">
                                        <button class="m-counter-btn" data-bank="${b.id}" data-type="multiple" data-action="dec">−</button>
                                        <span class="m-counter-value tnum" id="mv-${b.id}">0</span>
                                        <button class="m-counter-btn" data-bank="${b.id}" data-type="multiple" data-action="inc">+</button>
                                    </div>
                                </div>
                                <div class="m-config-item">
                                    <div class="m-config-label">判断</div>
                                    <div class="m-counter">
                                        <button class="m-counter-btn" data-bank="${b.id}" data-type="truefalse" data-action="dec">−</button>
                                        <span class="m-counter-value tnum" id="tv-${b.id}">0</span>
                                        <button class="m-counter-btn" data-bank="${b.id}" data-type="truefalse" data-action="inc">+</button>
                                    </div>
                                </div>
                            </div>
                            <button class="m-btn m-btn-primary m-btn-sm start-practice m-hidden" id="start-${b.id}" data-id="${b.id}">开始练习</button>
                        </div>
                    </div>
                </div>`
                )
                .join('');

            const state = {};
            const caps = {};
            banks.forEach((b) => {
                state[b.id] = { single: Math.min(10, b.single_count), multiple: 0, truefalse: 0 };
                caps[b.id] = { single: b.single_count, multiple: b.multiple_count, truefalse: b.truefalse_count };
                const el = document.getElementById('sv-' + b.id);
                if (el) el.textContent = state[b.id].single;
            });

            page.querySelectorAll('.m-card[data-id]').forEach((card) => {
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

            page.querySelectorAll('.m-counter-btn').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.bank;
                    const type = btn.dataset.type;
                    const inc = btn.dataset.action === 'inc';
                    const cap = caps[id][type];
                    // 允许为 0，但不允许超过该题库该题型的实际题量
                    state[id][type] = Math.min(Math.max(0, state[id][type] + (inc ? 1 : -1)), cap);
                    document.getElementById(type[0] + 'v-' + id).textContent = state[id][type];
                });
            });

            page.querySelectorAll('.start-practice').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    const id = btn.dataset.id;
                    const s = state[id];
                    const total = s.single + s.multiple + s.truefalse;
                    if (total === 0) {
                        alert('请至少选择一道题');
                        return;
                    }
                    if (total > 100) {
                        alert('单次最多练习 100 道题');
                        return;
                    }
                    try {
                        this.practiceData = await API.pickQuestions({
                            bank_id: parseInt(id, 10),
                            single_count: s.single,
                            multiple_count: s.multiple,
                            truefalse_count: s.truefalse,
                            mode: 'random',
                        });
                        window.location.hash = '#/practice/do';
                    } catch (err) {
                        alert(err.message);
                    }
                });
            });
        } catch (err) {
            page.innerHTML = `<div class="m-empty"><p>${esc(err.message)}</p></div>`;
        }
    },

    // ══════════════════════════════════════════════════════════
    // 答题
    // ══════════════════════════════════════════════════════════

    renderPracticeDo(page, titleEl) {
        titleEl.textContent = '答题';
        document.getElementById('tabbar').style.display = 'none';
        // 提交按钮固定在屏幕底部，页面需相应多留出底部空间
        page.classList.add('m-page--with-submit');

        const data = this.practiceData;
        if (!data || !data.questions || !data.questions.length) {
            page.innerHTML = '<div class="m-empty"><p>没有练习数据</p></div>';
            return;
        }

        const state = { idx: 0 };
        const answers = {};
        const total = data.questions.length;
        const self = this;

        const answeredCount = () =>
            Object.keys(answers).filter((k) => answers[k] && answers[k].selected !== null).length;

        const render = () => {
            const q = data.questions[state.idx];
            const a = answers[q.id];
            const sel = a ? a.selected : null;
            const isSelected = (i) => sel === i || (Array.isArray(sel) && sel.indexOf(i) >= 0);

            page.innerHTML = `
                <div class="m-practice-header">
                    <span class="tnum">第 ${state.idx + 1} / ${total} 题</span>
                    <span class="m-link" id="show-sheet">答题卡</span>
                </div>
                <div class="m-progress-bar"><div class="m-progress-fill" style="width:${((state.idx + 1) / total) * 100}%"></div></div>
                <div class="m-question-card">
                    <div class="m-question-meta">
                        <span class="m-badge">${esc(this.getTypeLabel(q.type))}</span>
                    </div>
                    <div class="m-question-stem">${esc(q.stem)}</div>
                    <div class="m-question-options">
                        ${q.options
                            .map(
                                (opt, i) => `
                            <div class="m-option ${isSelected(i) ? 'selected' : ''}" data-idx="${i}">
                                <div class="m-option-letter">${String.fromCharCode(65 + i)}</div>
                                <div class="m-option-text">${esc(opt)}</div>
                            </div>`
                            )
                            .join('')}
                    </div>
                </div>
                <div class="m-action-area">
                    <div class="m-practice-bar">
                        <button class="m-btn m-btn-secondary" id="btn-prev" ${state.idx === 0 ? 'disabled' : ''}>上一题</button>
                        <button class="m-btn m-btn-ghost" id="btn-dontknow">不会</button>
                        <button class="m-btn m-btn-secondary" id="btn-next" ${state.idx === total - 1 ? 'disabled' : ''}>下一题</button>
                    </div>
                    <button class="m-btn m-btn-primary m-btn-submit" id="btn-submit">提交试卷</button>
                </div>`;

            page.querySelectorAll('.m-option').forEach((opt) => {
                opt.addEventListener('click', () => {
                    const i = parseInt(opt.dataset.idx, 10);
                    if (q.type === 'multiple') {
                        if (!answers[q.id] || !Array.isArray(answers[q.id].selected)) {
                            answers[q.id] = { selected: [] };
                        }
                        const arr = answers[q.id].selected;
                        const pos = arr.indexOf(i);
                        if (pos > -1) arr.splice(pos, 1);
                        else arr.push(i);
                    } else {
                        answers[q.id] = { selected: i };
                    }
                    render();
                });
            });

            document.getElementById('btn-prev').addEventListener('click', () => {
                if (state.idx > 0) {
                    state.idx--;
                    render();
                }
            });
            document.getElementById('btn-next').addEventListener('click', () => {
                if (state.idx < total - 1) {
                    state.idx++;
                    render();
                }
            });
            /** M6：与桌面端对齐，新增「不会」—— 记为未作答而非答错 */
            document.getElementById('btn-dontknow').addEventListener('click', () => {
                answers[q.id] = { selected: null };
                if (state.idx < total - 1) state.idx++;
                render();
            });
            document.getElementById('btn-submit').addEventListener('click', () => {
                self.submitPractice(data, answers);
            });
            document.getElementById('show-sheet').addEventListener('click', () => {
                self.showSheet(data, answers, total, state, render, answeredCount);
            });

            self.enableSwipe(
                page,
                () => {
                    if (state.idx < total - 1) {
                        state.idx++;
                        render();
                    }
                },
                () => {
                    if (state.idx > 0) {
                        state.idx--;
                        render();
                    }
                }
            );
        };
        render();
    },

    getTypeLabel(type) {
        const map = { single: '单选题', multiple: '多选题', truefalse: '判断题' };
        return map[type] || type;
    },

    showSheet(data, answers, total, state, rerender, answeredCount) {
        let navHtml = '';
        for (let i = 0; i < total; i++) {
            const q = data.questions[i];
            const a = answers[q.id];
            const answered = a !== undefined && a.selected !== null;
            let cls = 'm-sheet-btn';
            if (answered) cls += ' answered';
            if (i === state.idx) cls += ' current';
            navHtml += `<button class="${cls}" data-idx="${i}">${i + 1}</button>`;
        }

        const mask = document.createElement('div');
        mask.className = 'm-drawer-mask';
        const drawer = document.createElement('div');
        drawer.className = 'm-drawer';
        drawer.innerHTML = `
            <div class="m-drawer-header">
                <span class="m-drawer-title">答题卡</span>
                <button class="m-drawer-close" aria-label="关闭"><span data-icon="x"></span></button>
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
                <span class="m-text-sm m-text-muted tnum">已答 ${answeredCount()}/${total} 题</span>
                <button class="m-btn m-btn-primary" id="drawer-submit">提交试卷</button>
            </div>`;

        document.body.appendChild(mask);
        document.body.appendChild(drawer);
        this.hydrateIcons(drawer);

        const close = () => {
            mask.classList.remove('open');
            drawer.classList.remove('open');
            setTimeout(() => {
                mask.remove();
                drawer.remove();
            }, 300);
        };

        mask.addEventListener('click', close);
        drawer.querySelector('.m-drawer-close').addEventListener('click', close);
        drawer.querySelectorAll('.m-sheet-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.idx = parseInt(btn.dataset.idx, 10);
                close();
                rerender();
            });
        });
        drawer.querySelector('#drawer-submit').addEventListener('click', () => {
            close();
            this.submitPractice(data, answers);
        });

        requestAnimationFrame(() => {
            mask.classList.add('open');
            drawer.classList.add('open');
        });
    },

    /**
     * 详情页的答题卡抽屉。
     *
     * 与答题时的答题卡不同：这里按「正确 / 错误 / 未答」着色，
     * 目的是快速定位错题 —— 这正是用户反馈缺失的能力。
     */
    showReviewSheet(answers, total, currentIdx, onJump) {
        let wrongCount = 0;
        let correctCount = 0;
        let unansweredCount = 0;

        let navHtml = '';
        for (let i = 0; i < total; i++) {
            const a = answers[i];
            const unanswered = a.is_correct === null;
            let cls = 'm-sheet-btn';
            if (unanswered) {
                unansweredCount++;
                cls += ' unanswered';
            } else if (a.is_correct) {
                correctCount++;
                cls += ' correct';
            } else {
                wrongCount++;
                cls += ' wrong';
            }
            if (i === currentIdx) cls += ' current';
            navHtml += `<button class="${cls}" data-idx="${i}">${i + 1}</button>`;
        }

        const mask = document.createElement('div');
        mask.className = 'm-drawer-mask';
        const drawer = document.createElement('div');
        drawer.className = 'm-drawer';
        drawer.innerHTML = `
            <div class="m-drawer-header">
                <span class="m-drawer-title">答题卡</span>
                <button class="m-drawer-close" aria-label="关闭"><span data-icon="x"></span></button>
            </div>
            <div class="m-drawer-body">
                <div class="m-sheet-legend">
                    <span class="m-sheet-legend-item"><span class="m-sheet-dot current"></span>当前</span>
                    <span class="m-sheet-legend-item"><span class="m-sheet-dot correct"></span>正确 ${correctCount}</span>
                    <span class="m-sheet-legend-item"><span class="m-sheet-dot wrong"></span>错误 ${wrongCount}</span>
                    <span class="m-sheet-legend-item"><span class="m-sheet-dot"></span>未答 ${unansweredCount}</span>
                </div>
                <div class="m-sheet-grid">${navHtml}</div>
            </div>`;

        document.body.appendChild(mask);
        document.body.appendChild(drawer);
        this.hydrateIcons(drawer);

        const close = () => {
            mask.classList.remove('open');
            drawer.classList.remove('open');
            setTimeout(() => {
                mask.remove();
                drawer.remove();
            }, 300);
        };

        mask.addEventListener('click', close);
        drawer.querySelector('.m-drawer-close').addEventListener('click', close);
        drawer.querySelectorAll('.m-sheet-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const target = parseInt(btn.dataset.idx, 10);
                close();
                onJump(target);
            });
        });

        requestAnimationFrame(() => {
            mask.classList.add('open');
            drawer.classList.add('open');
        });
    },

    enableSwipe(el, onSwipeLeft, onSwipeRight) {
        el.ontouchstart = (e) => {
            this.touchStartX = e.touches[0].clientX;
            this.touchStartY = e.touches[0].clientY;
        };
        el.ontouchend = (e) => {
            const t = e.changedTouches[0];
            const dx = t.clientX - this.touchStartX;
            const dy = t.clientY - this.touchStartY;
            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
                if (dx < 0) onSwipeLeft();
                else onSwipeRight();
            }
        };
    },

    /**
     * M4：只上报 selected，判分与服务端归属推导由后端完成。
     * 旧实现把 questions[0].bank_id 当作会话题库，跨题库错题练习会记错。
     */
    async submitPractice(data, answers) {
        const payload = data.questions.map((q) => {
            const a = answers[q.id];
            const item = { question_id: q.id, selected: a ? a.selected : null };
            if (q.shuffle_token) item.shuffle_token = q.shuffle_token;
            return item;
        });

        try {
            this.practiceResult = await API.submitPractice({
                mode: data.mode || 'random',
                answers: payload,
            });
            window.location.hash = '#/practice/result';
        } catch (err) {
            alert(err.message);
        }
    },

    // ══════════════════════════════════════════════════════════
    // 结果
    // ══════════════════════════════════════════════════════════

    renderPracticeResult(page, titleEl) {
        titleEl.textContent = '练习结果';
        document.getElementById('tabbar').style.display = 'none';

        const r = this.practiceResult;
        if (!r) {
            page.innerHTML = '<div class="m-empty"><p>没有结果</p></div>';
            return;
        }

        const pct = Math.round((r.accuracy || 0) * 100);
        const circ = 2 * Math.PI * 70;
        const offset = circ - (pct / 100) * circ;

        page.innerHTML = `
            <div class="m-text-center m-mb-16 m-pt-24">
                <div class="m-result-ring">
                    <svg width="160" height="160" viewBox="0 0 160 160">
                        <circle class="m-result-ring-bg" cx="80" cy="80" r="70"/>
                        <circle class="m-result-ring-fill" cx="80" cy="80" r="70"
                            stroke-dasharray="${circ}" stroke-dashoffset="${circ}"
                            style="transition-delay:0.3s"/>
                    </svg>
                    <div class="m-result-ring-text">
                        <div class="m-result-ring-value tnum">${pct}%</div>
                        <div class="m-result-ring-label">正确率</div>
                    </div>
                </div>
                <div class="m-result-stats">
                    <div class="m-result-stat"><div class="m-result-stat-value tnum">${r.total_count}</div><div class="m-result-stat-label">总题</div></div>
                    <div class="m-result-stat"><div class="m-result-stat-value correct tnum">${r.correct_count}</div><div class="m-result-stat-label">正确</div></div>
                    <div class="m-result-stat"><div class="m-result-stat-value wrong tnum">${r.wrong_count}</div><div class="m-result-stat-label">错误</div></div>
                    <div class="m-result-stat"><div class="m-result-stat-value unanswered tnum">${r.unanswered_count}</div><div class="m-result-stat-label">未答</div></div>
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

        document.getElementById('result-back').addEventListener('click', () => {
            window.location.hash = '#/';
        });
        document.getElementById('result-detail').addEventListener('click', () => {
            window.location.hash = '#/sessions/' + r.session_id;
        });
    },

    // ══════════════════════════════════════════════════════════
    // 错题本
    // ══════════════════════════════════════════════════════════

    async renderWrongBook(page, titleEl) {
        titleEl.textContent = '错题本';
        page.innerHTML = '<div class="m-loading"><div class="m-spinner"></div>加载中...</div>';
        try {
            const records = await API.getWrongBook();
            if (records.length === 0) {
                page.innerHTML = `<div class="m-empty"><span data-icon="circle-check"></span><p>暂无错题</p></div>`;
                this.hydrateIcons(page);
                return;
            }

            page.innerHTML = `
                <div class="m-flex-between m-mb-16">
                    <div class="m-text-sm m-text-muted tnum">共 ${records.length} 道错题</div>
                    <button class="m-btn m-btn-primary m-btn-sm" id="wrong-practice">练习错题</button>
                </div>
                ${records
                    .map(
                        (r) => `
                    <div class="m-wrong-item">
                        <div class="m-wrong-header">
                            <span class="m-badge">${esc(this.getTypeLabel(r.type))}</span>
                            <span class="m-text-sm m-text-muted">${esc(r.bank_name)}</span>
                        </div>
                        <div class="m-wrong-stem">${esc(r.stem)}</div>
                        <div class="m-wrong-footer">
                            <span class="m-wrong-meta tnum">错 ${esc(r.error_count)} 次 · 对 ${esc(r.correct_count || 0)}/5</span>
                            <button class="m-btn m-btn-secondary m-btn-sm" data-remove-wrong="${r.id}">移除</button>
                        </div>
                    </div>`
                    )
                    .join('')}`;

            document.getElementById('wrong-practice').addEventListener('click', async () => {
                try {
                    const data = await API.pickWrongQuestions({ count: 20 });
                    if (!data.questions || !data.questions.length) {
                        alert('错题本为空');
                        return;
                    }
                    // M4：不再伪造 bank_id
                    this.practiceData = { questions: data.questions, mode: 'wrongbook' };
                    window.location.hash = '#/practice/do';
                } catch (err) {
                    alert(err.message);
                }
            });

            page.querySelectorAll('[data-remove-wrong]').forEach((b) => {
                b.addEventListener('click', async () => {
                    if (!confirm('确定移除？')) return;
                    try {
                        await API.removeWrong(b.dataset.removeWrong);
                        this.renderWrongBook(page, titleEl);
                    } catch (err) {
                        alert(err.message);
                    }
                });
            });
        } catch (err) {
            page.innerHTML = `<div class="m-empty"><p>${esc(err.message)}</p></div>`;
        }
    },

    // ══════════════════════════════════════════════════════════
    // 练习记录
    // ══════════════════════════════════════════════════════════

    async renderSessions(page, titleEl) {
        titleEl.textContent = '练习记录';
        page.innerHTML = '<div class="m-loading"><div class="m-spinner"></div>加载中...</div>';
        try {
            const data = await API.getSessions({ page: 1, per_page: 50 });
            if (!data.sessions.length) {
                page.innerHTML = `<div class="m-empty"><span data-icon="inbox"></span><p>暂无练习记录</p></div>`;
                this.hydrateIcons(page);
                return;
            }

            page.innerHTML = data.sessions
                .map(
                    (s) => `
                <div class="m-session-item" data-session="${s.id}">
                    <div class="m-session-top">
                        <span class="m-session-time tnum">${esc(s.submitted_at)}</span>
                        <span class="m-text-sm tnum">${s.total_count} 题</span>
                    </div>
                    <div class="m-session-bank">${esc(s.bank_name)}</div>
                    <div class="m-session-stats">
                        <span class="correct tnum">正确 ${s.correct_count}</span>
                        <span class="wrong tnum">错误 ${s.wrong_count}</span>
                        <span class="m-text-muted tnum">未答 ${s.unanswered_count || 0}</span>
                        <span class="m-text-muted tnum">${this.accuracyText(s.correct_count, s.total_count)}</span>
                    </div>
                </div>`
                )
                .join('');

            page.querySelectorAll('[data-session]').forEach((el) => {
                el.addEventListener('click', () => {
                    window.location.hash = '#/sessions/' + el.dataset.session;
                });
            });
        } catch (err) {
            page.innerHTML = `<div class="m-empty"><p>${esc(err.message)}</p></div>`;
        }
    },

    // ══════════════════════════════════════════════════════════
    // 练习详情
    // ══════════════════════════════════════════════════════════

    async renderSessionDetail(id, page, titleEl) {
        titleEl.textContent = '答题详情';
        // 底部有常驻的上一题/下一题操作区，页面需相应留白
        page.classList.add('m-page--with-actions');
        page.innerHTML = '<div class="m-loading"><div class="m-spinner"></div>加载中...</div>';
        try {
            const data = await API.getSession(id);
            let idx = 0;
            const answers = data.answers;
            const total = answers.length;

            if (total === 0) {
                page.innerHTML = '<div class="m-empty"><p>这次练习没有作答明细</p></div>';
                return;
            }

            /** M2：正确答案与用户选择都可能是数组，必须归一化后再比较 */
            const toIndexArray = (v) => {
                if (v === null || v === undefined) return [];
                return Array.isArray(v) ? v : [v];
            };

            const self = this;

            const renderDetail = () => {
                const a = answers[idx];
                const correctIdxs = toIndexArray(a.correct_answer);
                const selectedIdxs = toIndexArray(a.selected_answer);
                const unanswered = a.is_correct === null && selectedIdxs.length === 0;
                const statusText = unanswered ? '未作答' : a.is_correct ? '正确' : '错误';
                const statusCls = unanswered ? 'unanswered' : a.is_correct ? 'correct' : 'wrong';

                page.innerHTML = `
                    <div class="m-practice-header">
                        <span class="tnum">第 ${idx + 1} / ${total} 题</span>
                        <span class="m-link" id="show-review-sheet">答题卡</span>
                    </div>
                    <div class="m-progress-bar"><div class="m-progress-fill" style="width:${((idx + 1) / total) * 100}%"></div></div>
                    <div class="m-review-card ${statusCls}">
                        <div class="m-review-stem">${esc(a.stem)}</div>
                        ${a.options
                            .map((opt, oi) => {
                                const isCorrect = correctIdxs.indexOf(oi) >= 0;
                                const isSelected = selectedIdxs.indexOf(oi) >= 0;
                                let cls = 'm-review-option';
                                if (isCorrect) cls += ' correct';
                                if (isSelected && !isCorrect) cls += ' wrong-selected';
                                return `<div class="${cls}">${String.fromCharCode(65 + oi)}. ${esc(opt)}</div>`;
                            })
                            .join('')}
                        ${a.explanation ? `<div class="m-review-explanation"><strong>解析：</strong>${esc(a.explanation)}</div>` : ''}
                    </div>
                    <div class="m-action-area">
                        <div class="m-practice-bar">
                            <button class="m-btn m-btn-primary" id="det-prev" ${idx === 0 ? 'disabled' : ''}>上一题</button>
                            <button class="m-btn m-btn-primary" id="det-next" ${idx === total - 1 ? 'disabled' : ''}>下一题</button>
                        </div>
                    </div>`;

                document.getElementById('det-prev').addEventListener('click', () => {
                    if (idx > 0) {
                        idx--;
                        renderDetail();
                    }
                });
                document.getElementById('det-next').addEventListener('click', () => {
                    if (idx < total - 1) {
                        idx++;
                        renderDetail();
                    }
                });
                document.getElementById('show-review-sheet').addEventListener('click', () => {
                    self.showReviewSheet(answers, total, idx, (target) => {
                        idx = target;
                        renderDetail();
                    });
                });
            };

            renderDetail();
            this.enableSwipe(
                page,
                () => {
                    if (idx < total - 1) {
                        idx++;
                        renderDetail();
                    }
                },
                () => {
                    if (idx > 0) {
                        idx--;
                        renderDetail();
                    }
                }
            );
        } catch (err) {
            page.innerHTML = `<div class="m-empty"><p>${esc(err.message)}</p></div>`;
        }
    },

    // ══════════════════════════════════════════════════════════
    // 个人设置
    // ══════════════════════════════════════════════════════════

    renderProfile(page, titleEl) {
        titleEl.textContent = '我的';
        const u = this.currentUser;
        if (!u) return;

        const name = u.display_name || u.username;

        page.innerHTML = `
            <div class="m-profile-header">
                <div class="m-profile-avatar">${esc(name.charAt(0).toUpperCase())}</div>
                <div class="m-profile-name">${esc(name)}</div>
                <div class="m-profile-role">${u.role === 'admin' ? '管理员' : '普通用户'}</div>
            </div>
            <div class="m-section-title">个人设置</div>
            <div class="m-card">
                <div class="m-card-body">
                    <form id="profile-form">
                        <div class="m-field">
                            <label for="p-name">显示名</label>
                            <input type="text" id="p-name" class="m-input" value="${esc(u.display_name)}" maxlength="32">
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
                            <label for="p-oldpwd">当前密码</label>
                            <input type="password" id="p-oldpwd" class="m-input" autocomplete="current-password">
                        </div>
                        <div class="m-field">
                            <label for="p-newpwd">新密码</label>
                            <input type="password" id="p-newpwd" class="m-input" autocomplete="new-password">
                        </div>
                        <button type="submit" class="m-btn m-btn-primary" id="btn-change-pw">修改密码</button>
                    </form>
                </div>
            </div>
            <button class="m-btn m-btn-secondary m-mt-16 m-btn-danger-text" id="logout-btn">退出登录</button>`;

        document.getElementById('profile-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const n = document.getElementById('p-name').value.trim();
            if (!n) return;
            try {
                await API.updateProfile(n);
                this.currentUser.display_name = n;
                alert('保存成功');
            } catch (err) {
                alert(err.message);
            }
        });

        document.getElementById('pwd-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const o = document.getElementById('p-oldpwd').value;
            const n = document.getElementById('p-newpwd').value;
            if (!o || !n) return;
            if (n.length < 6) {
                alert('新密码至少 6 位');
                return;
            }

            const btn = document.getElementById('btn-change-pw');
            btn.disabled = true;
            btn.textContent = '正在处理…';
            try {
                await API.changePassword(o, n);
                alert('修改成功');
                document.getElementById('p-oldpwd').value = '';
                document.getElementById('p-newpwd').value = '';
            } catch (err) {
                alert(err.message);
            } finally {
                btn.disabled = false;
                btn.textContent = '修改密码';
            }
        });

        document.getElementById('logout-btn').addEventListener('click', async () => {
            try {
                await API.logout();
            } catch (e) {
                /* 登出幂等 */
            }
            this.currentUser = null;
            window.location.hash = '#/login';
        });
    },

    updateTabBar() {
        document.querySelectorAll('.m-tab').forEach((t) => {
            t.classList.toggle('active', t.getAttribute('href') === (window.location.hash || '#/'));
        });
    },
};

document.addEventListener('DOMContentLoaded', () => App.init());
