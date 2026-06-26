# T23 上线前验收最小任务计划

## 目标

T23 的目标不是继续堆页面功能，而是在正式商用前把“能不能开放给客户”拆成可验证的检查项。每一项都必须基于真实接口、真实数据库、真实登录、真实余额、真实上游或明确标注为阻塞；不能用空数据、样例数据或假上游冒充通过。

当前最新业务口径：获客优化不再作为本阶段验收项，也不再作为发布门禁。用户端语言体验、公告翻译、模型与公开内容本地化仍保留为产品体验能力。

## 总体验收标准

- 用户端和商家端使用同一套 Web、同一个登录入口，按账号身份分流。
- 普通用户不能访问商家端页面和后台能力。
- 商家端配置的上游、模型、价格、充值码、公告、审计和日志都来自真实数据库。
- 客户 API Key 调用链路能追踪到请求日志、用量事件、钱包流水和上游结果。
- 缺少真实配置时必须显示未配置、跳过或阻塞；不得显示为通过。
- T21 真实部署完成前，不允许把系统标记为生产发布完成。
- 每轮完成后必须做 review 和 QA，并清理临时测试数据与无必要构建产物。

## 真实数据规则

| 项目 | 上线前规则 |
| --- | --- |
| 用户账号 | 使用真实注册或登录，不直接伪造会话 |
| 商家账号 | 使用真实后台角色，不伪造 `MERCHANT` 角色 |
| 上游 Key | 只通过商家端或生产环境变量配置，加密保存，不写入文档和仓库 |
| 模型 | 来自真实模型配置和上游映射，不写死可售模型 |
| 余额 | 来自真实钱包和流水，不在前端写死余额 |
| 计费 | 成功调用必须有真实用量事件和钱包流水 |
| 日志 | 请求编号必须能查到真实请求日志和关联链路 |
| 测试数据 | 临时数据必须带前缀，并在检查结束后清理为 0 |

## M01 上线前验收基线与阻塞清单

状态：已完成。

范围：

- 建立 T23 验收计划。
- 明确哪些项目当前可真实检查，哪些必须等待真实服务器或真实上游。
- 记录双端兼容、数据库一致性、功能接口预留和禁止假数据的验收标准。

验收指标：

- 文档明确 T21 真实部署未完成，不能冒充生产发布。
- 文档明确当前 MVP 是单平台老板模式；多商家独立上游 Key 属于商用升级。
- 本地真实检查至少覆盖构建、双端角色隔离、请求追踪或部署 smoke。
- 所有跳过项必须说明缺少什么真实条件。

完成记录：

- 已拆出 T23 M01-M07。
- 已新增 `docs/quality/t23-m01-prelaunch-baseline-self-check.md` 记录真实检查、阻塞项和 review 结论。
- 已确认当前没有服务器 SSH、正式域名 DNS、生产 `.env` 和真实 strict smoke 账号，因此本轮不标记 T21 完成。

## M02 生产 strict smoke 准备

状态：准备项已完成；真实执行仍受 T21 外部条件阻塞。

范围：

- 准备真实生产账号、真实模型、真实上游、真实余额、真实充值码和真实通知渠道。
- 在真实云服务器上执行 strict smoke。

验收指标：

- `SMOKE_STRICT=true` 时无 `skip`、无 `fail`。
- `/health`、Web 首页、服务状态、登录、令牌、模型、真实 chat、trace、充值和通知全部通过。
- 失败时保留请求编号和服务日志，不能直接重试掩盖问题。

完成记录：

- 已新增 `npm run qa:t23:production-strict-smoke-readiness`，并纳入 `npm run qa:release-gate` 的硬门槛。
- QA 强制 `ops/smoke/t21-deploy-smoke.mjs` 保留 `SMOKE_STRICT=true` 规则：任一核心检查出现 `skip` 或 `fail` 时，strict smoke 必须失败。
- 已在 `docs/deployment/cloud-server-deployment.md` 明确完整 strict smoke 输入：`SMOKE_API_URL`、`SMOKE_WEB_URL`、`SMOKE_USERNAME`、`SMOKE_PASSWORD`、`SMOKE_MODEL`、`SMOKE_RUN_CHAT`、`SMOKE_API_KEY`、`SMOKE_RECHARGE_CODE`、`SMOKE_TEST_NOTIFICATION` 和 `SMOKE_STRICT=true`。
- 已新增 `docs/quality/t23-m02-production-strict-smoke-readiness-self-check.md` 作为生产 strict smoke 准备自检记录。
- 真实执行仍需要云服务器、正式域名、HTTPS、生产 `.env`、真实上游 Key、真实 smoke 账号、真实余额、真实充值码和真实通知渠道。

## M03 账单与余额核对

状态：本地真实核对和硬门禁入口已完成；生产环境核对仍受 T21 外部条件阻塞。production verification is still blocked.

范围：

- 用真实客户账号发起一次可计费请求。
- 核对余额扣减、用量事件、钱包流水、请求日志和 trace。

验收指标：

- 成功调用后余额减少金额和用量事件一致。
- 请求日志能追踪到同一个请求编号。
- 上游失败、超时或 malformed 响应不误扣费。
- 临时数据清理后残留为 0。

完成记录：

- 已将 `npm run qa:t23:billing-reconciliation` 纳入 `npm run qa:release-gate`，成为 M03 账单闭环硬门槛。
- 已将 `npm run qa:t23:route-metering`、`npm run qa:t25:stream-billing-guard`、`npm run qa:t26:payment-orders` 和 `npm run qa:t27:model-experience` 纳入 `npm run qa:release-gate`，作为账单闭环的底层证据脚本。
- 对应自检记录：`docs/quality/t23-m03-billing-reconciliation-self-check.md`。
- 脚本使用真实 API、真实 Postgres、真实登录、真实钱包、临时 HTTP 上游和真实 `/v1/chat/completions` 调用。
- 成功调用必须产生 `BILLABLE` usage event、`DEBIT` 钱包流水、成功 request log，并且余额扣减与用量成本一致。
- 上游失败必须产生可追踪的失败 request log 和 `FAILED` usage event，但 `costCents=0`、无 wallet transaction、余额不变化。

## M04 压测与限流基线

状态：本地压测与限流基线已完成；生产环境压测仍受 T21 外部条件阻塞。

范围：

- 对登录、模型列表、Relay 请求和日志查询做上线前压力检查。
- 验证用户、令牌、IP 和模型限流仍生效。

验收指标：

- 超限请求被拒绝，不影响其他用户。
- 压测不产生负余额或重复扣费。
- 请求日志和安全审计不泄漏密钥。

完成记录：

- 已将 `npm run qa:t32:enterprise-performance` 纳入 `npm run qa:release-gate` 的硬门槛。
- 本地 QA 使用真实 Postgres、真实 API/Web 服务和 1000 个临时用户。
- 已覆盖商家数据面板、并发 dashboard、并发 `/auth/me`、并发 `/v1/models`、并发 `/usage/logs` 和 requestId trace 检索。
- 测试数据清理后，相关 users、sessions、wallets、apiTokens、usageEvents、requestLogs、walletTransactions、rechargeCodes、upstreamProviders、upstreamModels、modelPrices、modelGroupAccesses 残留必须为 0。

## M05 安全与权限复核

状态：本地真实复核已完成；生产环境密钥与服务器复核仍受 T21 外部条件阻塞。

范围：

- 复核普通用户、商家账号、未登录状态的权限边界。
- 扫描明文密码、明文 API Key、连接串和危险日志。

验收指标：

- 普通用户无法访问任一商家端页面或后台能力。
- 商家端响应不返回 password hash、token hash、上游 Key、充值码 hash 或连接串。
- 仓库不包含 `.env`、真实密钥或真实上游 Key。

完成记录：

- 已将 `npm run qa:t23:security-permissions` 纳入 `npm run qa:release-gate`。
- QA 使用真实 API、真实 Postgres、真实注册登录会话、真实 ADMIN 角色提升和普通用户账号。
- 脚本覆盖关键商家端 GET/POST 接口的 401/403/200 权限矩阵。
- 响应会递归扫描敏感字段和值，发现泄漏即失败。

## M06 运维演练

状态：本地 dry-run 门槛已完成；真实恢复演练仍受 T21 外部条件阻塞。

范围：

- 在真实或等价环境演练备份、恢复、重启恢复和回滚。

验收指标：

- 备份可生成并校验。
- 重启后 API、Web、数据库、Redis、反代自动恢复。
- 回滚前强制备份，回滚后 smoke 通过。

完成记录：

- 已新增 `npm run qa:t23:ops-rehearsal`，并纳入 `npm run qa:release-gate` 的硬门槛。
- dry-run QA 不执行生产回滚或真实恢复，只验证运维脚本的安全不变量。
- `ops/smoke/t21-deploy-smoke.mjs` 的 strict 模式必须在任一核心 smoke 被 skip 时失败。
- `compose.prod.yml` 必须保留生产服务、restart policy、healthcheck、Postgres/Caddy 持久卷和 API 健康依赖约束。
- 已新增 `docs/quality/t23-m06-ops-rehearsal-self-check.md` 作为本地运维演练自检记录。

## M07 上线决策报告

状态：本地决策报告已完成；生产发布仍受 T21 外部条件阻塞。

范围：

- 汇总 M02-M06 的真实证据。
- 给出继续内测、延期或开放客户的决策建议。

验收指标：

- 所有 P0/P1 阻塞项关闭或明确延期。
- 仍未接入的真实上游、支付、通知、监控不得写成已完成。
- 报告能让非技术负责人判断是否可以开放给客户。

完成记录：

- 已新增 `docs/quality/t23-m07-launch-decision-report.md`，结论为“暂缓生产上线；可继续受控内测”。
- 已新增 `npm run qa:t23:launch-decision`，并纳入 `npm run qa:release-gate` 的硬门槛。
- QA 强制报告列出 M02-M06 的真实证据状态、P0/P1 外部阻塞项，以及真实上游、真实支付、真实通知、外部监控和真实恢复演练未完成边界。
- QA 会拒绝把当前状态表述成已经可对外开放或已经完成生产发布。

## M08 最终全栈验证入口

状态：本地最终全栈 readiness 入口已完成；生产最终全栈验证仍受 T21 外部条件阻塞。production verification is still blocked.

范围：

- 将最终全栈验证从口头要求固化成 `npm run qa:t23:final-fullstack-readiness`。
- 确认完整 `npm run qa:release-gate` 仍要求 release-gate manifest、浏览器截图证据、语言、公告、账单、安全、运维、性能、VibeCoding 和手机号找回等本地全栈门禁。
- 确认 `docs/quality/production-strict-smoke-evidence-template.json` 在没有真实生产证据前保持 blocked 状态。

验收指标：

- `final_fullstack_readiness_requires_release_gate_manifest_and_browser_evidence` 必须通过。
- `final_fullstack_readiness_requires_structured_strict_smoke_evidence_template` 必须通过。
- `final_fullstack_readiness_blocks_production_completion_without_real_evidence` 必须通过。
- 本地 release gate 可以作为受控内测交付门槛，但不能写成生产最终全栈验证已完成。

完成记录：

- 已新增 `npm run qa:t23:final-fullstack-readiness`，并纳入 `npm run qa:release-gate` 的硬门槛。
- QA 会拒绝缺少 release-gate manifest、浏览器截图证据、生产阻塞边界或 strict-smoke blocked 证据模板的交付状态。
- 真实生产最终全栈验证仍需要服务器、DNS、HTTPS、生产 `.env`、真实上游 Key、真实支付、真实通知、外部监控和真实恢复演练。

## 功能接口预留边界

当前 MVP 已支持单平台老板模式：你在商家端录入上游中转站地址和上游 API Key，客户使用本平台发放的 Key 调用。以下能力只做计划预留，不在 T23 中伪造成已完成：

| 能力 | 当前状态 | 上线前要求 |
| --- | --- | --- |
| 多商家独立上游 Key | 未实现 | 后续新增商家归属、客户归属和商家独立上游配置 |
| 客户按商家归属转发 | 未实现 | 必须用两个商家、两个客户、两把上游 Key 做真实验收 |
| 商家独立账单 | 未实现 | 必须新增商家维度账单和对账规则 |
| 商家独立风控 | 未实现 | 必须按商家隔离限流、封禁和告警 |

## 当前阻塞清单

| 阻塞项 | 影响 | 解除条件 |
| --- | --- | --- |
| 无真实云服务器 SSH | 不能执行真实部署 | 提供服务器和可用 SSH |
| 无正式域名 DNS | 不能签发 HTTPS 证书 | 配好 `app` 和 `api` 域名 A 记录 |
| 无生产 `.env` | 不能启动生产环境 | 在服务器生成真实密钥和连接配置 |
| 无真实上游 Key | 不能完成真实 chat strict smoke | 在商家端或生产环境配置真实上游 |
| 无真实 smoke 账号 | 不能完成登录、令牌、trace 和充值 strict smoke | 准备带余额的真实测试账号 |
| 无真实通知渠道 | 不能完成通知 strict smoke | 配置真实 Webhook 或邮件渠道 |
| 无支付商户实参 | 不能验证真实充值回调 | 提供支付商户、签名密钥和回调地址 |
| 无外部监控渠道 | 不能验证生产告警闭环 | 配置真实监控和告警接收人 |

## 推荐下一步

如果能提供服务器、域名和生产配置，下一步回到 T21 做真实部署和 strict smoke。若暂时没有这些条件，继续推进本地可验证的语言体验、公告翻译、套餐、风控和 UI 改造，但所有外部条件继续保留为阻塞，不能写成已完成。
