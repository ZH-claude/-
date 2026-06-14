# T08 自检记录

日期：2026-06-14

范围：Relay MVP。包括 `GET /v1/models`、`POST /v1/chat/completions`、非流式上游转发、SSE 流式透传、OpenAI 风格错误响应、用户 API Key 鉴权、模型权限和上游 Key 隔离。

## 1. 本次交付

| 交付物 | 路径 | 状态 |
| --- | --- | --- |
| Relay 模块接入 | `apps/api/src/app.module.ts`、`apps/api/src/relay/relay.module.ts` | 完成 |
| OpenAI 兼容控制器 | `apps/api/src/relay/relay.controller.ts` | 完成 |
| Relay 转发服务 | `apps/api/src/relay/relay.service.ts` | 完成 |
| 额度耗尽错误语义 | `apps/api/src/tokens/tokens.service.ts` | 完成 |
| T08 任务记录 | `docs/superpowers/specs/2026-06-14-nested-api-relay-development-plan.md` | 完成 |

## 2. 功能闭环

| 功能 | 验证结果 |
| --- | --- |
| `/v1/models` | 通过：用户使用自己的 API Key 返回当前分组和令牌真实可用模型，包含 `request_id` 和 `x-request-id` |
| 非流式 `/v1/chat/completions` | 通过：用户请求经模型映射转发到上游，返回上游 JSON 结果 |
| 流式 `/v1/chat/completions` | 通过：`stream: true` 时透传 SSE chunk，响应包含 `data:` 和 `[DONE]` |
| 用户 Key 隔离 | 通过：测试上游捕获到的 `Authorization` 是平台配置的上游 Key，不是用户 API Key |
| 模型权限 | 通过：令牌未授权模型返回 `403 model_not_allowed` |
| 无效 Key | 通过：无效 API Key 返回 `401 invalid_api_key` |
| 额度耗尽 | 通过：额度为 0 的 API Key 返回 `402 insufficient_balance` |
| 未支持接口 | 通过：`/v1/embeddings` 返回 `501 not_implemented` |
| 上游错误 | 通过：上游 HTTP 500 被映射为 `502 upstream_error` |
| 自检数据清理 | 通过：临时用户、上游、模型、令牌和审计日志均已清理 |

## 3. 验证命令

| 命令/检查 | 结果 |
| --- | --- |
| `npm --prefix apps/api run typecheck` | 通过 |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `docker compose -p nested-api-relay up -d --build api web` | 通过，使用经典 Docker 构建 |
| `GET http://127.0.0.1:3001/health` | 通过，返回 `status: ok` |
| `GET http://127.0.0.1:3000` | 通过，HTTP 200 |
| `npm audit --prefix apps/api --audit-level=moderate` | 通过，0 vulnerabilities |
| `npm audit --prefix apps/web --audit-level=moderate` | 通过，0 vulnerabilities |
| `git diff --check` | 通过，仅有本机 CRLF/LF 转换提示 |
| 真实 HTTP Relay QA | 通过，覆盖 models、非流、流式、权限、错误码、密钥隔离和清理 |

真实 HTTP Relay QA 输出摘要：

```json
{
  "ok": true,
  "checks": [
    "models_success",
    "chat_non_stream_success",
    "chat_stream_success",
    "upstream_auth_isolation",
    "model_not_allowed_403",
    "invalid_key_401",
    "quota_exhausted_402",
    "unsupported_501",
    "upstream_500_to_502"
  ],
  "captures": 3,
  "cleanup": "DELETE 3 DELETE 1 DELETE 1 DELETE 2"
}
```

说明：QA 中的一次性上游服务是真实 HTTP 服务，API 容器通过 `host.docker.internal:4018` 调用它；它只用于验证网络转发链路，不作为产品假数据或生产逻辑保留。

## 4. 自检发现并修复的问题

| 问题 | 根因 | 处理 |
| --- | --- | --- |
| 额度耗尽被映射为 `token_disabled` | `TokensService` 抛出普通 `ForbiddenException`，Relay 无法区分额度耗尽和禁用 | 令牌额度耗尽携带 `insufficient_balance` 语义，Relay 返回 `402 insufficient_balance` |
| 上游网络类异常可能变成 `500 internal_error` | `fetch` 抛错未被 Relay 层归类为上游错误 | `fetchUpstreamChatCompletion` 将非 timeout 网络异常映射为 `502 upstream_error`，非流式保留一次重试 |
| Bearer scheme 大小写兼容偏弱 | 控制器只接受完全等于 `Bearer` | 改为大小写不敏感判断，兼容 `bearer` |
| 流式客户端断开资源释放弱 | 读取循环未监听客户端 close | 流式 pipe 增加 close 监听，客户端断开时取消上游 reader |
| QA 脚本探针超时 | `docker exec node -e fetch(...)` 探针没有显式退出，Node keep-alive 挂住 | 移除探针，最终 QA 直接以真实 Relay 调用证明连通性 |

## 5. 安全边界

- Relay 只接受用户 API Key，不接受后台 Cookie/session 作为 `/v1/*` 鉴权。
- 用户 API Key 只用于本平台鉴权，不转发给上游。
- 上游 Key 从数据库加密字段解密后仅用于上游 `Authorization`，不进入响应。
- `/v1/models` 不暴露上游真实 provider ID。
- 上游纯文本错误不原样透传，避免泄露内部信息。
- T08 不实现扣费、usage event、wallet transaction 或日志页面；这些属于 T09/T11。
- 120 秒上游 timeout 的长等待负例未放入自动 QA，已用上游 500 覆盖错误映射；生产级超时压测应在 T09/T20 后结合计费和日志一起做。

## 6. Worker workshare

| 项 | 结果 |
| --- | --- |
| 分配内容 | T08 Relay 只读侧向审查，重点看兼容性、安全和 QA 缺口 |
| worker 完成 | 找到 4 个风险：额度错误码、网络异常 500、流式断开处理、Bearer 大小写 |
| Codex 处理 | 接受并修复全部可在 T08 范围内处理的问题；长超时压测标记为后续边界 |
| 输出采纳状态 | 采纳并修订实现 |
