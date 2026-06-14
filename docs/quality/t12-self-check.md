# T12 自检报告 - 费用说明页面

日期：2026-06-15
任务：T12 费用说明页面
范围：用户查看自己分组真实可用模型的公开价格、模型倍率、分组倍率、计费公式，支持搜索和复制模型名；未登录用户不能访问个人化价格数据。

## 交付物

| 项目 | 文件 | 状态 |
| --- | --- | --- |
| 费用说明后端模块 | `apps/api/src/pricing/*` | 完成 |
| 计费公式共享常量 | `apps/api/src/billing/billing.constants.ts` | 完成 |
| 后端模块接入 | `apps/api/src/app.module.ts` | 完成 |
| 前端价格代理 | `apps/web/app/api/pricing/[[...path]]/route.ts` | 完成 |
| 费用说明页 | `apps/web/app/pricing/page.tsx` | 完成 |
| `/account/pricing` 兼容跳转 | `apps/web/app/account/pricing/page.tsx` | 完成 |
| 价格接口客户端 | `apps/web/app/lib/pricing-api.ts` | 完成 |
| 首页费用说明入口 | `apps/web/app/page.tsx` | 完成 |
| 真实数据 QA 脚本 | `apps/api/scripts/t12-pricing-qa.ts` | 完成 |
| 任务记录 | `docs/superpowers/specs/2026-06-14-nested-api-relay-development-plan.md` | 完成 |

## 核心行为

| 场景 | 结果 |
| --- | --- |
| 已登录用户访问费用说明 | 只返回当前用户分组可用模型 |
| 未登录访问后端价格接口 | 返回 401 |
| 模型可见性 | 必须满足模型启用、用户分组授权、存在启用上游模型、上游供应商启用 |
| 价格字段 | 返回公开输入/输出单价、模型倍率、分组倍率、stream 能力 |
| 计费公式 | `PricingService` 与 `BillingService` 共用 `BILLING_FORMULA` |
| 搜索 | 只在后端返回的授权模型集合内按模型名/展示名过滤 |
| 复制 | 复制纯模型名，不复制展示名或其他字段 |
| 敏感字段 | 不返回上游密钥、上游映射、供应商信息、内部价格快照、token/hash/password 字段 |

## 验证记录

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `docker compose -p nested-api-relay up -d --build api web` | 通过，生产构建包含 `/pricing`、`/account/pricing` 和 `/api/pricing/[[...path]]` |
| `GET http://127.0.0.1:3001/health` | HTTP 200，`status: ok` |
| `npm run qa:t12:pricing` | 通过，真实 HTTP + 真实 Postgres + 临时真实模型/分组/上游配置 |
| 浏览器 QA | 通过，未登录跳登录；登录后可见真实模型；搜索和复制成功；控制台 0 错误 |
| `npm run qa:t10:recharge` | 通过，充值链路兼容 |
| `npm run qa:t11:usage-logs` | 通过，日志与扣费链路兼容 |
| `npm audit --prefix apps/api --audit-level=moderate` | 0 vulnerabilities |
| `npm audit --prefix apps/web --audit-level=moderate` | 0 vulnerabilities |
| T12 新代码假数据扫描 | 未命中 `fake/mock/dummy/lorem/hardcoded/sample` |
| T12 新代码敏感字段扫描 | 价格模块和前端价格页未命中敏感字段返回 |
| `git diff --check` | 通过，无空白错误 |
| T12 QA 数据清理 | 脚本和浏览器 fixture 均清理为 0 残留 |

真实价格 QA 摘要：

```json
{
  "ok": true,
  "checks": [
    "unauthenticated_pricing_request_is_rejected",
    "pricing_formula_reuses_billing_source_of_truth",
    "pricing_response_reflects_real_model_price_and_group_multiplier",
    "pricing_filters_by_user_group_active_price_and_active_upstream",
    "pricing_blocks_cross_group_model_visibility",
    "pricing_response_uses_sensitive_field_allowlist"
  ],
  "residualBeforeCleanup": {
    "users": 2,
    "groups": 2,
    "sessions": 2,
    "wallets": 2,
    "model_prices": 5,
    "model_group_accesses": 5,
    "upstream_providers": 4,
    "upstream_models": 4,
    "api_tokens": 0
  },
  "residualAfterCleanup": {
    "users": 0,
    "groups": 0,
    "sessions": 0,
    "wallets": 0,
    "model_prices": 0,
    "model_group_accesses": 0,
    "upstream_providers": 0,
    "upstream_models": 0,
    "api_tokens": 0
  }
}
```

浏览器 QA 摘要：

```json
{
  "checks": [
    "real_browser_fixture_created_in_postgres",
    "browser_unauth_pricing_redirects_to_login",
    "browser_login_flow_succeeds",
    "browser_pricing_page_shows_and_searches_real_model",
    "browser_copy_model_name_succeeds"
  ],
  "consoleErrors": [],
  "residualAfterCleanup": {
    "users": 0,
    "groups": 0,
    "model_prices": 0,
    "upstream_providers": 0,
    "upstream_models": 0
  }
}
```

## Review + QA 结论

- Pre-landing review：未发现阻塞问题。鉴权由 `AuthGuard` 保护，返回字段为白名单，模型来源复用 `ModelCatalogService` 的分组和上游状态过滤。
- Greptile triage：本机没有 `gh` 命令，未接入 PR 评论检查；本地 diff review 已完成。
- QA：通过真实接口和真实数据库验证，不使用前端假模型；临时 QA 数据全部清理。
- Worker workshare：Darwin sidecar 只读复核 T12 复用模块、敏感字段、QA 断言和商用风险；Codex 接受其“字段白名单”和“公式防漂移”建议，并由 Codex 完成实现、集成、验证和最终审查。

## CEO + CTO 审查

- 用户价值：用户能直接理解自己能调用哪些模型、价格如何计算，并能复制模型名用于 API 调用。
- 财务正确性：页面公式与实际扣费路径共用同一常量，降低账单解释和实际扣费不一致的风险。
- 安全边界：接口不暴露上游供应商、上游模型、密钥预览、内部价格快照和数据库内部 id。
- 兼容性：不改模型授权算法，不改充值，不改实际扣费计算，只把公式文案收敛到共享常量；T10/T11 回归通过。
- 可运维性：T12 QA 可复跑，会自动创建并清理用户、分组、模型价格、上游和映射数据。

## 剩余边界

- T12 不做套餐、发票、付款方式和商业营销页。
- T12 不做管理员价格编辑；管理后台价格配置已在 T06 范围内。
- T12 不显示内部成本、上游供应商成本或历史 `priceSnapshot`；账单争议导出属于后续商用能力。
