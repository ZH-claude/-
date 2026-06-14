# API 中转站 Monorepo

这是一个面向“API 中转站套娃”场景的全栈项目骨架。当前 T01 只完成基础工程、前后端空壳、PostgreSQL、Redis 和 Docker Compose 启动链路，不实现业务功能。

## 目录结构

```text
.
├── apps
│   ├── api      # NestJS + Fastify 后端
│   └── web      # Next.js + Ant Design 前端
├── docs         # 规划文档
├── Dockerfile
├── docker-compose.yml
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

## T01 边界

T01 只做项目初始化：

- monorepo 根工作区
- `apps/web` 前端空壳
- `apps/api` 后端空壳和 `/health`
- PostgreSQL、Redis、Docker Compose
- README 和 `.env.example`

T01 不做用户系统、计费、Relay 转发、上游配置、数据库表结构、管理后台业务功能。
