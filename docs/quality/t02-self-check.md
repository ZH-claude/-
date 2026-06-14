# T02 自检记录

日期：2026-06-14  
范围：T02 文档交付、T01 工程骨架回归检查、Docker Compose 运行检查。

## 1. 本次交付

| 交付物 | 路径 | 状态 |
| --- | --- | --- |
| MVP PRD | `docs/product/mvp-prd.md` | 完成 |
| OpenAI 兼容 API 合约 | `docs/api/openai-compatible-mvp-contract.md` | 完成 |
| MVP 数据字典 | `docs/data/mvp-data-dictionary.md` | 完成 |
| 自检记录 | `docs/quality/t02-self-check.md` | 完成 |

## 2. 侧车复核处理

| 问题 | 处理 |
| --- | --- |
| 容器内前端后端调用基地址有歧义 | 增加 `INTERNAL_API_BASE_URL`，保留 `NEXT_PUBLIC_API_BASE_URL` 给浏览器 |
| `REDIS_PASSWORD` 未接入 Compose | Redis 服务支持可选 `REDIS_PASSWORD`，默认不启用密码 |
| 依赖安装不够可复现 | 根脚本和 Dockerfile 改为 `npm ci --prefix ...` |
| `WEB_PORT` 未被 Compose 使用 | Compose 端口映射改为 `${WEB_PORT:-3000}` 和 `${API_PORT:-3001}` |
| 生成缓存可能进入仓库 | `.gitignore` 增加 `*.tsbuildinfo` |

## 3. 验证命令

| 命令 | 结果 |
| --- | --- |
| `npm run install:all` | 通过，api/web 均 0 漏洞 |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `npm audit --prefix apps/api --audit-level=moderate` | 0 漏洞 |
| `npm audit --prefix apps/web --audit-level=moderate` | 0 漏洞 |
| `docker compose -p nested-api-relay config --quiet` | 通过 |
| `docker compose -p nested-api-relay up --build -d` | 通过，使用 `DOCKER_BUILDKIT=0` 兼容当前中文路径 |
| `curl http://127.0.0.1:3001/health` | 返回 `status: ok` |
| `curl http://127.0.0.1:3000` | HTTP 200 |

## 4. Redis 密码路径

使用临时容器验证同一条启动逻辑：

| 检查 | 结果 |
| --- | --- |
| `redis-cli -a selfcheck-pass ping` | `PONG` |
| `redis-cli ping` | `NOAUTH Authentication required` |

## 5. 密钥检查

- 已扫描用户提供过的真实密码模式、数据库/Redis 明文密码模式、疑似真实 `UPSTREAM_API_KEY`。
- 未发现真实密码或真实上游 Key 残留。
- `.env.example` 只保留 placeholder。

## 6. 当前可接受风险

| 风险 | 处理方式 |
| --- | --- |
| Docker Desktop 在中文路径下 BuildKit 报 gRPC header 错误 | README 记录 `DOCKER_BUILDKIT=0` 兼容方式 |
| 当前还没有真实业务接口 | 符合 T02 边界，T03 起逐步实现 |
| 当前没有 Git 仓库，无法做 git diff 级 review | 使用文件状态、构建、audit、Compose、HTTP 检查替代 |
