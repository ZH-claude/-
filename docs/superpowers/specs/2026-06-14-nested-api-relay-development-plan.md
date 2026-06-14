# 中转站套娃 API 平台开发文档

创建日期：2026-06-14  
目标：建设一个可部署到云服务器的前后端完整 API 中转站。你的平台作为第三方中转层，用户请求先进入你的系统，再由你的系统转发到另一个上游中转站。  
当前状态：T01 项目骨架已完成。工作区此前为空且不是 Git 仓库。  
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
| `api_tokens` | 用户 API Key 元数据、额度、过期、状态、备注 |
| `api_token_policies` | 单令牌模型限制、IP 白名单、限流器、首次激活策略 |
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
| [ ] | T07 | API 令牌管理 | 创建、复制、禁用、删除、额度、过期时间、备注 | 创建令牌后可用于 API 鉴权 |
| [ ] | T08 | Relay MVP | `/v1/models`、`/v1/chat/completions`、流式透传 | 用户用自己的 Key 调用成功返回上游结果 |
| [ ] | T09 | 计费事件与余额扣减 | usage_events、wallet_transactions、幂等扣费 | 成功调用扣费，失败调用不误扣，重试不重复扣 |
| [ ] | T10 | 余额充值与兑换码 | 兑换码生成、核销、充值记录 | 用户可核销卡密并增加余额 |
| [ ] | T11 | 调用日志页面 | 日志筛选、实时指标、导出 | 用户可按时间、令牌、模型查询消费 |
| [ ] | T12 | 费用说明页面 | 模型价格表、倍率说明、搜索、复制模型 | 用户能理解并复制可用模型列表 |
| [ ] | T13 | 分组状态页面 | 成功率统计、状态筛选、刷新 | 分组和模型状态可展示真实统计或暂无数据 |
| [ ] | T14 | 通知设置 | 邮件、Webhook、余额阈值、测试通知 | 余额低于阈值时能触发通知 |
| [ ] | T15 | 首页公告与文档入口 | 公告列表、更新日志、使用建议 | 管理员发布后用户首页可见 |
| [ ] | T16 | 异步任务与绘图日志 | async_tasks、任务查询页 | 若上游支持异步任务，能查询进度和结果 |
| [ ] | T17 | 服务状态页 | Uptime Kuma 配置或内置探针 | 用户可看到平台和上游状态 |
| [ ] | T18 | 风控与限流 | 用户/令牌/IP/模型限流、IP 白名单、首次激活策略、异常熔断 | 超限请求被拒绝且不影响其他用户 |
| [ ] | T19 | 安全加固 | Key 脱敏、审计日志、越权测试 | 日志无明文 Key，越权测试通过 |
| [ ] | T20 | 可观测性 | 结构化日志、trace_id、监控面板、告警 | 单次请求可追踪到上游和计费事件 |
| [ ] | T21 | 云服务器部署 | HTTPS、域名、备份、回滚文档 | 生产环境可访问，重启后服务自动恢复 |
| [ ] | T22 | 上线前验收 | 压测、安全检查、账单核对、运维手册 | 完成上线检查表并修复阻塞项 |

## 11. 下一次对话建议任务

建议下一次从 T07 开始：API 令牌管理。

T01 的边界：

- 只做项目结构，不做业务功能。
- 创建前端、后端、数据库、Redis、Docker Compose。
- 确认本地开发命令和云服务器部署雏形。
- 完成后把 T01 打勾。

T01 完成指标：

- `docker compose up` 能启动 PostgreSQL、Redis、后端、前端。
- 前端显示一个后台壳页面。
- 后端提供 `/health`。
- README 写明启动方式。

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
