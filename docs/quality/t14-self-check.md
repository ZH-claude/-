# T14 自检报告 - 通知设置

日期：2026-06-15
任务：T14 通知设置
范围：用户配置余额预警和 Webhook 通道；后端保存真实通知偏好、加密 Webhook 目标、发送真实测试通知，并在真实扣费后触发低余额通知。邮件通道仅展示未接入状态，不返回假成功。

## 交付物

| 项目 | 文件 | 状态 |
| --- | --- | --- |
| 通知数据模型与迁移 | `apps/api/prisma/schema.prisma`、`apps/api/prisma/migrations/20260615160000_t14_notifications/migration.sql` | 完成 |
| 通知后端模块 | `apps/api/src/notifications/*` | 完成 |
| 计费后低余额触发 | `apps/api/src/billing/billing.service.ts`、`apps/api/src/billing/billing.module.ts` | 完成 |
| 通知设置前端代理 | `apps/web/app/api/notifications/[[...path]]/route.ts` | 完成 |
| 通知设置客户端 | `apps/web/app/lib/notifications-api.ts` | 完成 |
| 通知设置页面 | `apps/web/app/account/notificationSettings/page.tsx` | 完成 |
| 首页通知设置入口 | `apps/web/app/page.tsx` | 完成 |
| 真实数据 QA 脚本 | `apps/api/scripts/t14-notifications-qa.ts` | 完成 |
| 任务记录 | `docs/superpowers/specs/2026-06-14-nested-api-relay-development-plan.md` | 完成 |

## 核心行为

| 场景 | 结果 |
| --- | --- |
| 未登录访问通知接口 | 返回 401 |
| 用户保存通知设置 | 写入当前用户的真实 `notification_preferences` 和 `notification_channels` |
| Webhook URL 存储 | 使用 AES-256-GCM 加密保存，响应和页面只显示掩码预览 |
| Webhook 测试 | 向已配置的真实 HTTPS 端点发送 POST，并记录 `SENT` 或 `FAILED` |
| 未配置通道测试 | 返回失败，不显示成功 |
| 低余额通知 | 真实 `BILLABLE` 扣费生成钱包流水后触发余额阈值检查 |
| 重复计费事件 | 幂等复用已有 usage event，不重复触发通知 |
| 邮件通道 | 显示未接入/不可测试，不伪造发送成功 |
| 敏感字段 | 不返回 `encryptedTarget`、完整 Webhook URL、token hash、密码 hash、上游 Key 或内部密文字段 |

## 验证记录

| 检查 | 结果 |
| --- | --- |
| `npm --prefix apps/api run typecheck` | 通过 |
| `npm --prefix apps/web run typecheck` | 通过 |
| `npm run build` | 通过，生产构建包含 `/account/notificationSettings` 和 `/api/notifications/[[...path]]` |
| `docker compose -p nested-api-relay up -d --build api web` | 通过，API 日志显示 `/notifications/settings` 和 `/notifications/test-webhook` 已映射 |
| `npm run qa:t14:notifications` | 通过，真实 HTTP + 真实 Postgres + 真实公开 HTTPS Webhook + 真实 Relay 扣费触发 |
| 浏览器 QA | 通过，未登录跳登录；真实用户注册后保存 Webhook；测试发送成功；投递历史显示 HTTP 204；控制台无真实业务错误 |
| `npm run qa:t10:recharge` | 通过，充值链路兼容 |
| `npm run qa:t11:usage-logs` | 通过，调用日志兼容 |
| `npm run qa:t12:pricing` | 通过，费用说明兼容 |
| `npm run qa:t13:group-availability` | 通过，分组状态兼容 |
| `npm audit --prefix apps/api --audit-level=moderate` | 0 vulnerabilities |
| `npm audit --prefix apps/web --audit-level=moderate` | 0 vulnerabilities |
| T14 新代码假数据扫描 | 无 `fake/mock/dummy/模拟/假数据/伪造/糊弄/滥竽充数` 命中 |
| T14 敏感字段扫描 | 命中均为服务端加密/解密实现和 QA 断言，未发现前端或接口响应泄露 |
| `git diff --check` | 通过，无空白错误 |
| T14 QA 数据清理 | 脚本和浏览器 fixture 均清理为 0 残留 |

真实通知 QA 摘要：

```json
{
  "ok": true,
  "checks": [
    "unauthenticated_notification_requests_are_rejected",
    "settings_get_uses_real_wallet_and_unconfigured_channels",
    "private_or_local_webhook_urls_are_rejected",
    "settings_put_persists_real_preference_and_masks_webhook_target",
    "webhook_target_is_encrypted_and_preview_only_in_database",
    "configured_webhook_test_sends_real_request_and_records_delivery",
    "unconfigured_channel_cannot_report_success_and_cross_user_deliveries_are_hidden",
    "failed_webhook_test_records_failed_delivery_in_database",
    "real_billable_relay_debit_triggers_balance_low_webhook",
    "notification_responses_use_sensitive_field_allowlist"
  ],
  "residualAfterCleanup": {
    "users": 0,
    "sessions": 0,
    "wallets": 0,
    "api_tokens": 0,
    "api_token_model_accesses": 0,
    "usage_events": 0,
    "wallet_transactions": 0,
    "notification_preferences": 0,
    "notification_channels": 0,
    "notification_deliveries": 0,
    "model_prices": 0,
    "model_group_accesses": 0,
    "upstream_providers": 0,
    "upstream_models": 0
  }
}
```

浏览器 QA 摘要：

```json
{
  "ok": true,
  "checks": [
    "browser_unauth_notification_settings_redirects_to_login",
    "browser_real_user_registered_with_session_cookie",
    "browser_notification_settings_page_loads_real_default_state",
    "browser_saves_notification_settings_through_ui",
    "browser_tests_configured_webhook_through_ui",
    "browser_delivery_history_shows_success_without_full_webhook_url"
  ],
  "consoleErrors": [],
  "ignoredConsoleErrors": [
    "Failed to load resource: the server responded with a status of 401 (Unauthorized)"
  ],
  "residualAfterCleanup": {
    "users": 0,
    "notificationPreferences": 0
  }
}
```

浏览器证据截图：`C:\Users\15359\AppData\Local\Temp\t14-notifications-browser-final.png`

## Review + QA 结论

- Pre-landing review：重点检查 SQL/data 安全、跨用户隔离、枚举处理、Webhook SSRF 防护、完整 URL 泄露、计费触发边界和同步发送风险；未发现阻塞级问题。
- Greptile triage：本机没有 `gh` 命令，未接入 PR 评论检查；本地 diff review 已完成。
- QA：通过真实接口、真实数据库、真实 Webhook、真实 Relay 扣费和真实浏览器路径验证；没有用假数据或模拟成功糊弄结果。
- Worker workshare：Volta sidecar 只读复核 T14 架构边界，建议将低余额通知挂在真实 `BillingService.createUsageEvent()` 扣费成功后，并限制 Webhook 响应只返回目标预览；Codex 接受该方向并完成实现、验证和最终审查。

## CEO + CTO 审查

- 用户价值：用户可以自己配置余额预警阈值和 Webhook，余额接近耗尽时能收到真实通知，减少 API 调用突然失败。
- 数据真实性：通知投递记录来自真实 HTTP 发送结果，余额触发来自真实钱包扣费后的余额，不写死状态。
- 安全边界：Webhook 目标加密保存、响应只给掩码预览、接口按当前登录用户隔离、未登录 401、跨用户看不到投递记录。
- 兼容性：T14 不改变充值、日志、价格、分组状态的主流程；T10-T13 回归通过。
- 商业化判断：当前 Webhook 发送是同步触发，MVP 可接受；商用阶段应升级为队列/outbox，避免第三方 Webhook 慢响应拖慢计费接口。

## 剩余边界

- T14 不实现邮件、Telegram、企业微信、钉钉、飞书、Bark、Gotify 等通道，只保留真实状态和后续扩展位。
- Webhook SSRF 防护已阻断本地、私网、保留地址和元数据主机，但商用高并发场景应进一步用独立出站代理或队列 worker 隔离网络风险。
- 低余额通知有冷却时间，避免每次扣费重复刷屏；如果业务需要更细颗粒度提醒，后续应增加通知策略配置。
