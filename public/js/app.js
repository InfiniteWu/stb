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

/**
 * 是否「未作答」——与服务端 lib/grade.ts 的 isUnanswered 保持同一口径：
 * null / undefined / 空数组都算未作答。
 *
 * 注意空数组这一条：多选题里把已选项全部取消后会得到 `[]`，界面各处原先用
 * `selected !== null` 判断，会把它算成「已答」，而服务端计为「未答」，
 * 导致交卷后的结果页与作答时的「未答」统计对不上。这里统一按服务端口径。
 */
const isUnansweredSelection = (selected) =>
    selected === null || selected === undefined || (Array.isArray(selected) && selected.length === 0);

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
        this.hideLoading();
        document.getElementById('login-page').classList.remove('hidden');
        document.getElementById('main-app').classList.add('hidden');
        this.loadLoginStats();
    },

    /**
     * 登录页左侧数据条。
     * 数字来自公开只读接口；取不到就保持隐藏 —— 不编数据（原来插画上的
     * 「68%」与「错题本 ×1」就是这么来的，已随插画删除）。
     */
    async loadLoginStats() {
        const box = document.getElementById('login-stats');
        if (!box || this._loginStatsLoaded) return;
        try {
            const stats = await API.getPublicStats();
            const fmt = (n) => Number(n || 0).toLocaleString('zh-CN');
            document.getElementById('login-stat-q').textContent = fmt(stats.question_count);
            document.getElementById('login-stat-b').textContent = fmt(stats.bank_count);
            document.getElementById('login-stat-p').textContent = fmt(stats.practice_count);
            box.classList.remove('hidden');
            this._loginStatsLoaded = true;
        } catch (e) {
            box.classList.add('hidden');
        }
    },

    /** 登录失败的内联提示（替代原来的 alert） */
    setLoginError(message) {
        const box = document.getElementById('login-error');
        if (!box) return;
        box.textContent = message || '登录失败，请稍后重试';
        box.classList.remove('hidden');
    },

    clearLoginError() {
        const box = document.getElementById('login-error');
        if (!box) return;
        box.textContent = '';
        box.classList.add('hidden');
    },

    /** 缺字段时的水平抖动；动画结束即移除类，便于重复触发 */
    shakeField(input) {
        const wrap = input.closest('.field-wrap');
        if (!wrap) return;
        wrap.classList.remove('shake');
        void wrap.offsetWidth; // 强制重排，让动画能重新开始
        wrap.classList.add('shake');
        wrap.addEventListener('animationend', () => wrap.classList.remove('shake'), { once: true });
    },

    showMainApp() {
        this.hideLoading();
        document.getElementById('login-page').classList.add('hidden');
        document.getElementById('main-app').classList.remove('hidden');
        this.updateUserInfo();
        this.updateAdminVisibility();
        this.initLogout();
    },

    /**
     * 移除首屏加载指示。
     *
     * index.html 的首屏默认内容就是这个加载指示（登录页默认 hidden），
     * 因为鉴权要等一次 /api/auth/me 往返 —— 否则已登录用户会先看到登录页
     * 一闪而过。鉴权结果出来后由下面两个方法移除它。
     */
    hideLoading() {
        const el = document.getElementById('app-loading');
        if (el) el.remove();
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

        const userInput = document.getElementById('username');
        const passInput = document.getElementById('password');
        const remember = document.getElementById('remember-me');
        const btn = document.getElementById('login-submit');

        // 密码显隐
        const eye = document.getElementById('toggle-password');
        eye.addEventListener('click', () => {
            const show = passInput.type === 'password';
            passInput.type = show ? 'text' : 'password';
            eye.setAttribute('data-icon', show ? 'eye-off' : 'eye');
            eye.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
            eye.setAttribute('aria-pressed', show ? 'true' : 'false');
            this.hydrateIcons(eye.parentElement);
        });

        // 「忘记密码？」与「联系管理员开通」开同一个说明弹框。
        // 桌面端不用 sms: —— 浏览器基本没有 SMS 处理器。
        const dialog = document.getElementById('contact-dialog');
        const openContact = () => dialog.showModal();
        document.getElementById('open-contact').addEventListener('click', openContact);
        document.getElementById('open-contact-2').addEventListener('click', openContact);
        document.getElementById('contact-close').addEventListener('click', () => dialog.close());
        // 原生 dialog 不默认支持点遮罩关闭：点遮罩时事件目标就是 dialog 本身
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) dialog.close();
        });

        // 用户一开始输入就撤掉上一次的失败提示
        [userInput, passInput].forEach((input) => {
            input.addEventListener('input', () => this.clearLoginError());
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = userInput.value.trim();
            const password = passInput.value;
            const originalText = btn ? btn.textContent : '';

            this.clearLoginError();

            // 缺字段不再静默 return，抖一下并聚焦到该字段
            if (!username) {
                this.shakeField(userInput);
                userInput.focus();
                return;
            }
            if (!password) {
                this.shakeField(passInput);
                passInput.focus();
                return;
            }

            // 客户端要跑 600k 轮 PBKDF2（约 200ms），给出明确反馈
            if (btn) {
                btn.disabled = true;
                btn.textContent = '正在验证…';
            }

            try {
                // 「记住我」不勾选 → 服务端下发会话 Cookie，关掉浏览器下次要重新登录
                const result = await API.login(username, password, remember.checked);
                this.currentUser = result.user;
                form.reset();
                this.showMainApp();
                window.location.hash = '#/';
            } catch (error) {
                // 不再 form.reset() —— 旧实现失败时把用户名和密码一起清掉，
                // 用户得整段重输。现在只清密码、保留用户名，并把光标放回密码框。
                passInput.value = '';
                this.setLoginError(error.message);
                passInput.focus();
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
        else if (path === '/recite') this.loadRecite();
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

    /**
     * 页面 banner。
     *
     * 每个分页面顶部统一使用（答题页除外 —— 那里要把纵向空间全留给题目）。
     * 背景由渐变、网格、光晕、文字遮罩四层构成，图标取自 Icons 模块，
     * 因此图标仍然只有一份定义。
     *
     * @param {object} o
     * @param {string} o.icon       Icons 中的图标名
     * @param {string} o.title      标题
     * @param {string} [o.subtitle] 副标题
     * @param {string} [o.actions]  右侧操作区 HTML
     */
    banner({ icon, title, subtitle, actions }) {
        return `
            <section class="page-banner">
                <div class="page-banner-bg" aria-hidden="true"></div>
                <div class="page-banner-scrim" aria-hidden="true"></div>
                <div class="page-banner-inner">
                    <div class="page-banner-icon">${Icons[icon] || Icons.brand}</div>
                    <div class="page-banner-text">
                        <h1>${esc(title)}</h1>
                        ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
                    </div>
                    ${actions ? `<div class="page-banner-actions">${actions}</div>` : ''}
                </div>
            </section>
        `;
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
            const trend = Array.isArray(data.trend) ? data.trend : [];
            const recent = data.recent_session;
            const wrongCount = data.wrong_active_count || 0;

            // 趋势摘要按整体算（总答对 / 总作答），不是把 7 天的百分比再平均 ——
            // 否则练习量少的那天权重会被放大
            const daysWithPractice = trend.filter((t) => t.accuracy !== null).length;
            const answeredSum = trend.reduce((sum, t) => sum + (t.answered || 0), 0);
            const correctSum = trend.reduce((sum, t) => sum + (t.correct || 0), 0);
            const avgAccuracy = answeredSum > 0 ? correctSum / answeredSum : null;

            c.innerHTML = `
                ${this.banner({ icon: 'dashboard', title: '仪表盘', subtitle: '今日学习概览' })}
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
                <div class="dashboard-grid">
                    <div class="card dashboard-panel">
                        <div class="card-header"><h3>最近练习</h3></div>
                        <div class="card-body">
                            ${
                                recent
                                    ? `<div class="recent-session">
                                           <div>
                                               <div class="recent-session-bank">${esc(recent.bank_name)}</div>
                                               <div class="recent-session-meta tnum">${esc(recent.submitted_at)} · 共 ${esc(recent.total_count)} 题</div>
                                           </div>
                                           <div class="recent-session-score tnum">${this.accuracyText(recent.correct_count, recent.total_count)}</div>
                                       </div>
                                       <button class="btn btn-secondary btn-block" id="btn-recent">查看详情</button>`
                                    : `<div class="empty-state">${Icons.inbox}<p>还没有练习记录</p></div>
                                       <button class="btn btn-primary btn-block" id="btn-start-practice">开始第一次练习</button>`
                            }
                        </div>
                    </div>
                    <div class="card dashboard-panel">
                        <div class="card-header"><h3>最近 7 天正确率</h3></div>
                        <div class="card-body">
                            ${trend.length > 0 ? `<svg class="trend-chart" id="trend-chart" role="img" aria-label="最近 7 天正确率趋势"></svg>` : ''}
                            <div class="trend-meta">
                                ${
                                    avgAccuracy === null
                                        ? '最近 7 天还没有练习记录'
                                        : `7 天平均正确率 <b class="tnum">${Math.round(avgAccuracy * 100)}%</b> · 练习 <b class="tnum">${daysWithPractice}</b> 天`
                                }
                            </div>
                        </div>
                    </div>
                </div>
                <div class="card review-card${wrongCount > 0 ? ' is-active' : ''}">
                    <div class="card-body review-body">
                        <div class="review-icon">${Icons['circle-x']}</div>
                        <div class="review-main">
                            <div class="review-title">${wrongCount > 0 ? `有 ${esc(wrongCount)} 道错题待复习` : '暂无错题'}</div>
                            <div class="review-desc">${
                                wrongCount > 0
                                    ? '趁热打铁，把错题再过一遍'
                                    : '继续保持 —— 答错的题会自动收进错题本'
                            }</div>
                        </div>
                        ${wrongCount > 0 ? `<button class="btn btn-primary" id="btn-review">去复习错题</button>` : ''}
                    </div>
                </div>
            `;

            // 内联 SVG 的尺寸要等插入 DOM 之后才量得到，所以趋势图放在这里画
            const trendSvg = document.getElementById('trend-chart');
            if (trendSvg) this.paintTrend(trendSvg, trend);

            const btnRecent = document.getElementById('btn-recent');
            if (btnRecent && recent) {
                btnRecent.onclick = () => {
                    window.location.hash = '#/sessions/' + recent.id;
                };
            }
            const btnStartPractice = document.getElementById('btn-start-practice');
            if (btnStartPractice) {
                btnStartPractice.onclick = () => {
                    window.location.hash = '#/practice/pick';
                };
            }
            const btnReview = document.getElementById('btn-review');
            if (btnReview) {
                btnReview.onclick = () => {
                    window.location.hash = '#/wrongbook';
                };
            }
        } catch (error) {
            c.innerHTML = `<div class="error-msg">${esc(error.message)}</div>`;
        }
    },

    /**
     * 画「最近 7 天正确率」折线。
     *
     * 两个必须绕开的坑：
     *   1. CSP 是 style-src 'self'，内联 style 属性会被直接丢弃 ——
     *      描边/填充/粗细一律写在 CSS 类里，坐标只走 SVG 属性。
     *   2. SVG 不能拉伸：viewBox 与显示尺寸不一致时，preserveAspectRatio
     *      用 meet 会在两侧留大片空白，用 none 会把圆点压成椭圆。
     *      所以按容器实测宽度生成像素坐标，让 viewBox 与显示尺寸 1:1。
     */
    paintTrend(svg, trend) {
        const H = 80;
        const PAD_X = 10;
        const PAD_Y = 12;
        const W = Math.max(160, Math.round(svg.clientWidth || 320));
        const n = trend.length;

        const points = [];
        trend.forEach((t, i) => {
            if (t.accuracy === null || t.accuracy === undefined) return;
            points.push({
                x: PAD_X + (i * (W - PAD_X * 2)) / Math.max(1, n - 1),
                y: H - PAD_Y - t.accuracy * (H - PAD_Y * 2),
            });
        });

        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        const base = `<line class="trend-base" x1="${PAD_X}" y1="${H - PAD_Y}" x2="${W - PAD_X}" y2="${H - PAD_Y}" />`;
        // 只有一个数据点时画不出线，只留点
        const line =
            points.length >= 2
                ? `<polyline class="trend-line" points="${points
                      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
                      .join(' ')}" />`
                : '';
        const dots = points
            .map(
                (p) =>
                    `<circle class="trend-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" />`,
            )
            .join('');

        svg.innerHTML = base + line + dots;
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
                ${this.banner({
                    icon: 'book-stack',
                    title: '题库管理',
                    subtitle: `共 ${banks.length} 个题库`,
                    actions: isAdmin ? `<button class="btn btn-primary" id="btn-create-bank">${Icons.plus} 新建题库</button>` : '',
                })}
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
                ${this.banner({
                    icon: 'book',
                    title: bank.name,
                    subtitle: `${bank.description || '暂无描述'} · 共 ${listed.total} 题`,
                    actions: `<button class="btn btn-secondary" id="btn-practice-here">开始练习</button>` +
                             (isAdmin ? `<button class="btn btn-primary" id="btn-add-question">${Icons.plus} 添加题目</button>` : ''),
                })}
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
                ${this.banner({
                    icon: 'edit',
                    title: isEdit ? '编辑题目' : '添加题目',
                    subtitle: isEdit ? '修改题干、选项与答案' : '为题库新增一道题目',
                    actions: `<button class="btn btn-secondary" id="btn-cancel">返回</button>`,
                })}
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
                    ${this.banner({ icon: 'target', title: '选择题库', subtitle: '选择要练习的题库' })}
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
                ${this.banner({ icon: 'target', title: '练习设置', subtitle: bank.name })}
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
                        <div class="practice-actions">
                            <button type="submit" class="btn btn-primary btn-lg">开始练习</button>
                            <button type="button" class="btn btn-secondary btn-lg" id="btn-recite">背题模式</button>
                        </div>
                    </form>
                </div></div>
            `;

            // 背题不受上面的题量配置与选项乱序影响：进入后按题型筛选整库通背
            document.getElementById('btn-recite').onclick = () => {
                window.location.hash = '#/recite?bank_id=' + bankId;
            };

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
                const answered =
                    answers[qid] !== undefined && !isUnansweredSelection(answers[qid].selected);
                const isCurrent = i === idx;
                const cls =
                    (isCurrent ? 'nav-q current' : 'nav-q') + (answered ? ' answered' : '');
                navHtml += `<button class="${cls}" data-idx="${i}" aria-label="第 ${i + 1} 题，${
                    answered ? '已答' : '未答'
                }"${isCurrent ? ' aria-current="true"' : ''}>${i + 1}</button>`;
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
                            <div class="progress-bar"><div class="progress-fill"></div></div>
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

            // 进度条宽度必须用 CSSOM 赋值：CSP 是 style-src 'self'（无
            // unsafe-inline），写在 HTML 属性里的内联样式会被直接丢弃。
            c.querySelector('.progress-fill').style.width = ((idx + 1) / total) * 100 + '%';

            const answeredCount = Object.keys(answers).filter(
                (k) => answers[k] && !isUnansweredSelection(answers[k].selected)
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

            // 有未作答时先确认：误点一次就会结束本次练习。
            // 未作答按服务端口径判定，与结果页的「未答」数一致。
            const unanswered = payload.filter((p) => isUnansweredSelection(p.selected)).length;
            if (unanswered > 0 && !confirm(`还有 ${unanswered} 道题未作答，确定交卷吗？`)) return;

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

    // ══════════════════════════════════════════════════════════
    // 背题模式
    // ══════════════════════════════════════════════════════════

    /**
     * 背题模式：逐题直接给出正确答案与解析，不判分、不落库。
     *
     * 数据来源是 GET /api/questions（已对登录用户返回 answer / explanation），
     * 而不是 /api/practice/pick —— 后者刻意不下发答案（判分在服务端）。
     * 因此背题全程只读：不写 practice_sessions / practice_answers / wrong_book，
     * 既不污染错题本与统计，也不消耗 D1 的写入配额。
     *
     * 与移动端 public/mobile/js/app.js 的 renderRecite 保持同一套行为：
     * 整库通背、按题型筛选、每页 200 题续载、接近尾部预取。
     */
    /**
     * 背题模式。
     *
     * 两个数据源：`#/recite?bank_id=N`（题库，分页拉取）与
     * `#/recite?source=wrongbook`（错题本，一次性载入）。
     * 渲染与翻页状态机是共用的，源之间的差异只收敛在 source 上：
     * title / types / total(type) / page(type)（page 为 null 表示走分页接口）。
     */
    async loadRecite() {
        const c = document.getElementById('page-container');
        const params = this.hashParams();
        const fromWrongBook = params.get('source') === 'wrongbook';

        c.innerHTML = '<div class="loading">加载中…</div>';

        let source;
        if (fromWrongBook) {
            let records;
            try {
                records = await API.getWrongBook();
            } catch (error) {
                c.innerHTML = `<div class="error-msg">${esc(error.message)}</div>`;
                return;
            }
            // 错题本接口已经带上 stem/type/options/answer/explanation，
            // 不必再逐题回查题库
            const all = records.map((r) => ({
                id: r.question_id,
                type: r.type,
                stem: r.stem,
                options: r.options,
                answer: r.answer,
                explanation: r.explanation,
            }));
            const countOf = (key) => (key ? all.filter((q) => q.type === key).length : all.length);
            source = {
                title: '错题本',
                icon: 'circle-x',
                bankId: null,
                page: (type) => (type ? all.filter((q) => q.type === type) : all),
                types: [
                    { key: '', label: '全部', count: countOf('') },
                    { key: 'single', label: '单选', count: countOf('single') },
                    { key: 'multiple', label: '多选', count: countOf('multiple') },
                    { key: 'truefalse', label: '判断', count: countOf('truefalse') },
                ].filter((t) => t.count > 0),
                total: (type) => countOf(type),
            };
        } else {
            const bankId = parseInt(params.get('bank_id') || '', 10);
            if (!bankId) {
                c.innerHTML = '<div class="error-msg">缺少题库参数</div>';
                return;
            }
            let bank;
            try {
                bank = await API.getBank(bankId);
            } catch (error) {
                c.innerHTML = `<div class="error-msg">${esc(error.message)}</div>`;
                return;
            }
            const types = [
                { key: '', label: '全部', count: bank.question_count },
                { key: 'single', label: '单选', count: bank.single_count },
                { key: 'multiple', label: '多选', count: bank.multiple_count },
                { key: 'truefalse', label: '判断', count: bank.truefalse_count },
            ].filter((t) => t.count > 0);
            source = {
                title: bank.name,
                icon: 'book',
                bankId,
                page: null,
                types,
                // 总题数取题库的预计算统计，不额外查表
                total: (type) => {
                    const t = types.find((x) => x.key === type);
                    return t ? t.count : 0;
                },
            };
        }

        const PAGE_SIZE = 200; // 服务端 per_page 硬上限
        const PREFETCH_AT = 20; // 距已加载尾部还剩这么多题时预取下一页

        const state = {
            type: '', // '' = 全部
            questions: [],
            idx: 0,
            loading: false,
            done: false,
            error: '',
            epoch: 0, // 题型切换令牌：用于丢弃过期响应
        };

        // 只保留题量非空的题型，避免出现点进去空空如也的筛选项
        const types = source.types;

        if (types.length === 0) {
            c.innerHTML = fromWrongBook
                ? '<div class="empty-state"><p>错题本是空的，先去练几道题吧</p></div>'
                : '<div class="empty-state"><p>这个题库还没有题目</p></div>';
            return;
        }

        /** 当前筛选下的总题数 */
        const currentTotal = () => source.total(state.type);

        /** 正确答案既可能是下标也可能是下标数组；解析失败时服务端给 -1 */
        const toIndexArray = (v) => {
            if (v === null || v === undefined) return [];
            return Array.isArray(v) ? v : [v];
        };

        /** 取下一页；同一时刻只允许一个请求在飞 */
        const loadNext = async () => {
            if (state.loading) return;
            if (state.questions.length >= currentTotal()) {
                state.done = true;
                return;
            }

            // 错题本：题目已经全在内存里，按当前题型一次性补齐
            if (source.page) {
                state.questions = source.page(state.type);
                state.done = true;
                state.loading = false;
                render();
                return;
            }

            const epoch = state.epoch;
            state.loading = true;
            state.error = '';
            render();

            try {
                const res = await API.getQuestions({
                    bank_id: source.bankId,
                    type: state.type || undefined,
                    page: Math.floor(state.questions.length / PAGE_SIZE) + 1,
                    per_page: PAGE_SIZE,
                });
                if (epoch !== state.epoch) return; // 期间切换了题型，丢弃

                // offset 分页在题目被删时可能重叠，按 id 去重
                const seen = new Set(state.questions.map((q) => q.id));
                let added = 0;
                for (const q of res.items || []) {
                    if (!seen.has(q.id)) {
                        state.questions.push(q);
                        seen.add(q.id);
                        added++;
                    }
                }
                // 整页都是重复/已删题目时收手，避免反复请求同一页
                if (added === 0) state.done = true;
            } catch (error) {
                if (epoch === state.epoch) state.error = error.message;
            } finally {
                if (epoch === state.epoch) {
                    state.loading = false;
                    state.done = state.questions.length >= currentTotal();
                    render();
                }
            }
        };

        const goto = (target) => {
            const total = currentTotal();
            if (target < 0 || target >= total) return;
            // 下一页还没回来时不越过已加载范围，避免连点跳题
            if (target >= state.questions.length && state.loading) return;

            state.idx = target;
            render();
            if (!state.done && target >= state.questions.length - PREFETCH_AT) loadNext();
        };

        const switchType = (type) => {
            if (type === state.type) return;
            state.type = type;
            state.epoch++; // 让在飞请求作废
            state.questions = [];
            state.idx = 0;
            state.loading = false;
            state.done = false;
            state.error = '';
            render();
            loadNext();
        };

        const render = () => {
            const total = currentTotal();
            const q = state.questions[state.idx];
            const answerIdxs = q ? toIndexArray(q.answer) : [];
            const answerOk = answerIdxs.length > 0 && answerIdxs.every((i) => i >= 0);
            const pct = total > 0 ? Math.round(((state.idx + 1) / total) * 100) : 0;

            let navHtml = '';
            for (let i = 0; i < state.questions.length; i++) {
                const isCurrent = i === state.idx;
                navHtml += `<button class="nav-q${isCurrent ? ' current' : ''}" data-idx="${i}" aria-label="第 ${
                    i + 1
                } 题"${isCurrent ? ' aria-current="true"' : ''}>${i + 1}</button>`;
            }

            const filterHtml = types
                .map(
                    (t) =>
                        `<button class="btn btn-sm ${
                            t.key === state.type ? 'btn-primary' : 'btn-secondary'
                        }" data-type="${t.key}">${t.label} ${t.count}</button>`
                )
                .join('');

            const cardHtml = q
                ? `
                    <div class="answer-card">
                        <div class="answer-card-header">
                            <span class="question-type-badge">${esc(this.getTypeLabel(q.type))}</span>
                        </div>
                        <div class="answer-card-stem">${esc(q.stem)}</div>
                        <div class="answer-options">
                            ${q.options
                                .map((opt, oi) => {
                                    const isCorrect = answerOk && answerIdxs.indexOf(oi) >= 0;
                                    return `<div class="answer-option${isCorrect ? ' correct' : ''}"><strong>${String.fromCharCode(65 + oi)}.</strong> <span class="answer-option-text">${esc(opt)}</span> ${isCorrect ? Icons.check : ''}</div>`;
                                })
                                .join('')}
                        </div>
                        ${
                            answerOk
                                ? ''
                                : '<div class="answer-explanation">本题答案数据异常，无法标注正确选项</div>'
                        }
                        ${
                            q.explanation
                                ? `<div class="answer-explanation"><strong>解析：</strong>${esc(q.explanation)}</div>`
                                : ''
                        }
                    </div>`
                : '<div class="loading">加载中…</div>';

            c.innerHTML = `
                ${this.banner({ icon: source.icon, title: '背题', subtitle: source.title })}
                <div class="practice-layout">
                    <div class="practice-main">
                        <div class="practice-progress">
                            <div class="progress-header">
                                <span class="progress-label">第 ${state.idx + 1} / 共 ${total} 题</span>
                                <span class="progress-count tnum">${pct}%</span>
                            </div>
                            <div class="progress-bar"><div class="progress-fill"></div></div>
                        </div>
                        ${cardHtml}
                        ${
                            state.error
                                ? `<div class="error-msg">加载失败：${esc(
                                      state.error
                                  )} <button class="btn btn-sm btn-secondary" id="recite-retry">重试</button></div>`
                                : ''
                        }
                        <div class="practice-actions">
                            <button class="btn btn-secondary" ${
                                state.idx === 0 ? 'disabled' : ''
                            } id="btn-prev">${Icons['arrow-left']} 上一题</button>
                            <button class="btn btn-secondary" ${
                                state.idx >= total - 1 ? 'disabled' : ''
                            } id="btn-next">${state.loading ? '加载中…' : '下一题'} ${Icons['arrow-right']}</button>
                        </div>
                    </div>
                    <div class="practice-sidebar">
                        <div class="sidebar-title">题型</div>
                        <div class="recite-filter">${filterHtml}</div>
                        <div class="sidebar-title">题号</div>
                        <div class="question-nav">${navHtml}</div>
                        <div class="sidebar-stats">
                            <span class="text-secondary">已加载 <b class="tnum">${
                                state.questions.length
                            }</b> / 共 <b class="tnum">${total}</b></span>
                        </div>
                    </div>
                </div>`;

            // CSP 拦内联样式属性，进度条宽度只能这样赋值
            c.querySelector('.progress-fill').style.width = pct + '%';

            c.querySelectorAll('.nav-q').forEach((btn) => {
                btn.addEventListener('click', () => goto(parseInt(btn.dataset.idx, 10)));
            });
            c.querySelectorAll('.recite-filter .btn').forEach((btn) => {
                btn.addEventListener('click', () => switchType(btn.dataset.type));
            });
            document.getElementById('btn-prev').addEventListener('click', () => goto(state.idx - 1));
            document.getElementById('btn-next').addEventListener('click', () => goto(state.idx + 1));
            const retry = document.getElementById('recite-retry');
            if (retry) retry.addEventListener('click', () => loadNext());
        };

        render();

        // 键盘左右键切题；handleRoute() 每次都会先移除上一页注册的处理器
        this._practiceKeyHandler = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                goto(state.idx - 1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                goto(state.idx + 1);
            }
        };
        document.addEventListener('keydown', this._practiceKeyHandler);

        loadNext();
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
            ${this.banner({ icon: 'circle-check', title: '练习结果', subtitle: '本次练习完成情况' })}
            <div class="result-container">
                <div class="result-hero">
                    <div class="result-ring">
                        <svg width="140" height="140">
                            <circle class="result-ring-bg" cx="70" cy="70" r="54"/>
                            <circle class="result-ring-fill" cx="70" cy="70" r="54"
                                stroke-dasharray="${circumference}" stroke-dashoffset="${circumference}"/>
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
            if (ring) {
                // 延迟也走 CSSOM：内联样式属性会被 CSP 丢弃
                ring.style.transitionDelay = '0.3s';
                ring.style.strokeDashoffset = offset;
            }
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
                ${this.banner({ icon: 'circle-x', title: '错题本', subtitle: `共 ${records.length} 道错题` })}
                ${
                    records.length > 0
                        ? `<div class="wrongbook-actions">
                               <div class="wrongbook-actions-hint">可以直接抽题练习，也可以进入背题模式逐题看解析。</div>
                               <div class="wrongbook-actions-buttons">
                                   <button class="btn btn-primary" id="btn-wrong-practice">练习错题</button>
                                   <button class="btn btn-secondary" id="btn-wrong-recite">学习错题</button>
                               </div>
                           </div>`
                        : ''
                }
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

            const btnRecite = document.getElementById('btn-wrong-recite');
            if (btnRecite) {
                btnRecite.onclick = () => {
                    window.location.hash = '#/recite?source=wrongbook';
                };
            }

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
            const filters = this.readSessionFilters();
            // 题库下拉与记录列表一起取，避免串行两次往返
            const [banks, data] = await Promise.all([
                API.getBanks(),
                API.getSessions({
                    page: currentPage,
                    per_page: this.SESSIONS_PER_PAGE,
                    ...this.sessionQuery(filters),
                }),
            ]);
            const totalPages = Math.max(1, Math.ceil(data.total / data.per_page));
            const hasFilter =
                filters.bankId !== '' || filters.range !== 'all' || filters.accuracy !== 'all';

            c.innerHTML = `
                ${this.banner({ icon: 'file-text', title: '练习记录', subtitle: `共 ${data.total} 条记录` })}
                <div class="card"><div class="card-body">
                    <div class="filter-bar">
                        <label class="filter-field">
                            <span class="filter-label">题库</span>
                            <select class="form-input" id="f-bank">
                                <option value="">全部题库</option>
                                ${banks
                                    .map(
                                        (b) =>
                                            `<option value="${b.id}"${String(b.id) === filters.bankId ? ' selected' : ''}>${esc(b.name)}</option>`
                                    )
                                    .join('')}
                            </select>
                        </label>
                        <label class="filter-field">
                            <span class="filter-label">时间范围</span>
                            <select class="form-input" id="f-range">
                                <option value="all"${filters.range === 'all' ? ' selected' : ''}>全部时间</option>
                                <option value="7d"${filters.range === '7d' ? ' selected' : ''}>最近 7 天</option>
                                <option value="30d"${filters.range === '30d' ? ' selected' : ''}>最近 30 天</option>
                            </select>
                        </label>
                        <label class="filter-field">
                            <span class="filter-label">正确率</span>
                            <select class="form-input" id="f-accuracy">
                                <option value="all"${filters.accuracy === 'all' ? ' selected' : ''}>全部</option>
                                <option value="low"${filters.accuracy === 'low' ? ' selected' : ''}>低于 60%</option>
                                <option value="mid"${filters.accuracy === 'mid' ? ' selected' : ''}>60% ~ 80%</option>
                                <option value="high"${filters.accuracy === 'high' ? ' selected' : ''}>80% 以上</option>
                            </select>
                        </label>
                        ${hasFilter ? '<button class="btn btn-sm btn-ghost" id="f-clear">清除筛选</button>' : ''}
                    </div>
                    ${
                        data.sessions.length === 0
                            ? `<div class="empty-state">${Icons.inbox}<p>${
                                  hasFilter ? '没有符合条件的记录' : '暂无练习记录'
                              }</p></div>`
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

            // 改任一筛选控件就改写 hash —— 由 hashchange 触发重渲染，
            // 页码因此自动回到第 1 页，筛选条件也会留在地址栏可复现
            const applyFilters = () => {
                const params = new URLSearchParams();
                const bank = document.getElementById('f-bank').value;
                const range = document.getElementById('f-range').value;
                const accuracy = document.getElementById('f-accuracy').value;
                if (bank) params.set('bank_id', bank);
                if (range !== 'all') params.set('range', range);
                if (accuracy !== 'all') params.set('accuracy', accuracy);
                const qs = params.toString();
                window.location.hash = '#/sessions' + (qs ? '?' + qs : '');
            };
            ['f-bank', 'f-range', 'f-accuracy'].forEach((id) => {
                document.getElementById(id).onchange = applyFilters;
            });
            const clearBtn = document.getElementById('f-clear');
            if (clearBtn) {
                clearBtn.onclick = () => {
                    window.location.hash = '#/sessions';
                };
            }
        } catch (error) {
            c.innerHTML = `<div class="error-msg">${esc(error.message)}</div>`;
        }
    },

    /**
     * 从 hash 读练习记录的筛选条件。
     * 取值只认白名单，手改 URL 写成别的值一律当未设置 ——
     * 否则会把非法参数原样发给接口、拿到 400 页面。
     */
    readSessionFilters() {
        const p = this.hashParams();
        const range = p.get('range');
        const accuracy = p.get('accuracy');
        return {
            bankId: p.get('bank_id') || '',
            range: ['7d', '30d', 'all'].indexOf(range) >= 0 ? range : 'all',
            accuracy: ['low', 'mid', 'high'].indexOf(accuracy) >= 0 ? accuracy : 'all',
        };
    },

    /** 语义桶 → 接口的整数百分比闭区间 */
    sessionQuery(filters) {
        // 缺省值不进 query：range=all 服务端会忽略，发出去只会让 URL 变长
        const q = {};
        if (filters.range !== 'all') q.range = filters.range;
        if (filters.bankId) q.bank_id = filters.bankId;
        if (filters.accuracy === 'low') {
            q.max_accuracy = 59;
        } else if (filters.accuracy === 'mid') {
            q.min_accuracy = 60;
            q.max_accuracy = 79;
        } else if (filters.accuracy === 'high') {
            q.min_accuracy = 80;
        }
        return q;
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
                    let state = '未作答';
                    if (i === idx) cls += ' current';
                    else if (ans.is_correct === 1) {
                        cls += ' correct';
                        state = '正确';
                    } else if (ans.is_correct === 0) {
                        cls += ' wrong';
                        state = '错误';
                    }
                    navHtml += `<button class="${cls}" data-idx="${i}" aria-label="第 ${i + 1} 题，${state}"${
                        i === idx ? ' aria-current="true"' : ''
                    }>${i + 1}</button>`;
                }

                const statusText = unanswered ? '未作答' : a.is_correct ? '正确' : '错误';
                const statusCls = unanswered ? 'unanswered' : a.is_correct ? 'correct' : 'wrong';

                c.innerHTML = `
                    ${this.banner({
                        icon: 'list-checks',
                        title: '练习详情',
                        subtitle: `${data.session.bank_name} · ${data.session.submitted_at}`,
                        actions: `<button class="btn btn-secondary" id="btn-back">${Icons['arrow-left']} 返回列表</button>`,
                    })}
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
                                <div class="progress-bar"><div class="progress-fill"></div></div>
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
                                <button class="btn btn-secondary" ${idx === total - 1 ? 'disabled' : ''} id="btn-next">下一题 ${Icons['arrow-right']}</button>
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

                // CSP 拦内联样式属性，进度条宽度只能这样赋值
                c.querySelector('.progress-fill').style.width = ((idx + 1) / total) * 100 + '%';

                document.getElementById('btn-back').onclick = () => {
                    window.location.hash = '#/sessions';
                };
                c.querySelectorAll('.nav-q').forEach((btn) => {
                    btn.addEventListener('click', () => {
                        idx = parseInt(btn.dataset.idx, 10);
                        renderDetail();
                    });
                });
                document.getElementById('btn-prev').addEventListener('click', () => go(-1));
                document.getElementById('btn-next').addEventListener('click', () => go(1));
            };

            /** 切上一题 / 下一题（按钮与键盘共用；越界则不动） */
            const go = (dir) => {
                const target = idx + dir;
                if (target < 0 || target >= total) return;
                idx = target;
                renderDetail();
            };

            renderDetail();

            // 键盘 ← / → 切题，与答题页一致。
            // handleRoute() 每次都会先移除上一页注册的处理器，无需在这里清理。
            this._practiceKeyHandler = (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    go(-1);
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    go(1);
                }
            };
            document.addEventListener('keydown', this._practiceKeyHandler);
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
            ${this.banner({ icon: 'upload', title: '导入题库', subtitle: '支持 JSON 文件或直接粘贴 JSON 数据' })}
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
                    <div class="progress-bar"><div class="progress-fill" id="import-bar"></div></div>
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
            // 起始宽度改为这里赋值：HTML 属性里的内联样式会被 CSP 丢弃，
            // 而 .progress-fill 没有默认宽度，不赋值就会显示成满格
            bar.style.width = '0%';
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
                ${this.banner({
                    icon: 'users',
                    title: '用户管理',
                    subtitle: `共 ${users.length} 个用户`,
                    actions: `<button class="btn btn-primary" id="btn-add-user">${Icons['user-plus']} 添加用户</button>`,
                })}
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
        const password = this.askNewPassword('请输入密码');
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

    /**
     * 两次输入新口令，一致才返回；取消或不一致一律返回 null。
     * 新建用户 / 重置口令与本人改密共用同一套「二次输入」约束。
     * 刻意不预填默认口令：预填值会变成全网可见的「惯用口令」，
     * 而且本文件是公开的前端资源。
     */
    askNewPassword(title) {
        const password = prompt(`${title}（至少 6 位）:`);
        if (!password) return null;
        if (password.length < 6) {
            alert('密码至少 6 位');
            return null;
        }
        const again = prompt('请再次输入以确认:', '');
        if (again === null) return null;
        if (password !== again) {
            alert('两次输入不一致，已取消，请重试');
            return null;
        }
        return password;
    },

    async resetPassword(id) {
        const password = this.askNewPassword('请输入新密码');
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
            ${this.banner({ icon: 'user', title: '个人设置', subtitle: '账号信息与登录密码' })}
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
                    <div class="form-group">
                        <label for="confirm-password">确认新密码</label>
                        <input type="password" id="confirm-password" class="form-input" required autocomplete="new-password">
                        <span class="hint">请再次输入新密码，两次必须完全一致</span>
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
            const confirmPwd = document.getElementById('confirm-password').value;
            if (!oldPwd || !newPwd || !confirmPwd) {
                alert('请填写完整');
                return;
            }
            if (newPwd.length < 6) {
                alert('新密码至少 6 位');
                return;
            }
            // 二次输入校验：这是防止「新密码打错一个字就把原密码覆盖掉」的唯一机会，
            // 服务端拿到的只有拉伸后的值，无法分辨是打错还是有意为之。
            if (newPwd !== confirmPwd) {
                alert('两次输入的新密码不一致，请重新输入');
                const confirmInput = document.getElementById('confirm-password');
                confirmInput.value = '';
                confirmInput.focus();
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
                document.getElementById('confirm-password').value = '';
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
            ${this.banner({ icon: 'help-circle', title: '页面不存在', subtitle: '你访问的地址没有对应的内容' })}
            <div class="error-page">
                <div class="error-page-code">404</div>
                <div class="error-page-text">页面不存在</div>
                <a href="#/" class="btn btn-primary">返回首页</a>
            </div>
        `;
    },
};

document.addEventListener('DOMContentLoaded', () => App.init());
