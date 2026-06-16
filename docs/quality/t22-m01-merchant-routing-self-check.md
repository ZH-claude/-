# T22-M01 Merchant Routing Self Check

Date: 2026-06-16

## Scope

M01 implements role-based routing after login and adds the `/merchant` compatibility entry. This task does not rebuild the full merchant shell yet; that is M02.

## Changed Files

- `apps/web/app/login/page.tsx`
- `apps/web/app/lib/role-routing.ts`
- `apps/web/app/merchant/page.tsx`
- `apps/api/scripts/t22-merchant-routing-qa.ts`
- `apps/api/package.json`
- `package.json`
- `docs/product/merchant-console-plan.md`

## Real Data Verification

The QA script uses a real PostgreSQL connection and real HTTP calls. It creates temporary users with wallets, logs in through `/auth/login`, receives real session cookies, calls `/merchant` on the web app, verifies `/admin/users` authorization, then removes all temporary rows.

Result:

```json
{
  "ok": true,
  "checks": [
    "seeded_real_user_and_merchant_rows_with_wallets",
    "ordinary_user_login_uses_real_role_and_routes_to_user_console",
    "merchant_login_uses_real_admin_role_and_routes_to_merchant_entry",
    "merchant_entry_rejects_missing_session",
    "merchant_entry_sends_ordinary_user_back_to_user_console",
    "merchant_entry_sends_admin_to_admin_console",
    "admin_api_permissions_remain_server_enforced",
    "database_roles_wallets_and_sessions_are_consistent"
  ],
  "residualAfterCleanup": {
    "users": 0,
    "wallets": 0,
    "sessions": 0,
    "securityAuditLogs": 0
  }
}
```

## Commands Run

| Command | Result |
| --- | --- |
| `npm --prefix apps/api run typecheck` | Passed |
| `npm --prefix apps/web run typecheck` | Passed |
| `npm --prefix apps/web run build` | Passed; `/merchant` is dynamic server-rendered route |
| `npm run qa:t22:merchant-routing` with `DATABASE_URL`, `API_BASE_URL`, `WEB_BASE_URL` | Passed |
| `git diff --check` | Passed |
| `rg -n "mock|fake|fixture|dummy|placeholder|merchant200611" ...` | No matches in changed functional files |

## Review Notes

- Compatibility: user side still routes to `/account/profile`; admin/merchant side routes to `/merchant`, then server-side redirects to `/admin`.
- Database consistency: no schema change in M01. The existing `UserRole.ADMIN` remains the merchant account carrier for MVP. QA verifies users, wallets, sessions, and roles against real Postgres rows.
- Interface reservation: `role-routing.ts` accepts both `admin` and future `merchant` role strings, so a later `MERCHANT` database role can be introduced with less frontend churn.
- Security: `/merchant` does not trust local client state. It calls backend `/auth/me` with the HttpOnly cookie and relies on existing `AuthGuard + AdminGuard` for `/admin/*`.
- No fake data: there are no mocked business results. The only generated data is temporary QA data, created in and cleaned from the real database.

## Remaining Scope

- M02 still needs a real merchant shell and fixed navigation so the merchant side no longer visually looks like the user side.
- M03 still needs a merchant Dashboard backed by real aggregate APIs.
