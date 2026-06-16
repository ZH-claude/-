# MVP 数据字典

状态：冻结草案  
所属任务：T02  
更新日期：2026-06-16

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
| 审计 | 管理员调整余额、禁用用户、修改上游配置必须写 `admin_audit_logs`；登录、改密和令牌生命周期必须写 `security_audit_logs` |

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
| `rate_limit_requests_per_minute` | int | nullable | 用户级每分钟 Relay 请求限制 |
| `risk_locked_until` | timestamp | nullable | 风控锁定结束时间 |
| `risk_reason` | text | nullable | 风控原因说明 |
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
| `last_used_at` | timestamp | nullable | 最近一次 API Key 验证时间 |
| `rate_limit_requests_per_minute` | int | nullable | 令牌级每分钟 Relay 请求限制 |
| `model_rate_limit_requests_per_minute` | int | nullable | 同一令牌单模型每分钟请求限制 |
| `ip_rate_limit_requests_per_minute` | int | nullable | 同一令牌单 IP 每分钟请求限制 |
| `ip_whitelist` | text[] | not null, default empty | 精确 IP 白名单，空数组表示不限制 |
| `activation_ttl_seconds` | int | nullable | 首次策略放行后有效秒数 |
| `activated_at` | timestamp | nullable | 首次策略放行的 Relay 请求时间 |
| `activation_expires_at` | timestamp | nullable | 首次激活过期时间 |
| `deleted_at` | timestamp | nullable | 软删除 |

约束：

- 不存 API Key 明文。
- 创建后只返回一次明文。
- `used_cents <= quota_cents` 仅在 `quota_cents` 不为空时校验。

### `api_token_model_accesses`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 记录 ID |
| `api_token_id` | uuid | FK `api_tokens.id` | 对应令牌 |
| `model` | text | not null | 允许该令牌调用的模型 |

规则：

- T18 MVP 不使用独立 `api_token_policies` 表；限流、IP 白名单和首次激活策略直接保存在 `api_tokens`。
- 模型白名单使用 `api_token_model_accesses` 记录；无记录表示继承用户分组可见模型。

### `relay_rate_limit_events`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 限流事件 ID |
| `request_id` | text | unique, not null | Relay 请求 ID |
| `user_id` | uuid | FK `users.id`, not null | 用户 |
| `token_id` | uuid | FK `api_tokens.id`, not null | 令牌 |
| `model` | text | nullable | 平台模型名，`/v1/models` 可为空 |
| `ip_address` | text | nullable | 归一化后的客户端 IP |
| `created_at` | timestamp | not null | 事件创建时间 |

规则：

- 只在策略放行后写入，用于 60 秒滑动窗口限流计数。
- 超限、IP 白名单拒绝、风险熔断和激活过期请求不写入成功用量、不扣费、不触达上游。
- 长期商用需要归档或清理历史事件，避免事件表无限增长。

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
| `recharge_code_id` | uuid | nullable FK | 关联兑换码 |
| `idempotency_key` | text | unique, not null | 幂等键 |
| `created_at` | timestamp | not null | 创建时间 |

规则：

- 流水不可更新、不可删除，只能追加冲正流水。
- 每次成功扣费必须有一条 `debit`。
- 每次成功兑换码充值必须有一条 `recharge`，`amount_cents` 为正数，且关联 `recharge_code_id`。

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
| `user_id` | uuid | nullable FK `users.id`, on delete set null | 用户 |
| `token_id` | uuid | nullable FK `api_tokens.id`, on delete set null | 令牌 |
| `upstream_provider_id` | uuid | nullable FK `upstream_providers.id`, on delete set null | 上游供应商 |
| `method` | text | not null | HTTP 方法 |
| `path` | text | not null | 请求路径 |
| `model` | text | nullable | 模型 |
| `status_code` | int | nullable | 响应状态 |
| `error_code` | text | nullable | 平台错误码 |
| `latency_ms` | int | nullable | 平台总延迟，毫秒 |
| `upstream_latency_ms` | int | nullable | 上游请求延迟，毫秒 |
| `upstream_status_code` | int | nullable | 上游 HTTP 状态码 |
| `upstream_status` | text | nullable | 上游状态摘要，如 `success`、`http_error`、`failed`、`malformed_response`、`stream_started`、`not_required` |
| `created_at` | timestamp | not null | 创建时间 |
| `completed_at` | timestamp | nullable | 请求日志完成时间 |

规则：

- 不记录 API Key 明文。
- 默认不保存完整 prompt。
- `request_id` 唯一，作为 trace 查询入口，关联 `usage_events`、`wallet_transactions` 和上游状态。
- 查询响应必须使用字段白名单，不返回 `token_hash`、上游 Key、连接串、`price_snapshot`、`idempotency_key` 或内部密钥。

索引：

- unique `request_logs_request_id_key(request_id)`
- index `request_logs_user_created_at_idx(user_id, created_at)`
- index `request_logs_token_created_at_idx(token_id, created_at)`
- index `request_logs_status_created_at_idx(status_code, created_at)`
- index `request_logs_error_created_at_idx(error_code, created_at)`

### `recharge_codes`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 卡密 ID |
| `code_hash` | text | unique, not null | 卡密 hash |
| `amount_cents` | bigint | not null | 金额 |
| `status` | enum | not null | `unused`、`used`、`disabled` |
| `created_by_admin_id` | uuid | FK `users.id` | 创建管理员 |
| `used_by_user_id` | uuid | nullable FK | 使用人 |
| `used_at` | timestamp | nullable | 使用时间 |

规则：

- 明文卡密只在生成接口响应中返回一次，数据库只保存 `code_hash`。
- `amount_cents > 0`。
- `used` 状态必须同时记录 `used_by_user_id` 和 `used_at`。
- 核销必须与钱包余额增加和 `wallet_transactions` 充值流水写在同一事务内。

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
- 查询出口必须递归脱敏 Key、hash、连接串、Base URL、secret 等敏感字段。

### `security_audit_logs`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 安全审计 ID |
| `actor_user_id` | uuid | nullable FK `users.id` | 触发用户；用户删除时置空 |
| `action` | text | not null | 安全动作，如 `user_login_succeeded`、`api_token_reset` |
| `target_type` | text | not null | 目标类型，如 `user`、`session`、`api_token` |
| `target_id` | uuid | nullable | 目标 ID |
| `ip_address` | text | nullable | 归一化后的客户端 IP |
| `metadata` | jsonb | nullable | 脱敏后的补充信息 |
| `created_at` | timestamp | not null | 创建时间 |

规则：

- 登录、登出、修改密码、注册、令牌创建/重置/禁用/删除必须写安全审计。
- `metadata` 不保存明文密码、明文 API Key、token hash、password hash、上游 Key、连接串或内部密钥。
- 安全审计查询仅管理员可访问，普通用户不能读取或伪造。

### `referral_rewards`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 返利记录 ID |
| `inviter_user_id` | uuid | FK `users.id`, not null | 邀请人 |
| `invitee_user_id` | uuid | FK `users.id`, not null | 被邀请人 |
| `amount_cents` | int | not null, `>= 0` | 返利金额，单位分 |
| `status` | enum | not null | `PENDING`、`SETTLED`、`CANCELED` |
| `source` | text | nullable | 返利来源说明或外部关联标识 |
| `settled_at` | timestamp | nullable | 结算时间 |
| `created_at` | timestamp | not null | 创建时间 |
| `updated_at` | timestamp | not null | 更新时间 |

规则：

- 账户中心只聚合当前登录用户作为邀请人的记录，不允许跨用户读取。
- `PENDING` 计入待使用收益，`SETTLED` 计入总收益，`CANCELED` 不计入用户可见收益。
- 返利金额使用整数分，禁止前端写死或用模拟收益替代数据库聚合。

## 3. 交易边界

| 操作 | 事务要求 |
| --- | --- |
| 创建用户 | `users` + `wallets` 同一事务 |
| 创建 API Key | `api_tokens` + 可选 `api_token_model_accesses` 同一事务 |
| 成功扣费 | `usage_events` + `wallet_transactions` + `wallets` 同一事务 |
| Relay 请求日志 | `request_logs` 以 `request_id` upsert；日志写入失败不得影响已完成的鉴权、上游转发或计费结果 |
| 卡密充值 | `recharge_codes` 状态更新 + `wallet_transactions` + `wallets` 同一事务 |
| 管理员调账 | `wallet_transactions` + `wallets` + `admin_audit_logs` 同一事务 |
| 用户安全动作 | 业务状态变更 + `security_audit_logs` 尽量同一事务 |

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
| 安全审计 | 至少 2 年 |
| 用户 API Key 明文 | 不保存 |
| 上游 API Key | 加密保存 |
