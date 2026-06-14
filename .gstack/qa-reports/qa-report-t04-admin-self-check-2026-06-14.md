# QA Report - T04 Admin Foundation

Date: 2026-06-14

Scope: T04 management console foundation. Covered admin bootstrap, admin-only API protection, user list, announcement publishing, audit logging, `/admin` frontend page, same-origin admin proxy, Docker migration/startup, and browser QA.

## Review Findings

| Severity | Finding | Result |
| --- | --- | --- |
| High | Admin endpoints need explicit role protection, not only session authentication. | Fixed with `AuthGuard` plus `AdminGuard`. |
| High | T04 cannot self-check administrator login without a safe admin account bootstrap path. | Fixed with optional `ADMIN_BOOTSTRAP_USERNAME` and `ADMIN_BOOTSTRAP_PASSWORD`. |
| Medium | Announcement publishing should be auditable. | Fixed by writing `admin_audit_logs` on announcement creation. |
| Medium | Frontend/admin API must keep HttpOnly Cookie flow, not reintroduce browser tokens. | Fixed with same-origin `/api/admin/*` proxy and `credentials: include`. |
| Low | User list UI claimed 100 rows while frontend requested default page size. | Fixed by requesting `/admin/users?limit=100`. |

## Fixes Applied

| Area | Change |
| --- | --- |
| Database | Added `AnnouncementStatus`, `Announcement`, and `AdminAuditLog` in Prisma plus migration `20260614120000_t04_admin_announcements_audit`. |
| Backend | Added `AdminModule`, `AdminController`, `AdminService`, and `AdminGuard`. |
| Auth integration | Exported `AuthService/AuthGuard` from `AuthModule`; admin routes use `AuthGuard + AdminGuard`. |
| Bootstrap | Added optional admin bootstrap from environment variables. |
| Frontend | Added `/admin` page, admin API client, and `/api/admin/[...path]` proxy. |
| Docs | Checked off T04 and wrote `docs/quality/t04-self-check.md`. |

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run build` | Passed |
| `npm audit --prefix apps/api --audit-level=moderate` | Passed, 0 vulnerabilities |
| `npm audit --prefix apps/web --audit-level=moderate` | Passed, 0 vulnerabilities |
| `docker compose -p nested-api-relay up --build -d` | Passed |
| Docker migration | Passed, T04 migration applied and later rerun showed no pending migrations |
| Docker API startup | Passed, API started with `node dist/main.js` |
| Docker Web startup | Passed, Web started with `next start -p 3000` |
| API permissions | Passed, normal user receives 403 for `/admin/users` |
| API admin flow | Passed, admin login, user list, announcement create/list |
| API validation | Passed, invalid announcement `status` returns HTTP 400 |
| Audit log | Passed, exactly one `announcement_created` audit row for the tested announcement |
| Browser flow | Passed, admin login, `/admin`, Chinese announcement creation, announcement list |
| Browser session | Passed, admin session cookie is HttpOnly |
| Responsive check | Passed, 390px viewport had no horizontal document overflow |
| Production-mode check | Passed, no Next dev tools badge in production container |

## Artifacts

| Artifact | Path |
| --- | --- |
| Desktop admin screenshot | `.gstack/qa-reports/artifacts/t04-admin-desktop.png` |
| Mobile admin screenshot | `.gstack/qa-reports/artifacts/t04-admin-mobile.png` |

## Residual Risk

No blocking T04 issue remains. Before production deployment, create the first admin with strong `ADMIN_BOOTSTRAP_PASSWORD`, then remove the bootstrap variables after access is confirmed unless you intentionally want env-based password reset behavior.
