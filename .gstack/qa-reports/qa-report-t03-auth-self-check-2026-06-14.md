# QA Report - T03 Auth Self Check

Date: 2026-06-14

Scope: T03 account/authentication foundation. Covered registration, login, session handling, account profile, password change, logout, Docker startup mode, and deploy-facing auth configuration.

## Review Findings

| Severity | Finding | Result |
| --- | --- | --- |
| Medium-high | Browser session token was exposed to frontend code and previously stored through localStorage. | Fixed with HttpOnly Cookie plus same-origin `/api/auth/*` proxy. |
| Medium | Soft-deleted users could keep using an unexpired session. | Fixed by rejecting sessions whose user has `deletedAt`. |
| Medium | Docker Compose ran API and Web in dev mode, not production mode. | Fixed by building production artifacts in the image and starting `node dist/main.js` / `next start`. |
| Low | Typecheck depended on `DATABASE_URL` being present because Prisma config used a required env helper. | Fixed with a non-secret placeholder fallback for generate/typecheck/build only. |

## Fixes Applied

| Area | Change |
| --- | --- |
| API session transport | `register` and `login` set `nested_api_relay_session` as HttpOnly Cookie and no longer return token to the browser response. |
| API guard | Auth guard accepts bearer for direct API compatibility, then falls back to the session Cookie. |
| Frontend auth | Frontend auth client uses same-origin `/api` and `credentials: include`; localStorage session helpers were removed. |
| Next proxy | Added `/api/auth/[...path]` server route to proxy auth calls to `INTERNAL_API_BASE_URL` and forward `Set-Cookie`. |
| Deployment | Dockerfile now runs `npm run build`; Compose uses production start commands. |
| Configuration | Added `SESSION_COOKIE_SECURE`; local HTTP keeps false, production HTTPS should set true. |

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run build` | Passed |
| `npm audit --prefix apps/api --audit-level=moderate` | Passed, 0 vulnerabilities after clearing dead local proxy env |
| `npm audit --prefix apps/web --audit-level=moderate` | Passed, 0 vulnerabilities after clearing dead local proxy env |
| `docker compose -p nested-api-relay up --build -d` | Passed |
| Docker logs | API started with `node dist/main.js`; Web started with `next start -p 3000` |
| API flow | Passed: register, duplicate 409, me, change password, old password 401, logout revoke, new password login |
| Malformed cookie | Passed: invalid percent-encoded session Cookie returns HTTP 401 |
| Browser flow | Passed: register to account, HttpOnly cookie present, change password, logout, new password login |
| Responsive check | Passed: 390px viewport had no horizontal overflow |
| Dev-mode check | Passed: no Next dev tools badge in production container |
| Secret scan | Passed: user login password and database password were not found in tracked repo content |

## Artifacts

| Artifact | Path |
| --- | --- |
| Desktop account screenshot | `.gstack/qa-reports/artifacts/t03-account-desktop.png` |
| Mobile account screenshot | `.gstack/qa-reports/artifacts/t03-account-mobile.png` |

## Residual Risk

No blocking T03 issue remains. Before public cloud deployment behind HTTPS, set `SESSION_COOKIE_SECURE=true`.
