# T20 自检报告 - 可观测性

日期：2026-06-16
任务：T20 可观测性
范围：新增 Relay 请求日志、request_id trace 查询、真实成功/失败链路 QA、敏感字段白名单验证，并修复旧 Relay QA 在新增请求日志后可能遗留测试数据的问题。T20 不新增营销页，不伪造监控面板数据。

## 交付物

| 项目 | 文件 | 状态 |
| --- | --- | --- |
| 请求日志数据模型与迁移 | `apps/api/prisma/schema.prisma`、`apps/api/prisma/migrations/20260616043000_t20_request_logs/migration.sql` | 完成 |
| 请求日志服务 | `apps/api/src/request-logs/request-logs.service.ts`、`apps/api/src/request-logs/request-logs.module.ts` | 完成 |
| Relay 写入 request log | `apps/api/src/relay/relay.service.ts`、`apps/api/src/relay/relay.module.ts` | 完成 |
| trace 查询接口 | `apps/api/src/usage-logs/usage-logs.service.ts`、`apps/api/src/usage-logs/usage-logs.controller.ts`、`apps/api/src/usage-logs/usage-logs.module.ts` | 完成 |
| 真实可观测性 QA | `apps/api/scripts/t20-observability-qa.ts`、`package.json`、`apps/api/package.json` | 完成 |
| 旧 QA 清理兼容 | `apps/api/scripts/t11-usage-logs-qa.ts`、`apps/api/scripts/t13-group-availability-qa.ts`、`apps/api/scripts/t14-notifications-qa.ts`、`apps/api/scripts/t18-rate-limits-qa.ts` | 完成 |
| 文档 | `docs/superpowers/specs/2026-06-14-nested-api-relay-development-plan.md`、`docs/data/mvp-data-dictionary.md`、`docs/api/openai-compatible-mvp-contract.md` | 完成 |

## 核心行为

| 场景 | 结果 |
| --- | --- |
| `GET /v1/models` | 写入 `request_logs`，`upstream_status=not_required`，不伪造 usage event |
| 非流式成功 chat | 写入 `usage_events`、`wallet_transactions`、`request_logs`，trace 可查到账单和上游成功状态 |
| 上游 HTTP 500 | 写入 failed usage event 和 request log，trace 显示平台 502 与上游 500，不扣费 |
| 上游 malformed JSON | 写入 failed usage event 和 request log，trace 显示 `malformed_response`，不扣费 |
| 流式开始 | 写入 request log 的 `stream_started` 状态，保持既有流式透传行为 |
| 前置拒绝 | 模型不允许、限流、激活过期等拒绝写入 `request_logs`，不生成 usage event，不触达上游 |
| 跨用户查询 trace | 当前登录用户查别人的 request_id 返回 404，不泄露是否存在 |
| 敏感字段 | trace 响应不返回上游 Key、token hash、password hash、连接串、price snapshot、idempotency key 或内部 provider id |
| 日志写入失败 | `RequestLogsService` 写入失败只记录内部 warning，不让日志故障破坏已完成请求 |

## 验证记录

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm --prefix apps/api run build` | 通过 |
| `npm --prefix apps/api exec -- prisma migrate status` | 通过，数据库 schema up to date |
| `npm run qa:t20:observability` | 通过，真实 HTTP + 真实 Postgres + 真实临时上游 |
| `npm run qa:t19:security-hardening` | 通过，安全审计和越权边界兼容 |
| `npm run qa:t18:rate-limits` | 通过，限流回归兼容；本轮产生 21 条 `request_logs` 并清理为 0 |
| `npm run qa:t14:notifications` | 通过，余额低通知回归兼容且 `request_logs` 清理为 0 |
| `npm run qa:t13:group-availability` | 通过，分组状态回归兼容 |
| `npm run qa:t11:usage-logs` | 通过，调用日志回归兼容且 `request_logs` 清理为 0 |
| 全库 `request_logs` 残留检查 | 通过，当前总数为 0 |

T20 真实可观测性 QA 摘要：

```json
{
  "ok": true,
  "checks": [
    "models_endpoint_writes_request_log_without_fake_usage_event",
    "pre_upstream_rejection_writes_request_log_without_usage_or_upstream_call",
    "billable_trace_links_request_usage_wallet_and_upstream_status",
    "failed_trace_links_error_usage_and_upstream_http_status",
    "malformed_trace_records_safe_error_classification",
    "trace_endpoint_is_user_scoped",
    "request_logs_are_real_database_rows_with_token_and_user_correlation",
    "trace_response_uses_sensitive_field_allowlist"
  ],
  "residualBeforeCleanup": {
    "users": 2,
    "sessions": 2,
    "wallets": 2,
    "api_tokens": 2,
    "api_token_model_accesses": 2,
    "usage_events": 3,
    "wallet_transactions": 1,
    "request_logs": 5,
    "upstream_providers": 1,
    "upstream_models": 1,
    "model_prices": 1
  },
  "residualAfterCleanup": {
    "users": 0,
    "sessions": 0,
    "wallets": 0,
    "api_tokens": 0,
    "api_token_model_accesses": 0,
    "usage_events": 0,
    "wallet_transactions": 0,
    "request_logs": 0,
    "upstream_providers": 0,
    "upstream_models": 0,
    "model_prices": 0
  }
}
```

## Review + QA 结论

- Pre-landing review：重点检查 request_id 唯一性、用户隔离、日志字段白名单、前置拒绝、错误链路、计费链路、旧 QA 残留和回归影响；发现并修复 T18 旧 QA 对新增 `request_logs` 的清理盲区，并改为按真实响应 request_id 精确清理。
- QA：所有核心检查均通过真实注册、真实令牌、真实临时上游、真实 Relay HTTP 请求和真实 Postgres 记录完成，没有用静态假数据替代链路结果。
- 视频思路结合：视频里的“统一入口、标准 API、密钥/负载/用量运营”对产品定位有价值；T20 已先落地“统一标准 API 调用可追踪”和“用量可核对”，监控面板、负载策略和生产告警进入 T21/T22 之后的商用化阶段。
- Worker workshare：T20 前置 `gpt-5.3-codex-spark` 侧车尝试失败，错误为 `wss://chatgpt.com/backend-api/codex/responses` 连接被主动拒绝/stream disconnected；Codex 本地完成实现、修复、验证和最终审查。

## CEO + CTO 审查

- 用户价值：用户拿到 `x-request-id` 后，可以追到请求是否到达平台、是否触达上游、是否扣费、是否产生钱包流水，减少账单争议。
- 数据真实性：trace 数据来自真实 `request_logs`、`usage_events` 和 `wallet_transactions`，不是前端展示拼出来的假状态。
- 安全边界：trace 强制按当前登录用户过滤；普通用户不能通过 request_id 枚举别人的调用记录。
- 商业化判断：MVP 已具备基础客服排障和账单核对证据链，但生产还需要集中日志、指标面板、告警、保留周期清理任务和多上游负载策略。
- 兼容性：T11、T13、T14、T18、T19 回归通过，说明新增 request log 没有破坏调用日志、分组状态、通知、限流和安全审计。

## 受阻或未覆盖

- T20 没有实现 Prometheus/Grafana/Loki 面板和生产告警；当前只完成请求级 trace 和数据库可观测性基础。
- 流式请求当前记录 `stream_started`，尚未对客户端断开后的最终字节数、最终 token 用量和 partial billing 做完整追踪。
- 日志保留 90 天是数据字典策略，尚未实现定时归档/清理任务。
- Docker 镜像重建未在本任务重新作为通过项；本轮以本地构建 API、专用 API 进程、Docker Postgres/Redis 和真实 HTTP QA 完成验证。
