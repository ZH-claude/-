# T23 M02 Production Strict Smoke Readiness Self-Check

## Scope

This self-check covers production strict-smoke preparation. It does not execute a real production smoke test because no real server, DNS, production `.env`, real upstream key, real smoke account, real recharge code, or real notification channel is available in the repository.

## Evidence Added

- `npm run qa:t23:production-strict-smoke-readiness` verifies strict-smoke script and documentation invariants.
- `npm run qa:release-gate` now requires `qa_t23_production_strict_smoke_readiness`.
- `docs/deployment/cloud-server-deployment.md` documents the full strict-smoke input set.
- `docs/quality/production-strict-smoke-evidence-template.json` is the required production evidence artifact and stays blocked until a real `SMOKE_STRICT=true` run has zero skips and zero failures.

## Required Invariants

| Area | Guard |
| --- | --- |
| Required endpoints | `SMOKE_API_URL` and `SMOKE_WEB_URL` are required before the deploy smoke starts. |
| Strict behavior | `SMOKE_STRICT=true` fails when any smoke check is `skip` or `fail`. |
| Core flow coverage | Health, web home, login, token creation, models, request trace, chat, recharge, and notification checks remain in the script. |
| Real inputs | Username, password, model, chat enablement, API key, recharge code, and notification test flags stay documented. |
| No fake pass | Missing real account, model, upstream, recharge code, or notification channel is documented as `skip`, not a pass. |

## Review Result

The production strict-smoke path is prepared and protected from accidental weakening. Real production execution remains blocked until the external T21 inputs are provided and `SMOKE_STRICT=true` can run with zero skips and zero failures.
