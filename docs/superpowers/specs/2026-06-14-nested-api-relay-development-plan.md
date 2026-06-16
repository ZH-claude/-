# 中转站套娃 API 平台开发文档

创建日期：2026-06-14  
目标：建设一个可部署到云服务器的前后端完整 API 中转站。你的平台作为第三方中转层，用户请求先进入你的系统，再由你的系统转发到另一个上游中转站。  
当前状态：T21 云服务器部署资产已完成并通过本地验证；真实云服务器部署、HTTPS 证书和公网重启恢复验证待服务器 SSH、域名 DNS、生产 `.env` 和真实 smoke 账号。
数据库密码通过 `POSTGRES_PASSWORD` 配置，真实值只写入未提交的 `.env` 或服务器密钥管理。  
Redis MVP 阶段默认不启用密码；如生产环境需要启用，通过 `REDIS_PASSWORD` 或托管 Redis 密钥配置，真实值不写入开发文档。

## 0. 本次已完成

- [x] T00 - 目标站只读调研与开发规划
  - 观察方式：使用 Chrome 只读查看 `https://new.aicode.us.com/account/profile` 及主要导航页面。
  - 已观察页面：主页公告、账户中心、余额充值、费用说明、通知设置、分组状态、令牌、日志、绘图日志、异步任务、服务状态。
  - 输出：本开发文档。
  - 完成指标：功能边界、推荐架构、任务拆分、每项验收指标已写入本文档。

## 1. 业务定位

这是一个“中转站套娃”系统：

```text
终端用户 / 用户程序
  -> 你的 API 中转站
  -> 上游 API 中转站
  -> 最终模型或第三方服务
```

你的平台需要同时承担三件事：

1. 面向用户提供 OpenAI 兼容 API、账户、令牌、余额、日志、模型价格等功能。
2. 面向上游中转站做统一转发、鉴权、模型映射、失败处理和成本统计。
3. 面向你自己提供后台管理、价格倍率、上游渠道、风控、公告、充值和运营能力。

原则：做“同类功能”，不要复制目标站品牌、私有文案、账号数据或可能受保护的界面素材。

## 2. 从目标站观察到的功能范围

| 模块 | 目标站可见能力 | 我们要做的对应能力 |
| --- | --- | --- |
| 主页 | 系统公告、更新日志、使用建议、外部教程链接 | 公告中心、更新记录、平台使用建议 |
| 账户中心 | 用户名、用户等级、分组、余额、累计消费、调用次数、邀请返利、时区、可用模型、模型配置、修改密码、系统令牌 | 用户资料、余额概览、消费统计、邀请返利、模型可用性、账户安全 |
| 余额充值 | 兑换码核销、账户余额、充值说明、充值记录 | 卡密充值、余额流水、充值记录、后续可接支付 |
| 费用说明 | 模型价格、倍率、分组倍率、计费公式、模型搜索、复制模型 | 模型价格表、倍率配置、分组价、计费说明 |
| 通知设置 | 余额预警、安全警报、系统公告、促销、模型价格更新；邮件、Telegram、Webhook、企业微信、WxPusher、钉钉、飞书、Bark、Gotify | 通知订阅、余额阈值、通知渠道配置、测试通知 |
| 分组状态 | 正常、部分可用、不可用、暂无数据；时间范围；分组/模型搜索；成功率说明 | 上游分组可用性、模型可用性、成功率统计 |
| 令牌 | 令牌搜索、分组、计费方式、导出、新增、状态、可用模型、消耗额度、剩余额度、过期时间、复制/删除/配置；新增弹窗支持无限额度、永不过期、计费模式、分组、备注、Discord 代理、MJ 翻译、高级选项 | API Key 管理、额度限制、模型限制、状态、导出、删除、配置 |
| 日志 | 调用数据一览、缓存状态、类型、时间、令牌名称、实时消费、RPM、TPM、MPM、预计日消费、导出、汇总账单、调用表格 | 请求日志、消费日志、账单明细、导出、实时统计 |
| 绘图日志 | 提交时间、类型、任务 ID、进度、耗时、结果、Prompt、失败原因 | 图片或异步任务日志，取决于上游是否支持 |
| 异步任务 | 任务 ID、平台、类型、状态、渠道 ID、模型、用户、进度、结果 | 异步任务查询、状态同步、失败追踪 |
| 服务状态 | Uptime Kuma 配置、状态页展示；需要访问地址和状态页 Slug | 服务状态页、外部监控集成 |

## 3. 推荐技术方案

### 3.1 推荐方案

采用“控制面 + 数据面”的渐进式架构，MVP 阶段可以在一个仓库和一台云服务器上部署，代码上先分清模块边界，后续可拆分服务。

| 层 | 责任 | 推荐技术 |
| --- | --- | --- |
| 前端门户 | 用户后台、管理后台、日志、充值、模型、通知 | Next.js + React + Ant Design |
| 控制面后端 | 用户、鉴权、余额、计费、令牌、配置、后台管理 | NestJS + Fastify + Prisma |
| 数据面 Relay | `/v1/*` OpenAI 兼容转发、流式响应、限流、计量 | NestJS/Fastify 独立模块，后续可拆服务 |
| 队列任务 | 异步账单、通知、上游状态探测、导出 | BullMQ + Redis |
| 数据库 | 用户、余额、订单、令牌、模型、日志索引 | PostgreSQL |
| 缓存/限流 | 会话、配额快照、速率限制、幂等键 | Redis |
| 运维 | 部署、反代、HTTPS、日志、监控 | Docker Compose + Nginx/Caddy + Prometheus/Grafana/Loki |

### 3.2 为什么推荐这个方案

1. 你要部署在云服务器上，Docker Compose 最快落地。
2. 套娃中转最核心风险是转发稳定性、计费准确性、密钥安全，必须把 Relay、计费、日志做成清晰边界。
3. 前端目标站风格是管理台，Ant Design 能快速做出类似的表格、筛选、分段控制、弹窗和表单。
4. 后续如果并发上来，可以先把 Relay 数据面横向扩容，再把控制面和数据面拆开。

### 3.3 备选方案

| 方案 | 优点 | 缺点 | 适用情况 |
| --- | --- | --- | --- |
| A. 单体全栈 | 开发最快、部署简单 | 高并发转发和后台逻辑耦合 | 只做小规模自用 |
| B. 控制面 + 数据面 | 稳定、可扩展、适合商业化 | 初期设计要求更高 | 推荐 |
| C. 微服务/K8s | 扩展能力最强 | 运维成本高，MVP 不划算 | 用户量很大后再考虑 |

## 4. 后端核心模块设计

### 4.1 用户与权限

- 注册、登录、退出、修改密码。
- 用户状态：正常、禁用、风控中。
- 用户分组：default、低价组、高稳定组、官方 API 组等。
- 管理员后台：用户列表、余额调整、权限、备注、封禁。

### 4.2 API 令牌

- 创建 API Key。
- 复制、禁用、删除、重置。
- 绑定分组、模型范围、额度上限、过期时间。
- 支持按量优先、额度优先等计费方式。
- 支持批量生成令牌。
- 支持首次使用激活、激活有效期、IP 白名单、令牌级限流器。
- 支持令牌级“重试计费类型一致性”，避免重试时混合计费。
- 支持令牌备注、Discord 代理、MJ 翻译配置。
- 令牌只展示一次明文，数据库只存 hash 和加密片段。

### 4.3 上游中转站配置

- 上游名称、Base URL、上游 API Key。
- 上游支持的模型列表。
- 上游分组和倍率。
- 单上游限流、超时、重试、熔断。
- 健康检查和可用率统计。

### 4.4 OpenAI 兼容 Relay

MVP 第一批接口：

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`

后续接口：

- `POST /v1/embeddings`
- 图片接口或 Midjourney 类异步接口
- 文件、批处理、任务查询，按上游能力决定

Relay 必须支持：

- Bearer Token 鉴权。
- 非流式响应。
- 流式 SSE 响应。
- 请求超时。
- 上游错误透传和统一错误码。
- 请求日志脱敏。
- 计费事件幂等。

### 4.5 计费与余额

计费需要记录价格快照，不能只依赖当前价格表。

核心规则：

```text
最终费用 = 上游成本或模型基础单价
        * 模型倍率
        * 用户分组倍率
        * 充值倍率或折扣系数
        * 补全 token 倍率
```

每次调用生成一条不可变计费事件：

- request_id
- user_id
- token_id
- upstream_id
- model
- prompt_tokens
- completion_tokens
- cached_tokens
- cost
- status
- error_code
- price_snapshot

### 4.6 日志与报表

- 请求日志：时间、模型、令牌、分组、耗时、流式、token、消费、IP、说明。
- 账单日志：充值、消费、退款、管理员调整。
- 实时指标：RPM、TPM、分钟消费、预计日消费。
- 导出：CSV/XLSX。
- 汇总账单：按日、按用户、按模型、按令牌。

### 4.7 通知

首期只做邮件和 Webhook，后续增加 Telegram、企业微信、钉钉、飞书、Bark、Gotify。

事件类型：

- 余额不足。
- 额度即将过期。
- 安全警报。
- 系统公告。
- 模型价格更新。
- 系统报错告警。

### 4.8 风控与安全

- 用户、令牌、IP、模型四层限流。
- 异常消费熔断。
- 敏感词和滥用检测。
- API Key 不进入普通日志。
- 管理员操作审计。
- 越权测试覆盖所有用户数据接口。

## 5. 前端页面设计

| 路由 | 页面 | 完成标准 |
| --- | --- | --- |
| `/` | 首页公告 | 能发布公告、显示更新记录、显示使用建议 |
| `/login` | 登录 | 用户名密码登录，错误提示清楚 |
| `/register` | 注册 | 可开关注册，支持邀请码 |
| `/account/profile` | 个人中心 | 余额、消费、调用次数、邀请、分组、可用模型 |
| `/account/topup/recharge` | 充值 | 兑换码核销、充值记录 |
| `/account/pricing` | 费用说明 | 模型搜索、倍率、计费说明 |
| `/account/notificationSettings` | 通知设置 | 订阅事件、通知渠道、余额阈值 |
| `/groupAvailability` | 分组状态 | 成功率、状态筛选、时间范围 |
| `/token` | 令牌管理 | 新增、查询、导出、删除、配置、高级限流、IP 白名单、模型限制 |
| `/log` | 调用日志 | 筛选、实时指标、导出、汇总账单 |
| `/midjourney` | 绘图日志 | 异步绘图记录，若上游支持 |
| `/task` | 异步任务 | 任务筛选、进度、结果 |
| `/uptimeStatus` | 服务状态 | Uptime Kuma 或内置健康状态 |
| `/admin` | 管理后台 | 用户、上游、模型、价格、公告、风控 |

## 6. 数据库核心表

| 表 | 用途 |
| --- | --- |
| `users` | 用户账户 |
| `user_groups` | 用户分组与倍率 |
| `api_tokens` | 用户 API Key 元数据、额度、过期、状态、备注、限流器、IP 白名单、首次激活策略 |
| `api_token_model_accesses` | 单令牌模型白名单 |
| `relay_rate_limit_events` | Relay 限流窗口事件 |
| `upstream_providers` | 上游中转站配置 |
| `upstream_models` | 上游模型与映射 |
| `model_prices` | 模型价格和倍率 |
| `wallets` | 用户余额 |
| `wallet_transactions` | 充值、消费、调整流水 |
| `usage_events` | 每次 API 调用计费事件 |
| `request_logs` | 调用日志 |
| `recharge_codes` | 兑换码 |
| `announcements` | 系统公告 |
| `notification_preferences` | 通知设置 |
| `notification_channels` | 通知渠道 |
| `availability_metrics` | 分组和模型可用率 |
| `async_tasks` | 异步任务 |
| `admin_audit_logs` | 管理员操作审计 |
| `security_audit_logs` | 登录、改密、令牌生命周期等安全审计 |
| `referral_rewards` | 邀请返利收益明细，用于账户中心待使用收益、总收益和返利记录 |

## 7. 云服务器部署方案

MVP 推荐一台 4C8G 或更高配置云服务器：

```text
Nginx/Caddy
  -> Frontend container
  -> Backend API container
  -> Relay container or backend relay module
  -> Worker container
PostgreSQL
Redis
Loki/Prometheus/Grafana
```

部署要求：

- 全站 HTTPS。
- `.env` 不提交仓库。
- 数据库密码通过 `POSTGRES_PASSWORD` 配置；真实值只写入未提交的 `.env` 或云服务器密钥管理，不写入开发文档和代码仓库。
- 上游账号、登录密码、API Key 等真实凭据不写入开发文档或代码仓库；本地和云服务器通过 `.env` 或服务器密钥管理配置。
- 上游 API Key 使用加密存储。
- 数据库每日自动备份。
- 日志保留周期可配置。
- 支持一键回滚镜像。

## 8. 关键风险与控制

| 风险 | 等级 | 控制 |
| --- | --- | --- |
| 上游中转站不稳定 | 高 | 超时、重试、熔断、失败状态记录 |
| 重试导致重复扣费 | 高 | request_id 幂等、计费事件唯一约束 |
| API Key 泄露 | 高 | hash 存储、加密、日志脱敏、只显示一次 |
| 用户恶意刷量 | 高 | 分层限流、余额阈值、异常熔断 |
| 账单争议 | 高 | 不可变计费事件、价格快照、可导出账单 |
| 用户数据串号 | 高 | user_id 强制过滤、越权测试、审计 |
| 合规风险 | 高 | 服务协议、内容风控、封禁与证据留存 |
| 单机故障 | 中 | 备份、监控、容器重启、后续多机扩容 |

## 9. 任务执行规则

后续每次对话只完成一个任务。完成后必须：

1. 在本文档把对应任务从 `[ ]` 改成 `[x]`。
2. 写明完成证据。
3. 跑最低限度验证。
4. 如果涉及前后端运行，启动或重启服务并验证页面或接口。
5. 提交本次任务代码，并推送到固定 GitHub 仓库。
6. 不跳过未完成的前置任务。

## 10. 任务清单

| 状态 | 编号 | 任务 | 交付物 | 完成指标 |
| --- | --- | --- | --- | --- |
| [x] | T00 | 目标站调研与开发规划 | 本文档 | 已完成页面调研和任务拆分 |
| [x] | T01 | 初始化项目骨架 | monorepo、前端、后端、Docker Compose、README | `docker compose up` 能启动空壳前后端 |
| [x] | T02 | 冻结 MVP 需求与接口范围 | PRD、接口清单、数据字典 | 明确首期支持的 `/v1/*` 接口和不做的功能 |
| [x] | T03 | 用户认证与账户基础 | 登录、注册、会话、用户表 | 用户可注册、登录、退出、修改密码 |
| [x] | T04 | 管理后台基础 | 管理员登录、用户列表、公告管理入口 | 管理员可查看用户并发布公告 |
| [x] | T05 | 上游中转站配置 | 上游配置表、Base URL、Key 加密、健康检查 | 可配置一个上游并验证连通 |
| [x] | T06 | 模型与分组配置 | 模型表、分组倍率、用户分组 | 用户能看到自己分组可用模型 |
| [x] | T07 | API 令牌管理 | 创建、复制、禁用、删除、额度、过期时间、备注 | 创建令牌后可用于 API 鉴权 |
| [x] | T08 | Relay MVP | `/v1/models`、`/v1/chat/completions`、流式透传 | 用户用自己的 Key 调用成功返回上游结果 |
| [x] | T09 | 计费事件与余额扣减 | usage_events、wallet_transactions、幂等扣费 | 成功调用扣费，失败调用不误扣，重试不重复扣 |
| [x] | T10 | 余额充值与兑换码 | 兑换码生成、核销、充值记录 | 用户可核销卡密并增加余额 |
| [x] | T11 | 调用日志页面 | 日志筛选、实时指标、导出 | 用户可按时间、令牌、模型查询消费 |
| [x] | T12 | 费用说明页面 | 模型价格表、倍率说明、搜索、复制模型 | 用户能理解并复制可用模型列表 |
| [x] | T13 | 分组状态页面 | 成功率统计、状态筛选、刷新 | 分组和模型状态可展示真实统计或暂无数据 |
| [x] | T14 | 通知设置 | 邮件、Webhook、余额阈值、测试通知 | 余额低于阈值时能触发通知 |
| [x] | T15 | 首页公告与文档入口 | 公告列表、更新日志、使用建议 | 管理员发布后用户首页可见 |
| [x] | T16 | 异步任务与绘图日志 | async_tasks、任务查询页 | 若上游支持异步任务，能查询进度和结果 |
| [x] | T17 | 服务状态页 | Uptime Kuma 配置或内置探针 | 用户可看到平台和上游状态 |
| [x] | T18 | 风控与限流 | 用户/令牌/IP/模型限流、IP 白名单、首次激活策略、异常熔断 | 超限请求被拒绝且不影响其他用户 |
| [x] | T19 | 安全加固 | Key 脱敏、审计日志、越权测试 | 日志无明文 Key，越权测试通过 |
| [x] | T20 | 可观测性 | 结构化日志、trace_id、监控面板、告警 | 单次请求可追踪到上游和计费事件 |
| [ ] | T21 | 云服务器部署 | HTTPS、域名、备份、回滚文档 | 生产环境可访问，重启后服务自动恢复 |
| [ ] | T22 | 商家端独立化 | 登录角色分流、商家端固定导航、后台 Dashboard、管理模块拆页 | 商家账号进入独立工作台，普通用户无法访问 |
| [ ] | T23 | 上线前验收 | 压测、安全检查、账单核对、运维手册 | 完成上线检查表并修复阻塞项 |

## 11. 下一次对话建议任务

建议下一次优先完成 T22 的商家端独立化：详细拆分见 `docs/product/merchant-console-plan.md`。当前真实云服务器部署仍保留在 T21，拿到服务器、域名和生产 `.env` 后再执行 strict smoke。

T22 商家端独立化进展记录（2026-06-16）：

- M01 登录后角色分流已完成：登录页使用真实 `/auth/login` 返回的 `user.role` 决定跳转，普通用户进入 `/account/profile`，后台/商家账号进入 `/merchant`。
- 已新增服务端动态入口 `/merchant`，用真实 HttpOnly cookie 调用后端 `/auth/me` 做角色判断：未登录跳 `/login`，普通用户跳 `/account/profile`，后台/商家账号跳 `/admin`。
- 已新增前端角色路由 helper，当前兼容 `admin`，并预留未来 `merchant` 角色字符串；数据库仍保持 MVP 的 `USER/ADMIN` 双角色，不做伪造角色。
- 已新增 `npm run qa:t22:merchant-routing`，通过真实 Postgres 临时用户、真实登录、真实 session、真实 `/merchant` HTTP 重定向和真实 `/admin/users` 权限检查验证双端互通，结束后临时用户、钱包、会话和安全审计残留为 0。
- M02 商家端 Shell 与固定导航已完成：新增独立 `MerchantShell`，`/admin` 使用商家端顶部栏和左侧固定栏，不再显示普通用户中心侧栏。
- 商家端固定栏已包含首页、用户、充值码、分组状态、令牌入口、请求日志、绘图日志、上游/模型、公告、审计、服务状态；后台审计和安全审计区域来自真实后端接口并只展示脱敏字段。
- 已新增 `npm run qa:t22:merchant-shell`，通过真实 Postgres、真实登录、真实 session、真实 `/admin` 页面和真实后台 API 权限验证商家 Shell 与双端兼容，结束后临时用户、钱包、会话和安全审计残留为 0。
- 已完成本地浏览器真实登录验证：`merchant_test_1 / merchant200611` 在 1920、1366、390 三个视口下商家 Shell 存在、普通用户菜单未泄漏、无横向溢出、控制台无错误。
- M03 商家端入口 Dashboard 已完成：`/merchant` 现在渲染商家工作台，不再只是跳 `/admin`；未登录跳 `/login`，普通用户跳 `/account/profile`。
- 已新增 `GET /admin/dashboard-summary`，由后台权限保护，用真实数据库聚合用户、钱包、今日调用/消费、上游健康、模型、充值码和最近告警，不返回密码哈希、token hash、上游密钥、充值码 hash 或连接串。
- 已新增 `npm run qa:t22:merchant-dashboard`，通过真实 Postgres 临时创建用户、钱包、令牌、上游、模型、usage、request log 和充值码，真实登录后与数据库实时重算结果逐项比对；普通用户访问汇总接口为 403；结束后临时数据残留为 0。
- 已更新 `npm run qa:t22:merchant-routing` 和 `npm run qa:t22:merchant-shell`，适配新的 `/merchant` Dashboard 行为并复测通过。
- 已完成本地浏览器真实登录验证：`merchant_test_1 / merchant200611` 在 1920、1366、390 三个视口下 Dashboard 存在、普通用户菜单未泄漏、无横向溢出、控制台无错误。
- M04 商家端用户管理页已完成：新增 `/merchant/users` 独立页面，商家端导航“用户”进入该页，旧 `/admin` 大页面保留兼容。
- 已新增 `GET /admin/groups`，由后台权限保护，只返回公开分组字段、用户数和模型授权数；用户页通过真实 `/admin/users` 分页读取用户，通过真实 `/admin/users/:id/group` 更新分组。
- 已新增 `npm run qa:t22:merchant-users`，通过真实 Postgres 临时创建管理员、普通用户、两个分组和钱包，真实登录后验证用户列表、分组列表、分组更新、数据库持久化、普通用户 403、敏感字段不泄漏；结束后临时用户、钱包、会话、审计和分组残留为 0。
- 已复跑 `qa:t22:merchant-routing`、`qa:t22:merchant-shell`、`qa:t22:merchant-dashboard`，确认 M01-M03 未回归；并用浏览器真实登录验证 `/merchant/users` 在 1920、1366、390 三个视口无控制台错误、无普通用户菜单泄漏、无横向页面溢出。

账户中心功能对齐补强记录（2026-06-16）：

- 已将 `/account` 改为跳转 `/account/profile`，并新增接近参考站结构的账户中心：顶部导航、左侧账户菜单、身份卡、余额/消费/调用/邀请指标、推广信息、用户信息、可用模型、模型配置和账户选项。
- 已新增 `referral_rewards` 真实数据库表和 Prisma migration `20260616070000_profile_referral_rewards`，账户中心的待使用收益、总收益和返利记录来自数据库聚合。
- 已扩展 `/auth/me` 真实响应：返回 `lastLoginIp`、调用次数、活跃令牌数、邀请用户数、返利收益聚合和当前分组可用模型，不返回 `passwordHash`、`tokenHash`、上游密钥或内部上游映射。
- 已新增 `/auth/timezone`，用户可在账户中心修改时区，写入 `users.timezone` 并记录 `security_audit_logs`。
- 已新增 `npm run qa:profile-alignment`，通过真实 API + 真实 Postgres 创建临时用户、分组、模型、令牌、用量、返利记录并验证响应，结束后清理到 0 残留。
- 已完成本地浏览器真实流程验证：浏览器注册用户、跳转账户中心、写入真实钱包/邀请收益/模型/调用数据、刷新页面展示真实数据、修改时区落库，临时 QA 数据清理为 0。
- 未勾选 T21/T22：本次是账户中心功能对齐补强，不代表云服务器部署、DNS、HTTPS、生产 strict smoke 或上线前验收完成。

T21 的边界：

- 以当前 monorepo 和 Docker Compose 为基础，补齐云服务器部署说明、环境变量矩阵、HTTPS/反代、数据库迁移、备份和回滚步骤。
- 明确生产环境真实密钥只进入服务器 `.env` 或密钥管理，不写入仓库、文档、CI 日志或截图。
- 建立部署后 smoke test：`/health`、登录、令牌创建、`/v1/models`、`/v1/chat/completions`、usage trace、充值、通知和服务状态。
- 明确进程自恢复策略，至少覆盖 API、Web、PostgreSQL、Redis 和反代重启后的恢复路径。
- T21 不应改变业务功能逻辑；如发现部署阻塞，只做部署所需的最小兼容修改。

T21 完成指标：

- 文档能指导一台干净云服务器完成部署、迁移、启动、HTTPS 配置、备份和回滚。
- `.env.example` 覆盖生产必需配置项，但不包含真实密钥。
- 本地至少验证 Compose 配置、生产构建、迁移状态和部署 smoke test 脚本或等效命令。
- 部署文档明确上线前不能伪造真实上游、真实支付或真实监控结果；未接入项必须显示为未配置。

T21 仓库侧进展记录（2026-06-16）：

- 已新增生产部署编排 `compose.prod.yml`，包含 PostgreSQL、Redis、API、Web 和 Caddy；生产只暴露 80/443，PostgreSQL/Redis 不暴露公网。
- 已新增 `ops/caddy/Caddyfile`，通过 `CADDY_WEB_DOMAIN`、`CADDY_API_DOMAIN` 和 `ACME_EMAIL` 支持自动 HTTPS。
- 已新增 `ops/backup/postgres-backup.sh` 和 `ops/deploy/rollback.sh`；回滚默认先做 PostgreSQL 备份，再切换 Git ref、重建 API/Web 并可选执行 smoke。
- 已新增 `ops/deploy/preflight.mjs` 和 `npm run preflight:t21:prod`，上线前检查 `.env`、占位值、密钥长度、Compose URL、HTTPS 域名、DNS、80/443、Git/Docker/Compose 和生产 Compose 展开，且不输出真实密钥。
- 已新增 `ops/deploy/deploy.sh`、`ops/deploy/restart-verify.sh`、`npm run deploy:t21:prod` 和 `npm run verify:t21:restart`，服务器侧可执行预检、可选备份、build/up、迁移、health、真实 smoke 和重启恢复验证。
- 已新增 `ops/smoke/t21-deploy-smoke.mjs` 和 `npm run smoke:t21:deploy`，用真实 HTTP 检查 `/health`、Web 首页、`/service-status`、登录、令牌、`/v1/models`、`/v1/chat/completions`、usage trace、充值和通知；缺少真实配置时输出 `skip`，`SMOKE_STRICT=true` 时任何 `skip` 都失败。
- 已更新 `.env.example`、`README.md` 和 `docs/deployment/cloud-server-deployment.md`，明确生产密钥只进入服务器 `.env` 或密钥管理，不写入仓库、文档、CI 日志或截图。
- 已验证 `docker compose -p nested-api-relay --env-file .env.example -f compose.prod.yml config`、`node --check ops/smoke/t21-deploy-smoke.mjs`、`node --check ops/deploy/preflight.mjs`、Docker/Alpine `sh -n` 检查 deploy/restart/backup/rollback、preflight 拒绝 `.env.example`、临时生产形态 env preflight 通过、`npm run typecheck`、`npm run build`、本地 Docker 镜像重建、Prisma migrate status、本地 smoke、`npm run qa:t17:service-status` 和 `npm run qa:t20:observability`。
- 已创建 `docs/quality/t21-self-check.md`，记录真实验证、跳过项、旧容器导致的 T20 回归失败根因和复测通过证据。
- 未勾选 T21：真实云服务器 SSH 部署、DNS、Caddy ACME 证书签发、公网 HTTPS、生产 `.env`、真实账号/模型/上游/充值/通知 strict smoke 和服务器重启恢复尚未执行。

T20 完成记录（2026-06-16）：

- 已新增 `request_logs` 表和 Prisma migration `20260616043000_t20_request_logs`，用 `request_id` 唯一关联用户、令牌、上游、路径、状态码、错误码、总延迟、上游延迟和上游状态。
- 已新增 `RequestLogsService`，在 Relay 成功、上游 HTTP 错误、连接失败、malformed response、流式开始、前置拒绝和 `/v1/models` 路径写入真实请求日志；日志写入失败只记录内部 warning，不影响用户请求返回。
- 已新增 `GET /usage/logs/:requestId/trace`，当前登录用户只能查询自己的请求链路；响应用白名单返回 usage event、wallet transaction、request log 和 upstream 摘要，不暴露上游 Key、token hash、连接串、price snapshot 或内部 provider id。
- 已将视频参考里的“统一入口、标准 OpenAI API、密钥/负载/用量运营”思路落到工程路线：当前阶段先完成标准 API 请求可追踪和用量可核对；后续 T21/T22 再面向云部署、监控面板和生产运营。
- 已新增 `apps/api/scripts/t20-observability-qa.ts` 和 `npm run qa:t20:observability`，通过真实注册、真实令牌、真实临时上游、真实 Relay HTTP 调用和真实 Postgres 记录验证成功、前置拒绝、上游 500、malformed JSON、`/v1/models` 和跨用户隔离。
- 已修复旧 Relay QA 脚本在新增 `request_logs` 后的清理盲区：T11、T13、T14、T18 均已统计并清理 `request_logs`；T18 进一步捕获真实响应 `x-request-id` 做精确清理，避免前置拒绝日志在外键置空后残留。历史残留已按精确 request id 清理，当前 `request_logs` 总数为 0。
- 已验证 `npm run typecheck`、`npm --prefix apps/api run build`、`npm --prefix apps/api exec -- prisma migrate status`、`npm run qa:t20:observability`、`npm run qa:t19:security-hardening`、`npm run qa:t18:rate-limits`、`npm run qa:t14:notifications`、`npm run qa:t13:group-availability`、`npm run qa:t11:usage-logs`。
- T20 QA 和相关回归均使用真实数据库记录、真实 HTTP 请求、真实会话 Cookie 和真实临时上游，完成后清理为 0 残留。

T19 完成记录（2026-06-16）：

- 已新增 `security_audit_logs` 表，记录登录、登出、改密、注册和用户令牌生命周期事件，并按 actor/action/created_at 建立查询索引。
- 已新增 `SecurityAuditService`，在写入和查询时递归脱敏 `authorization`、`cookie`、`password`、`tokenHash`、`encryptedApiKey`、`apiKey`、`secret`、`connectionString`、`DATABASE_URL`、`REDIS_URL`、`baseUrl`、`codeHash` 等敏感 key。
- 已将注册、登录成功、登出、修改密码、令牌创建、令牌重置、令牌禁用和令牌删除写入安全审计；明文 API Key 和密码不进入审计 metadata。
- 已新增管理员只读 `GET /admin/audit-logs` 和 `GET /admin/security-audit-logs`，继续由 `AuthGuard + AdminGuard` 保护；普通用户访问返回 403。
- 已对管理员审计查询增加快照脱敏，避免上游 Base URL、加密 Key、Key 预览、充值码 hash、token hash、password hash 等内部字段从查询口泄露。
- 已新增 `apps/api/scripts/t19-security-hardening-qa.ts` 和 `npm run qa:t19:security-hardening`，通过真实注册、登录、改密、令牌、管理员公告/上游/充值码操作和跨用户访问验证。
- 已验证跨用户 token 删除返回 404，跨用户 usage log token 查询为空，跨用户 async task 和 notification settings 不泄露。
- 已验证管理员审计和安全审计可查询且脱敏；普通用户不能读取或伪造后台审计面。
- 已验证 `npm run typecheck`、`npm --prefix apps/api run build`、`npx prisma migrate status`、`npm run qa:t19:security-hardening`、`npm run qa:t18:rate-limits`、`npm run qa:t15:announcements`、`npm run qa:t16:async-tasks`、`npm run qa:t17:service-status`、api/web audit 和 `git diff --check`。
- T19 QA 使用真实数据库记录、真实 HTTP 登录态和真实会话 Cookie，完成后清理为 0 残留。

T18 完成记录（2026-06-16）：

- 已新增用户、令牌和限流事件相关字段：用户级 RPM、风险锁定时间/原因、令牌级 RPM、单模型 RPM、单 IP RPM、IP 白名单、首次激活 TTL、激活时间和激活过期时间。
- 已新增 `relay_rate_limit_events` 表，按用户、令牌、模型、IP 和创建时间建立查询索引，使用 request id 保证事件唯一。
- 已新增 `RelayPolicyService`，在 Relay 上游转发和计费之前执行风险锁定、IP 白名单、失败熔断、用户/令牌/模型/IP 限流。
- 已使用 PostgreSQL advisory lock 序列化同一限流 scope，防止并发请求穿透限额。
- 已将 `/v1/models` 和 `/v1/chat/completions` 接入同一真实令牌/IP 策略；超限返回稳定错误码 `rate_limit_exceeded`，IP 白名单返回 `ip_not_allowed`，激活过期返回 `token_activation_expired`，风险熔断返回 `risk_limit_exceeded`。
- 已修复审查中发现的首次激活副作用：策略拒绝请求不会写入 `activated_at` 或 `activation_expires_at`，只有策略放行后的真实 Relay 请求才启动首次激活窗口。
- 已在 `/token` 用户页面新增令牌 RPM、单模型 RPM、单 IP RPM、IP 白名单和首次激活有效分钟配置，并在令牌列表展示策略摘要。
- 已新增 `apps/api/scripts/t18-rate-limits-qa.ts` 和 `npm run qa:t18:rate-limits`，通过真实注册用户、真实数据库字段、真实临时上游和真实 Relay HTTP 请求验证。
- 已完成浏览器 QA：真实创建带限流策略的令牌，页面展示 token/model/IP RPM、IP 白名单数量和激活有效期。
- 已验证 `npm run typecheck`、`npm --prefix apps/api run build`、`npx prisma migrate status`、`npm run qa:t18:rate-limits`、`npm run qa:t11:usage-logs`、`npm run qa:t14:notifications`、`npm run qa:t15:announcements`、`npm run qa:t16:async-tasks`、`npm run qa:t17:service-status`、api/web audit 和 `git diff --check`。
- T18 QA 与浏览器临时记录均使用真实数据库记录和真实 HTTP/浏览器路径，完成后清理为 0 残留。
- Docker 镜像重建本轮未作为通过项：依赖拉取出现 `ECONNRESET`，后续重建超时；已记录在 `docs/quality/t18-self-check.md` 的未覆盖项中。

T17 完成记录（2026-06-15）：

- 已新增 `ServiceStatusModule` 和公开只读 `GET /service-status`。
- 已实现内置平台探针：API 进程、数据库 `SELECT 1`、Redis TCP 连接、Web 健康 URL。
- 已新增可选 `UPTIME_KUMA_STATUS_URL`；未配置时返回 `not_configured`，不伪造外部监控结果。
- 已复用 `upstream_providers.health_status`、`last_health_check_at`、`last_health_latency_ms` 和脱敏后的健康错误展示上游状态。
- 已保证服务状态响应不返回 `baseUrl`、`apiKeyPreview`、`encryptedApiKey`、数据库连接串、Redis 连接串或内部 URL。
- 已新增 Next 同源代理 `/api/service-status`、前端客户端和 `/uptimeStatus` 页面。
- 已把首页导航和文档入口接入服务状态页。
- 已新增 `apps/api/scripts/t17-service-status-qa.ts` 和 `npm run qa:t17:service-status`，通过真实注册、真实 `upstream_providers` 表、真实后端 API 和真实 Next 代理验证。
- 已完成浏览器 QA：桌面/移动端服务状态页加载、刷新、真实内置探针、外部监控未配置状态和空上游状态均通过，控制台无错误。
- 已创建 `docs/quality/t17-self-check.md`，记录 review、QA、浏览器验证、敏感字段扫描、依赖审计、回归和残留清理。
- 已验证 `npm run typecheck`、Docker 经典构建重建、Docker 重启、`npm run qa:t17:service-status`、浏览器 QA、`npm run qa:t16:async-tasks`、`npm run qa:t15:announcements`、`npm run qa:t14:notifications`、`npm run qa:t13:group-availability`、api/web audit 和 `git diff --check`。
- T17 QA 与浏览器临时记录均使用真实数据库记录和真实 HTTP/浏览器路径，完成后清理为 0 残留。

T16 完成记录（2026-06-15）：

- 已新增 `AsyncTaskKind`、`AsyncTaskStatus`、`async_tasks` 数据表和 Prisma migration `20260615190000_t16_async_tasks`。
- 已实现后端 `AsyncTasksModule` 和 `GET /async-tasks`，由 `AuthGuard` 保护并强制按当前用户 `userId` 查询。
- 已支持 `kind`、`status`、`platform`、`model`、`limit` 过滤，非法枚举和条数返回 400。
- 已实现响应字段白名单，只返回任务展示所需字段和上游名称/状态，不返回 `userId`、`upstreamProviderId`、密码 hash 或 token hash。
- 已新增 Next 同源代理 `/api/async-tasks/[[...path]]` 和前端客户端。
- 已新增 `/task` 通用异步任务页和 `/midjourney` 绘图日志页；绘图日志固定 `kind=image`。
- 已把首页导航和文档入口接入异步任务、绘图日志。
- 已新增 `apps/api/scripts/t16-async-tasks-qa.ts` 和 `npm run qa:t16:async-tasks`，通过真实注册、真实 `async_tasks` 表、真实后端 API 和真实 Next 代理验证。
- 已完成浏览器 QA：`/task` 展示当前用户真实任务、失败状态筛选和刷新有效；`/midjourney` 只显示绘图类任务；未登录访问 `/task` 跳转登录页；控制台无错误。
- 已创建 `docs/quality/t16-self-check.md`，记录 review、QA、浏览器验证、敏感字段扫描、依赖审计、回归和残留清理。
- 已验证 `npm run typecheck`、Docker 重建重启、`npm run qa:t16:async-tasks`、浏览器 QA、`npm run qa:t15:announcements`、`npm run qa:t14:notifications`、api/web audit 和 `git diff --check`。
- T16 QA 与浏览器临时记录均使用真实数据库记录和真实 HTTP/浏览器路径，完成后清理为 0 残留。

T15 完成记录（2026-06-15）：

- 已新增 `AnnouncementCategory` 枚举和 Prisma migration `20260615173000_t15_announcement_categories`，支持 `announcement`、`update_log`、`usage_guide` 三类真实首页内容。
- 已扩展管理员 `/admin/announcements` 创建和列表接口，发布时可选择分类；旧客户端不传分类时默认 `announcement`，保持 T04 兼容。
- 已新增公开只读后端 `/announcements`，只返回 `PUBLISHED` 公告，并按公告、更新日志、使用建议分组；不返回管理员 ID、创建人、草稿、归档或审计字段。
- 已新增 Next 同源 `/api/announcements` 代理、前端公告客户端和首页真实公告展示。
- 首页现在展示真实发布内容、真实空状态和已有页面的文档入口，不写死演示公告、更新日志或使用建议。
- 已新增 `apps/api/scripts/t15-announcements-qa.ts` 和 `npm run qa:t15:announcements`，通过真实管理员、真实公告表、真实公开 API 和真实 Next 代理验证。
- 已完成浏览器 QA：真实管理员在后台页面发布三类公告和一个草稿，首页只显示三条已发布内容，草稿不显示，文档入口可跳转。
- 已创建 `docs/quality/t15-self-check.md`，记录 review、QA、浏览器验证、敏感字段扫描、残留清理和剩余边界。
- 已验证 `npm --prefix apps/api run typecheck`、`npm --prefix apps/web run typecheck`、Docker 重建重启、`npm run qa:t15:announcements`、浏览器 QA、`npm run qa:t14:notifications`、api/web audit 和 `git diff --check`。
- T15 QA 与浏览器 fixture 均使用真实数据库记录和真实 HTTP/浏览器路径，完成后清理为 0 残留。

T14 完成记录（2026-06-15）：

- 已新增 `notification_preferences`、`notification_channels`、`notification_deliveries` 数据表、通知枚举和 Prisma migration `20260615160000_t14_notifications`。
- 已实现后端 `/notifications/settings`、`PUT /notifications/settings`、`POST /notifications/test-webhook`，所有接口由 `AuthGuard` 保护并按当前用户隔离。
- 已实现 Webhook URL 加密存储、只返回掩码预览、SSRF 基础防护、真实 Webhook 发送、成功/失败投递记录和最近投递历史。
- 已接入真实计费扣款后余额预警：仅在成功 `BILLABLE` 扣费和真实钱包流水生成后检查阈值；幂等重复事件、失败调用、未计量流式调用不触发。
- 已新增前端 `/account/notificationSettings`、同源 `/api/notifications/*` 代理、通知 API 客户端和首页通知设置入口。
- 邮件通道首期明确标记为未接入/不可测试，不返回假成功；Webhook 未配置时也不能返回成功。
- 已创建 `apps/api/scripts/t14-notifications-qa.ts` 和 `npm run qa:t14:notifications`，使用真实 PostgreSQL、真实 HTTP API、真实公开 HTTPS Webhook 端点和真实 Relay 扣费触发余额预警。
- 已创建 `docs/quality/t14-self-check.md`，记录 review、QA、浏览器验证、敏感字段扫描、残留清理和剩余边界。
- 已验证 `npm --prefix apps/api run typecheck`、`npm --prefix apps/web run typecheck`、`npm run build`、Docker 重建重启、`npm run qa:t14:notifications`、浏览器 QA、api/web audit 和 `git diff --check`。
- 已回归验证 `npm run qa:t10:recharge`、`npm run qa:t11:usage-logs`、`npm run qa:t12:pricing`、`npm run qa:t13:group-availability`，确认充值、日志、价格、分组状态与 T14 兼容。
- T14 QA 与浏览器 fixture 均使用真实数据库记录和真实 HTTP/浏览器路径，完成后清理为 0 残留。

T13 完成记录（2026-06-15）：

- 已新增后端 `/group-availability/models`，由 `AuthGuard` 保护，只按当前登录用户分组返回授权模型状态。
- 已基于真实 `model_prices`、`model_group_accesses`、`upstream_models`、`upstream_providers` 和 `usage_events` 聚合状态、成功率、窗口统计和原因码。
- 已定义 `normal`、`partial`、`unavailable`、`no_data` 状态，区分“无数据”和“不可用”，避免虚构成功率。
- 已新增前端 `/groupAvailability`、同源 `/api/group-availability/*` 代理和首页分组状态入口。
- 已实现时间窗筛选、状态筛选、刷新、汇总指标和模型状态表。
- Review 中发现并修复空分组 `userCount` 误报 0 问题，新增真实 QA 断言覆盖。
- 已创建 `docs/quality/t13-self-check.md`，记录 review、QA、浏览器验证、敏感字段断言和剩余边界。
- 已验证 `npm run typecheck`、`npm run build`、Docker 重建重启、`npm run qa:t13:group-availability`、浏览器 QA、`npm run qa:t12:pricing`、`npm run qa:t11:usage-logs`、`npm run qa:t10:recharge`、api/web audit 和 `git diff --check`。
- T13 QA 与浏览器 fixture 均使用真实 PostgreSQL 记录和真实 HTTP/浏览器路径，完成后清理为 0 残留。

T12 完成记录（2026-06-15）：

- 已新增后端 `/pricing/models`，由 `AuthGuard` 保护，返回当前用户分组真实可用模型、公开输入/输出单价、模型倍率、分组倍率和计费公式。
- 已复用 `ModelCatalogService` 的真实可用模型过滤：模型启用、用户分组授权、存在启用上游模型且供应商启用。
- 已新增 `BILLING_FORMULA` 与 `BILLING_ROUNDING` 共享常量，`PricingService` 与 `BillingService` 共用同一公式来源，降低价格说明和实际扣费漂移风险。
- 已新增前端 `/pricing`、`/account/pricing` 兼容跳转、同源 `/api/pricing/*` 代理和首页费用说明入口。
- 已实现费用说明页模型搜索、复制模型名、公开价格、实际倍率后单价和公式展示。
- 已创建 `docs/quality/t12-self-check.md`，记录 review、QA、真实数据验证、浏览器验证、敏感字段扫描和剩余边界。
- 已验证 `npm run typecheck`、`npm run build`、Docker 重建重启、`npm run qa:t12:pricing`、浏览器 QA、`npm run qa:t10:recharge`、`npm run qa:t11:usage-logs`、api/web audit 和 `git diff --check`。
- T12 QA 与浏览器 fixture 均使用真实 PostgreSQL 记录和真实 HTTP/浏览器路径，完成后清理为 0 残留。

T01 完成记录（2026-06-14）：

- 已创建根目录编排脚本、`apps/web`、`apps/api`、`docker-compose.yml`、`Dockerfile`、`.env.example`、`README.md`。
- 已验证 `npm run typecheck` 通过。
- 已验证 `npm run build` 通过。
- 已验证 `npm audit --prefix apps/api --audit-level=moderate` 和 `npm audit --prefix apps/web --audit-level=moderate` 均为 0 漏洞。
- 已验证 `docker compose -p nested-api-relay up -d` 启动 PostgreSQL、Redis、API、Web。
- 已验证 `http://127.0.0.1:3001/health` 返回 `status: ok`。
- 已验证 `http://127.0.0.1:3000` 返回 HTTP 200。

T02 完成记录（2026-06-14）：

- 已创建 `docs/product/mvp-prd.md`，冻结 MVP 目标用户、商业规则、页面范围、后端能力、明确不做项和运行时配置矩阵。
- 已创建 `docs/api/openai-compatible-mvp-contract.md`，冻结首期支持的 `/v1/models`、`/v1/chat/completions`，以及暂不支持接口、错误码、超时、重试、流式中断和脱敏规则。
- 已创建 `docs/data/mvp-data-dictionary.md`，冻结核心表、唯一约束、索引、归属关系、交易边界、账本不可变性和 Redis Key 约定。
- 已创建 `docs/quality/t02-self-check.md`，记录代码自检、侧车复核处理、验证命令和剩余风险。
- 已修复自检发现的基础配置问题：`npm ci` 可复现安装、Redis 可选密码、前端内外部 API 地址区分、Compose 端口变量、`.gitignore` 缓存规则。
- 已验证 `npm run install:all`、`npm run typecheck`、`npm run build`、api/web audit、Compose 配置、Docker 启动、`/health` 和前端 HTTP 200。

T03 完成记录（2026-06-14）：

- 已实现 PostgreSQL 用户认证基础表：`user_groups`、`users`、`wallets`、`sessions`，并创建 Prisma migration。
- 已实现后端 `/auth/register`、`/auth/login`、`/auth/me`、`/auth/logout`、`/auth/change-password`。
- 已采用数据库 opaque session，登出会撤销当前会话，改密会撤销其他会话；密码使用 bcrypt hash，不存明文。
- 已实现前端 `/register`、`/login`、`/account`，支持注册后进入账户、登录、退出、修改密码、展示分组和余额基础信息。
- 已让 Compose API 启动前执行 `prisma migrate deploy`，云服务器空库启动时可自动应用迁移。
- 已创建 `docs/quality/t03-self-check.md`，记录类型检查、构建、依赖审计、Docker、API 链路和浏览器链路验证。

T04 完成记录（2026-06-14）：

- 已新增 `announcements` 与 `admin_audit_logs` 数据表，并创建 Prisma migration `20260614120000_t04_admin_announcements_audit`。
- 已实现后端 `/admin/users`、`/admin/announcements`，所有后台接口由 `AuthGuard + AdminGuard` 保护，仅 `admin` 角色可访问。
- 已实现可选管理员引导配置：`ADMIN_BOOTSTRAP_USERNAME` 与 `ADMIN_BOOTSTRAP_PASSWORD`，只通过环境变量提供，不写真实密码进仓库；默认不覆盖已有活动管理员，只有 `ADMIN_BOOTSTRAP_FORCE_RESET=true` 才显式重置。
- 已实现前端 `/admin`，管理员可查看用户列表、发布公告、查看公告记录。
- 已实现前端同源 `/api/admin/*` 代理，继续使用 HttpOnly Cookie 会话。
- 已创建 `docs/quality/t04-self-check.md`，记录类型检查、构建、依赖审计、Docker 迁移、API 权限链路、审计日志和浏览器链路验证。

T05 完成记录（2026-06-14）：

- 已新增 `upstream_providers` 数据表、状态枚举与 Prisma migration `20260614133000_t05_upstream_providers`。
- 已实现上游 API Key AES-256-GCM 加密保存，接口和前端只展示 `apiKeyPreview`，不返回明文 Key。
- 已实现后端 `/admin/upstreams` 与 `/admin/upstreams/:id/health-check`，继续由 `AuthGuard + AdminGuard` 保护。
- 已为上游健康检查增加本机、内网、链路本地、组播和云元数据地址拦截，避免配置页被用作内网探测入口。
- 已实现前端 `/admin` 上游配置与健康检查区域，支持保存 Base URL、Key、状态并触发连通性验证。
- 已新增 `UPSTREAM_KEY_ENCRYPTION_SECRET` 运行时配置；Compose 带开发专用默认值，生产真实密钥必须放 `.env` 或服务器环境变量。
- 已创建 `docs/quality/t05-self-check.md`，记录类型检查、构建、Docker 重建、真实 HTTP 健康检查、密文查库、自检数据清理和剩余风险。

T06 完成记录（2026-06-14）：

- 已新增 `model_prices`、`upstream_models`、`model_group_accesses` 数据表、`ModelStatus` 枚举与 Prisma migration `20260614141000_t06_model_group_config`。
- 已实现统一模型可见性查询服务，用户可见模型必须同时满足用户分组 active、模型 active、上游 active、存在 active 映射。
- 已实现后端 `/admin/model-config`、`/admin/groups`、`/admin/users/:id/group`、`/admin/models`、`/admin/upstream-models`，继续由 `AuthGuard + AdminGuard` 保护。
- 已实现前端 `/admin` 分组配置、用户分组调整、模型价格配置、上游模型映射；已实现 `/account` 展示当前用户分组可用模型。
- 已创建 `docs/quality/t06-self-check.md`，记录类型检查、构建、迁移恢复、真实后台 API、真实用户可见性、越权检查、密文查库和自检数据清理。

T07 完成记录（2026-06-14）：

- 已新增 `api_tokens`、`api_token_model_accesses` 数据表、`ApiTokenStatus` 枚举与 Prisma migration `20260614152000_t07_api_tokens`。
- 已实现后端 `/tokens`、`/tokens/:id/disable`、`/tokens/:id/reset`、`DELETE /tokens/:id`，所有管理接口由登录会话保护并强制按 `userId` 过滤。
- 已实现 `GET /tokens/verify` 独立 API Key 鉴权证明：active、未过期、未删除、未撤销、额度未用尽的 Key 才能通过。
- 已实现 API Key 明文只在创建/重置响应中返回一次，数据库只保存 SHA-256 hash 和 `keyPreview`。
- 已实现令牌模型范围校验，用户只能选择自己分组真实可用模型；空范围表示继承分组可用模型。
- 已实现前端同源 `/api/tokens/*` 代理和 `/token` 页面，支持创建、复制一次性 Key、禁用、重置、删除、额度、过期时间和备注。
- 已创建 `docs/quality/t07-self-check.md`，记录类型检查、构建、Docker 重建、真实接口 QA、真实前端代理 QA、浏览器 UI QA、明文 Key 查库和自检数据清理。
- 已验证 T07 不实现完整 Relay；`/v1/models`、`/v1/chat/completions` 保持为 T08 范围。

T08 完成记录（2026-06-14）：

- 已新增 `RelayModule`、`RelayController`、`RelayService`，并接入 `AppModule`，实现 OpenAI 兼容 `GET /v1/models`、`POST /v1/chat/completions` 和 `/v1/*` 未支持接口统一 `501 not_implemented`。
- 已实现用户 API Key Bearer 鉴权、令牌额度/过期/禁用校验、用户分组与令牌模型权限校验，`/v1/models` 只返回当前 Key 真实可用模型。
- 已实现上游模型映射、上游 Key 解密转发、非流式 JSON 透传、流式 SSE chunk 透传、上游 5xx/连接错误/timeout/malformed JSON 的统一错误映射，并返回 `request_id` 与 `x-request-id`。
- 已修复侧车审查发现的问题：额度耗尽在 Relay 层返回 `402 insufficient_balance`，上游网络类异常不再退化成裸 `500`，Bearer scheme 大小写兼容，流式客户端断开时会取消上游读取。
- 已创建 `docs/quality/t08-self-check.md`，记录类型检查、构建、Docker 重建、真实 HTTP 上游 QA、错误码 QA、密钥隔离 QA、自检数据清理和剩余边界。
- 已验证 T08 不实现完整计费扣款；余额扣减、usage event、wallet transaction 和幂等扣费仍保持为 T09 范围。

T09 完成记录（2026-06-15）：

- 已新增 `usage_events`、`wallet_transactions`、`UsageEventStatus`、`WalletTransactionType`，并创建 Prisma migration `20260615103000_t09_billing_events`。
- 已新增 `BillingService`，将成功计费写入同一事务：`usage_event`、`wallet_transaction`、`wallets.balance_cents/total_spend_cents/version`、`api_tokens.used_cents` 同步更新。
- 已在 Relay 成功路径接入真实扣费：非流式成功响应按上游真实 `usage`、模型单价、模型倍率、用户分组倍率计算 `cost_cents`，并返回 `x-usage-event-id`。
- 已在失败路径接入不扣费记录：上游 4xx/5xx、连接失败、timeout、malformed response 记录 `FAILED` usage event，不生成钱包扣费流水。
- 已实现余额不足前置阻断：用户钱包余额不足时返回 `402 insufficient_balance`，不转发上游。
- 已实现流式 MVP 计费边界：流式成功但没有可计量 usage 时写入 `METERING_UNKNOWN` usage event，默认不扣费。
- 已验证真实接口 QA：余额不足不触达上游、成功扣费、上游 Key 隔离、上游 500 不扣费、malformed 不扣费、上游内部重试只扣一次、流式 `METERING_UNKNOWN` 不扣费、并发扣费不出现负余额。
- 已创建 `docs/quality/t09-self-check.md`，记录类型检查、构建、迁移、Docker 重建、真实 HTTP 上游 QA、并发扣费 QA、自检数据清理和剩余边界。

T10 完成记录（2026-06-15）：

- 已新增 `RechargeCodeStatus`、`recharge_codes` 数据表，并通过 Prisma migration `20260615120000_t10_recharge_codes` 关联 `wallet_transactions.recharge_code_id`。
- 已新增 `RechargeModule`，实现管理员 `/admin/recharge-codes` 生成、列表、禁用接口；生成时只返回一次明文兑换码，数据库只保存 `code_hash`。
- 已实现用户 `/recharge/redeem` 和 `/recharge/records`，核销成功会在同一事务内更新兑换码状态、增加钱包余额、写入 `RECHARGE` 钱包流水。
- 已新增前端 `/account/topup/recharge` 充值页、`/account/recharge` 兼容跳转、个人中心充值入口，以及管理后台兑换码生成/列表/禁用面板。
- 已修复 UUID 校验兼容性：后台、令牌、充值模块不再只允许 v1-v5 UUID，避免 Prisma 生成的新版本 UUID 被误拒。
- 已验证真实接口 QA：非管理员不能生成兑换码、管理员生成后数据库不保存明文、审计日志不泄露明文或 hash、用户核销增加余额、重复核销/禁用码/错误码不增加余额、并发同码只有一次成功、管理员禁用与用户核销并发不返回 500、充值记录来自真实 `wallet_transactions`。
- 已创建 `apps/api/scripts/t10-recharge-qa.ts` 和 `npm run qa:t10:recharge`，用于复跑 T10 真实 HTTP + 真实 Postgres 验收，并在结束后清理临时 QA 数据。
- 已创建 `docs/quality/t10-self-check.md`，记录类型检查、构建、迁移、Docker 重建、真实充值 QA、残留数据清理和剩余边界。

T11 完成记录（2026-06-15）：

- 已新增后端 `UsageLogsModule`，提供 `GET /usage/logs`，强制按当前登录用户 `userId` 查询 `usage_events`，并支持时间、模型、令牌、状态和条数筛选。
- 已实现日志响应白名单：返回 `request_id`、usage event、令牌展示名/预览、token 用量、消费金额、状态、错误码和关联钱包流水；不返回 `tokenHash`、上游密钥、`priceSnapshot`、`idempotencyKey` 或上游供应商内部字段。
- 已新增前端同源代理 `/api/usage/*` 和 `/log` 页面，展示筛选区、汇总指标、调用明细表、状态标签和当前结果 CSV 导出。
- 已把首页侧边栏“日志”入口接到 `/log`，用户可从控制台进入调用日志页。
- 已新增 `apps/api/scripts/t11-usage-logs-qa.ts` 和 `npm run qa:t11:usage-logs`，通过真实注册、真实令牌、真实模型/上游映射、真实 `/v1/chat/completions` 调用生成并验证日志，不手写假日志。
- 已验证真实链路 QA：成功扣费、失败调用、计量未知三类状态均写入真实 `usage_events`；成功扣费关联 `wallet_transactions`；按状态/令牌筛选有效；外部用户令牌 ID 不泄露数据；跨用户读取不可行；敏感字段未出现在日志响应。
- 已验证 Docker 重建、生产构建、页面 HTTP 200、未登录日志接口 401、安全审计 0 漏洞、T11 QA 数据清理为 0 残留。
- 已创建 `docs/quality/t11-self-check.md`，记录类型检查、构建、Docker 重建、真实日志 QA、敏感字段扫描、权限验证、残留数据清理和剩余边界。

## 12. 待你确认的一个关键决策

默认推荐使用“Next.js + NestJS + PostgreSQL + Redis + Docker Compose”。如果你想更快但性能弱一些，可以改成单体全栈；如果你想直接做高并发版本，可以把 Relay 从第一天就拆成独立服务。

## GSTACK REVIEW REPORT

审查日期：2026-06-14  
触发方式：`/plan-ceo-review`  
审查模式建议：`SELECTIVE_EXPANSION`，保持当前 MVP 范围，但在进入 T01/T02 前补齐中转站业务约束、Relay 契约、计费真相链和安全基线。  
执行限制：当前环境没有可用的 `AskUserQuestion` 精确工具，且工作区不是 Git 仓库；因此本次未执行完整 gstack 交互式决策流、未提交 commit、未生成 git 维度的审查仪表盘。已用等价只读审查和 5.3 Spark 侧车复核替代。

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | issues_open | mode: SELECTIVE_EXPANSION, 5 critical gaps |
| Codex Review | native sidecar | Independent 2nd opinion | 1 | advisory | sidecar agrees core gaps are business constraints, Relay contract, SLO, billing, security |
| Eng Review | `/plan-eng-review` | Architecture & tests required before build | 0 | missing | required before implementation |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | missing | UI scope exists, should run after architecture decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | useful after T01 scaffold exists |

**UNRESOLVED:** 3 decisions need your approval before implementation: whether to add a T00.5 preflight task, whether to keep `SELECTIVE_EXPANSION`, and whether Relay is one module inside backend for MVP or a separate service from day one.  
**VERDICT:** CEO review found open issues. Do not start T01 implementation until the preflight constraints below are either accepted into the task list or explicitly deferred. Eng review is still required.

### CEO Findings

1. **CRITICAL GAP - Business constraint is not first-class.**  
   The plan states the platform is a third-party nested relay, but it does not define first-month customer target, upstream cost basis, markup/margin rule, acceptable billing error, refund rule, or acceptable upstream outage behavior. If this stays vague, every later decision about pricing, limits, and logs becomes subjective.

2. **CRITICAL GAP - Relay contract is too thin.**  
   The plan lists `/v1/models`, `/v1/chat/completions`, and `/v1/responses`, but it does not define request/response compatibility, upstream error mapping, streaming interruption behavior, timeout budget, retry limits, fallback policy, idempotency key source, or what gets billed when partial output is returned.

3. **CRITICAL GAP - Database section names tables but not invariants.**  
   The core tables are named, including users, tokens, wallets, usage events, request logs, and upstream providers. Missing are field-level rules, unique constraints, indexes, row ownership, soft-delete policy, ledger immutability, transaction boundaries, and the exact relationship between `usage_events` and `wallet_transactions`.

4. **CRITICAL GAP - Observability is scheduled late.**  
   T20 covers trace/log/monitoring, but the product cannot safely test T08/T09 without trace IDs, request IDs, structured logs, and billing event correlation from the first Relay call. Observability should be part of the Relay and billing tasks, not only a late hardening task.

5. **WARNING - Deployment plan is cloud-ready but not failure-ready.**  
   The plan includes Docker Compose, HTTPS, backups, and rollback, but does not define migration rollback, old/new code compatibility, feature flags, kill switches, post-deploy smoke tests, or what happens if the upstream is down during deployment.

### Recommended Preflight Task

Add a new task before T01 or split T02 so implementation does not start on soft assumptions:

- [ ] **T00.5 (P1, human: ~1 day / CC: ~30-60 min)** - Freeze business and Relay constraints
  - Surfaced by: CEO Review - business constraint, Relay contract, billing truth chain.
  - Files: this plan, future PRD, future API contract document.
  - Deliverables: MVP business constraint sheet, Relay contract, billing/refund rules, SLO targets, security baseline.
  - Verify: an engineer can implement `/v1/chat/completions` billing without asking whether to bill partial failures, retries, upstream 429, upstream timeout, or stream disconnect.

### Implementation Approaches

**Approach A - Recommended: control-plane skeleton plus single-upstream Relay.**  
Build the full repo scaffold, but MVP Relay supports one configured upstream first. This keeps architecture honest while avoiding premature multi-provider complexity.

**Approach B - Billing-first core.**  
Build wallet, immutable ledger, usage event, and idempotency before the user-facing portal. This reduces billing risk but delays visible product progress.

**Approach C - Data-plane-first gateway.**  
Make Relay a separate service from day one. This gives cleaner future scale, but adds deployment and coordination overhead before the business model is proven.

Recommendation: choose Approach A for MVP, but pull billing invariants and trace IDs from Approach B into the first Relay task.

### Required Diagrams

System architecture:

```text
User / SDK
  -> Nginx/Caddy
  -> Relay API
       -> Auth + token policy
       -> Rate limit + balance check
       -> Upstream adapter
       -> Usage event writer
  -> Upstream relay

Control web
  -> Backend API
       -> Users / wallets / tokens / prices / admin
       -> PostgreSQL
       -> Redis
       -> Worker
```

Billing truth flow:

```text
request_id
  -> token auth
  -> preflight balance + policy
  -> upstream call
  -> normalized usage
  -> immutable usage_event
  -> wallet_transaction
  -> request_log
```

Failure flow:

```text
upstream timeout / 429 / 5xx / stream disconnect
  -> classify error
  -> retry only if policy allows
  -> write request_log
  -> bill only according to explicit rule
  -> return stable error code to user
```

### Error And Rescue Registry

| Codepath | Failure mode | Rescued | User sees | Required fix |
| --- | --- | --- | --- | --- |
| Relay auth | Missing/invalid token | yes | 401 with stable code | Define exact error schema |
| Relay routing | Unknown model | partial | 400 or mapped fallback | Define model mapping and fallback policy |
| Upstream call | Timeout | partial | 503 or retry result | Define timeout budget and retry count |
| Upstream call | 429 rate limit | partial | 429/503 with retry hint | Define upstream vs user rate-limit semantics |
| Streaming | Disconnect after partial output | no | currently undefined | Define partial billing and log state |
| Billing | Duplicate retry | partial | should be invisible | Enforce request/event uniqueness |
| Wallet | Concurrent calls overspend balance | no | possible negative balance | Define row lock or atomic debit |
| Logging | Secret accidentally logged | partial | invisible to user | Define redaction filter and tests |

### Failure Modes Registry

| Codepath | Failure mode | Rescued | Test | User sees | Logged |
| --- | --- | --- | --- | --- | --- |
| `/v1/chat/completions` | Upstream 500 | partial | missing | stable API error | required |
| `/v1/chat/completions` streaming | upstream closes stream | no | missing | undefined | required |
| wallet debit | two parallel requests spend same balance | no | missing | possible later balance dispute | required |
| token create | duplicate names or batch generation collision | partial | missing | form error | required |
| admin balance adjustment | wrong user selected | partial | missing | irreversible money error | required |
| export logs | large range export times out | no | missing | failed export | required |

### NOT In Scope Unless Approved

- Multi-upstream intelligent routing in MVP. It is valuable, but a single upstream proves the business path faster.
- Full payment integration in MVP. Card/code recharge is enough until ledger correctness is proven.
- All notification channels on day one. Email and Webhook are enough until the notification event model is stable.
- Full Midjourney feature parity. Keep async task tables generic until upstream image capability is confirmed.

### What Already Exists

- The plan file exists and covers pages, modules, tables, risks, deployment, and task flow.
- There is no existing codebase, README, git history, TODO list, or architecture document in this workspace.
- Target site observations exist only as prior Chrome session findings, not as reusable fixtures or screenshots in the repo.

### Dream State Delta

Current plan gets to a functional clone of the visible account portal. The 12-month ideal is a trusted API monetization platform where users understand cost before they call, operators can trace every dispute to one request ID, and upstream instability does not become silent money loss. The gap is not UI surface area; the gap is financial correctness, upstream failure governance, and operational trust.

### Implementation Tasks From This Review

- [ ] **R1 (P1, human: ~1 day / CC: ~30-60 min)** - Planning - Add MVP business constraint sheet
  - Surfaced by: CEO Finding 1.
  - Files: this plan or a new PRD document.
  - Verify: target users, margin model, refund rules, outage rules, and out-of-scope items are explicit.

- [ ] **R2 (P1, human: ~1 day / CC: ~30-60 min)** - Relay - Write the API compatibility contract
  - Surfaced by: CEO Finding 2.
  - Files: future API contract document.
  - Verify: streaming, timeout, retry, partial output, and upstream error mapping all have expected behavior.

- [ ] **R3 (P1, human: ~1 day / CC: ~45 min)** - Database - Expand table list into schema invariants
  - Surfaced by: CEO Finding 3.
  - Files: future schema document or Prisma schema.
  - Verify: unique constraints, indexes, ownership, transaction boundaries, and ledger immutability are defined.

- [ ] **R4 (P1, human: ~4h / CC: ~20 min)** - Observability - Move trace and billing correlation into Relay MVP
  - Surfaced by: CEO Finding 4.
  - Files: this plan, future backend tasks.
  - Verify: every Relay request has `request_id`, trace ID, usage event ID, and log correlation from first implementation.

- [ ] **R5 (P2, human: ~4h / CC: ~20 min)** - Deployment - Add rollback and smoke-test checklist
  - Surfaced by: CEO Finding 5.
  - Files: future deployment document.
  - Verify: post-deploy checks, migration rollback, upstream-down behavior, and kill switches are defined.

### Review Readiness Dashboard

```text
+====================================================================+
|                    REVIEW READINESS DASHBOARD                       |
+====================================================================+
| Review          | Runs | Last Run            | Status      | Required |
|-----------------|------|---------------------|-------------|----------|
| Eng Review      |  0   | -                   | MISSING     | YES      |
| CEO Review      |  1   | 2026-06-14          | ISSUES_OPEN | no       |
| Design Review   |  0   | -                   | MISSING     | no       |
| Adversarial     |  1   | 2026-06-14          | ADVISORY    | no       |
| Outside Voice   |  1   | 2026-06-14          | ADVISORY    | no       |
+--------------------------------------------------------------------+
| VERDICT: NOT CLEARED - CEO gaps open and eng review required.       |
+====================================================================+
```
