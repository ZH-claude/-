# 账户中心功能对齐自检报告

日期：2026-06-16
范围：`/account/profile` 账户中心功能和真实数据链路对齐参考站。

## 交付内容

| 项目 | 结果 |
| --- | --- |
| 前端账户中心 | 新增顶部导航、左侧账户菜单、身份卡、余额/消费/调用/邀请指标、推广、用户信息、可用模型、模型配置、账户选项 |
| 后端用户资料 | `/auth/me` 返回真实钱包、调用次数、活跃令牌数、邀请统计、返利收益、可用模型、上次登录 IP |
| 时区保存 | 新增 `/auth/timezone`，写入 `users.timezone` 并记录安全审计 |
| 邀请返利 | 新增 `referral_rewards` 表和迁移，账户中心收益来自真实数据库聚合 |
| 邀请链接闭环 | `/register?inviteCode=...` 会在注册页自动带入邀请码，避免复制链接后仍需手填 |
| QA 脚本 | 新增 `npm run qa:profile-alignment`，使用真实 API + 真实 Postgres，不写死假数据 |

## 验证证据

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `npm --prefix apps/api run db:migrate` | 通过，已应用 `20260616070000_profile_referral_rewards` |
| `npm run qa:profile-alignment` | 通过，验证真实用户、真实分组、真实模型、真实令牌、真实用量、真实返利、真实时区保存 |
| QA 临时数据清理 | 通过，`users/groups/sessions/wallets/api_tokens/usage_events/referral_rewards/security_audit_logs/model_prices/model_group_accesses/upstream_providers/upstream_models` 均为 0 残留 |
| 浏览器端到端 | 通过，Chrome/Playwright 注册用户并进入 `/account/profile`，页面展示真实钱包、返利、模型和时区数据 |
| 敏感字段检查 | 通过，资料响应未包含 `passwordHash`、`tokenHash`、`encryptedApiKey`、上游 key、上游内部模型映射或价格快照 |

## 未通过或未覆盖

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| Docker 本地重建 | 未完成 | BuildKit 在当前中文路径环境触发 gRPC header 错误；关闭 BuildKit 后，`npm ci` 下载 `uid` 包遇到 registry `ECONNRESET`。本次改动已用本地真实服务完成验证，但 Docker 镜像重建需网络稳定后复测。 |
| 真实云服务器 | 未覆盖 | 没有服务器 SSH、域名 DNS、生产 `.env` 和公网 smoke 账号，不能把本地通过冒充生产上线通过。 |

## CEO + CTO 结论

- 用户价值：账户中心不再是简化卡片页，已经覆盖参考站账户页的核心业务信息和操作入口。
- 数据真实性：余额、消费、调用次数、邀请用户、返利收益、可用模型和时区均来自真实后端/数据库链路，不使用静态假数据。
- 技术风险：当前仍是 MVP 对齐，不等于完整商用版；商用前还需要继续做生产部署、严格 smoke、压测、安全基线和运维监控。
- Worker workshare：已尝试 `gpt-5.3-codex-spark` 侧车，命令超时退出，未产生可用交付；本次实现、集成和验证由 Codex 本地完成。
