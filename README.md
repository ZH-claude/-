# API 中转站 Monorepo

这是一个面向“API 中转站套娃”场景的全栈项目。当前已完成 MVP 用户端、管理端、Relay、计费、日志、通知、限流、安全审计和请求可观测性；T21 增加云服务器部署资产。

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
- `ops/deploy/rollback.sh`：按 Git ref 回滚。
- `ops/smoke/t21-deploy-smoke.mjs`：部署后真实 HTTP smoke test。
- `docs/deployment/cloud-server-deployment.md`：完整云服务器部署手册。

生产部署入口：

```bash
docker compose -p nested-api-relay --env-file .env -f compose.prod.yml config
docker compose -p nested-api-relay --env-file .env -f compose.prod.yml up -d --build
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
