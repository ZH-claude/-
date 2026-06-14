# T04 自检记录

日期：2026-06-14

范围：管理后台基础。包含管理员环境变量引导、管理员权限守卫、用户列表、公告发布、公告记录、公告创建审计、前端 `/admin` 页面和同源后台代理。

## 1. 本次交付

| 交付物 | 路径 | 状态 |
| --- | --- | --- |
| 后台数据表与迁移 | `apps/api/prisma/schema.prisma`、`apps/api/prisma/migrations/20260614120000_t04_admin_announcements_audit/migration.sql` | 完成 |
| 管理后台后端模块 | `apps/api/src/admin/*` | 完成 |
| 管理员环境变量引导 | `ADMIN_BOOTSTRAP_USERNAME`、`ADMIN_BOOTSTRAP_PASSWORD` | 完成 |
| 前端后台页面 | `apps/web/app/admin/page.tsx` | 完成 |
| 前端后台 API 客户端与代理 | `apps/web/app/lib/admin-api.ts`、`apps/web/app/api/admin/[...path]/route.ts` | 完成 |
| QA 截图 | `.gstack/qa-reports/artifacts/t04-admin-desktop.png`、`.gstack/qa-reports/artifacts/t04-admin-mobile.png` | 完成 |

## 2. 功能闭环

| 功能 | 验证结果 |
| --- | --- |
| 管理员引导 | 通过，Compose 临时传入管理员用户名和强密码后，API 启动时创建/更新管理员 |
| 普通用户访问后台 | 通过，普通用户访问 `/admin/users` 返回 HTTP 403 |
| 管理员登录 | 通过，复用 `/auth/login`，返回用户角色 `admin` |
| 用户列表 | 通过，管理员可读取 `/admin/users?limit=100`，列表包含新建普通用户 |
| 发布公告 | 通过，管理员可 POST `/admin/announcements` 创建 published 公告 |
| 公告输入校验 | 通过，非法 `status` 返回 HTTP 400 |
| 公告记录 | 通过，管理员可 GET `/admin/announcements` 看到新公告 |
| 审计日志 | 通过，`admin_audit_logs` 为公告创建写入 1 条 `announcement_created` |
| 前端后台 | 通过，浏览器登录管理员后进入 `/admin`，可查看用户、发布中文公告、查看公告记录 |

## 3. 验证命令

| 命令/检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `npm audit --prefix apps/api --audit-level=moderate` | 0 漏洞 |
| `npm audit --prefix apps/web --audit-level=moderate` | 0 漏洞 |
| `docker compose -p nested-api-relay up --build -d` | 通过 |
| API 健康检查 | 通过，`/health` 返回 `status: ok` |
| Docker API 日志 | 通过，`prisma migrate deploy` 无待迁移，API 使用 `node dist/main.js` 启动 |
| Docker Web 日志 | 通过，Web 使用 `next start -p 3000` 启动 |
| API 权限链路脚本 | 通过：普通用户 403、管理员用户列表、公告发布、公告列表、审计日志 |
| API 异常输入脚本 | 通过：非法公告 `status` 返回 HTTP 400 |
| Playwright 浏览器脚本 | 通过：管理员登录、后台加载、中文公告发布、HttpOnly Cookie、移动端无横向溢出、无 Next dev 浮标 |

## 4. 自检发现并修复的问题

| 问题 | 根因 | 修复 |
| --- | --- | --- |
| 后台守卫依赖隐式继承注入 | `AdminGuard` 继承 `AuthGuard` 时没有显式构造注入，运行时 DI 风险高 | 改为 `@UseGuards(AuthGuard, AdminGuard)`，`AdminGuard` 只检查已附加的用户角色 |
| 缺少稳定管理员登录入口 | 只有普通注册登录，没有管理员账号创建路径 | 增加 `ADMIN_BOOTSTRAP_USERNAME` / `ADMIN_BOOTSTRAP_PASSWORD` 环境变量引导管理员 |
| 前端说明与接口分页不一致 | 页面写最多 100 个用户，接口默认请求 20 个 | 前端请求 `/admin/users?limit=100` |
| 公告状态输入过宽 | 非字符串 `status` 会被默认发布 | 非空非法 `status` 改为 HTTP 400 |
| 并行执行 `typecheck` 和 `build` 触发 Prisma generate 目录冲突 | 两个命令同时写 `apps/api/src/generated/prisma` | 清理生成目录并改为串行执行验证 |
| PowerShell API 脚本中文请求体显示为 `??` | 本机 PowerShell 管道编码影响 JSON 字面量 | API 脚本改用 ASCII，浏览器 QA 使用 Unicode 字符串覆盖中文输入 |

## 5. 安全边界

- 管理员密码不写入仓库；本地自检仅通过临时环境变量传入。
- 后台接口复用 HttpOnly Cookie 会话，不在浏览器代码保存 token。
- 普通用户后台访问返回 403。
- 公告创建写入审计日志。
- 本任务未实现余额调整、禁用用户、上游配置、模型价格、卡密、API Key 或 Relay；这些仍按 T05 以后任务推进。
