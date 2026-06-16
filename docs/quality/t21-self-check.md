# T21 自检报告 - 云服务器部署

日期：2026-06-16
任务：T21 云服务器部署
状态：部署资产和本地验证完成；真实云服务器部署未执行，原因是当前没有服务器 SSH、域名 DNS、生产 `.env` 和真实 smoke 账号。不得把本地验证冒充为生产上线通过。

## 交付物

| 项目 | 文件 | 状态 |
| --- | --- | --- |
| 生产 Compose | `compose.prod.yml` | 完成 |
| HTTPS 反代配置 | `ops/caddy/Caddyfile` | 完成 |
| PostgreSQL 备份脚本 | `ops/backup/postgres-backup.sh` | 完成 |
| 生产预检脚本 | `ops/deploy/preflight.mjs`、`package.json` | 完成 |
| 回滚脚本 | `ops/deploy/rollback.sh` | 完成，默认先备份 |
| 部署后 smoke test | `ops/smoke/t21-deploy-smoke.mjs` | 完成 |
| 生产变量模板 | `.env.example` | 完成，不含真实密钥 |
| 部署手册 | `docs/deployment/cloud-server-deployment.md` | 完成 |
| README 入口 | `README.md` | 完成 |

## 核心行为

| 场景 | 结果 |
| --- | --- |
| 生产编排 | PostgreSQL、Redis、API、Web、Caddy 均设置 `restart: unless-stopped` |
| 公网暴露 | 生产 Compose 只暴露 Caddy 的 80/443，不暴露 PostgreSQL/Redis |
| 迁移 | API 容器启动前执行 `npm --prefix apps/api run db:migrate` |
| HTTPS | Caddy 根据 `CADDY_WEB_DOMAIN`、`CADDY_API_DOMAIN` 和 `ACME_EMAIL` 自动申请证书 |
| 备份 | `ops/backup/postgres-backup.sh` 生成 custom dump 和 sha256 |
| 预检 | `ops/deploy/preflight.mjs` 检查 `.env`、占位值、密钥长度、Compose URL、HTTPS 域名、DNS、80/443、Git/Docker/Compose 和生产 Compose 展开 |
| 回滚 | `ops/deploy/rollback.sh <git-ref>` 默认先备份，再切换 ref、重建 API/Web、启动并可选 smoke |
| Smoke test | 真实 HTTP 检查 `/health`、Web 首页、`/service-status`；登录、令牌、模型、chat、充值、通知缺少真实配置时显示 `skip` |
| 防伪造 | `SMOKE_STRICT=true` 时任何 `skip` 或 `fail` 都返回失败，不能用未配置项冒充生产通过 |

## 验证记录

| 检查 | 结果 |
| --- | --- |
| `docker compose -p nested-api-relay --env-file .env.example -f compose.prod.yml config` | 通过 |
| `node --check ops/smoke/t21-deploy-smoke.mjs` | 通过 |
| `node --check ops/deploy/preflight.mjs` | 通过 |
| `node ops/deploy/preflight.mjs --env-file .env.example --skip-dns --skip-ports --json` | 按预期失败，拒绝占位值、短密码和非生产 Cookie |
| 临时生产形态 `.env` 跳过 DNS/端口后的 preflight | 通过，随后已删除临时文件，不提交测试凭据 |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| Docker 本地镜像重建 | 通过；BuildKit 在中文路径触发 gRPC header 错误，使用 `DOCKER_BUILDKIT=0` 后成功 |
| 本地容器重启 | 通过，API/Web 用当前代码重建并启动 |
| `npm --prefix apps/api exec -- prisma migrate status`，显式 `DATABASE_URL` | 通过，13 个 migrations，schema up to date |
| `SMOKE_API_URL=http://127.0.0.1:3001 SMOKE_WEB_URL=http://127.0.0.1:3000 npm run smoke:t21:deploy` | 通过基础项；登录、令牌、模型、chat、充值、通知因缺少真实凭据/配置为 `skip` |
| `npm run qa:t17:service-status`，显式数据库和 Redis 环境变量 | 通过，真实 Postgres/Redis/HTTP 探针，清理后 0 残留 |
| `npm run qa:t20:observability`，显式数据库和 Redis 环境变量 | 通过，真实 Relay HTTP、真实临时上游、真实 Postgres trace，清理后 0 残留 |
| `git diff --check` | 通过，仅有 Windows 行尾提示 |
| `bash -n ops/*.sh` | 未覆盖；本机只有 Windows/WSL bash stub，`/bin/bash` 缺失，且未安装 Git Bash |

## 真实 Smoke 摘要

```json
{
  "ok": true,
  "strict": false,
  "results": [
    { "name": "api_health", "status": "pass" },
    { "name": "web_home", "status": "pass" },
    { "name": "service_status", "status": "pass" },
    { "name": "login", "status": "skip" },
    { "name": "token_create", "status": "skip" },
    { "name": "v1_models", "status": "skip" },
    { "name": "usage_trace", "status": "skip" },
    { "name": "v1_chat_completions", "status": "skip" },
    { "name": "recharge_redeem", "status": "skip" },
    { "name": "notification_test_webhook", "status": "skip" }
  ]
}
```

`skip` 不是通过项。生产环境必须提供真实用户、真实模型、真实上游、真实余额、真实充值码和真实通知渠道后，用 `SMOKE_STRICT=true` 复测。

## Review + QA 结论

- Pre-landing review：重点检查生产密钥不入库、不入文档、不入 Git；PostgreSQL/Redis 不暴露公网；回滚先备份；smoke test 不接受假数据；生产失败项必须显示失败或未配置。
- QA：本轮部署验证使用当前代码重建的真实容器、真实 HTTP 端口、真实 Postgres/Redis、真实服务状态和真实 Relay trace；没有用静态假数据冒充接口可用。
- 修复记录：T20 回归第一次失败是因为本机旧 API 容器未包含 trace 路由；已用当前代码重建并重启 API/Web，复测 T20 通过。
- 预检增量：新增 production preflight 后，`.env.example` 会被明确拒绝，避免直接拿模板上线；脚本不打印真实密钥值。
- Worker workshare：T21 前置 `gpt-5.3-codex-spark` 侧车尝试失败，错误为 `wss://chatgpt.com/backend-api/codex/responses` 连接被拒绝/stream disconnected；后续预检增量再次尝试侧车也因同一 websocket/API 连接问题失败；Codex 本地完成部署资产、验证、审查和文档更新。

## CEO + CTO 审查

- 用户价值：现在有一套可复制到云服务器执行的生产部署路径，包含 HTTPS、迁移、备份、回滚和部署后检查。
- 商业风险：没有真实云服务器就不能确认域名解析、证书签发、云防火墙、生产 `.env`、对象存储备份和重启后的公网访问。
- 技术判断：T21 的代码仓库侧资产已达成；生产上线验收必须等真实服务器信息后完成，不能在任务表里伪造“生产环境可访问”。
- 兼容性：T17 服务状态和 T20 可观测性回归均通过，说明部署资产没有破坏现有业务链路。

## 受阻或未覆盖

- 未执行真实云服务器 SSH 部署。
- 未验证真实 DNS A 记录、Caddy ACME 证书签发和公网 HTTPS。
- 未执行生产服务器重启后的公网恢复验证。
- 未配置真实上游、真实余额、真实充值码和真实通知渠道，因此 strict smoke 尚不能作为上线通过项。
- 未完成本机 shell 语法器检查；脚本逻辑已通过人工审查和部署文档约束，生产执行前建议在 Linux 服务器上运行 `sh -n ops/backup/postgres-backup.sh ops/deploy/rollback.sh`。
