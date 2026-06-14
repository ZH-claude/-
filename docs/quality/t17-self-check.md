# T17 自检报告 - 服务状态页

日期：2026-06-15
任务：T17 服务状态页
范围：新增只读服务状态 API、内置平台探针、可选 Uptime Kuma 配置读取、上游健康字段展示、Next 同源代理和 `/uptimeStatus` 用户页面；没有外部监控配置时明确显示未配置，不伪造在线率、持续运行时间或上游状态。

## 交付物

| 项目 | 文件 | 状态 |
| --- | --- | --- |
| 服务状态后端模块 | `apps/api/src/service-status/*` | 完成 |
| 后端模块接入 | `apps/api/src/app.module.ts` | 完成 |
| 内置探针配置 | `.env.example`、`docker-compose.yml` | 完成 |
| Next 同源代理 | `apps/web/app/api/service-status/route.ts` | 完成 |
| 前端客户端 | `apps/web/app/lib/service-status-api.ts` | 完成 |
| 服务状态页 | `apps/web/app/uptimeStatus/page.tsx` | 完成 |
| 首页入口 | `apps/web/app/page.tsx` | 完成 |
| 真实数据 QA 脚本 | `apps/api/scripts/t17-service-status-qa.ts` | 完成 |
| 任务记录 | `docs/superpowers/specs/2026-06-14-nested-api-relay-development-plan.md` | 完成 |

## 核心行为

| 场景 | 结果 |
| --- | --- |
| `GET /service-status` | 公开只读返回平台组件、上游状态和汇总 |
| API 探针 | 当前进程能响应时返回 `healthy` |
| 数据库探针 | 真实执行 `SELECT 1 AS ok`，失败时返回脱敏错误码 |
| Redis 探针 | 读取 `REDIS_URL` 后做真实 TCP 连接探测 |
| Web 探针 | 读取 `WEB_HEALTH_URL` 后请求真实 Web 服务 |
| 外部监控 | `UPTIME_KUMA_STATUS_URL` 为空时返回 `not_configured`，不伪造监控结果 |
| 上游状态 | 读取 `upstream_providers.health_status`、`last_health_check_at`、`last_health_latency_ms` |
| 空上游 | 无上游记录时返回空数组，页面显示明确空状态 |
| 敏感字段 | 不返回 `baseUrl`、`apiKeyPreview`、`encryptedApiKey`、数据库连接串、Redis 连接串或内部 URL |

## 验证记录

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `docker compose -p nested-api-relay build api web` | 通过，使用经典构建模式绕过 Docker Desktop bake gRPC 工具错误 |
| `docker compose -p nested-api-relay up -d api web` | 通过，API/Web/Postgres/Redis 均启动 |
| `GET /health` | 通过，API 返回 `status: ok` |
| `GET /service-status` | 通过，API/DB/Redis/Web 为 `healthy`，外部监控为 `not_configured`，上游为空 |
| `GET /uptimeStatus` | 通过，Next 页面返回 200 |
| `npm run qa:t17:service-status` | 通过，真实 HTTP + 真实 Postgres + 真实 Next 代理 |
| 浏览器 QA | 通过，桌面/移动端加载、刷新、空上游状态和控制台错误均验证 |
| `npm run qa:t16:async-tasks` | 通过，异步任务兼容 |
| `npm run qa:t15:announcements` | 通过，首页公告兼容 |
| `npm run qa:t14:notifications` | 通过，通知与 Relay 扣费链路兼容 |
| `npm run qa:t13:group-availability` | 通过，分组状态与上游健康字段兼容 |
| `npm --prefix apps/api audit --audit-level=moderate` | 0 vulnerabilities |
| `npm --prefix apps/web audit --audit-level=moderate` | 0 vulnerabilities |
| T17 新代码数据真实性扫描 | 无产品代码 `fake/mock/dummy/模拟/假数据/伪造` 命中 |
| T17 敏感字段扫描 | 命中均为环境变量读取或 QA 断言；服务状态响应不返回敏感字段 |
| `git diff --check` | 通过，无空白错误 |
| T17 QA 数据清理 | 脚本创建的用户、会话、钱包、上游记录均清理为 0 残留 |

真实服务状态 QA 摘要：

```json
{
  "ok": true,
  "checks": [
    "real_upstream_provider_health_rows_are_written_to_postgres",
    "builtin_probes_report_real_api_database_redis_web_and_unconfigured_monitor",
    "service_status_uses_real_upstream_health_fields",
    "next_proxy_returns_real_service_status",
    "service_status_response_uses_sensitive_field_allowlist",
    "empty_upstream_state_returns_no_synthetic_provider_rows"
  ],
  "residualAfterCleanup": {
    "users": 0,
    "sessions": 0,
    "wallets": 0,
    "upstream_providers": 0
  }
}
```

浏览器 QA 摘要：

```json
{
  "ok": true,
  "checks": [
    "browser_service_status_desktop_loads_real_builtin_probe_data",
    "browser_service_status_refresh_updates_component_rows",
    "browser_service_status_empty_upstream_state_is_explicit",
    "browser_service_status_mobile_renders_without_console_errors"
  ],
  "desktop": {
    "componentRows": 5,
    "upstreamRows": 1,
    "emptyUpstream": true
  },
  "mobile": {
    "componentRows": 5,
    "upstreamRows": 1,
    "emptyUpstream": true
  }
}
```

浏览器证据截图：

- `C:\Users\15359\AppData\Local\Temp\t17-service-status-desktop.png`
- `C:\Users\15359\AppData\Local\Temp\t17-service-status-mobile.png`
- `C:\Users\15359\AppData\Local\Temp\t17-service-status-desktop-final.png`

## Review + QA 结论

- Pre-landing review：重点检查公共接口脱敏、DB/Redis/Web 探针错误归一化、Uptime Kuma 未配置状态、上游字段白名单、页面空态和刷新交互；未发现阻塞问题。
- Greptile triage：本机没有 `gh` 命令，未接入 PR 评论检查；本地 diff review 已完成。
- QA：通过真实注册用户、真实 `upstream_providers` 记录、真实后端接口、真实 Next 代理和真实浏览器路径验证；服务状态不是前端静态数组，也没有硬编码健康结果。
- Worker workshare：Boyle sidecar 只读复核 T17 可复用健康字段、Uptime Kuma 缺口、前端页面模式和 QA 风险；Codex 采纳“内置探针优先、Kuma 未配置明确显示、复用 `upstream_providers` 健康字段”的方向，并完成实现、验证和最终审查。

## CEO + CTO 审查

- 用户价值：用户现在可在 `/uptimeStatus` 看到平台 API、数据库、Redis、Web 前端和上游的真实状态。
- 数据真实性：平台状态来自实时探针；上游状态来自数据库健康检查字段；无外部监控配置时显示未配置。
- 安全边界：公共 API 不返回内部 URL、连接串、Key 预览、加密 Key 或供应商 Base URL；健康错误被归一化为安全错误码。
- 兼容性：T17 不改 Relay、计费、通知、公告、异步任务和分组状态核心链路；T13-T16 回归通过。
- 商业化判断：MVP 的状态页可用；商用阶段需要定时巡检 worker、告警推送和真实 Uptime Kuma 状态页拉取策略。

## 剩余边界

- T17 不实现定时巡检 worker、告警规则、Prometheus/Grafana 面板或 Uptime Kuma 配置管理页面。
- 当前 Redis 探针验证 TCP 可达性，不执行认证后的 Redis `PING` 命令。
- 当前 Web 探针依赖 `WEB_HEALTH_URL`，生产环境应配置为真实 Web 健康地址。
