# T10 自检报告 - 余额充值与兑换码

日期：2026-06-15
任务：T10 余额充值与兑换码
范围：管理员生成兑换码、用户核销、余额增加、充值流水、重复/禁用/错误码不误充值。

## 交付物

| 项目 | 文件 | 状态 |
| --- | --- | --- |
| 兑换码数据模型 | `apps/api/prisma/schema.prisma` | 完成 |
| 数据库迁移 | `apps/api/prisma/migrations/20260615120000_t10_recharge_codes/migration.sql` | 完成 |
| 充值后端模块 | `apps/api/src/recharge/*` | 完成 |
| 真实接口 QA 脚本 | `apps/api/scripts/t10-recharge-qa.ts` | 完成 |
| 用户充值页 | `apps/web/app/account/topup/recharge/page.tsx` | 完成 |
| 管理后台卡密面板 | `apps/web/app/admin/page.tsx` | 完成 |
| 任务记录 | `docs/superpowers/specs/2026-06-14-nested-api-relay-development-plan.md` | 完成 |

## 核心行为

| 场景 | 结果 |
| --- | --- |
| 非管理员生成兑换码 | 返回 `403`，不创建兑换码 |
| 管理员生成兑换码 | 返回一次性明文码，数据库只保存 `code_hash` |
| 用户核销未使用兑换码 | 增加钱包余额，写入 `RECHARGE` 钱包流水 |
| 重复核销同一码 | 返回冲突，不增加余额 |
| 核销禁用码 | 返回错误，不增加余额 |
| 核销错误码 | 返回错误，不增加余额 |
| 并发核销同一码 | 只有 1 次成功，只有 1 条充值流水 |
| 管理员禁用与用户核销并发 | 不返回 500，最终只会落到 `disabled` 或 `used` 业务状态 |

## 验证记录

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过，Docker 镜像构建阶段也通过 |
| `npm audit --prefix apps/api --audit-level=moderate` | 0 vulnerabilities |
| `npm audit --prefix apps/web --audit-level=moderate` | 0 vulnerabilities |
| `docker compose -p nested-api-relay up -d --build api web` | 通过；需关闭本机 Compose Bake/BuildKit 绕过 Docker gRPC header 环境问题 |
| `prisma migrate deploy` | 通过，应用 `20260615120000_t10_recharge_codes` |
| `GET http://127.0.0.1:3001/health` | `status: ok` |
| `GET http://127.0.0.1:3000/account/topup/recharge` | HTTP 200 |
| `npm run qa:t10:recharge` | 通过，真实 HTTP + 真实 Postgres，13 项检查 |
| 自检数据清理 | `users=0`、`sessions=0`、`recharge_codes=0`、`wallet_transactions=0`、`admin_audit_logs=0` |

真实充值 QA 摘要：

```json
{
  "ok": true,
  "checks": [
    "admin_guard_blocks_user",
    "admin_generates_codes_once",
    "database_stores_hash_not_plain_code",
    "audit_logs_hide_plain_code_and_hash",
    "admin_list_hides_plain_code",
    "user_redeems_code_wallet_and_ledger",
    "duplicate_redeem_no_balance_change",
    "disable_used_code_returns_business_conflict",
    "disabled_code_no_balance_change",
    "invalid_code_no_balance_change",
    "concurrent_same_code_single_success",
    "concurrent_disable_or_redeem_no_server_error",
    "user_recharge_records_are_real_recharge_transactions"
  ],
  "codeCount": 5,
  "residualBeforeCleanup": {
    "users": 2,
    "sessions": 2,
    "recharge_codes": 5,
    "wallet_transactions": 2,
    "admin_audit_logs": 7
  },
  "residualAfterCleanup": {
    "users": 0,
    "sessions": 0,
    "recharge_codes": 0,
    "wallet_transactions": 0,
    "admin_audit_logs": 0
  }
}
```

## CEO + CTO 审查

- 用户价值：用户可以用卡密充值余额，充值后立即反映到账户余额。
- 财务正确性：充值与钱包余额、钱包流水同事务，成功充值形成可追踪 `RECHARGE` 流水。
- 安全边界：数据库不保存明文兑换码；管理列表不返回明文码；审计日志不写明文码和 hash。
- 并发边界：同一兑换码并发核销只成功一次，重复请求不会重复入账；管理员禁用与用户核销并发不会退化成 500。
- 兼容性：T09 消费流水仍使用 `usage:` 幂等前缀，T10 充值流水使用 `recharge:` 前缀；不改变 Relay 扣费语义。

## 剩余边界

- T10 不实现在线支付、自动发卡、渠道订单或发票；这些属于商用支付阶段。
- T10 不实现管理员手动调账；PRD 将其归入管理员余额调整能力，可后续单独做。
- T10 充值记录只展示最近 100 条，分页和导出属于后续账单/日志任务。
- 本地 Docker 默认 BuildKit/Bake 在当前 Windows 环境报 gRPC header 错误；已用 `COMPOSE_BAKE=false` 与 `DOCKER_BUILDKIT=0` 完成等价构建验证。
