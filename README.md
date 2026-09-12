# 二哥刷题宝

刷题练习应用。后端为 **Hono on Cloudflare Workers + D1**，前端为原生 JS 单页应用（桌面 `public/` + 移动 `public/mobile/`）。

> 本仓库由 PHP 版本迁移而来。迁移前的实现完整保留在 `legacy/`，仅作参考与回退之用。

---

## 快速开始（本地）

```bash
npm install --registry=https://registry.npmjs.org   # 见下方「已知坑」
npm run db:migrate:local                            # 建表
npm run dev                                         # http://127.0.0.1:8787
```

首次使用需要创建账号并设置口令（旧库迁移过来的账号无法直接登录，见下）：

```bash
npm run pw:set -- admin '你的口令' > /tmp/pw.sql
npx wrangler d1 execute DB --local --file=/tmp/pw.sql
```

> **本地访问必须用 `http://localhost:8787` 或 `http://127.0.0.1:8787`。**
> 登录依赖浏览器的 `crypto.subtle`，它只在安全上下文（HTTPS 或 localhost）可用。
> 用 `http://192.168.x.x` 打开会提示「当前环境不支持安全加密运算」。

---

## 架构

```
worker/
  src/
    index.ts            Hono 装配、统一 onError、静态资源回退
    routes/             按资源拆分的 10 个路由模块
    lib/                判分、口令、会话、时间、校验、乱序、题库统计
    middleware/auth.ts  会话解析、权限、CSRF
  migrations/           0001 表结构、0002 种子数据（由旧库生成）
  scripts/              种子生成、口令设置
  test/                 vitest（真实 workerd + 隔离 D1）
public/                 静态资源，由 Workers Static Assets 托管
tools/                  图标生成、冒烟测试
legacy/                 迁移前的 PHP 实现与旧数据库快照
```

请求分工：只有 `/api/*` 会进入 Worker（`assets.run_worker_first`），其余请求由静态资源层直接响应 —— 不计费、不消耗 CPU。

---

## 部署

前置：Cloudflare 账号、一个已接入 Cloudflare 的自有域名。

```bash
npx wrangler login                                  # 交互式授权
npx wrangler d1 create shuatibao                    # 把返回的 database_id 填入 wrangler.jsonc
npx wrangler secret put SERVER_KDF_SECRET           # 用于派生假盐，防止用户名枚举

npm run db:migrate:remote                           # 建表 + 导入既有数据
npm run pw:set -- admin '你的口令' > /tmp/pw.sql
npx wrangler d1 execute DB --remote --file=/tmp/pw.sql

npx wrangler deploy
```

部署前请把 `wrangler.jsonc` 中的 `routes` 取消注释并替换为你的域名，同时替换 `d1_databases[0].database_id`。

冒烟检查：

```bash
curl https://<你的域名>/api/health
```

**不要使用 `*.workers.dev`** —— 该域名在国内不可达（本机实测 DNS 被污染）。

---

## 关键设计决策

### 口令为什么在浏览器里拉伸

Workers 免费版每次请求只有 **10 ms CPU**。在真实 workerd 中实测：

| 方案 | 耗时 |
|---|---|
| PBKDF2-SHA256 600k 轮（OWASP 推荐） | 201 ms |
| bcrypt cost 12（旧 PHP 默认） | 250 ms |

服务端无法承载任何强度合格的口令哈希。因此采用 Bitwarden / 1Password 同款分离式 KDF：

1. 客户端取挑战（盐 + 轮数）
2. 浏览器算 `stretched = PBKDF2-SHA256(口令, 盐, 600k)` —— 约 200 ms，**花用户自己的 CPU**
3. 服务端算 `HMAC-SHA256(key=盐, msg=stretched)` 后常量时间比较 —— **< 0.1 ms**

安全性：库泄露时攻击者拿到盐与 HMAC 值，两者都不可逆，破解每个候选口令仍需完整跑一次 600k 轮 PBKDF2 —— 与直接存 bcrypt 强度相同。服务器被攻破时攻击者拿到的是拉伸值而非明文口令，无法用于撞库其它站点。

### 为什么所有列表都强制分页

实测在 workerd 中序列化 1376 道题约需 **8 ms CPU**，已逼近免费版 10 ms 上限。因此 `GET /api/questions` 的 `per_page` 硬上限为 200，导入改为客户端分批（每批 30 题，控制在每次调用 50 次查询额度内）。

### 时间一律显式按北京时间计算

D1 运行在 UTC，`datetime('now','localtime')` 在 D1 中**等于 UTC**。照搬旧 SQL 会让所有「今天」的判定偏移 8 小时，且对列套函数会使索引失效（D1 按扫描行数计费）。所有时间戳由 `worker/src/lib/time.ts` 显式计算并绑定，格式 `YYYY-MM-DD HH:MM:SS`，与历史数据一致。

---

## 从旧库迁移

```bash
npm run db:seed:generate     # 读 legacy/data/shuatibao.db，生成 0002_seed.sql
npm run db:migrate:local     # 或 db:migrate:remote
```

**旧账号无法直接登录。** 旧系统用 PHP 的 `bcrypt($2y$12$)`，新架构是「客户端 PBKDF2 拉伸 + 服务端 HMAC 验签」，两者不可互验。迁移时原哈希被存入 `legacy_password_hash` 仅作审计，`password_hash` 置空。

处理方式二选一：

- 管理员登录后通过「用户管理 → 重置密码」逐个重置；
- 或若留存了明文口令，用 `npm run pw:set -- <用户名> '<口令>'` 直接生成。

登录页对这类账号会明确提示「该账号由旧系统迁移而来，需要管理员重置密码后才能登录」，而不是含糊地报「用户名或密码错误」。

---

## 测试

```bash
npm test          # vitest，在真实 workerd 中跑，D1 用隔离实例
npm run typecheck
```

冒烟测试（需要先启动 `npm run dev`）：

```bash
node tools/smoke-auth.mjs http://127.0.0.1:8787 admin '你的口令'
node tools/smoke-api.mjs  http://127.0.0.1:8787 admin '你的口令'
```

测试覆盖了本次修复的每一项语义缺陷，包括：客户端伪造 `is_correct` 无效、未作答计「未答」而非「答错」、错题本移出后可重新进入、连续答对 5 次自动移出、错题统计按用户隔离、越权访问返回 404、题库统计为 0 而非 NULL、删除用户级联清理、北京时区日边界。

---

## 已知坑

**npm 默认 registry 是 npmmirror，会导致安装失败。** 该镜像的 workerd 二进制版本陈旧（`1.20260815.1`，而 wrangler 4.131 需要 `1.20260911.1`），postinstall 会报 `Expected "2026-09-11" but got "workerd 2026-08-15"`。安装时显式指定官方源：

```bash
npm install --registry=https://registry.npmjs.org
```

**`compatibility_date` 被测试工具链钉在 `2026-08-15`。** `@cloudflare/vitest-pool-workers` 依赖的 miniflare 捆绑 workerd `1.20260815`，更高日期无法启动。这里刻意让测试与线上使用同一日期，而不是让测试跑在另一套运行时语义上。待该依赖升级 miniflare 后可一并上调。

**npm 11 默认拦截 postinstall 脚本。** workerd 与 esbuild 的二进制由平台包直接提供，验证脚本被拦截不影响使用；若遇到问题可执行 `npm approve-scripts --allow-scripts-pending`。

---

## 目录：旧版本

`legacy/php/README.md` 记录了旧 PHP 实现的已知缺陷清单与运行方式。其中两个路由器（`router.php`、`public-router.php`）曾有**目录穿越漏洞**，可被匿名下载整个数据库与源码，已于迁移时修补。新架构不再包含 PHP，该问题不再存在。
