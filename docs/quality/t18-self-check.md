# T18 自检报告 - 风控与限流

日期：2026-06-16
任务：T18 风控与限流
范围：新增服务端 Relay 风控策略、用户/令牌/模型/IP 四层限流、令牌 IP 白名单、首次激活策略、异常失败熔断、用户侧令牌策略配置展示，以及真实接口 QA。所有拦截发生在后端 Relay 转发和计费之前。

## 交付物

| 项目 | 文件 | 状态 |
| --- | --- | --- |
| 风控数据模型与迁移 | `apps/api/prisma/schema.prisma`、`apps/api/prisma/migrations/20260615203000_t18_relay_rate_limits/migration.sql` | 完成 |
| Relay 策略服务 | `apps/api/src/relay/relay-policy.service.ts` | 完成 |
| Relay 接入 | `apps/api/src/relay/relay.service.ts`、`apps/api/src/relay/relay.controller.ts`、`apps/api/src/relay/relay.module.ts` | 完成 |
| 令牌策略字段与校验 | `apps/api/src/tokens/tokens.service.ts` | 完成 |
| 用户侧令牌配置 | `apps/web/app/token/page.tsx`、`apps/web/app/lib/token-api.ts` | 完成 |
| 真实数据 QA 脚本 | `apps/api/scripts/t18-rate-limits-qa.ts`、`package.json`、`apps/api/package.json` | 完成 |
| 任务记录 | `docs/superpowers/specs/2026-06-14-nested-api-relay-development-plan.md` | 完成 |

## 核心行为

| 场景 | 结果 |
| --- | --- |
| 用户级限流 | 读取 `users.rate_limit_requests_per_minute`，同一用户窗口内超限返回 `429 rate_limit_exceeded` |
| 令牌级限流 | 读取 `api_tokens.rate_limit_requests_per_minute`，超限不触达上游、不扣费 |
| 模型级限流 | 按 `tokenId + model` 限制，其他令牌和其他用户不受影响 |
| IP 级限流 | 按 `tokenId + clientIp` 限制，其他 IP 不受影响 |
| IP 白名单 | 未在白名单内返回 `403 ip_not_allowed` |
| 首次激活 | 策略放行后才写入 `activated_at` 和 `activation_expires_at`；策略拒绝不会启动激活窗口 |
| 激活过期 | 已过期令牌返回 `403 token_activation_expired`，不转发、不扣费 |
| 异常熔断 | 基于真实 `usage_events.status = FAILED` 的近 5 分钟失败数，不写死命中 |
| 并发限流 | PostgreSQL advisory lock 序列化同一限流 scope，避免并发穿透 |
| `/v1/models` | 使用同一令牌/IP 策略，真实返回当前分组可用模型 |

## 验证记录

| 检查 | 结果 |
| --- | --- |
| `npm --prefix apps/api run prisma:generate` | 通过 |
| `npm --prefix apps/api run typecheck` | 通过 |
| `npm --prefix apps/api run build` | 通过 |
| `npm run typecheck` | 通过 |
| `npx prisma migrate status` | 通过，数据库 schema up to date |
| `GET /health` on local compiled API `127.0.0.1:3011` | 通过 |
| `GET /service-status` on local compiled API | 通过，API/DB/Redis/Web healthy，外部监控 not_configured |
| `npm run qa:t18:rate-limits` | 通过，真实 HTTP + 真实 Postgres + 真实临时上游 |
| `npm run qa:t11:usage-logs` | 通过，真实计费/日志兼容 |
| `npm run qa:t14:notifications` | 通过，真实扣费触发低余额通知兼容 |
| `npm run qa:t15:announcements` | 通过，公告兼容 |
| `npm run qa:t16:async-tasks` | 通过，异步任务兼容 |
| `npm run qa:t17:service-status` | 通过，服务状态兼容 |
| 浏览器 QA | 通过，`/token` 创建真实策略令牌并展示 token/model/IP RPM、IP 白名单和激活有效期 |
| `npm --prefix apps/api audit --audit-level=moderate` | 0 vulnerabilities |
| `npm --prefix apps/web audit --audit-level=moderate` | 0 vulnerabilities |
| T18 新代码数据真实性扫描 | 无产品代码 `fake/mock/dummy/模拟/假数据/伪造/糊弄/滥竽充数` 命中 |
| T18 敏感字段扫描 | 命中均为鉴权、加密或 QA 一次性测试 key；产品响应不返回明文上游 Key 或 token hash |
| `git diff --check` | 通过，无空白错误；仅 Windows LF/CRLF 提示 |
| T18 QA 数据清理 | 脚本创建的用户、会话、钱包、令牌、限流事件、用量、钱包流水、上游、模型和价格均清理为 0 残留 |

真实风控 QA 摘要：

```json
{
  "ok": true,
  "checks": [
    "token_rpm_blocks_before_upstream_and_billing",
    "rate_limit_state_isolated_between_users_and_tokens",
    "ip_whitelist_blocks_unlisted_ip_and_allows_listed_ip",
    "policy_blocked_request_does_not_start_first_activation_window",
    "ip_rpm_is_scoped_to_token_and_client_ip",
    "model_rpm_blocks_same_token_model_before_upstream",
    "first_activation_window_uses_real_first_relay_request",
    "user_rpm_blocks_without_affecting_other_users",
    "risk_breaker_uses_real_recent_failed_usage_events",
    "concurrent_token_rpm_is_serialized_by_database_lock",
    "models_endpoint_uses_same_real_token_ip_policy"
  ],
  "residualAfterCleanup": {
    "users": 0,
    "sessions": 0,
    "wallets": 0,
    "api_tokens": 0,
    "api_token_model_accesses": 0,
    "relay_rate_limit_events": 0,
    "usage_events": 0,
    "wallet_transactions": 0,
    "upstream_providers": 0,
    "upstream_models": 0,
    "model_prices": 0
  }
}
```

浏览器证据截图：

- `C:\Users\15359\AppData\Local\Temp\t18-token-policy-browser.png`

## Review + QA 结论

- Pre-landing review：重点检查限流拦截顺序、并发穿透、跨用户隔离、上游转发前置条件、计费副作用、首次激活副作用、敏感字段和测试残留。审查中发现“策略拒绝也会启动首次激活窗口”的问题，已修复并用 T18 QA 新断言覆盖。
- QA：通过真实注册用户、真实令牌、真实数据库字段、真实临时上游、真实 Relay HTTP 请求和真实浏览器路径验证；没有把限流做成前端假拦截，也没有用静态假数据冒充结果。
- Greptile triage：本机没有 `gh` 命令，未接入 PR 评论检查；本地 diff review 已完成。
- Worker workshare：前置 `gpt-5.3-codex-spark` 只读侧车已完成 T18 架构切入点复核；本轮最终侧车重试因 `chatgpt.com/backend-api/codex/responses` WebSocket 被拒绝而未完成。Codex 负责代码修复、集成、验证和最终审查。

## CEO + CTO 审查

- 用户价值：用户现在可以在令牌页配置每分钟请求限制、单模型限制、单 IP 限制、IP 白名单和首次激活有效期。
- 数据真实性：所有风控判断来自数据库字段、真实请求 IP、真实 usage event 和真实 relay rate limit event，不依赖前端状态或硬编码命中。
- 安全边界：超限、白名单拒绝、激活过期和风险熔断都在上游转发和计费之前拦截；被拒绝请求不写成功用量、不扣费、不触达上游。
- 兼容性：T11、T14、T15、T16、T17 回归通过，说明日志、通知、公告、异步任务和服务状态兼容。
- 商业化判断：MVP 可用；商用阶段还需要管理端策略配置、审计日志、清理/归档限流事件、Redis 或专用限流器、网关可信代理配置和可观测性告警。

## 受阻或未覆盖

- Docker 镜像重建本轮没有作为通过项：一次 `npm ci` 拉取依赖时 `ECONNRESET`，一次重建超过 604 秒超时。已用本地编译后的 API + 本地 Next dev + Docker Postgres/Redis 完成真实运行验证。
- 当前 IP 白名单只支持精确 IP，不支持 CIDR；生产环境需要在可信反向代理下统一 `X-Forwarded-For` 来源。
- 当前限流事件写入 PostgreSQL，长期商用需要定期清理或迁移到 Redis/专用限流存储，避免事件表无限增长。
