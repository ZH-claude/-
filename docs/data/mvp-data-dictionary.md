# MVP 数据字典

状态：冻结草案  
所属任务：T02  
更新日期：2026-06-14

## 1. 数据库约定

| 项 | 决策 |
| --- | --- |
| 主数据库 | PostgreSQL |
| 缓存/限流 | Redis |
| ORM | Prisma |
| 主键 | `uuid` |
| 时间字段 | `created_at`、`updated_at`，使用 UTC |
| 金额字段 | 整数分 `amount_cents`，不使用浮点 |
| 软删除 | 用户、令牌、上游配置使用 `deleted_at` |
| 审计 | 管理员调整余额、禁用用户、修改上游配置必须写 `admin_audit_logs` |

## 2. 核心表

### `users`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 用户 ID |
| `username` | text | unique, not null | 登录名 |
| `password_hash` | text | not null | 密码 hash |
| `status` | enum | not null | `active`、`disabled`、`risk_locked` |
| `group_id` | uuid | FK `user_groups.id` | 用户分组 |
| `inviter_id` | uuid | nullable FK `users.id` | 邀请人 |
| `timezone` | text | default `UTC` | 展示时区 |
| `deleted_at` | timestamp | nullable | 软删除 |

索引：

- unique `users_username_key(username)` where `deleted_at is null`
- index `users_group_id_idx(group_id)`

### `user_groups`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 分组 ID |
| `code` | text | unique, not null | `default`、`stable`、`low_cost` |
| `name` | text | not null | 展示名 |
| `multiplier` | numeric(10,4) | not null | 分组倍率 |
| `status` | enum | not null | `active`、`disabled` |

### `api_tokens`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 令牌 ID |
| `user_id` | uuid | FK `users.id`, not null | 所属用户 |
| `name` | text | not null | 令牌备注名 |
| `token_hash` | text | unique, not null | API Key hash |
| `token_prefix` | text | not null | 用于展示和排查 |
| `status` | enum | not null | `active`、`disabled`、`expired` |
| `quota_cents` | bigint | nullable | 令牌额度上限 |
| `used_cents` | bigint | default 0 | 已使用额度 |
| `expires_at` | timestamp | nullable | 过期时间 |
| `first_used_at` | timestamp | nullable | 首次使用 |
| `deleted_at` | timestamp | nullable | 软删除 |

约束：

- 不存 API Key 明文。
- 创建后只返回一次明文。
- `used_cents <= quota_cents` 仅在 `quota_cents` 不为空时校验。

### `api_token_policies`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `token_id` | uuid | PK/FK `api_tokens.id` | 对应令牌 |
| `allowed_models` | jsonb | nullable | 模型白名单 |
| `ip_allowlist` | jsonb | nullable | IP 白名单 |
| `rpm_limit` | int | nullable | 每分钟请求数 |
| `tpm_limit` | int | nullable | 每分钟 token 数 |
| `first_use_valid_days` | int | nullable | 首次使用后有效天数 |

### `upstream_providers`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 上游 ID |
| `name` | text | not null | 上游名称 |
| `base_url` | text | not null | 上游 Base URL |
| `api_key_ciphertext` | text | not null | 加密后的上游 Key |
| `status` | enum | not null | `active`、`disabled`、`degraded` |
| `priority` | int | default 100 | 路由优先级 |
| `timeout_ms` | int | default 120000 | 超时 |
| `retry_count` | int | default 1 | 重试次数 |
| `deleted_at` | timestamp | nullable | 软删除 |

约束：

- 上游 Key 不进入普通日志。
- 修改上游配置必须写 `admin_audit_logs`。

### `upstream_models`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 模型映射 ID |
| `provider_id` | uuid | FK `upstream_providers.id` | 上游 |
| `public_model` | text | not null | 对用户暴露的模型名 |
| `upstream_model` | text | not null | 上游真实模型名 |
| `status` | enum | not null | `active`、`disabled` |
| `supports_stream` | boolean | default true | 是否支持流式 |

索引：

- unique `(provider_id, public_model, upstream_model)`
- index `(public_model, status)`

### `model_prices`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 价格 ID |
| `model` | text | unique, not null | 平台模型名 |
| `input_price_cents_per_1k` | bigint | not null | 输入价格 |
| `output_price_cents_per_1k` | bigint | not null | 输出价格 |
| `model_multiplier` | numeric(10,4) | default 1 | 模型倍率 |
| `status` | enum | not null | `active`、`disabled` |

### `wallets`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `user_id` | uuid | PK/FK `users.id` | 用户 |
| `balance_cents` | bigint | not null, default 0 | 当前余额 |
| `version` | bigint | not null, default 0 | 乐观锁版本 |

约束：

- `balance_cents >= 0`
- 扣费必须在事务内完成。
- 并发扣费使用行锁或乐观锁，不允许负余额。

### `wallet_transactions`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 流水 ID |
| `user_id` | uuid | FK `users.id` | 用户 |
| `type` | enum | not null | `recharge`、`debit`、`refund`、`admin_adjust` |
| `amount_cents` | bigint | not null | 正数入账，负数扣费 |
| `balance_after_cents` | bigint | not null | 交易后余额 |
| `usage_event_id` | uuid | nullable FK | 关联调用事件 |
| `idempotency_key` | text | unique, not null | 幂等键 |
| `created_at` | timestamp | not null | 创建时间 |

规则：

- 流水不可更新、不可删除，只能追加冲正流水。
- 每次成功扣费必须有一条 `debit`。

### `usage_events`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 事件 ID |
| `request_id` | text | unique, not null | 请求 ID |
| `user_id` | uuid | FK `users.id` | 用户 |
| `token_id` | uuid | FK `api_tokens.id` | 令牌 |
| `model` | text | not null | 平台模型 |
| `upstream_provider_id` | uuid | FK | 上游 |
| `prompt_tokens` | int | default 0 | 输入 token |
| `completion_tokens` | int | default 0 | 输出 token |
| `total_tokens` | int | default 0 | 总 token |
| `cost_cents` | bigint | not null | 本次费用 |
| `status` | enum | not null | `billable`、`free`、`failed`、`metering_unknown` |
| `price_snapshot` | jsonb | not null | 调用时价格快照 |

规则：

- `request_id` 唯一，防止重复计费。
- `price_snapshot` 保存模型价、模型倍率、用户分组倍率。

### `request_logs`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 日志 ID |
| `request_id` | text | unique, not null | 请求 ID |
| `user_id` | uuid | FK | 用户 |
| `token_id` | uuid | FK | 令牌 |
| `method` | text | not null | HTTP 方法 |
| `path` | text | not null | 请求路径 |
| `model` | text | nullable | 模型 |
| `status_code` | int | nullable | 响应状态 |
| `error_code` | text | nullable | 平台错误码 |
| `latency_ms` | int | nullable | 延迟 |
| `upstream_latency_ms` | int | nullable | 上游延迟 |
| `created_at` | timestamp | not null | 创建时间 |

规则：

- 不记录 API Key 明文。
- 默认不保存完整 prompt。

### `recharge_codes`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 卡密 ID |
| `code_hash` | text | unique, not null | 卡密 hash |
| `amount_cents` | bigint | not null | 金额 |
| `status` | enum | not null | `unused`、`used`、`disabled` |
| `used_by_user_id` | uuid | nullable FK | 使用人 |
| `used_at` | timestamp | nullable | 使用时间 |

### `announcements`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 公告 ID |
| `title` | text | not null | 标题 |
| `content` | text | not null | 内容 |
| `status` | enum | not null | `draft`、`published`、`archived` |
| `published_at` | timestamp | nullable | 发布时间 |
| `created_by_admin_id` | uuid | FK `users.id` | 发布管理员 |

### `availability_metrics`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 指标 ID |
| `provider_id` | uuid | FK `upstream_providers.id` | 上游 |
| `model` | text | nullable | 模型 |
| `window_start` | timestamp | not null | 统计窗口开始 |
| `window_minutes` | int | not null | 窗口长度 |
| `success_count` | int | default 0 | 成功数 |
| `failure_count` | int | default 0 | 失败数 |
| `p95_latency_ms` | int | nullable | P95 延迟 |

索引：

- unique `(provider_id, model, window_start, window_minutes)`

### `admin_audit_logs`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 审计 ID |
| `admin_user_id` | uuid | FK `users.id` | 操作管理员 |
| `action` | text | not null | 操作名 |
| `target_type` | text | not null | 目标类型 |
| `target_id` | uuid | nullable | 目标 ID |
| `before_snapshot` | jsonb | nullable | 修改前 |
| `after_snapshot` | jsonb | nullable | 修改后 |
| `created_at` | timestamp | not null | 操作时间 |

规则：

- 审计日志不可更新、不可删除。
- 余额调整、禁用用户、修改上游 Key、修改价格必须写审计。

## 3. 交易边界

| 操作 | 事务要求 |
| --- | --- |
| 创建用户 | `users` + `wallets` 同一事务 |
| 创建 API Key | `api_tokens` + `api_token_policies` 同一事务 |
| 成功扣费 | `usage_events` + `wallet_transactions` + `wallets` 同一事务 |
| 卡密充值 | `recharge_codes` 状态更新 + `wallet_transactions` + `wallets` 同一事务 |
| 管理员调账 | `wallet_transactions` + `wallets` + `admin_audit_logs` 同一事务 |

## 4. Redis Key 约定

| Key | TTL | 说明 |
| --- | --- | --- |
| `session:{session_id}` | 7 天 | Web 会话 |
| `rate:user:{user_id}:rpm:{minute}` | 2 分钟 | 用户 RPM |
| `rate:token:{token_id}:rpm:{minute}` | 2 分钟 | 令牌 RPM |
| `quota:token:{token_id}` | 60 秒 | 令牌额度快照 |
| `idempotency:{request_id}` | 24 小时 | 请求幂等 |
| `upstream:health:{provider_id}` | 60 秒 | 上游健康状态 |

Redis MVP 默认不启用密码。生产环境如需密码，通过 `REDIS_PASSWORD` 或托管 Redis 密钥配置。

## 5. 数据保留

| 数据 | 保留策略 |
| --- | --- |
| 钱包流水 | 永久保留，不物理删除 |
| 使用事件 | 至少 2 年 |
| 请求日志 | 默认 90 天，可配置 |
| 管理员审计 | 至少 2 年 |
| 用户 API Key 明文 | 不保存 |
| 上游 API Key | 加密保存 |
