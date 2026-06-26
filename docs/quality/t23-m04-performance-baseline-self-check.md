# T23 M04 Performance Baseline Self-Check

Date: 2026-06-25

## Scope

- Harden the local enterprise performance gate for the prelaunch checklist.
- Verify the 1000-user baseline covers more than login and dashboard reads.
- Keep production pressure testing explicitly blocked until real server, domain, production `.env`, upstream keys, and traffic entrypoints are available.

## Implementation Evidence

- `apps/api/scripts/t32-enterprise-performance-qa.ts` now seeds 1000 users with real sessions, wallets, API tokens, recharge records, usage events, request logs, upstream provider/model rows, model pricing, and model group access.
- The gate verifies:
  - one dashboard summary under the threshold;
  - 10 parallel merchant dashboard reads;
  - 1000 concurrent authenticated `/auth/me` reads;
  - 100 concurrent `/v1/models` reads through real bearer API keys;
  - 50 parallel `/usage/logs` reads scoped to seeded users;
  - one `/usage/logs/:requestId/trace` lookup proving both usage event and request log are linked.
- `apps/api/scripts/frontend-scale-qa.ts` now verifies the browser-facing pages remain capped: admin list endpoints clamp page size to 100, merchant user/request-log pages request 20-row pages, user usage logs default to 50 rows, token leaderboard requests 10 rows, and merchant dashboard renders capped summary lists instead of unbounded database rows.
- Cleanup now counts and removes request logs from seeded user IDs, token IDs, model name, upstream provider, and prefixed request IDs, plus model group access rows.

## QA Evidence

Command:

```powershell
$env:DATABASE_URL='postgresql://nested_relay:change-me@localhost:5432/nested_relay?schema=public'
npm run qa:release-gate
```

Result: passed. `qa:frontend-scale` is now included in the release gate and records `frontend_scale_pages_do_not_render_unbounded_1000_row_tables` as the browser-side scale guard.

Observed `qa:t32:enterprise-performance` timings:

| Check | Result |
| --- | ---: |
| seed 1000-user fixture | 2863ms |
| dashboard summary | 113ms |
| 10 parallel dashboard reads | 311ms |
| 1000 concurrent `/auth/me` reads | 4122ms |
| 100 concurrent `/v1/models` reads | 790ms batch / 784ms p95 |
| 50 parallel `/usage/logs` reads | 253ms batch / 247ms p95 |
| trace lookup | 20ms |

Residual cleanup after the T32 run was 0 for users, sessions, wallets, API tokens, usage events, request logs, wallet transactions, recharge codes, upstream providers, upstream models, model prices, and model group accesses.

## Review

- Accepted: the local gate now exercises real API keys, real database reads, user-scoped usage logs, trace linkage, sensitive-field checks, and zero-residual cleanup.
- Accepted: the frontend scale guard closes the previous browser responsiveness gap by preventing unbounded 1000-row table rendering on merchant/user log surfaces.
- Boundary: this is not a production load test. Real production pressure testing still requires deployed infrastructure, production environment variables, real upstream keys, and an approved external load-test target.
- Remaining risk: real browser performance under production traffic still needs deployed infrastructure and real traffic shape; locally, the release gate now covers both backend 1000-user access and capped browser-facing data surfaces.
