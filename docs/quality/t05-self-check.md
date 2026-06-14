# T05 自检记录

日期：2026-06-14

范围：上游中转站配置。包括 `upstream_providers` 表、Base URL、上游 API Key 加密保存、管理员上游配置接口、健康检查接口、管理后台上游配置界面。

## 1. 本次交付

| 交付物 | 路径 | 状态 |
| --- | --- | --- |
| 上游配置数据表与迁移 | `apps/api/prisma/schema.prisma`、`apps/api/prisma/migrations/20260614133000_t05_upstream_providers/migration.sql` | 完成 |
| 上游 Key 加密工具 | `apps/api/src/admin/upstream-key-crypto.ts` | 完成 |
| 管理员上游配置 API | `apps/api/src/admin/admin.controller.ts`、`apps/api/src/admin/admin.service.ts` | 完成 |
| 管理后台上游配置 UI | `apps/web/app/admin/page.tsx`、`apps/web/app/lib/admin-api.ts`、`apps/web/app/globals.css` | 完成 |
| 运行时加密密钥配置 | `.env.example`、`docker-compose.yml` | 完成 |

## 2. 功能闭环

| 功能 | 验证结果 |
| --- | --- |
| 创建上游配置 | 通过：管理员可 `POST /admin/upstreams` 创建 name、Base URL、API Key、status |
| API Key 加密保存 | 通过：接口响应不包含原始 Key，数据库 `encrypted_api_key <> 原始 Key` |
| Key 脱敏展示 | 通过：接口仅返回 `apiKeyPreview`，不返回明文 `apiKey` |
| 健康检查 | 通过：`POST /admin/upstreams/:id/health-check` 请求上游 `/v1/models` 并更新状态 |
| 管理后台 | 通过：`/admin` 页面包含 Upstream config 与 Health check 区域 |
| 自检数据清理 | 通过：临时上游、临时管理员、临时会话和钱包均已删除 |

## 3. 验证命令

| 命令/检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `docker compose -p nested-api-relay up -d --build api web` | 通过；BuildKit/Bake 异常后关闭 `COMPOSE_BAKE` 与 `DOCKER_BUILDKIT` 重试成功 |
| `curl http://localhost:3001/health` | 通过，返回 `status: ok` |
| `curl http://localhost:3000/admin` | 通过，HTTP 200 |
| `/admin` HTML 检查 | 通过，包含 `Upstream config` 与 `Health check` |
| 临时上游健康检查 | 通过，`health_reachable=True` |
| 数据库明文检查 | 通过，`encrypted_not_plaintext = t` |
| 数据库清理检查 | 通过，`upstream_providers_total=0`、`t05_selfcheck_users=0`、`users_total=1` |

## 4. 自检发现并修复的问题

| 问题 | 根因 | 处理 |
| --- | --- | --- |
| Docker BuildKit/Bake 重建失败 | Docker gRPC session header 异常 | 关闭 `COMPOSE_BAKE=false` 与 `DOCKER_BUILDKIT=0` 后重建成功 |
| Windows PowerShell 传 JSON 给 `curl.exe -d` 后端报非法 JSON | 命令行引号被 PowerShell/curl 组合破坏 | 改用 stdin 与 `--data-binary '@-'` 传 JSON |
| 临时管理员引导环境可能留在容器里 | 自检需要可登录管理员账号 | 自检后清理临时账号，并重建 API 容器；`docker inspect` 确认管理员引导变量为空值 |
| 临时本地 stub 无法启动 | 当前 Windows 环境拒绝后台进程/job | 改用公开 HTTP 回显端点 `https://httpbingo.org/anything/v1/models` 验证真实出网和健康检查链路 |

## 5. 安全边界

- 真实上游 API Key 不写入仓库，只通过管理员表单提交并用 `UPSTREAM_KEY_ENCRYPTION_SECRET` 派生的 AES-256-GCM 密钥加密保存。
- 健康检查请求带 `Authorization: Bearer ...`，但服务响应、审计日志和前端列表不返回明文 Key。
- 本任务只做上游配置和连通性检查，不做 Relay 转发、模型同步、计费、限流或多上游路由。
- 生产环境必须设置稳定的 `UPSTREAM_KEY_ENCRYPTION_SECRET`；更换该值会导致旧密文无法解密，后续需要单独设计密钥轮换。
