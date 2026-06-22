# T21 云服务器部署手册

更新日期：2026-06-16
适用范围：单台 Linux 云服务器上的 MVP 商用前部署。默认使用 Docker Compose、PostgreSQL、Redis、API、Web 和 Caddy 自动 HTTPS。

## 1. 部署前提

| 项目 | 要求 |
| --- | --- |
| 服务器 | Ubuntu 22.04/24.04 LTS 或等效 Linux，建议 4C8G 起步 |
| 域名 | 至少两个 A 记录：`app.example.com` 指向 Web，`api.example.com` 指向 API |
| 端口 | 云防火墙开放 80、443；SSH 仅开放给管理员 IP |
| 软件 | Docker Engine、Docker Compose plugin、Git |
| 密钥 | 真实 `.env` 只放在服务器，不提交 GitHub，不截图，不粘贴到文档 |
| 上游 | 真实上游 Base URL/API Key 必须由管理员在后台配置；未配置时不能伪造可用状态 |

## 2. 文件清单

| 文件 | 用途 |
| --- | --- |
| `compose.prod.yml` | 生产 Compose 编排，不暴露 PostgreSQL/Redis 公网端口 |
| `ops/caddy/Caddyfile` | Caddy HTTPS 和反向代理配置 |
| `ops/backup/postgres-backup.sh` | PostgreSQL 逻辑备份脚本 |
| `ops/deploy/deploy.sh` | Linux 服务器部署入口 |
| `ops/deploy/preflight.mjs` | 上线前服务器和 `.env` 预检 |
| `ops/deploy/restart-verify.sh` | 重启恢复验证 |
| `ops/deploy/rollback.sh` | 指定 Git ref 的回滚脚本 |
| `ops/smoke/t21-deploy-smoke.mjs` | 部署后真实 HTTP smoke test |
| `apps/api/scripts/seed-merchant-test-accounts.ts` | 本地/测试环境商家端测试账号创建脚本，密码必须通过环境变量传入 |
| `.env.example` | 生产环境变量模板，不含真实密钥 |

## 3. 服务器初始化

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker
docker version
docker compose version
```

拉取代码：

```bash
git clone https://github.com/ZH-claude/-.git nested-api-relay
cd nested-api-relay
```

## 4. 配置 `.env`

```bash
cp .env.example .env
chmod 600 .env
```

生产必须改掉这些值：

| 变量 | 生产要求 |
| --- | --- |
| `POSTGRES_USER` | 独立数据库用户，不用默认占位 |
| `POSTGRES_PASSWORD` | 32 字符以上随机值 |
| `POSTGRES_DB` | 生产库名 |
| `DATABASE_URL` | `postgresql://用户:密码@postgres:5432/库名?schema=public` |
| `REDIS_PASSWORD` | 建议生产启用；启用后 `REDIS_URL=redis://:密码@redis:6379` |
| `UPSTREAM_KEY_ENCRYPTION_SECRET` | 32 字符以上随机值，后续不可随意更换 |
| `NOTIFICATION_SECRET_ENCRYPTION_SECRET` | 32 字符以上随机值，后续不可随意更换 |
| `JWT_SECRET` | 32 字符以上随机值 |
| `SESSION_COOKIE_SECURE` | 生产必须为 `true` |
| `PUBLIC_WEB_URL` | 例如 `https://app.example.com` |
| `PUBLIC_API_URL` | 例如 `https://api.example.com` |
| `CADDY_WEB_DOMAIN` | 例如 `app.example.com` |
| `CADDY_API_DOMAIN` | 例如 `api.example.com` |
| `ACME_EMAIL` | 证书通知邮箱 |
| `ADMIN_BOOTSTRAP_USERNAME` | 首次部署可临时设置管理员账号 |
| `ADMIN_BOOTSTRAP_PASSWORD` | 首次部署可临时设置强密码；创建后应清空并重启 |

生成随机密钥示例：

```bash
openssl rand -hex 32
```

不要把真实 `.env` 提交、发给 AI、写进 issue、写进 README 或保存到截图。

### 4.1 商家端部署边界

当前 MVP 是同一套 Web 按账号身份分流，不需要额外部署第二个商家端前端：

| 账号类型 | 登录后入口 | 说明 |
| --- | --- | --- |
| 普通用户 | `/account/profile` | 账户、余额、令牌、日志、价格、通知和服务状态 |
| 商家/后台账号 | `/merchant` | 用户、充值码、上游/模型、公告、审计、服务状态、请求日志 |

生产环境首次管理员账号使用 `ADMIN_BOOTSTRAP_USERNAME` 和 `ADMIN_BOOTSTRAP_PASSWORD` 创建，创建成功后应清空并重启，避免每次启动都携带引导密码。

本地或测试环境如需 3 个商家测试账号，只能手动设置 `MERCHANT_TEST_PASSWORD` 后运行：

```bash
MERCHANT_TEST_PASSWORD='<local-test-password>' npm run seed:merchant-test-accounts
```

脚本会创建或更新 `merchant_test_1`、`merchant_test_2`、`merchant_test_3`。不要在生产脚本、生产 `.env`、部署文档或仓库中写死测试密码；生产环境不建议保留这些测试账号。

当前商家端是单平台老板模式：管理员在商家端录入上游中转站地址和上游 API Key，客户使用本平台发放的 Key 调用。多商家各自配置独立上游 Key、客户按商家归属转发，属于后续商用升级，不在当前 MVP 中伪造成已完成。

上线前先跑预检：

```bash
npm run preflight:t21:prod
```

预检会检查 `.env` 是否存在、Linux 权限是否安全、密钥是否仍是占位值、`DATABASE_URL`/`REDIS_URL` 是否匹配 Compose 服务名、生产 URL 是否是 HTTPS、Caddy 域名是否和公网 URL 一致、DNS 是否可解析、80/443 是否可供 Caddy 绑定、Git/Docker/Compose 是否可用，以及生产 Compose 配置是否能展开。预检不会输出真实密钥值。

## 5. 启动和迁移

先验证 Compose 配置：

```bash
docker compose -p nested-api-relay --env-file .env -f compose.prod.yml config >/tmp/nested-api-relay-compose.yml
```

构建并启动：

```bash
RUN_SMOKE=true \
RUN_RESTART_VERIFY=true \
SMOKE_API_URL=https://api.example.com \
SMOKE_WEB_URL=https://app.example.com \
sh ops/deploy/deploy.sh
```

API 容器启动命令会自动执行：

```bash
npm --prefix apps/api run db:migrate
```

查看状态：

```bash
docker compose -p nested-api-relay --env-file .env -f compose.prod.yml ps
docker compose -p nested-api-relay --env-file .env -f compose.prod.yml logs --tail=100 api
docker compose -p nested-api-relay --env-file .env -f compose.prod.yml logs --tail=100 caddy
```

## 6. 部署后 Smoke Test

最低检查：

```bash
SMOKE_API_URL=https://api.example.com \
SMOKE_WEB_URL=https://app.example.com \
npm run smoke:t21:deploy
```

登录、令牌和 trace 检查：

```bash
SMOKE_API_URL=https://api.example.com \
SMOKE_WEB_URL=https://app.example.com \
SMOKE_USERNAME=admin_user \
SMOKE_PASSWORD='real-password' \
SMOKE_MODEL='real-enabled-model' \
npm run smoke:t21:deploy
```

真实 chat 检查只有在上游、模型、余额都已真实配置后才开启：

```bash
SMOKE_API_URL=https://api.example.com \
SMOKE_WEB_URL=https://app.example.com \
SMOKE_USERNAME=admin_user \
SMOKE_PASSWORD='real-password' \
SMOKE_MODEL='real-enabled-model' \
SMOKE_RUN_CHAT=true \
SMOKE_STRICT=true \
npm run smoke:t21:deploy
```

脚本规则：

- `pass` 表示真实 HTTP 请求成功。
- `skip` 表示缺少真实账号、真实 API Key、真实模型、真实充值码或真实通知配置，不算通过。
- `SMOKE_STRICT=true` 时，只要存在 `skip` 或 `fail` 就返回失败。
- 不能用静态样例或假上游冒充生产可用。

## 7. 备份

手动备份：

```bash
sh ops/backup/postgres-backup.sh
```

建议加入 cron：

```cron
15 3 * * * cd /opt/nested-api-relay && COMPOSE_FILE=compose.prod.yml sh ops/backup/postgres-backup.sh >> logs/backup.log 2>&1
```

备份文件在 `backups/postgres/`，每个 `.dump` 会生成对应 `.sha256`。生产应再同步到对象存储或异地服务器。

恢复演练示例：

```bash
docker compose -p nested-api-relay --env-file .env -f compose.prod.yml exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < backups/postgres/postgres-YYYYMMDDTHHMMSSZ.dump
```

恢复会覆盖数据库，必须先确认目标环境和备份文件。

## 8. 回滚

回滚前先备份当前数据库：

```bash
sh ops/backup/postgres-backup.sh
```

回滚到指定提交：

```bash
SMOKE_API_URL=https://api.example.com \
SMOKE_WEB_URL=https://app.example.com \
sh ops/deploy/rollback.sh <commit-sha-or-tag>
```

`ops/deploy/rollback.sh` 默认会先执行一次 PostgreSQL 备份；只有在已经人工完成备份且明确接受风险时，才允许设置 `SKIP_ROLLBACK_BACKUP=true`。

限制：

- Prisma migration 默认只前进不回滚；如果新版本已经执行破坏性 schema 变更，必须按迁移说明人工恢复备份。
- 回滚后必须运行 smoke test。
- 若回滚后 Caddy 证书、域名或 `.env` 不变，HTTPS 不需要重新申请。

## 9. 自恢复和重启验证

Compose 中所有生产服务均设置 `restart: unless-stopped`。验证：

```bash
SMOKE_API_URL=https://api.example.com \
SMOKE_WEB_URL=https://app.example.com \
RUN_SMOKE=true \
sh ops/deploy/restart-verify.sh
```

服务器重启验证：

```bash
sudo reboot
# 重新登录后
cd /opt/nested-api-relay
docker compose -p nested-api-relay --env-file .env -f compose.prod.yml ps
```

## 10. 上线禁止项

- 禁止把真实 `.env`、数据库密码、上游 Key、Webhook secret、充值码明文提交到 GitHub。
- 禁止把未配置的上游、支付、通知、Uptime Kuma 伪造成可用。
- 禁止跳过迁移状态检查和 smoke test。
- 禁止在未备份数据库的情况下回滚。
- 禁止把 PostgreSQL、Redis 直接暴露到公网。
