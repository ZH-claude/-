# T06 自检记录

日期：2026-06-14

范围：模型与分组配置。包括 `model_prices`、`upstream_models`、`model_group_accesses` 三张表，管理员模型/分组/映射接口，账户中心可用模型展示，以及用户分组调整。

## 1. 本次交付

| 交付物 | 路径 | 状态 |
| --- | --- | --- |
| 模型与分组配置数据表 | `apps/api/prisma/schema.prisma`、`apps/api/prisma/migrations/20260614141000_t06_model_group_config/migration.sql` | 完成 |
| 统一模型可见性查询服务 | `apps/api/src/model-catalog.service.ts` | 完成 |
| 管理员模型配置 API | `apps/api/src/admin/admin.controller.ts`、`apps/api/src/admin/admin.service.ts` | 完成 |
| 用户资料返回可用模型 | `apps/api/src/auth/auth.service.ts` | 完成 |
| 管理后台模型/分组配置 UI | `apps/web/app/admin/page.tsx`、`apps/web/app/lib/admin-api.ts`、`apps/web/app/globals.css` | 完成 |
| 账户中心可用模型展示 | `apps/web/app/account/page.tsx`、`apps/web/app/lib/auth-api.ts` | 完成 |

## 2. 功能闭环

| 功能 | 验证结果 |
| --- | --- |
| 创建分组 | 通过：管理员可 `POST /admin/groups` 创建 code、name、multiplier、status |
| 调整用户分组 | 通过：管理员可 `POST /admin/users/:id/group` 把用户切到目标分组，并写审计 |
| 创建模型价格 | 通过：管理员可 `POST /admin/models` 配置公开模型名、价格、倍率、可见分组 |
| 创建上游模型映射 | 通过：管理员可 `POST /admin/upstream-models` 绑定 provider、public model、upstream model |
| 用户可见模型 | 通过：`/auth/me` 只返回当前用户分组允许、模型启用、上游启用且有映射的模型 |
| 越权保护 | 通过：普通用户访问 `/admin/model-config` 返回 403 |
| 自检数据清理 | 通过：临时用户、分组、模型、上游、映射、审计日志均已删除 |

## 3. 验证命令

| 命令/检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `docker compose -p nested-api-relay up -d --build` | 通过，迁移失败恢复后服务稳定运行 |
| `curl http://127.0.0.1:3001/health` | 通过，返回 `status: ok` |
| `curl http://127.0.0.1:3000/admin` | 通过，HTTP 200 |
| 迁移检查 | 通过，`model_prices`、`upstream_models`、`model_group_accesses` 三张表存在 |
| 真实后台 API QA | 通过，临时管理员创建分组、模型、上游和映射成功 |
| 真实用户可见性 QA | 通过，`qa_t06_user_*` 只看到 `qa-model-*`，未看到 default-only 模型 |
| 真实浏览器账户页 QA | 通过，登录后账户页显示临时用户、分组、唯一可用模型，`/api/auth/me` 返回真实 DB 数据 |
| 真实浏览器后台页 QA | 通过，管理员后台显示临时分组、模型价格、上游映射、用户分组和脱敏 Key |
| 上游映射分页 QA | 通过，创建 2 条真实临时映射，`upstreamModelsLimit=1` 时第 1/2 页各返回 1 条，`total=2`、`totalPages=2` |
| 非管理员访问后台模型配置 | 通过，返回 403 |
| 数据库密钥检查 | 通过，`encrypted_api_key` 为 `v1:` 密文格式，不包含 `sk-t06-*` |
| 审计日志明文检查 | 通过，`admin_audit_logs` 中包含原始 QA Key 的记录数为 0 |
| 数据清理检查 | 通过，`qa_t06_*` 用户/分组、`qa-model-*`、`qa-default-*`、`qa-t06-*` 上游、映射和审计残留均为 0 |

## 4. 自检发现并修复的问题

| 问题 | 根因 | 处理 |
| --- | --- | --- |
| API 容器重启，T06 迁移未完成 | 迁移文件最初由 PowerShell 写入时带 UTF-8 BOM，PostgreSQL 在首字符报语法错误 | 移除 BOM，确认迁移文件首字节为 `2D 2D 20`，用 `prisma migrate resolve --rolled-back` 恢复失败记录后重新应用迁移 |
| React 状态读取上游列表可能为空 | 加载模型配置时依赖刚 `setUpstreams` 的异步状态 | `applyModelConfiguration` 接收接口刚返回的 provider 列表，避免默认 provider 选择为空 |
| 禁用分组仍可能看到模型 | 模型查询最初只按 group id 过滤 | `ModelCatalogService` 增加 `GroupStatus.ACTIVE` 判断，禁用分组返回空模型列表 |
| 表单 placeholder 像假模型/假上游 | 管理后台输入框使用了示例模型名和 `example.com` 域名 | 改成中性输入提示，避免把示例值误认为真实配置 |
| 上游映射列表静默截断 | 侧审发现后台配置接口固定取 100 条，超过后管理员无法看见全部映射 | `/admin/model-config` 增加 `upstreamModelsPage/upstreamModelsLimit`、`total/totalPages`，前端增加映射分页 |

## 5. 安全边界

- T06 不实现 Relay `/v1/models` 或 `/v1/chat/completions`，这些仍归 T08。
- 普通用户只能通过 `/auth/me` 看到自己分组可见模型，不能访问后台模型配置接口。
- 上游 API Key 继续沿用 T05 的 AES-256-GCM 加密保存和脱敏展示，T06 不返回明文 Key。
- 模型可见性以数据库配置为准，不使用硬编码模型列表或假数据。
