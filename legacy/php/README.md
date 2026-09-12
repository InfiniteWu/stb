# legacy/php —— 已冻结的 PHP 后端

这里存放**迁移前**的 PHP 实现，仅作参考与过渡期回退之用，不再演进。

## 为什么还在

新架构（`worker/`，Hono on Cloudflare Workers + D1）尚未上线期间，这套 PHP 版本
仍可继续提供服务，避免迁移过程影响正在使用的用户。

## 目录结构

```
legacy/
├── data/shuatibao.db     # 迁移前的数据库快照（含全部业务数据）
└── php/
    ├── api/              # 后端 API（手写路由分发）
    ├── router.php        # PHP 内置服务器路由器（run.sh 使用）
    ├── public-router.php # 另一份路由器，未被 run.sh 使用
    ├── run.sh            # 启动脚本
    ├── nginx.conf        # 未启用，且已知有缺陷（见下）
    └── tools/migrate.php # 一次性数据迁移脚本，已失效
```

`public/` 静态资源**不在**这里，仍位于仓库根目录 —— 新旧两套后端共用同一份前端。
因此 `router.php` 与 `public-router.php` 都通过 `PUBLIC_DIR` 常量显式指回仓库根。
同理，`api/config.php` 的 `DB_PATH` 上溯两层指向 `legacy/data/`。

## 运行

```bash
cd legacy/php
./run.sh 2026            # 默认端口 2026
```

> **注意**：Windows/Linux 上若 PHP 的 `session.save_path` 不可写，登录会失败并报
> `session_start(): open(...) failed`。可用
> `php -d session.save_path=/tmp/php-sess -S 0.0.0.0:2026 router.php` 规避。

## 已知缺陷（均已在 worker/ 新架构中修复，此处不再回补）

安全类 **已修复**：

- **目录穿越**：`router.php` 与 `public-router.php` 原先都能被
  `/../data/shuatibao.db` 读取整个数据库、被 `/../api/*.php` 读取源码，
  已于 2026-09-12 修补（`realpath()` 前缀校验 + 扩展名白名单 + 越权返回 403）。

功能类 **保持原状**（详见迁移计划）：

- 练习计分完全信任前端传来的 `is_correct`，可伪造满分
- `unanswered_count` 恒为 0，「不会」被计为错题
- 已被移除的错题无法重新进入错题本（`INSERT OR IGNORE` 与唯一约束冲突）
- 删除用户因外键约束失败，接口却仍返回 `{"ok":true}`
- 空题库统计被写成 `NULL` 而非 `0`
- `GET /api/questions` 无分页，题库 2 有 1376 题会一次性返回
- `api/wrongbook.php:32` 存在未定义索引警告

配置类：

- `nginx.conf` 的正则 location `^/api/(?!index\.php$)` 会拒绝**全部** `/api/*`
  （正则 location 优先于无 `^~` 的前缀 location），一旦启用即全站 403 —— 故从未启用。
- `tools/migrate.php` 中 `'/server\\shuatibao.db'` 的反斜杠是字面量，在 Linux 上
  路径无效；该脚本已被 `worker/scripts/make-seed.mjs` 取代。

## 何时删除

线上新架构稳定运行一个发布周期后，即可整体删除本目录。届时如果还需要旧版本，
从 git 历史取即可：

```bash
git show d9627ac:api/index.php      # 迁移前的原始实现
```
