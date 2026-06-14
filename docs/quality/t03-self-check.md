# T03 自检记录

日期：2026-06-14

范围：用户认证与账户基础。包含注册、登录、服务端会话、退出、修改密码、用户表、默认分组、钱包初始化和前端账户页。

## 1. 本次交付

| 交付物 | 路径 | 状态 |
| --- | --- | --- |
| Prisma schema 与迁移 | `apps/api/prisma/schema.prisma`、`apps/api/prisma/migrations/20260614093111_init_auth/migration.sql` | 完成 |
| 认证后端模块 | `apps/api/src/auth/*`、`apps/api/src/prisma.service.ts` | 完成 |
| 前端认证页面 | `apps/web/app/register`、`apps/web/app/login`、`apps/web/app/account` | 完成 |
| 前端 API 客户端 | `apps/web/app/lib/auth-api.ts` | 完成 |
| Docker 自动迁移 | `docker-compose.yml` | 完成 |

## 2. 功能闭环

| 功能 | 验证结果 |
| --- | --- |
| 注册用户 | 通过，返回会话 token，创建默认分组和 0 余额钱包 |
| 重复用户名 | 通过，返回 HTTP 409 |
| 登录 | 通过，正确密码返回会话 token |
| 读取当前账户 | 通过，`/auth/me` 返回用户、分组、钱包 |
| 修改密码 | 通过，旧密码失效，其他会话被撤销 |
| 退出 | 通过，当前会话被撤销，旧 token 再访问返回 HTTP 401 |
| 前端流程 | 通过，注册进入账户、改密、退出、用新密码登录 |

## 3. 验证命令

| 命令/检查 | 结果 |
| --- | --- |
| `npm --prefix apps/api run typecheck` | 通过 |
| `npm --prefix apps/web run typecheck` | 通过 |
| `npm run build` | 通过 |
| `npm audit --prefix apps/api --audit-level=moderate` | 0 漏洞 |
| `npm audit --prefix apps/web --audit-level=moderate` | 0 漏洞 |
| `docker compose -p nested-api-relay up --build -d` | 通过，API 启动前执行 `prisma migrate deploy` |
| API 链路脚本 | 通过：health、register、duplicate 409、me、change-password、old password 401、logout revoke、new password login |
| Playwright 浏览器脚本 | 通过：注册、账户页、改密、退出、新密码登录、桌面/移动无横向溢出、无应用控制台错误 |

## 4. 自检中发现并修复的问题

| 问题 | 根因 | 修复 |
| --- | --- | --- |
| Prisma schema `url = env(...)` 失败 | Prisma 7 改为在 `prisma.config.ts` 管理 datasource URL | 增加 `apps/api/prisma.config.ts`，应用端使用 `@prisma/adapter-pg` |
| Nest dev 容器中依赖注入为 `undefined` | `tsx` 运行 Nest 时构造函数元数据不稳定 | 对 `AuthController`、`AuthGuard`、`AuthService` 增加显式 `@Inject(...)` |
| API audit 出现 Prisma CLI 间接中危 | `@hono/node-server` 旧版本由 Prisma dev 依赖引入 | 使用 npm override 提升到修复版本，审计回到 0 漏洞 |
| 注册页点击后变成 `/register?` | Next dev 阻止 `127.0.0.1` HMR 资源，页面未 hydration | 增加 `apps/web/next.config.ts` 的 `allowedDevOrigins` |
| Chrome 拦截用户名 pattern | HTML pattern 在新正则规则下不兼容 | 移除前端 pattern，保留后端用户名校验 |
| 移动端账户页横向溢出 | grid item 默认 `min-width:auto` 被长用户名撑宽 | 面板加 `min-width:0`，标题/信息加断词 |

## 5. 安全边界

- 密码仅存 bcrypt hash，不存明文。
- Web 会话使用随机 opaque token，数据库只存 SHA-256 token hash。
- `.env`、真实数据库密码、上游账号密码、上游 API Key 和用户会话 token 没有写入仓库。
- 本任务未实现 API Key、充值、余额扣费、上游转发、管理员后台；这些仍按 T04 以后任务推进。

## 6. 剩余风险

| 风险 | 处理方式 |
| --- | --- |
| 当前 Web 会话 token 存在 localStorage | MVP 阶段可接受；后续安全加固可迁移到 httpOnly cookie |
| `users.username` 当前是普通唯一约束 | T11/T19 做软删除和账号治理时再升级为 PostgreSQL 部分唯一索引 |
| 会话存储当前在 PostgreSQL | 可在后续风控/限流阶段加入 Redis 会话缓存或在线状态 |
