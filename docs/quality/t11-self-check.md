# T11 自检报告 - 调用日志页面

日期：2026-06-15
任务：T11 调用日志页面
范围：用户按时间、模型、令牌、状态查询自己的真实调用日志和消费明细；页面展示汇总指标、明细表和当前结果 CSV 导出。

## 交付物

| 项目 | 文件 | 状态 |
| --- | --- | --- |
| 日志后端模块 | `apps/api/src/usage-logs/*` | 完成 |
| 后端模块接入 | `apps/api/src/app.module.ts` | 完成 |
| 前端日志代理 | `apps/web/app/api/usage/[[...path]]/route.ts` | 完成 |
| 日志页 | `apps/web/app/log/page.tsx` | 完成 |
| 日志接口客户端 | `apps/web/app/lib/usage-log-api.ts` | 完成 |
| 首页日志入口 | `apps/web/app/page.tsx` | 完成 |
| 真实链路 QA 脚本 | `apps/api/scripts/t11-usage-logs-qa.ts` | 完成 |
| 任务记录 | `docs/superpowers/specs/2026-06-14-nested-api-relay-development-plan.md` | 完成 |

## 核心行为

| 场景 | 结果 |
| --- | --- |
| 已登录用户查询日志 | 只返回当前用户自己的 `usage_events` |
| 按模型筛选 | 只返回该模型的调用记录 |
| 按令牌筛选 | 只返回该令牌对应的调用记录 |
| 按状态筛选 | `billable`、`free`、`failed`、`metering_unknown` 可过滤 |
| 成功扣费记录 | 关联 `request_id`、usage event 和 `wallet_transaction` |
| 失败调用记录 | 展示失败状态和错误码，不关联扣费流水 |
| 计量未知记录 | 展示 `metering_unknown`，费用为 0 |
| 跨用户查询 | 即使传入其他用户 tokenId，也不返回对方记录 |
| 未登录访问后端日志接口 | 返回 401 |
| 敏感字段 | 不返回 `tokenHash`、上游密钥、`priceSnapshot`、`idempotencyKey` 或内部上游字段 |

## 验证记录

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `docker compose -p nested-api-relay up -d --build api web` | 通过，生产构建包含 `/log` 和 `/api/usage/[[...path]]` |
| `npm run qa:t11:usage-logs` | 通过，真实 HTTP + 真实 Postgres + 临时真实上游 |
| `GET http://127.0.0.1:3001/health` | HTTP 200，`status: ok` |
| `GET http://127.0.0.1:3000/log` | HTTP 200 |
| `GET http://127.0.0.1:3000/` | HTTP 200，首页日志入口已接入 `/log` |
| 未登录 `GET http://127.0.0.1:3001/usage/logs` | HTTP 401 |
| `npm audit --prefix apps/api --audit-level=moderate` | 0 vulnerabilities |
| `npm audit --prefix apps/web --audit-level=moderate` | 0 vulnerabilities |
| `git diff --check` | 通过，无空白错误 |
| T11 QA 数据清理 | `users=0`、`usage_events=0`、`upstream_providers=0`、`model_prices=0` |

真实调用日志 QA 摘要：

```json
{
  "ok": true,
  "checks": [
    "real_billable_relay_call_created_usage_headers",
    "real_failed_relay_call_created_request_id",
    "real_metering_unknown_relay_call_created_usage_event",
    "usage_logs_link_request_usage_and_wallet_truthfully",
    "status_filter_returns_only_requested_status",
    "token_filter_returns_only_requested_owned_token",
    "foreign_token_id_query_does_not_leak_rows",
    "user_scope_blocks_cross_account_log_reads",
    "usage_logs_response_uses_sensitive_field_allowlist"
  ],
  "residualBeforeCleanup": {
    "users": 2,
    "sessions": 2,
    "wallets": 2,
    "api_tokens": 2,
    "api_token_model_accesses": 2,
    "usage_events": 3,
    "wallet_transactions": 1,
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
    "upstream_providers": 0,
    "upstream_models": 0,
    "model_prices": 0
  }
}
```

## CEO + CTO 审查

- 用户价值：用户能用 `request_id` 对账，知道每次调用是否成功扣费、失败未扣费、或计量未知。
- 财务正确性：页面数据来自 T09 的真实 `usage_events` 和 `wallet_transactions`，不是手工造日志。
- 安全边界：接口以当前登录用户为唯一查询边界；返回字段采用白名单，敏感字段不出接口。
- 兼容性：不改变 Relay 计费语义，不改变 T10 充值流水；T11 只读消费日志，避免影响钱包写入路径。
- 可运维性：QA 脚本可复跑，会自动清理临时用户、令牌、上游、模型和日志数据。

## 剩余边界

- T11 不做管理员全局日志筛选；这属于后续商用运营后台。
- T11 不做大范围异步导出、分页游标、报表聚合和实时图表；当前只导出页面已有结果。
- T11 不新增独立 `request_logs` 表；MVP 先使用已验证的 `usage_events` 作为调用消费真相来源。
- 当前环境没有 Playwright 依赖，未做自动截图级浏览器断言；已用生产构建和 HTTP 页面访问验证替代。
