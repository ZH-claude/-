# Real Data Interface Audit

Date: 2026-06-14
Scope: Completed T01-T04 runtime interfaces and visible pages.
Mode: `/qa` focused on fake/mock data detection.

## Verdict

The completed auth and admin interfaces are database-backed. They are not returning hardcoded mock arrays.

However, the local PostgreSQL database is polluted with QA-generated rows from previous validation runs. The page is showing real database rows, but those rows are test data, not business production data.

## Classification

| Area | Classification | Evidence |
| --- | --- | --- |
| `GET /health` | STATIC_RUNTIME_HEALTH | Returns service status and current timestamp from `apps/api/src/app.controller.ts`; no user/business data. |
| `POST /auth/register` | REAL_DB | Creates `users`, `wallets`, and `sessions` through Prisma in `apps/api/src/auth/auth.service.ts`. |
| `POST /auth/login` | REAL_DB | Reads `users`, writes session and `lastLoginAt` through Prisma. |
| `GET /auth/me` | REAL_DB | Reads session and joined user/group/wallet from Prisma. |
| `POST /auth/change-password` | REAL_DB | Updates password hash and revokes other sessions in DB. |
| `GET /admin/users` | REAL_DB | Reads `users` with `group` and `wallet`; API total matched DB count. |
| `GET /admin/announcements` | REAL_DB | Reads `announcements` with creator user; API count matched DB count. |
| `POST /admin/announcements` | REAL_DB | Writes `announcements` and `admin_audit_logs` in one transaction. |
| `/admin` page | REAL_API_UI | Browser observed calls to `/api/admin/users?limit=100` and `/api/admin/announcements`; page values matched DB rows. |
| `/account` page | REAL_API_UI | Uses `/api/auth/me` through `apps/web/app/lib/auth-api.ts`. |
| `/` homepage | STATIC_UI | Shows stage/status/navigation text only; not presented as live business metrics. |
| `.env.example`, `docker-compose.yml`, docs | PLACEHOLDER_CONFIG | Contains placeholder DB/upstream examples only; not runtime business data. |

## Runtime Evidence

| Check | Result |
| --- | --- |
| DB active users | 28 |
| API `/admin/users` total | 28 |
| DB announcements | 11 |
| API `/admin/announcements` items | 11 |
| Browser admin API calls | `GET /api/admin/users?limit=100`, `GET /api/admin/announcements`, both HTTP 200 |
| Browser console errors | 0 |

## Local Test Data Found

| Data type | Count | Examples |
| --- | --- | --- |
| QA-like users | 27 | `qauser20260614194106`, `debuguser20260614192934419`, `t04user1781435633949` |
| QA-like announcements | 11 | `review-qa-announcement-1781437292409`, `qa-announcement-20260614194106`, `T04 browser clean 1781435699467` |

This is not mock code. It is real rows in the local database created by prior QA runs.

## Screenshot

- `.gstack/qa-reports/artifacts/t04-real-data-audit-admin.png`

## Open Decision

Do not delete these rows silently. They are local test records and can be cleaned, but cleanup should be a separate explicit action because it changes database state outside Git.
