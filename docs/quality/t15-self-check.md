# T15 自检报告 - 首页公告与文档入口

日期：2026-06-15
任务：T15 首页公告与文档入口
范围：管理员发布真实公告、更新日志和使用建议；用户首页只读取已发布内容；草稿、归档和管理员字段不进入公开首页；文档入口链接到当前已实现页面。

## 交付物

| 项目 | 文件 | 状态 |
| --- | --- | --- |
| 公告分类数据模型与迁移 | `apps/api/prisma/schema.prisma`、`apps/api/prisma/migrations/20260615173000_t15_announcement_categories/migration.sql` | 完成 |
| 用户侧公开公告接口 | `apps/api/src/announcements/*` | 完成 |
| 后端模块接入 | `apps/api/src/app.module.ts` | 完成 |
| 后台公告分类发布 | `apps/api/src/admin/admin.service.ts`、`apps/web/app/admin/page.tsx`、`apps/web/app/lib/admin-api.ts` | 完成 |
| 首页公告代理与客户端 | `apps/web/app/api/announcements/route.ts`、`apps/web/app/lib/announcements-api.ts` | 完成 |
| 首页真实展示 | `apps/web/app/page.tsx`、`apps/web/app/globals.css` | 完成 |
| 真实数据 QA 脚本 | `apps/api/scripts/t15-announcements-qa.ts` | 完成 |
| 任务记录 | `docs/superpowers/specs/2026-06-14-nested-api-relay-development-plan.md` | 完成 |

## 核心行为

| 场景 | 结果 |
| --- | --- |
| 管理员发布公告 | 写入真实 `announcements`，记录分类、状态、发布时间和审计日志 |
| 普通用户发布公告 | `AuthGuard + AdminGuard` 拦截，返回 403 |
| 后台公告列表 | 管理员可看到草稿、已发布、归档，保持运营视角 |
| 公开公告接口 | 只返回 `PUBLISHED` 内容，按 `announcement`、`update_log`、`usage_guide` 分组 |
| 首页展示 | 从 `/api/announcements` 读取真实发布内容，空分类显示空状态 |
| 文档入口 | 链接到当前已存在的令牌、费用、日志、充值、分组状态、通知设置页面 |
| 敏感字段 | 不返回 `createdByAdminId`、`createdBy`、管理员用户 ID、草稿/归档状态或审计字段 |

## 验证记录

| 检查 | 结果 |
| --- | --- |
| `npm --prefix apps/api run typecheck` | 通过 |
| `npm --prefix apps/web run typecheck` | 通过 |
| `docker compose -p nested-api-relay up -d --build api web` | 通过，生产构建包含 `/api/announcements` |
| 数据库迁移 | 通过，`20260615173000_t15_announcement_categories` 已应用 |
| API 路由映射 | 通过，API 日志显示 `/announcements` 已映射 |
| `npm run qa:t15:announcements` | 通过，真实 HTTP + 真实 Postgres + 真实 Next 代理 |
| 浏览器 QA | 通过，真实管理员后台发布三类内容；首页只显示已发布内容；文档入口跳转；控制台 0 错误 |
| `npm run qa:t14:notifications` | 通过，通知链路兼容 |
| `npm audit --prefix apps/api --audit-level=moderate` | 0 vulnerabilities |
| `npm audit --prefix apps/web --audit-level=moderate` | 0 vulnerabilities |
| T15 新代码假数据扫描 | 无 `fake/mock/dummy/模拟/假数据/伪造/糊弄/滥竽充数` 命中 |
| T15 敏感字段扫描 | 命中均为 QA 断言或后台运营接口；公开公告接口和首页未返回敏感字段 |
| `git diff --check` | 通过，无空白错误 |
| T15 QA 数据清理 | 脚本和浏览器 fixture 均清理为 0 残留 |

真实公告 QA 摘要：

```json
{
  "ok": true,
  "checks": [
    "admin_guard_blocks_ordinary_user_announcement_publish",
    "admin_creates_real_announcement_categories_and_statuses",
    "database_stores_real_announcement_categories",
    "admin_list_keeps_full_operational_visibility",
    "public_api_returns_only_published_real_announcements_by_category",
    "next_proxy_returns_same_published_announcement_feed",
    "public_announcement_feed_uses_sensitive_field_allowlist"
  ],
  "residualAfterCleanup": {
    "users": 0,
    "sessions": 0,
    "wallets": 0,
    "announcements": 0,
    "admin_audit_logs": 0
  }
}
```

浏览器 QA 摘要：

```json
{
  "ok": true,
  "checks": [
    "browser_real_admin_and_user_registered",
    "browser_admin_page_loaded_with_real_session",
    "browser_admin_published_real_categories_and_draft",
    "browser_homepage_shows_only_published_real_announcements",
    "browser_homepage_document_entry_navigates"
  ],
  "consoleErrors": [],
  "residualAfterCleanup": {
    "announcements": 0,
    "users": 0
  }
}
```

浏览器证据截图：`C:\Users\15359\AppData\Local\Temp\t15-announcements-browser-final.png`

## Review + QA 结论

- Pre-landing review：重点检查公开接口只读边界、发布状态过滤、公告分类枚举、后台兼容性、首页空状态、敏感字段白名单和真实数据路径；未发现阻塞级问题。
- Greptile triage：本机没有 `gh` 命令，未接入 PR 评论检查；本地 diff review 已完成。
- QA：通过真实管理员、真实数据库、真实后端接口、真实 Next 代理和真实浏览器路径验证；没有写死演示公告或伪造更新日志。
- Worker workshare：Schrodinger sidecar 只读复核 T15 数据模型、用户侧 API、首页受影响文件、安全边界和 QA 清单；Codex 采纳“仅公开 PUBLISHED、公开响应白名单、首页空状态不造数据”的建议，并完成实现、验证和最终审查。

## CEO + CTO 审查

- 用户价值：首页不再是静态壳，用户能看到运营真实发布的公告、更新日志和使用建议。
- 数据真实性：公告、更新日志、使用建议全部来自 `announcements` 表的真实发布记录；无数据时显示空状态。
- 安全边界：后台接口保留完整运营视角，公开接口只返回可公开字段；普通用户不能发布公告。
- 兼容性：旧公告默认归入平台公告；现有后台公告发布继续可用，T14 通知链路回归通过。
- 可运营性：分类枚举和公开 feed 结构后续可接系统公告通知、首页置顶、分页和富文本，但不影响当前 MVP。

## 剩余边界

- T15 不做富文本编辑、附件、置顶、分页、定向公告或已读状态。
- T15 不把系统公告自动推送到 T14 通知通道；这里只做首页读取和展示。
- 文档入口只链接当前已实现页面，不新增外部教程或静态说明文章。
