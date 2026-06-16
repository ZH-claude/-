# API 中转站 Monorepo

这是一个面向“API 中转站套娃”场景的全栈项目。当前已完成 MVP 用户端、商家端、Relay、计费、日志、通知、限流、安全审计、请求可观测性和云服务器部署资产。

## 目录结构

```text
.
├── apps
│   ├── api      # NestJS + Fastify 后端
│   └── web      # Next.js + Ant Design 前端
├── docs         # 规划文档
├── Dockerfile
├── docker-compose.yml
├── compose.prod.yml
├── ops          # 生产部署、备份、回滚、smoke test
├── package.json
├── .env.example
└── README.md
```

## 前置要求

- Node.js 22 LTS 推荐，最低 Node.js 20.11
- npm 11 或更高版本
- Docker 和 Docker Compose
- 本地端口 `3000`、`3001`、`5432`、`6379` 未被占用

## 环境变量

复制环境变量样例：

```bash
cp .env.example .env
```

Windows PowerShell 可以使用：

```powershell
Copy-Item .env.example .env
```

不要把真实数据库密码、JWT 密钥、上游 API Key 写进文档或提交到仓库。

## 用户端和商家端

MVP 只部署一套 Web，不拆成两个网站，也不需要第二套登录系统。登录后按账号身份分流：

- 普通用户进入 `/account/profile`，用于账户、余额、令牌、日志、价格、通知和服务状态。
- 商家/后台账号进入 `/merchant`，用于用户、充值码、上游/模型、公告、审计、服务状态、请求日志和绘图日志。
- 当前数据库角色仍是 `USER` 和 `ADMIN`。MVP 阶段商家端账号由 `ADMIN` 承载；真正多商家入驻、每个商家独立上游密钥和客户归属隔离，属于后续商用升级，不在当前 MVP 中伪造。

本地或测试环境可创建 3 个商家端测试账号：

```powershell
$env:MERCHANT_TEST_PASSWORD='<本地测试密码>'
npm run seed:merchant-test-accounts
```

创建的账号名为 `merchant_test_1`、`merchant_test_2`、`merchant_test_3`。密码只通过 `MERCHANT_TEST_PASSWORD` 传入，不写入生产脚本、`.env.example` 或 GitHub。生产环境应使用 `ADMIN_BOOTSTRAP_USERNAME` 和 `ADMIN_BOOTSTRAP_PASSWORD` 首次创建管理员账号，创建后清空这两个变量并重启。

商家端的“上游/模型”页面用于录入另一个中转站的真实上游地址和 API Key；客户使用本平台发放的 Key 调用本平台，本平台再转发到上游。未配置真实上游时，页面和接口只能显示未配置或空状态，不能用假数据冒充可用。

## Docker 启动

在项目根目录执行：

```bash
docker compose -p nested-api-relay up --build
```

Windows PowerShell 如果在中文路径下遇到 Docker BuildKit/gRPC header 错误，使用传统构建路径：

```powershell
$env:DOCKER_BUILDKIT='0'
docker compose -p nested-api-relay up --build
```

启动后访问：

- 前端后台壳页面：http://localhost:3000
- 后端健康检查：http://localhost:3001/health

## 云服务器部署

T21 生产部署资产：

- `compose.prod.yml`：生产 Compose，不暴露 PostgreSQL/Redis 公网端口。
- `ops/caddy/Caddyfile`：Caddy HTTPS 和反向代理。
- `ops/backup/postgres-backup.sh`：PostgreSQL 备份。
- `ops/deploy/deploy.sh`：Linux 生产部署入口。
- `ops/deploy/preflight.mjs`：生产 `.env`、Docker、DNS、端口和 Compose 预检。
- `ops/deploy/restart-verify.sh`：生产重启恢复验证。
- `ops/deploy/rollback.sh`：按 Git ref 回滚。
- `ops/smoke/t21-deploy-smoke.mjs`：部署后真实 HTTP smoke test。
- `docs/deployment/cloud-server-deployment.md`：完整云服务器部署手册。

生产部署入口：

```bash
npm run preflight:t21:prod
RUN_SMOKE=true RUN_RESTART_VERIFY=true \
SMOKE_API_URL=https://api.example.com \
SMOKE_WEB_URL=https://app.example.com \
sh ops/deploy/deploy.sh
```

部署后 smoke test：

```bash
SMOKE_API_URL=https://api.example.com \
SMOKE_WEB_URL=https://app.example.com \
npm run smoke:t21:deploy
```

缺少真实账号、真实模型、真实上游、真实充值码或真实通知配置时，smoke test 会显示 `skip`，不会把未配置功能伪造成通过。

## 本地开发命令

安装依赖：

```bash
npm run install:all
```

启动后端：

```bash
npm run dev:api
```

启动前端：

```bash
npm run dev:web
```

类型检查：

```bash
npm run typecheck
```

构建：

```bash
npm run build
```

## 常用验证

```bash
npm run typecheck
npm run build
npm --prefix apps/api run db:migrate
npm run qa:t20:observability
```
