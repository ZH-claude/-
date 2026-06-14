# T16 自检报告 - 异步任务与绘图日志

日期：2026-06-15
任务：T16 异步任务与绘图日志
范围：新增 `async_tasks` 持久化表、用户侧任务查询接口、Next 同源代理、`/task` 通用异步任务页和 `/midjourney` 绘图日志页；页面只读取当前用户已有真实任务记录，未接入提交或同步链路时保持空状态和未接入能力标识。

## 交付物

| 项目 | 文件 | 状态 |
| --- | --- | --- |
| 异步任务数据模型与迁移 | `apps/api/prisma/schema.prisma`、`apps/api/prisma/migrations/20260615190000_t16_async_tasks/migration.sql` | 完成 |
| 用户侧异步任务接口 | `apps/api/src/async-tasks/*` | 完成 |
| 后端模块接入 | `apps/api/src/app.module.ts` | 完成 |
| Next 同源代理 | `apps/web/app/api/async-tasks/[[...path]]/route.ts` | 完成 |
| 前端客户端 | `apps/web/app/lib/async-tasks-api.ts` | 完成 |
| 异步任务页 | `apps/web/app/task/*` | 完成 |
| 绘图日志页 | `apps/web/app/midjourney/page.tsx` | 完成 |
| 首页入口 | `apps/web/app/page.tsx` | 完成 |
| 真实数据 QA 脚本 | `apps/api/scripts/t16-async-tasks-qa.ts` | 完成 |
| 任务记录 | `docs/superpowers/specs/2026-06-14-nested-api-relay-development-plan.md` | 完成 |

## 核心行为

| 场景 | 结果 |
| --- | --- |
| 未登录访问 `/async-tasks` | 后端返回 401，前端 `/task` 跳转 `/login` |
| 当前用户查询任务 | 后端强制 `where: { userId: currentUser.id }`，只返回当前用户记录 |
| 其他用户任务 | 不出现在 API、Next 代理或浏览器页面 |
| 任务筛选 | 支持 `kind`、`status`、`platform`、`model`、`limit`，非法值返回 400 |
| 绘图日志 | `/midjourney` 固定 `kind=image`，只显示绘图类记录 |
| 空状态 | 无记录用户返回 0 条、空平台/模型选项，页面显示空状态 |
| 能力状态 | 提交入口、图片提交、状态同步均明确为未接入，不返回成功能力 |
| 敏感字段 | 响应不返回 `userId`、`upstreamProviderId`、`passwordHash`、`tokenHash` |

## 验证记录

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `docker compose -p nested-api-relay up -d --build api web` | 通过，生产构建包含 `/task`、`/midjourney`、`/api/async-tasks/[[...path]]` |
| 数据库迁移 | 通过，`20260615190000_t16_async_tasks` 已应用 |
| API 路由映射 | 通过，API 日志显示 `/async-tasks` 已映射 |
| `npm run qa:t16:async-tasks` | 通过，真实 HTTP + 真实 Postgres + 真实 Next 代理 |
| 浏览器 QA | 通过，`/task`、失败状态筛选、刷新、`/midjourney`、未登录跳转和控制台错误均验证 |
| `npm run qa:t15:announcements` | 通过，首页公告兼容 |
| `npm run qa:t14:notifications` | 通过，通知和 Relay 扣费链路兼容 |
| `npm --prefix apps/api audit --audit-level=moderate` | 0 vulnerabilities |
| `npm --prefix apps/web audit --audit-level=moderate` | 0 vulnerabilities |
| T16 新代码数据真实性扫描 | 无 `fake/mock/dummy/sample/hardcode/模拟/假数据/伪造/糊弄/滥竽充数` 命中 |
| T16 敏感字段扫描 | 命中均为 QA 断言或服务端 owner 过滤；接口响应未暴露敏感字段 |
| `git diff --check` | 通过，无空白错误 |
| T16 QA 数据清理 | 脚本和浏览器临时记录均清理为 0 残留 |

真实任务 QA 摘要：

```json
{
  "ok": true,
  "checks": [
    "unauthenticated_async_task_requests_are_rejected",
    "real_async_task_rows_are_written_to_postgres",
    "owner_filter_returns_only_current_user_async_tasks",
    "kind_filter_returns_only_image_tasks",
    "status_filter_returns_real_failure_reason",
    "platform_and_model_filters_are_applied_together",
    "limit_reduces_rows_without_changing_summary",
    "invalid_filters_are_rejected",
    "empty_user_gets_real_empty_state_data",
    "next_proxy_returns_authenticated_async_tasks",
    "async_task_response_uses_sensitive_field_allowlist_and_honest_capabilities"
  ],
  "residualAfterCleanup": {
    "users": 0,
    "sessions": 0,
    "wallets": 0,
    "async_tasks": 0
  }
}
```

浏览器 QA 摘要：

```json
{
  "ok": true,
  "checks": [
    "browser_real_users_and_async_task_rows_created",
    "browser_task_page_shows_only_current_user_real_tasks",
    "browser_task_status_filter_uses_real_backend_query",
    "browser_task_refresh_preserves_filtered_real_data",
    "browser_midjourney_page_shows_only_image_kind_tasks",
    "browser_console_and_runtime_errors_absent",
    "browser_unauth_task_redirects_to_login"
  ],
  "residualAfterCleanup": {
    "users": 0,
    "sessions": 0,
    "wallets": 0,
    "async_tasks": 0
  }
}
```

浏览器证据截图：

- `C:\Users\15359\AppData\Local\Temp\t16-async-tasks-browser-task-final.png`
- `C:\Users\15359\AppData\Local\Temp\t16-async-tasks-browser-midjourney-final.png`

## Review + QA 结论

- Pre-landing review：重点检查 SQL/data 安全、owner 过滤、枚举完整性、过滤参数校验、公开字段白名单、Next 代理 Cookie 转发、未登录重定向和前端表格展示；发现并修复一个未登录错误格式未带状态码的问题。
- Greptile triage：本机没有 `gh` 命令，未接入 PR 评论检查；本地 diff review 已完成。
- QA：通过真实注册用户、真实 `async_tasks` 记录、真实后端接口、真实 Next 代理和真实浏览器路径验证；任务记录不是前端静态数组或硬编码页面内容。
- Worker workshare：Godel sidecar 只读复核 T16 数据模型、owner 隔离、前端路由和 QA 清单；Codex 采纳“绘图日志用 `kind=image` 承载、首期只查询真实记录、能力未接入时保持关闭”的方向，并完成实现、验证和最终审查。

## CEO + CTO 审查

- 用户价值：用户现在可以在控制台查看自己的异步任务和绘图记录，能按状态、平台、模型筛选，失败原因和结果来自持久化记录。
- 数据真实性：页面只调用 `/api/async-tasks`，后端只查 `async_tasks`；未接入提交/同步能力时不展示成功入口。
- 安全边界：所有查询由 `AuthGuard` 保护，并在服务层强制当前用户 `userId`；QA 验证跨用户任务不会出现在 API 或页面。
- 兼容性：T16 不改 Relay、计费、日志、公告、通知主流程；T15、T14 回归通过。
- 商业化判断：当前是查询与日志基础，适合 MVP；商用阶段需要把真实上游异步提交、轮询同步、重试和队列 outbox 接入这张表。

## 剩余边界

- T16 不实现 Midjourney 提交、图片上传、状态轮询 worker、重试按钮或结果附件下载。
- T16 不把上游异步接口接进 Relay；当前只建立真实任务记录查询面。
- 后续写入链路接入时，应在服务端统一校验进度范围、状态流转和上游任务 ID 幂等规则。
