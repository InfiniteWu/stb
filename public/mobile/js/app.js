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

/**
 * 是否「未作答」——与服务端 lib/grade.ts 的 isUnanswered 同一口径：
 * null / undefined / 空数组都算未作答。
 *
 * 注意空数组：多选题把已选项全部取消后得到 `[]`，界面各处原先用
 * `selected !== null` 判断会把它算成「已答」，而服务端计为「未答」，
 * 于是交卷后的结果页与作答时的「未答」统计对不上。这里统一按服务端口径。
 */
const isUnansweredSelection = (selected) =>
    selected === null || selected === undefined || (Array.isArray(selected) && selected.length === 0);

const App = {
    currentUser: null,
    practiceData: null,
    practiceResult: null,
    /** 背题模式状态：{ bank, type, questions, total, idx, loading, epoch } */
    reciteData: null,

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

        // 背题页与答题页一样有常驻底部操作区，隐藏标签栏避免遮挡
        const noTab =
            ['/login', '/practice/do', '/recite'].indexOf(path) >= 0 ||
            path.startsWith('/sessions/');
        tabbar.style.display = noTab ? 'none' : 'flex';

        const noHeader = path === '/login';
        header.style.display = noHeader ? 'none' : 'flex';

        // 详情页此前被排除在「显示返回箭头」之外，导致进去后无法中途退出，
        // 只能一路翻到最后一题才有返回按钮。现在恢复箭头。
        const noBack =
            ['/', '/login', '/practice/pick', '/wrongbook', '/sessions', '/profile'].indexOf(path) >= 0;
        // 用类而不是内联 style 控制显隐：CSP（style-src 'self'）会丢弃内联样式，
        // index.html 里那句初始的 display:none 本来就没生效
        back.classList.toggle('m-hidden', noBack);

        back.onclick = () => {
            if (path.startsWith('/sessions/')) {
                // 回练习记录列表，而不是退回首页
                window.location.hash = '#/sessions';
            } else if (path === '/practice/do' || path === '/practice/result') {
                window.location.hash = '#/';
            } else if (path === '/recite') {
                // 直接以 #/recite?bank_id=N 打开时 history 里没有上一页可退
                window.location.hash = '#/practice/pick';
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
        page.classList.remove('m-page--swipeable');

        if (path === '/' || path === '') this.renderDashboard(page, title);
        else if (path === '/login') this.renderLogin(page, header);
        else if (path === '/practice/pick') this.renderPracticePick(page, title);
        else if (path === '/practice/do') this.renderPracticeDo(page, title);
        else if (path === '/practice/result') this.renderPracticeResult(page, title);
        else if (path === '/recite') this.renderRecite(page, title);
        else if (path === '/wrongbook') this.renderWrongBook(page, title);
        else if (path === '/sessions') this.renderSessions(page, title);
        else if (path.match(/^\/sessions\/\d+$/)) this.renderSessionDetail(path.split('/')[2], page, title);
        else if (path === '/profile') this.renderProfile(page, title);
        else page.innerHTML = '<div class="m-empty"><p>页面不存在</p></div>';

        this.hydrateIcons(page);
    },

    /** 取 hash 上的查询参数（与桌面端同名同实现） */
    hashParams() {
        const hash = window.location.hash || '';
        const qi = hash.indexOf('?');
        return new URLSearchParams(qi === -1 ? '' : hash.slice(qi + 1));
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
            const trend = Array.isArray(d.trend) ? d.trend : [];
            const recent = d.recent_session;
            const wrongCount = d.wrong_active_count || 0;

            // 趋势摘要按整体算（总答对 / 总作答），不把 7 天的百分比再平均
            const daysWithPractice = trend.filter((t) => t.accuracy !== null).length;
            const answeredSum = trend.reduce((sum, t) => sum + (t.answered || 0), 0);
            const correctSum = trend.reduce((sum, t) => sum + (t.correct || 0), 0);
            const avgAccuracy = answeredSum > 0 ? correctSum / answeredSum : null;

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
                <div class="m-card">
                    <div class="m-card-header">最近练习</div>
                    <div class="m-card-body">
                        ${
                            recent
                                ? `<div class="m-recent-session">
                                       <div>
                                           <div class="m-fw-600">${esc(recent.bank_name)}</div>
                                           <div class="m-text-sm m-text-muted tnum">${esc(recent.submitted_at)} · 共 ${esc(recent.total_count)} 题</div>
                                       </div>
                                       <div class="m-recent-score tnum">${this.accuracyText(recent.correct_count, recent.total_count)}</div>
                                   </div>
                                   <a class="m-btn m-btn-secondary m-btn-sm m-mt-12" href="#/sessions/${recent.id}">查看详情</a>`
                                : `<div class="m-text-muted">还没有练习记录</div>
                                   <a class="m-btn m-btn-primary m-btn-sm m-mt-12" href="#/practice/pick">开始第一次练习</a>`
                        }
                    </div>
                </div>
                <div class="m-card">
                    <div class="m-card-header">最近 7 天正确率</div>
                    <div class="m-card-body">
                        ${
                            trend.length > 0
                                ? '<svg class="m-trend-chart" id="m-trend-chart" role="img" aria-label="最近 7 天正确率趋势"></svg>'
                                : ''
                        }
                        <div class="m-trend-meta">
                            ${
                                avgAccuracy === null
                                    ? '最近 7 天还没有练习记录'
                                    : `7 天平均正确率 <b class="tnum">${Math.round(avgAccuracy * 100)}%</b> · 练习 <b class="tnum">${daysWithPractice}</b> 天`
                            }
                        </div>
                    </div>
                </div>
                <div class="m-card m-review-card${wrongCount > 0 ? ' is-active' : ''}">
                    <div class="m-card-body m-review-body">
                        <div class="m-review-main">
                            <div class="m-fw-600">${wrongCount > 0 ? `有 ${esc(wrongCount)} 道错题待复习` : '暂无错题'}</div>
                            <div class="m-text-sm m-text-muted">${
                                wrongCount > 0 ? '趁热打铁，把错题再过一遍' : '继续保持 —— 答错的题会自动收进错题本'
                            }</div>
                        </div>
                        ${wrongCount > 0 ? '<a class="m-btn m-btn-primary m-btn-sm m-review-btn" href="#/wrongbook">去复习</a>' : ''}
                    </div>
                </div>
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
            // SVG 要等插入 DOM 之后才量得到宽度，所以趋势图在这里画
            const trendSvg = document.getElementById('m-trend-chart');
            if (trendSvg) this.paintTrendChart(trendSvg, trend);
            this.hydrateIcons(page);
        } catch (err) {
            page.innerHTML = `<div class="m-empty"><p>${esc(err.message)}</p></div>`;
        }
    },

    /**
     * 画「最近 7 天正确率」折线（与桌面端同一套算法）。
     *
     * CSP 是 style-src 'self'，内联 style 属性会被丢弃 —— 描边/填充写在 CSS 类里，
     * 坐标只走 SVG 属性；又因为 SVG 一旦被非等比拉伸就会把圆点压成椭圆，
     * 这里按容器实测宽度生成像素坐标，让 viewBox 与显示尺寸 1:1。
     */
    paintTrendChart(svg, trend) {
        const H = 72;
        const PAD_X = 8;
        const PAD_Y = 10;
        const W = Math.max(120, Math.round(svg.clientWidth || 300));
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
        const base = `<line class="m-trend-base" x1="${PAD_X}" y1="${H - PAD_Y}" x2="${W - PAD_X}" y2="${H - PAD_Y}" />`;
        const line =
            points.length >= 2
                ? `<polyline class="m-trend-line" points="${points
                      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
                      .join(' ')}" />`
                : '';
        const dots = points
            .map((p) => `<circle class="m-trend-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" />`)
            .join('');

        svg.innerHTML = base + line + dots;
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
                            <div class="m-config-row m-hidden" id="config-${b.id}">
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
                            <div class="m-flex m-gap-8 m-hidden" id="actions-${b.id}">
                                <button class="m-btn m-btn-primary m-btn-sm start-practice" id="start-${b.id}" data-id="${b.id}">开始练习</button>
                                <button class="m-btn m-btn-secondary m-btn-sm recite-bank" id="recite-${b.id}" data-id="${b.id}">背题模式</button>
                            </div>
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
                    if (
                        e.target.closest('.m-counter-btn') ||
                        e.target.closest('.start-practice') ||
                        e.target.closest('.recite-bank')
                    )
                        return;
                    const id = card.dataset.id;
                    const cfg = document.getElementById('config-' + id);
                    const actions = document.getElementById('actions-' + id);
                    // 用类而不是内联 style 控制显隐：CSP（style-src 'self'，无
                    // unsafe-inline）会把 HTML 里的内联 display:none 整条丢弃，
                    // 卡片因此永远收不起来。
                    const isOpen = !cfg.classList.contains('m-hidden');
                    cfg.classList.toggle('m-hidden', isOpen);
                    actions.classList.toggle('m-hidden', isOpen);
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

            // 背题模式不受上面的题量配置影响：进入后按题型筛选整库通背
            page.querySelectorAll('.recite-bank').forEach((btn) => {
                btn.addEventListener('click', () => {
                    window.location.hash = '#/recite?bank_id=' + btn.dataset.id;
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
        // 左右拖动切上一题/下一题
        page.classList.add('m-page--swipeable');

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
            Object.keys(answers).filter(
                (k) => answers[k] && !isUnansweredSelection(answers[k].selected)
            ).length;

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
                <div class="m-progress-bar"><div class="m-progress-fill"></div></div>
                <div class="m-question-card">
                    <div class="m-question-meta">
                        <span class="m-badge">${esc(this.getTypeLabel(q.type))}</span>
                    </div>
                    <div class="m-question-stem">${esc(q.stem)}</div>
                    <div class="m-question-options" role="${
                        q.type === 'multiple' ? 'group' : 'radiogroup'
                    }" aria-label="${esc(this.getTypeLabel(q.type))}选项">
                        ${q.options
                            .map(
                                (opt, i) => `
                            <div class="m-option ${isSelected(i) ? 'selected' : ''}" data-idx="${i}"
                                 role="${q.type === 'multiple' ? 'checkbox' : 'radio'}"
                                 aria-checked="${isSelected(i) ? 'true' : 'false'}">
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
                    <button class="m-btn m-btn-primary" id="btn-submit">提交试卷</button>
                </div>`;

            // 进度条宽度必须用 CSSOM 赋值：CSP 是 style-src 'self'（无 unsafe-inline），
            // 写在 HTML 属性里的宽度会被浏览器直接丢弃。
            page.querySelector('.m-progress-fill').style.width =
                ((state.idx + 1) / total) * 100 + '%';

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

            /** 切题：dir 为 1 下一题、-1 上一题；能播动画就交给 slideTo */
            const go = (dir) => {
                const target = state.idx + dir;
                if (target < 0 || target >= total) return;
                state.idx = target;
                if (self.slideTo(page, dir, render)) return;
                render();
            };

            document.getElementById('btn-prev').addEventListener('click', () => go(-1));
            document.getElementById('btn-next').addEventListener('click', () => go(1));
            /** M6：与桌面端对齐，新增「不会」—— 记为未作答而非答错 */
            document.getElementById('btn-dontknow').addEventListener('click', () => {
                answers[q.id] = { selected: null };
                // 末题没有下一题可切，但仍要重画以反映「已标记未作答」
                if (state.idx < total - 1) go(1);
                else render();
            });
            document.getElementById('btn-submit').addEventListener('click', () => {
                self.submitPractice(data, answers);
            });
            document.getElementById('show-sheet').addEventListener('click', () => {
                self.showSheet(data, answers, total, state, render, answeredCount);
            });

            self.enableSwipe(
                page,
                () => go(1), // 左滑 → 下一题
                () => go(-1) // 右滑 → 上一题
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
            const answered = a !== undefined && !isUnansweredSelection(a.selected);
            const isCurrent = i === state.idx;
            let cls = 'm-sheet-btn';
            if (answered) cls += ' answered';
            if (isCurrent) cls += ' current';
            navHtml += `<button class="${cls}" data-idx="${i}" aria-label="第 ${i + 1} 题，${
                answered ? '已答' : '未答'
            }"${isCurrent ? ' aria-current="true"' : ''}>${i + 1}</button>`;
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
            let state = '未作答';
            let cls = 'm-sheet-btn';
            if (unanswered) {
                unansweredCount++;
                cls += ' unanswered';
            } else if (a.is_correct) {
                correctCount++;
                cls += ' correct';
                state = '正确';
            } else {
                wrongCount++;
                cls += ' wrong';
                state = '错误';
            }
            const isCurrent = i === currentIdx;
            if (isCurrent) cls += ' current';
            navHtml += `<button class="${cls}" data-idx="${i}" aria-label="第 ${i + 1} 题，${state}"${
                isCurrent ? ' aria-current="true"' : ''
            }>${i + 1}</button>`;
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

    /**
     * 左右拖动切上一题 / 下一题。
     *
     * 参数约定（与各调用点一致）：onSwipeLeft = 下一题，onSwipeRight = 上一题。
     *
     * 用属性赋值（ontouchstart 等）而不是 addEventListener：本方法会在每次
     * render() 之后被重新调用，属性赋值会替换掉上一次的处理器，而
     * addEventListener 会一层层累积监听器 —— 结果是一次拖动切好几题。
     *
     * 纵向滚动必须照常可用：一旦判定为纵向拖动就放弃本次手势，而不是强行
     * 接管，否则用户往下翻长题干时会被误切到下一题。
     */
    enableSwipe(el, onSwipeLeft, onSwipeRight) {
        const MIN_DX = 60; // 横向位移达到该值才切换
        const MAX_DY = 80; // 纵向位移超过该值即判定为滚动，放弃手势
        let startX = 0;
        let startY = 0;
        let tracking = false;

        el.ontouchstart = (e) => {
            // 多指（缩放等）不参与切题
            if (e.touches.length !== 1) {
                tracking = false;
                return;
            }
            tracking = true;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        };

        el.ontouchmove = (e) => {
            if (!tracking || e.touches.length !== 1) return;
            if (Math.abs(e.touches[0].clientY - startY) > MAX_DY) tracking = false;
        };

        el.ontouchend = (e) => {
            if (!tracking) return;
            tracking = false;

            const t = e.changedTouches && e.changedTouches[0];
            if (!t) return;

            const dx = t.clientX - startX;
            const dy = t.clientY - startY;
            if (Math.abs(dx) < MIN_DX) return;
            // 横向位移必须明显大于纵向，避免斜着拖时误触发
            if (Math.abs(dx) <= Math.abs(dy) * 1.5) return;

            if (dx < 0) onSwipeLeft();
            else onSwipeRight();
        };

        // 浏览器接管手势（如判定为滚动）时会发 touchcancel，必须复位
        el.ontouchcancel = () => {
            tracking = false;
        };
    },

    /**
     * 切题过渡：卡片滑出 → 重画 → 新卡片滑入，方向跟随手势。
     *
     * dir 为 1 表示下一题（旧卡片向左滑出、新卡片自右滑入），-1 表示上一题。
     * render() 由调用方提供，负责按当前下标重画页面；本方法会在滑出动画结束后
     * 才调用它，并给新卡片挂上滑入动画。
     *
     * 返回 true 表示已接管（调用方不必再自己 render），false 表示跳过动画、
     * 调用方应立即 render（例如卡片不存在、或用户偏好减少动效）。
     *
     * 只对卡片做 transform：底部 .m-action-area 是 position: fixed，
     * 祖先一旦有 transform 就会退化成相对该祖先定位，按钮会跟着一起滑。
     */
    slideTo(page, dir, render) {
        const CARD = '.m-question-card, .m-review-card';
        const OUT_MS = 110;

        if (this._slideBusy) return false; // 上一次过渡还没结束
        const card = page.querySelector(CARD);
        if (!card) return false;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            return false;
        }

        this._slideBusy = true;
        // 先清掉上一轮残留的动画类：同一元素上若同时挂着 m-slide-in-* 与
        // m-slide-out-*，两条 animation 规则相撞、后定义的 m-slide-in-* 胜出，
        // 滑出动画就静默不播（第一次之后的每次切换都会踩到）。
        card.classList.remove('m-slide-out-left', 'm-slide-out-right');
        card.classList.remove('m-slide-in-right', 'm-slide-in-left');

        // 分支写法而非三元表达式：check:styles 要能静态收集到这些类名
        if (dir > 0) card.classList.add('m-slide-out-left');
        else card.classList.add('m-slide-out-right');

        const hashAtStart = window.location.hash;

        setTimeout(() => {
            this._slideBusy = false;
            // 这 110ms 里用户可能已经点了返回/切到别的页面，此时不能再把
            // 旧页面画回去
            if (window.location.hash !== hashAtStart) return;
            render();
            const next = page.querySelector(CARD);
            if (!next) return; // 跨页加载中会先出现占位块，此时不做滑入
            if (dir > 0) next.classList.add('m-slide-in-right');
            else next.classList.add('m-slide-in-left');
        }, OUT_MS);

        return true;
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

        // 有未作答时先确认：误点一次就会结束本次练习。
        // 未作答按服务端口径判定，与结果页的「未答」数一致。
        const unanswered = payload.filter((p) => isUnansweredSelection(p.selected)).length;
        if (unanswered > 0 && !confirm(`还有 ${unanswered} 道题未作答，确定交卷吗？`)) return;

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
                            stroke-dasharray="${circ}" stroke-dashoffset="${circ}"/>
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
            if (ring) {
                // 延迟也走 CSSOM：内联 style 属性会被 CSP 丢弃
                ring.style.transitionDelay = '0.3s';
                ring.style.strokeDashoffset = offset;
            }
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
            const filters = this.readSessionFilters();
            // 题库下拉与记录列表一起取，避免串行两次往返
            const [banks, data] = await Promise.all([
                API.getBanks(),
                API.getSessions({ page: 1, per_page: 50, ...this.sessionQuery(filters) }),
            ]);
            const hasFilter =
                filters.bankId !== '' || filters.range !== 'all' || filters.accuracy !== 'all';

            const filterHtml = `
                <div class="m-filter-bar">
                    <select class="m-input m-filter-select" id="mf-bank" aria-label="按题库筛选">
                        <option value="">全部题库</option>
                        ${banks
                            .map(
                                (b) =>
                                    `<option value="${b.id}"${String(b.id) === filters.bankId ? ' selected' : ''}>${esc(b.name)}</option>`
                            )
                            .join('')}
                    </select>
                    <select class="m-input m-filter-select" id="mf-range" aria-label="按时间范围筛选">
                        <option value="all"${filters.range === 'all' ? ' selected' : ''}>全部时间</option>
                        <option value="7d"${filters.range === '7d' ? ' selected' : ''}>最近 7 天</option>
                        <option value="30d"${filters.range === '30d' ? ' selected' : ''}>最近 30 天</option>
                    </select>
                    <select class="m-input m-filter-select" id="mf-accuracy" aria-label="按正确率筛选">
                        <option value="all"${filters.accuracy === 'all' ? ' selected' : ''}>全部正确率</option>
                        <option value="low"${filters.accuracy === 'low' ? ' selected' : ''}>低于 60%</option>
                        <option value="mid"${filters.accuracy === 'mid' ? ' selected' : ''}>60% ~ 80%</option>
                        <option value="high"${filters.accuracy === 'high' ? ' selected' : ''}>80% 以上</option>
                    </select>
                </div>
                ${hasFilter ? '<button class="m-btn m-btn-secondary m-btn-sm m-clear-filter" id="mf-clear">清除筛选</button>' : ''}
            `;

            const listHtml = data.sessions
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

            page.innerHTML = data.sessions.length
                ? filterHtml + listHtml
                : `${filterHtml}<div class="m-empty"><p>${
                      hasFilter ? '没有符合条件的记录' : '暂无练习记录'
                  }</p></div>`;

            page.querySelectorAll('[data-session]').forEach((el) => {
                el.addEventListener('click', () => {
                    window.location.hash = '#/sessions/' + el.dataset.session;
                });
            });

            // 改任一筛选控件就改写 hash —— 由 hashchange 触发重渲染，
            // 筛选条件因此留在地址栏、可返回上一步
            const applyFilters = () => {
                const params = new URLSearchParams();
                const bank = document.getElementById('mf-bank').value;
                const range = document.getElementById('mf-range').value;
                const accuracy = document.getElementById('mf-accuracy').value;
                if (bank) params.set('bank_id', bank);
                if (range !== 'all') params.set('range', range);
                if (accuracy !== 'all') params.set('accuracy', accuracy);
                const qs = params.toString();
                window.location.hash = '#/sessions' + (qs ? '?' + qs : '');
            };
            ['mf-bank', 'mf-range', 'mf-accuracy'].forEach((id) => {
                document.getElementById(id).onchange = applyFilters;
            });
            const clearBtn = document.getElementById('mf-clear');
            if (clearBtn) {
                clearBtn.onclick = () => {
                    window.location.hash = '#/sessions';
                };
            }
            this.hydrateIcons(page);
        } catch (err) {
            page.innerHTML = `<div class="m-empty"><p>${esc(err.message)}</p></div>`;
        }
    },

    /**
     * 从 hash 读练习记录的筛选条件（与桌面端同一套约定）。
     * 取值只认白名单，手改 URL 写成别的值一律当未设置。
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

    // ══════════════════════════════════════════════════════════
    // 练习详情
    // ══════════════════════════════════════════════════════════

    async renderSessionDetail(id, page, titleEl) {
        titleEl.textContent = '答题详情';
        // 底部有常驻的上一题/下一题操作区，页面需相应留白
        page.classList.add('m-page--with-actions');
        // 左右拖动切上一题/下一题
        page.classList.add('m-page--swipeable');
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
                    <div class="m-progress-bar"><div class="m-progress-fill"></div></div>
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

                // CSP 拦内联 style 属性，进度条宽度只能这样赋值
                page.querySelector('.m-progress-fill').style.width =
                    ((idx + 1) / total) * 100 + '%';

                document.getElementById('det-prev').addEventListener('click', () => go(-1));
                document.getElementById('det-next').addEventListener('click', () => go(1));
                document.getElementById('show-review-sheet').addEventListener('click', () => {
                    self.showReviewSheet(answers, total, idx, (target) => {
                        idx = target;
                        renderDetail();
                    });
                });
            };

            /** 切题：dir 为 1 下一题、-1 上一题；能播动画就交给 slideTo */
            const go = (dir) => {
                const target = idx + dir;
                if (target < 0 || target >= total) return;
                idx = target;
                if (self.slideTo(page, dir, renderDetail)) return;
                renderDetail();
            };

            renderDetail();
            this.enableSwipe(
                page,
                () => go(1), // 左滑 → 下一题
                () => go(-1) // 右滑 → 上一题
            );
        } catch (err) {
            page.innerHTML = `<div class="m-empty"><p>${esc(err.message)}</p></div>`;
        }
    },

    // ══════════════════════════════════════════════════════════
    // 背题
    // ══════════════════════════════════════════════════════════

    /**
     * 背题模式：逐题直接给出正确答案与解析，不判分、不落库。
     *
     * 数据来源是 GET /api/questions（已对登录用户返回 answer / explanation），
     * 而不是 /api/practice/pick —— 后者刻意不下发答案（判分在服务端）。
     * 因此背题全程只读：不写 practice_sessions / practice_answers / wrong_book，
     * 既不污染错题本与统计，也不消耗 D1 的写入配额。
     */
    async renderRecite(page, titleEl) {
        titleEl.textContent = '背题';
        // 底部有常驻的上/下一题操作区
        page.classList.add('m-page--with-actions');
        // 左右拖动切题：向浏览器声明横向手势由页面自己处理
        page.classList.add('m-page--swipeable');

        const bankId = parseInt(this.hashParams().get('bank_id') || '', 10);
        if (!bankId) {
            page.innerHTML = '<div class="m-empty"><p>缺少题库参数</p></div>';
            return;
        }

        page.innerHTML = '<div class="m-loading"><div class="m-spinner"></div>加载中...</div>';

        let bank;
        try {
            bank = await API.getBank(bankId);
        } catch (err) {
            page.innerHTML = `<div class="m-empty"><p>${esc(err.message)}</p></div>`;
            return;
        }

        const self = this;
        const PAGE_SIZE = 200; // 服务端 per_page 硬上限
        const PREFETCH_AT = 20; // 距已加载尾部还剩这么多题时预取下一页

        const state = {
            bank: bank,
            type: '', // '' = 全部
            questions: [],
            idx: 0,
            loading: false,
            done: false,
            error: '',
            epoch: 0, // 题型切换令牌：用于丢弃过期响应
        };
        this.reciteData = state;

        // 只保留题量非空的题型，避免出现点进去空空如也的筛选项
        const types = [
            { key: '', label: '全部', count: bank.question_count },
            { key: 'single', label: '单选', count: bank.single_count },
            { key: 'multiple', label: '多选', count: bank.multiple_count },
            { key: 'truefalse', label: '判断', count: bank.truefalse_count },
        ].filter((t) => t.count > 0);

        if (types.length === 0) {
            page.innerHTML = '<div class="m-empty"><p>这个题库还没有题目</p></div>';
            return;
        }

        /** 当前筛选下的总题数（取题库的预计算统计，不额外查表） */
        const currentTotal = () => {
            const t = types.find((x) => x.key === state.type);
            return t ? t.count : 0;
        };

        /** 正确答案既可能是下标也可能是指标数组；解析失败时服务端给 -1 */
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

            const epoch = state.epoch;
            state.loading = true;
            state.error = '';
            render();

            try {
                const res = await API.getQuestions({
                    bank_id: bank.id,
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
            } catch (err) {
                if (epoch === state.epoch) state.error = err.message;
            } finally {
                if (epoch === state.epoch) {
                    state.loading = false;
                    state.done = state.questions.length >= currentTotal();
                    render();
                }
            }
        };

        /**
         * 跳题。dir 为 1/-1 时播滑动过渡（下一题/上一题）；0 表示直接重画
         * （题号抽屉跨多题跳转时不适合套用左右滑动，故不传方向）。
         */
        const goto = (target, dir = 0) => {
            const total = currentTotal();
            if (target < 0 || target >= total) return;
            // 下一页还没回来时不越过已加载范围，避免连点跳题
            if (target >= state.questions.length && state.loading) return;
            if (dir && self._slideBusy) return; // 过渡进行中，忽略本次输入

            state.idx = target;
            const prefetch = () => {
                if (!state.done && state.idx >= state.questions.length - PREFETCH_AT) loadNext();
            };
            if (dir && self.slideTo(page, dir, render)) {
                prefetch();
                return;
            }
            render();
            prefetch();
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
            const pct = total > 0 ? ((state.idx + 1) / total) * 100 : 0;

            const filterHtml = types
                .map(
                    (t) =>
                        `<button class="m-btn m-btn-sm ${
                            t.key === state.type ? 'm-btn-primary' : 'm-btn-secondary'
                        } recite-filter" data-type="${t.key}">${t.label} ${t.count}</button>`,
                )
                .join('');

            const cardHtml = q
                ? `
                    <div class="m-review-card">
                        <div class="m-question-meta"><span class="m-badge">${esc(self.getTypeLabel(q.type))}</span></div>
                        <div class="m-review-stem">${esc(q.stem)}</div>
                        ${q.options
                            .map((opt, oi) => {
                                // 先算好修饰类，避免在 class="…" 里跨行插值
                                // （check-styles 会把插值里的标识符当成类名）
                                const optCls =
                                    answerOk && answerIdxs.indexOf(oi) >= 0 ? ' correct' : '';
                                return `<div class="m-review-option${optCls}">${String.fromCharCode(65 + oi)}. ${esc(opt)}</div>`;
                            })
                            .join('')}
                        ${
                            answerOk
                                ? ''
                                : '<div class="m-review-explanation">本题答案数据异常，无法标注正确选项</div>'
                        }
                        ${
                            q.explanation
                                ? `<div class="m-review-explanation"><strong>解析：</strong>${esc(q.explanation)}</div>`
                                : ''
                        }
                    </div>`
                : '<div class="m-loading"><div class="m-spinner"></div>加载中...</div>';

            page.innerHTML = `
                <div class="m-practice-header">
                    <span class="tnum">第 ${state.idx + 1} / ${total} 题</span>
                    <span class="m-link" id="show-index">题号</span>
                </div>
                <div class="m-progress-bar"><div class="m-progress-fill"></div></div>
                <div class="m-flex m-gap-8 m-wrap">${filterHtml}</div>
                ${cardHtml}
                ${
                    state.error
                        ? `<div class="m-card"><div class="m-card-body">加载失败：${esc(
                              state.error,
                          )} <button class="m-link" id="rec-retry">重试</button></div></div>`
                        : ''
                }
                <div class="m-action-area">
                    <div class="m-practice-bar">
                        <button class="m-btn m-btn-primary" id="rec-prev" ${
                            state.idx === 0 ? 'disabled' : ''
                        }>上一题</button>
                        <button class="m-btn m-btn-primary" id="rec-next" ${
                            state.idx >= total - 1 ? 'disabled' : ''
                        }>${state.loading ? '加载中…' : '下一题'}</button>
                    </div>
                </div>`;

            // CSP 拦内联 style 属性，进度条宽度只能这样赋值
            page.querySelector('.m-progress-fill').style.width = pct + '%';

            page.querySelectorAll('.recite-filter').forEach((btn) => {
                btn.addEventListener('click', () => switchType(btn.dataset.type));
            });
            document.getElementById('rec-prev').addEventListener('click', () => goto(state.idx - 1, -1));
            document.getElementById('rec-next').addEventListener('click', () => goto(state.idx + 1, 1));
            document.getElementById('show-index').addEventListener('click', () => {
                self.showIndexSheet(total, state.questions.length, state.idx, goto);
            });
            const retry = document.getElementById('rec-retry');
            if (retry) retry.addEventListener('click', () => loadNext());
        };

        render();
        this.enableSwipe(
            page,
            () => goto(state.idx + 1, 1), // 左滑 → 下一题
            () => goto(state.idx - 1, -1), // 右滑 → 上一题
        );
        loadNext();
    },

    /**
     * 背题页的题号抽屉。
     *
     * 只列「已加载」的题号：大题库有一两千题，一次渲染上千个按钮既慢又毫无
     * 意义（未加载的题号点了也没有数据）。继续往后翻会自动加载更多。
     */
    showIndexSheet(total, loaded, currentIdx, onJump) {
        const mask = document.createElement('div');
        mask.className = 'm-drawer-mask';
        const drawer = document.createElement('div');
        drawer.className = 'm-drawer';

        let navHtml = '';
        for (let i = 0; i < loaded; i++) {
            const curCls = i === currentIdx ? ' current' : '';
            navHtml += `<button class="m-sheet-btn${curCls}" data-idx="${i}" aria-label="第 ${
                i + 1
            } 题"${curCls ? ' aria-current="true"' : ''}>${i + 1}</button>`;
        }

        drawer.innerHTML = `
            <div class="m-drawer-header">
                <span class="m-drawer-title">题号</span>
                <button class="m-drawer-close" aria-label="关闭"><span data-icon="x"></span></button>
            </div>
            <div class="m-drawer-body">
                <div class="m-sheet-legend">
                    <span class="m-sheet-legend-item"><span class="m-sheet-dot current"></span>当前</span>
                    <span class="m-sheet-legend-item">共 ${total} 题，已加载 ${loaded} 题</span>
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
                        <div class="m-field">
                            <label for="p-confirmpwd">确认新密码</label>
                            <input type="password" id="p-confirmpwd" class="m-input" autocomplete="new-password">
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
            const c = document.getElementById('p-confirmpwd').value;
            if (!o || !n || !c) {
                alert('请填写完整');
                return;
            }
            if (n.length < 6) {
                alert('新密码至少 6 位');
                return;
            }
            // 二次输入校验：服务端只收到拉伸后的值，无法分辨新密码是打错还是有意为之，
            // 一旦写错就会把原口令直接覆盖掉，所以必须在这里拦住。
            if (n !== c) {
                alert('两次输入的新密码不一致，请重新输入');
                const confirmInput = document.getElementById('p-confirmpwd');
                confirmInput.value = '';
                confirmInput.focus();
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
                document.getElementById('p-confirmpwd').value = '';
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
