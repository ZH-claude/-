# T04 Review + QA Report

Date: 2026-06-14
Scope: T04 admin management foundation follow-up self-check.
Mode: `/review` + `/qa`

## Result

Status: PASS after fixes.
Health score: 96/100.

## Findings And Actions

| Finding | Severity | Action |
| --- | --- | --- |
| Admin bootstrap reset existing admin password on every restart | P2 | Fixed. Existing active admins are skipped by default; `ADMIN_BOOTSTRAP_FORCE_RESET=true` is required for explicit reset. |
| `/api/admin/*` proxy did not forward upstream `Set-Cookie` | P3 | Fixed. Admin proxy now mirrors auth proxy cookie propagation. |
| Missing favicon caused browser console 404 | Low | Fixed. Added SVG favicon and metadata icon declaration. |
| Polymorphic admin audit target is not FK-constrained | P3 residual | Deferred. Current T04 only writes announcement audit rows in the same transaction; stronger typed audit targets should be handled when more admin action domains are added. |

## Verification Evidence

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm audit --prefix apps/api --audit-level=moderate` | PASS, 0 vulnerabilities |
| `npm audit --prefix apps/web --audit-level=moderate` | PASS, 0 vulnerabilities |
| Docker Compose production rebuild/restart | PASS |
| API `/health` | PASS, `status: ok` |
| Web homepage HTTP 200 | PASS |
| `/favicon.svg` HTTP 200 | PASS |
| Normal user access to `/admin/users` | PASS, HTTP 403 |
| Non-forced bootstrap password replacement | PASS, new env password rejected with HTTP 401 |
| Existing admin login after restart | PASS, role `admin` |
| Admin user list | PASS |
| Announcement create/list | PASS |
| Invalid announcement `status` | PASS, HTTP 400 |
| Announcement audit log | PASS, exactly 1 `announcement_created` row |
| Browser admin login and `/admin` workflow | PASS |
| HttpOnly session cookie | PASS |
| Browser console and HTTP resource errors | PASS, 0 errors |
| Mobile horizontal overflow | PASS, false |

## Screenshots

- `.gstack/qa-reports/artifacts/t04-admin-review-qa-desktop.png`
- `.gstack/qa-reports/artifacts/t04-admin-review-qa-mobile.png`

## Worker Workshare

Codex GPT-5.3-Codex-Spark worker performed a read-only sidecar review of the scoped T04 files. Codex accepted the bootstrap reset and admin proxy cookie findings, fixed them locally, and treated the polymorphic audit FK concern as a future audit-model hardening item rather than a T04 blocker.
