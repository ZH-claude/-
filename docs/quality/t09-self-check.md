# T09 自检报告 - 计费事件与余额扣减

日期：2026-06-15
任务：T09 计费事件与余额扣减
范围：真实 Relay 调用后的 usage event、wallet transaction、余额扣减、失败不误扣、重试不重复扣。

## 交付物

| 项目 | 文件 | 状态 |
| --- | --- | --- |
| 账务数据模型 | `apps/api/prisma/schema.prisma` | 完成 |
| 数据库迁移 | `apps/api/prisma/migrations/20260615103000_t09_billing_events/migration.sql` | 完成 |
| 计费服务 | `apps/api/src/billing/billing.service.ts` | 完成 |
| Relay 接入 | `apps/api/src/relay/relay.service.ts` | 完成 |
| 任务记录 | `docs/superpowers/specs/2026-06-14-nested-api-relay-development-plan.md` | 完成 |

## 核心行为

| 场景 | 结果 |
| --- | --- |
| 钱包余额为 0 | 返回 `402 insufficient_balance`，不转发上游 |
| 非流式成功且上游返回 usage | 写入 `BILLABLE` usage event，生成 `DEBIT` wallet transaction，扣减钱包并增加 token usedCents |
| 上游 500 | 写入 `FAILED` usage event，不生成钱包扣费流水 |
| 上游 malformed JSON | 写入 `FAILED` usage event，不生成钱包扣费流水 |
| 上游首次 502、重试成功 | 最终成功，只生成 1 条扣费流水 |
| 流式成功但无 usage | 写入 `METERING_UNKNOWN` usage event，默认不扣费 |
| 并发请求超过余额 | 只允许余额可覆盖的请求扣费，钱包不出现负数 |

## 验证记录

| 检查 | 结果 |
| --- | --- |
| `npm --prefix apps/api run typecheck` | 通过 |
| `prisma migrate deploy` | 通过，应用 `20260615103000_t09_billing_events` |
| `docker compose -p nested-api-relay up -d --build api` | 通过 |
| `GET http://127.0.0.1:3001/health` | `status: ok` |
| 数据库结构检查 | `usage_events`、`wallet_transactions`、相关 enum 存在 |
| 真实 Relay QA | 通过 |

真实 Relay QA 摘要：

```json
{
  "ok": true,
  "checks": [
    "insufficient_balance_no_upstream",
    "success_debits_wallet_and_token",
    "upstream_key_isolation",
    "upstream_500_failed_no_debit",
    "malformed_failed_no_debit",
    "upstream_retry_charged_once",
    "stream_metering_unknown_no_debit",
    "concurrency_no_negative_balance"
  ],
  "residualBeforeCleanup": "8,5",
  "residualAfterCleanup": "0,0,0,0,0"
}
```

## CEO + CTO 审查

- 用户价值：用户余额不足会被明确拒绝，不会静默免费调用或超额扣费。
- 财务正确性：成功扣费、失败不扣、重试不重复扣，账务事件与钱包流水可按 `request_id` 追踪。
- 技术边界：扣费在数据库事务内完成，钱包扣减使用条件更新防止负余额。
- 安全边界：QA 验证转发给上游的是平台上游 Key，不是用户 API Key。
- 兼容性：保留原有 OpenAI 兼容响应主体，仅新增 `x-usage-event-id` 响应头，不破坏客户端解析。

## 剩余边界

- T09 不实现充值码、在线支付或用户充值页面；这些属于 T10。
- T09 不实现调用日志页面和导出；这些属于 T11。
- 流式响应本期在无 usage 时默认不扣费并标记 `METERING_UNKNOWN`；解析流式 usage 后扣费属于后续增强。
- 并发余额不足时，已保证不负余额；极端竞态下已发往上游但最终扣费失败的请求会返回 `402`，后续商用可增加预授权/余额冻结来降低平台成本风险。
