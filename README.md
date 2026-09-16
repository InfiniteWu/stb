# 二哥刷题宝

班组刷题练习应用：题库练习、背题模式、错题本、练习记录。桌面端与手机端各一套界面，小屏访问会自动跳到手机版。

**在线使用：https://stb.jorinedu.top**

---

## 功能

| 功能 | 说明 |
|---|---|
| **练习** | 按题库抽题，单选 / 多选 / 判断可分别指定数量；可选随机抽题与打乱选项；交卷后由服务端判分 |
| **背题模式** | 逐题直接给出正确答案与解析，可按题型筛选、整库通背；不计分，也不写入任何记录 |
| **错题本** | 答错自动收录；同一题连续答对 5 次自动移出；手动移出的题之后答错可重新进入 |
| **练习记录** | 每次练习的正确率，以及逐题回顾（含正确答案与解析） |
| **题库管理** | 管理员：题库增删改、题目维护、JSON 批量导入 |
| **用户管理** | 管理员：建号、改显示名、重置口令、删除用户 |

## 使用

1. 浏览器打开 https://stb.jorinedu.top
2. 用管理员分配的账号登录（首次登录后可在「我的 → 个人设置」修改口令）
3. 「练习」→ 选择题库 → 设定各题型数量 → 开始练习
4. 手机端在题库卡片上还可直接点「背题模式」：不用作答，一路看正确答案与解析过一遍
5. 答完提交即可看到成绩；做错的题会进入「错题本」，随时回来重做

手机端答题页与背题页都支持左右滑动切上一题 / 下一题。

## 技术栈

- 后端 **Hono on Cloudflare Workers**，数据库 **Cloudflare D1**（SQLite）
- 前端原生 JavaScript 单页应用，无构建步骤
- 桌面端 `public/`，手机端 `public/mobile/`

## 目录结构

```
worker/    后端源码、数据库迁移与测试
public/    前端静态资源（public/mobile/ 为手机端）
tools/     图标生成与冒烟测试脚本
```

## 本地运行

```bash
npm install --registry=https://registry.npmjs.org   # 默认镜像的 workerd 版本过旧，会装失败
npm run db:migrate:local                            # 建表
npm run pw:set -- admin '你的口令' > /tmp/pw.sql     # 设置管理员口令
npx wrangler d1 execute DB --local --file=/tmp/pw.sql
npm run dev                                         # http://127.0.0.1:8787
```

必须用 `http://localhost:8787` 或 `http://127.0.0.1:8787` 访问：登录依赖浏览器的 `crypto.subtle`，它只在安全上下文（HTTPS 或 localhost）下可用。

## 许可

MIT，见 `LICENSE`。
