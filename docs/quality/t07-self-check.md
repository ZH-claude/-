# T07 自检记录

日期：2026-06-14

范围：API 令牌管理。包括 `api_tokens`、`api_token_model_accesses` 两张表，用户令牌管理接口，独立 API Key 鉴权验证，前端 `/token` 页面和同源 `/api/tokens/*` 代理。

## 1. 本次交付

| 交付物 | 路径 | 状态 |
| --- | --- | --- |
| API Token 数据表 | `apps/api/prisma/schema.prisma`、`apps/api/prisma/migrations/20260614152000_t07_api_tokens/migration.sql` | 完成 |
| 用户令牌管理 API | `apps/api/src/tokens/tokens.controller.ts`、`apps/api/src/tokens/tokens.service.ts`、`apps/api/src/tokens/tokens.module.ts` | 完成 |
| 独立 API Key 鉴权证明 | `GET /tokens/verify` | 完成 |
| 前端同源令牌代理 | `apps/web/app/api/tokens/[[...path]]/route.ts` | 完成 |
| 前端令牌页面 | `apps/web/app/token/page.tsx`、`apps/web/app/lib/token-api.ts`、`apps/web/app/globals.css` | 完成 |
| 首页入口更新 | `apps/web/app/page.tsx` | 完成 |

## 2. 功能闭环

| 功能 | 验证结果 |
| --- | --- |
| 创建令牌 | 通过：登录用户可 `POST /tokens` 创建令牌，并只在响应中拿到一次性 `apiKey` |
| hash 存储 | 通过：数据库 `api_tokens.token_hash` 等于明文 Key 的 SHA-256，未保存明文 |
| 列表脱敏 | 通过：`GET /tokens` 返回 `keyPreview`，不返回 `apiKey` 或 `tokenHash` |
| 模型范围 | 通过：令牌模型范围必须来自用户分组真实可用模型，不可用模型返回 400 |
| 独立鉴权 | 通过：`GET /tokens/verify` 使用 Bearer API Key 可返回用户、令牌和可用模型 |
| 禁用令牌 | 通过：禁用后原 Key 访问 `/tokens/verify` 返回 401 |
| 重置令牌 | 通过：重置后旧 Key 返回 401，新 Key 可通过鉴权 |
| 删除令牌 | 通过：软删除后新 Key 返回 401，令牌不再出现在列表 |
| 用户隔离 | 通过：其他用户不能看到令牌，也不能禁用别人的令牌 |
| 前端页面 | 通过：真实浏览器注册用户后进入 `/token`，创建令牌并显示一次性 Key |
| 自检数据清理 | 通过：临时用户、令牌、模型、上游和审计数据均已清理 |

## 3. 验证命令

| 命令/检查 | 结果 |
| --- | --- |
| `npm --prefix apps/api run typecheck` | 通过 |
| `npm --prefix apps/web run typecheck` | 通过 |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `npm audit --prefix apps/api --audit-level=moderate` | 通过，0 vulnerabilities |
| `npm audit --prefix apps/web --audit-level=moderate` | 通过，0 vulnerabilities |
| `git diff --check` | 通过，仅提示本机 CRLF/LF 转换警告 |
| `docker compose -p nested-api-relay up -d --build api web` | 通过，使用经典 Docker 构建规避本机 BuildKit gRPC 会话异常 |
| `GET http://127.0.0.1:3001/health` | 通过，返回 `status: ok` |
| `GET http://127.0.0.1:3000/token` | 通过，HTTP 200 |
| 真实后端 API QA | 通过，注册临时用户、创建真实模型前置条件、创建/禁用/重置/删除令牌全链路成功 |
| 真实前端代理 QA | 通过，`/api/auth/register`、`/api/tokens` 创建/列表/删除均走同源代理成功 |
| 真实浏览器 UI QA | 通过，Chrome 打开 `/register` 注册后进入 `/token` 创建令牌，页面显示一次性 Key 和列表行 |
| 明文 Key 扫描 | 通过，`api_tokens` 文本列未发现明文 API Key |
| 假数据/测试残留扫描 | 通过，未发现 T07 QA 用户、模型、上游或临时 Key 残留 |

## 4. 自检发现并修复的问题

| 问题 | 根因 | 处理 |
| --- | --- | --- |
| Docker BuildKit 重建失败 | 本机代理/BuildKit gRPC 会话头异常，报 `x-docker-expose-session-sharedkey` 非打印字符 | 临时设置 `DOCKER_BUILDKIT=0` 和 `COMPOSE_DOCKER_CLI_BUILD=0` 使用经典构建，构建和启动通过 |
| 令牌 UUID 被误判无效 | `TokensService` 中 UUID 正则漏掉第四段 UUID 长度和分隔符 | 修正为完整 UUID 正则，并重跑真实接口 QA |
| worker 前端切片返回契约过松 | worker 使用兼容 `apiKey/token/api_key` 和 `/_root` 路由约定，可能掩盖真实后端契约 | Codex 重写前端 token API 和页面，严格匹配后端 `{ apiKey, token }` 与 optional catch-all 路由 |
| npm audit 首次失败 | 环境变量 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY` 指向不可用的 `127.0.0.1:7897` | 在 audit 命令内临时清空代理变量后重跑，通过 |

## 5. 安全边界

- T07 只证明用户 API Key 可被独立鉴权，不实现 `/v1/models`、`/v1/chat/completions` 转发；完整 Relay 属于 T08。
- 用户 API Key 不进入 `AuthGuard` 后台会话链路，不能作为后台 Cookie/session 使用。
- 数据库只保存 API Key 的 SHA-256 hash 和脱敏预览，明文只在创建/重置响应中出现一次。
- 删除采用软删除，保留未来 usage/log/billing 追溯能力；软删除令牌不能再通过鉴权。
- 模型限制必须基于用户分组真实可用模型，不允许保存不存在或不可见模型。
