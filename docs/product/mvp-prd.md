# MVP PRD - API 中转站套娃

状态：冻结草案  
所属任务：T02  
更新日期：2026-06-14

## 1. MVP 目标

做一个可部署到云服务器的第三方 API 中转站。终端用户使用本平台签发的 API Key 调用 OpenAI 兼容接口，本平台再转发到一个上游中转站，并记录调用、余额和基础日志。

MVP 不追求功能最多，先保证四件事：

1. 用户能注册、登录、创建 API Key。
2. 用户能调用 `/v1/models` 和 `/v1/chat/completions`。
3. 成功调用能形成可追踪的 usage event 和 wallet transaction。
4. 管理员能配置一个上游中转站、模型列表、价格倍率和用户余额。

## 2. 目标用户

| 用户 | 目标 | MVP 支持 |
| --- | --- | --- |
| 终端 API 用户 | 拿到一个可用 Key，接入自己的工具或代码 | 支持 |
| 平台管理员 | 配置上游、用户、价格、余额、公告 | 支持基础能力 |
| 代理/邀请用户 | 通过邀请码带来返利 | 只保留字段，不做自动结算 |
| 企业客户 | 多成员、发票、合同、SLA | 不支持 |

## 3. 商业规则

| 规则 | MVP 决策 |
| --- | --- |
| 计量单位 | 用户端显示 token；商家端充值码和运营核算显示人民币；历史数据库字段仍可能保留金额类命名，但业务口径按 token 扣减 |
| 计费单位 | token 记录真实输入输出用量，金额按线路价格规则和价格倍率计算 |
| 余额不足 | 请求前检查余额，不足直接拒绝，不转发上游 |
| 上游失败 | 不扣费，记录失败日志 |
| 流式中断 | 如果上游返回了可计量 token，则按已完成部分计费；如果无法计量则不扣费并标记 `metering_unknown` |
| 重试扣费 | 使用 `request_id` 和 `usage_event` 唯一约束防止重复扣费 |
| 退款 | MVP 只支持管理员手动调整余额并写入审计日志 |
| 邀请返利 | MVP 只记录邀请关系和待结算收益，不做自动提现 |

### 3.1 毛利模型

```text
用户价格 = 模型基础价格 * 模型倍率 * 用户分组倍率
平台毛利 = 用户实收金额 - 上游实际成本
```

MVP 必须在 `usage_events.price_snapshot` 中保存本次调用的模型基础价格、模型倍率、用户分组倍率和估算上游成本。这样以后价格变动不会影响历史账单解释。

### 3.2 宕机与降级规则

| 场景 | 用户看到 | 平台处理 |
| --- | --- | --- |
| 上游整体不可用 | `upstream_error` 或状态页 degraded | 不扣费，记录失败，管理员告警 |
| 单模型不可用 | `model_unavailable` | 不扣费，该模型状态标记 degraded |
| 平台余额系统异常 | `billing_unavailable` | 拒绝请求，不转发上游，避免免费调用或乱扣费 |
| 日志系统异常 | 请求可继续 | 写降级日志，保留最小 request_id |
| 管理后台异常 | 用户 API 不受影响 | 后台返回维护提示 |

## 4. MVP 页面范围

| 页面 | 路由 | MVP 内容 |
| --- | --- | --- |
| 首页公告 | `/` | 公告列表、更新记录 |
| 登录 | `/login` | 用户名密码登录 |
| 注册 | `/register` | 可开关注册，支持邀请码 |
| 个人中心 | `/account/profile` | 余额、消费、调用次数、分组、可用模型 |
| 余额充值 | `/account/recharge` | 兑换码充值、余额流水 |
| 费用说明 | `/pricing` | 模型价格、倍率、分组价格 |
| 令牌管理 | `/token` | 创建、复制一次、禁用、删除、额度、过期时间 |
| 调用日志 | `/log` | 请求状态、模型、消耗、费用、错误 |
| 分组状态 | `/groupAvailability` | 上游可用性和模型状态 |
| 服务状态 | `/uptimeStatus` | 内置健康状态，后续可接 Uptime Kuma |
| 管理后台 | `/admin` | 用户、上游、模型、价格、公告、卡密 |

## 5. MVP 后端能力

| 模块 | MVP 能力 |
| --- | --- |
| Auth | 注册、登录、退出、会话、密码 hash |
| User | 用户状态、用户分组、余额概览 |
| Token | API Key 创建、hash 存储、只显示一次、状态、额度、过期时间 |
| Upstream | 一个或多个上游配置、Base URL、加密 API Key、健康检查 |
| Model | 模型列表、模型映射、模型倍率、分组可见性 |
| Relay | OpenAI 兼容 `/v1/models`、`/v1/chat/completions`，支持 SSE 流式 |
| Billing | 使用事件、钱包流水、幂等扣费、余额不足拒绝 |
| Logs | 请求日志、错误日志、脱敏、导出预留 |
| Admin | 用户管理、余额调整、公告、卡密生成 |

## 6. 明确不做

| 不做项 | 原因 |
| --- | --- |
| Midjourney/绘图异步任务 | 上游能力差异大，放到 T16 |
| `/v1/embeddings` | 首期先保证 chat relay 和计费链路稳定 |
| 文件上传、batch、fine-tuning | 复杂度高，容易扩大安全面 |
| 多租户企业组织 | MVP 面向个人用户和管理员 |
| 自动返利提现 | 涉及财务和风控，先记录待结算数据 |
| 在线支付 | 首期使用兑换码和管理员调账 |
| 多上游接入 | 商家可接入多个上游，但一个客户模型只启用一条上游；不同上游发布成不同客户模型 |
| Kubernetes | 一台云服务器 + Docker Compose 即可 |

## 7. 成功指标

| 指标 | 验收方式 |
| --- | --- |
| 用户能拿到 API Key | 前端创建令牌后只展示一次明文 |
| `/v1/models` 可用 | 用用户 Key 请求返回可用模型数组 |
| `/v1/chat/completions` 可用 | 非流式和流式请求能得到上游响应 |
| 失败不误扣 | 上游 4xx/5xx/超时不生成成功扣费流水 |
| 成功可追踪 | 单次请求可关联 request log、usage event、wallet transaction |
| 余额不为负 | 并发请求下钱包扣减保持原子性 |

## 8. 上线前阻塞项

- 必须完成 API 合约中的错误码、超时、重试、流式中断行为。
- 必须完成数据字典中的唯一约束、索引、交易边界、审计规则。
- 必须完成密钥脱敏检查：数据库不存用户 API Key 明文，日志不写上游 Key。
- 必须完成最小压测：并发扣费不出现负余额或重复扣费。

## 9. 运行时配置矩阵

| 变量 | 默认值 | 用途 | 生产要求 |
| --- | --- | --- | --- |
| `POSTGRES_USER` | `placeholder_user` | PostgreSQL 用户 | 改成生产专用账号 |
| `POSTGRES_PASSWORD` | `placeholder_password` | PostgreSQL 密码 | 使用强密码，只放 `.env` 或服务器密钥 |
| `POSTGRES_DB` | `relay_station` | PostgreSQL 数据库 | 可保留或按环境命名 |
| `DATABASE_URL` | `postgresql://...` | 后端数据库连接 | 不提交真实值 |
| `REDIS_URL` | `redis://redis:6379` | 后端 Redis 地址 | 如启用密码需同步改为 `redis://:<password>@redis:6379` |
| `REDIS_PASSWORD` | 空 | Redis 密码，可选 | 生产建议启用或使用托管 Redis ACL |
| `API_PORT` | `3001` | 后端端口 | 由反代暴露 HTTPS |
| `WEB_PORT` | `3000` | 前端端口预留 | Docker Compose 当前固定映射 3000 |
| `SESSION_COOKIE_SECURE` | `false` | 会话 Cookie 是否强制 Secure | 本地 HTTP 保持 false，生产 HTTPS 必须设为 true |
| `ADMIN_BOOTSTRAP_USERNAME` | 空 | 首个管理员账号引导用户名 | 仅初始化或找回管理员时临时设置，完成后建议移除 |
| `ADMIN_BOOTSTRAP_PASSWORD` | 空 | 首个管理员账号引导密码 | 使用强密码，只放 `.env` 或服务器密钥，不提交真实值 |
| `ADMIN_BOOTSTRAP_FORCE_RESET` | `false` | 是否强制重置已存在管理员 | 默认不覆盖已有活动管理员；找回或修复账号时才临时设为 `true` |
| `INTERNAL_API_BASE_URL` | `http://api:3001` | 前端服务端代理访问 API 的地址 | Compose 内保持服务名，生产使用内网地址 |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3001` | 兼容旧前端直连配置的备用值 | 正常部署走 `/api/auth/*` 同源代理，可不依赖该值 |
| `JWT_SECRET` | 占位值 | 会话签名 | 强随机值 |
| `UPSTREAM_BASE_URL` | `https://upstream.example.com` | 上游中转站地址 | 填真实上游地址 |
| `UPSTREAM_API_KEY` | 占位值 | 上游中转站 Key | 加密存储，不写日志 |
