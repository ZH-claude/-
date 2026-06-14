# T13 自检报告 - 分组状态页面

日期：2026-06-15
任务：T13 分组状态页面
范围：用户查看当前分组可用模型的真实状态、窗口成功率、状态筛选和刷新；无真实统计时显示明确空状态，不使用虚构成功率或虚构流量。

## 交付物

| 项目 | 文件 | 状态 |
| --- | --- | --- |
| 分组状态后端模块 | `apps/api/src/group-availability/*` | 完成 |
| 后端模块接入 | `apps/api/src/app.module.ts` | 完成 |
| 前端分组状态代理 | `apps/web/app/api/group-availability/[[...path]]/route.ts` | 完成 |
| 分组状态页 | `apps/web/app/groupAvailability/page.tsx` | 完成 |
| 分组状态接口客户端 | `apps/web/app/lib/group-availability-api.ts` | 完成 |
| 首页分组状态入口 | `apps/web/app/page.tsx` | 完成 |
| 真实数据 QA 脚本 | `apps/api/scripts/t13-group-availability-qa.ts` | 完成 |
| 任务记录 | `docs/superpowers/specs/2026-06-14-nested-api-relay-development-plan.md` | 完成 |

## 核心行为

| 场景 | 结果 |
| --- | --- |
| 已登录用户访问分组状态 | 只返回当前用户分组授权模型 |
| 未登录访问后端接口 | 返回 401 |
| 模型状态 | 返回 `normal`、`partial`、`unavailable`、`no_data` 和原因码 |
| 成功率统计 | 基于窗口内真实 `usage_events` 聚合 |
| 成功口径 | `FAILED` 计失败，其余已记录调用计入“请求成功” |
| 状态筛选 | 后端按状态过滤模型行 |
| 刷新 | 重新读实时数据库，新增事件会反映到统计 |
| 空分组 | 无授权模型时不造模型，仍返回真实组内用户数 |
| 敏感字段 | 不返回用户 id、token id、request id、上游供应商 id、上游模型、价格快照、密钥或账务流水 |

## 验证记录

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `docker compose -p nested-api-relay up -d --build api web` | 通过，生产构建包含 `/groupAvailability` 和 `/api/group-availability/[[...path]]` |
| `npm run qa:t13:group-availability` | 通过，真实 HTTP + 真实 Postgres + 临时真实分组/模型/上游/usage_events |
| 浏览器 QA | 通过，未登录跳登录；登录后展示真实模型；partial 筛选和刷新成功；控制台 0 错误 |
| `npm run qa:t12:pricing` | 通过，费用说明兼容 |
| `npm run qa:t11:usage-logs` | 通过，日志和 usage_events 兼容 |
| `npm run qa:t10:recharge` | 通过，充值链路兼容 |
| `npm audit --prefix apps/api --audit-level=moderate` | 0 vulnerabilities |
| `npm audit --prefix apps/web --audit-level=moderate` | 0 vulnerabilities |
| T13 新代码假数据扫描 | 无功能假数据命中 |
| T13 响应敏感字段 QA | 通过字段和值白名单断言 |
| `git diff --check` | 通过，无空白错误 |
| T13 QA 数据清理 | 脚本和浏览器 fixture 均清理为 0 残留 |

真实分组状态 QA 摘要：

```json
{
  "ok": true,
  "checks": [
    "unauthenticated_group_availability_request_is_rejected",
    "availability_summary_uses_real_usage_events_for_current_group",
    "availability_model_rows_reflect_real_status_and_group_access",
    "status_filter_returns_only_requested_status",
    "time_window_changes_real_usage_aggregation",
    "refresh_reads_live_database_changes",
    "availability_blocks_cross_group_models_and_usage",
    "empty_group_reports_real_user_count_without_synthetic_models",
    "availability_response_uses_sensitive_field_allowlist"
  ],
  "residualBeforeCleanup": {
    "users": 3,
    "groups": 3,
    "sessions": 3,
    "wallets": 3,
    "api_tokens": 2,
    "usage_events": 7,
    "model_prices": 6,
    "model_group_accesses": 6,
    "upstream_providers": 5,
    "upstream_models": 5
  },
  "residualAfterCleanup": {
    "users": 0,
    "groups": 0,
    "sessions": 0,
    "wallets": 0,
    "api_tokens": 0,
    "usage_events": 0,
    "model_prices": 0,
    "model_group_accesses": 0,
    "upstream_providers": 0,
    "upstream_models": 0
  }
}
```

浏览器 QA 摘要：

```json
{
  "checks": [
    "real_browser_fixture_created_in_postgres",
    "browser_unauth_group_availability_redirects_to_login",
    "browser_group_availability_shows_real_models",
    "browser_status_filter_shows_partial_only",
    "browser_refresh_keeps_real_filtered_state"
  ],
  "consoleErrors": [],
  "residualAfterCleanup": {
    "users": 0,
    "groups": 0,
    "model_prices": 0,
    "upstream_providers": 0,
    "upstream_models": 0,
    "usage_events": 0
  }
}
```

## Review + QA 结论

- Pre-landing review：发现并修复空分组 `userCount` 误报为 0 的问题；修复后增加真实 QA 断言。
- Greptile triage：本机没有 `gh` 命令，未接入 PR 评论检查；本地 diff review 已完成。
- QA：通过真实接口、真实数据库、真实浏览器路径验证，未使用虚构统计。
- Worker workshare：Franklin sidecar 只读复核 T13 查询边界、状态枚举、敏感字段和商用风险；Codex 接受“状态 + 原因码”“成功率口径说明”“空数据不可伪造”等建议，并完成实现、修复、验证和最终审查。

## CEO + CTO 审查

- 用户价值：用户能看到自己分组模型是否正常、部分可用、不可用或暂无数据，并能按状态筛选。
- 数据真实性：成功率来自真实 `usage_events`；上游状态来自真实 `upstream_providers.healthStatus`；无数据时明确显示暂无数据。
- 安全边界：接口不允许传用户 id 或分组 id；只按当前登录用户分组计算，不返回 token/user/request/provider 明细。
- 兼容性：不改变模型授权、Relay、计费、充值或日志写入路径；T10/T11/T12 回归通过。
- 可运维性：状态含原因码和最近调用/健康检查时间，后续可接入 T17/T20 监控而不推翻页面结构。

## 剩余边界

- T13 不做全平台状态页、SLA、Uptime Kuma 或告警；这些留到 T17/T20。
- T13 不主动触发上游健康检查，只展示已有健康检查结果和真实调用统计。
- T13 成功率口径是“请求记录成功率”，不是“计费成功率”；计量未知不算失败。
