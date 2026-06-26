# T23 M06 Ops Rehearsal Self-Check

## Scope

This self-check covers the local dry-run guard for operations rehearsal. It does not execute a real production restore, Docker rollout, or rollback. Real recovery still requires a disposable production-like environment or explicit approval.

## Evidence Added

- `npm run qa:t23:ops-rehearsal` verifies the production operations scripts and compose contract.
- `npm run qa:release-gate` now requires `qa_t23_ops_rehearsal`.
- `release_gate_documentation_contract` requires the release documentation to keep naming the ops rehearsal guard.

## Required Invariants

| Area | Guard |
| --- | --- |
| Backup | `ops/backup/postgres-backup.sh` must create a custom-format `pg_dump` and a `.sha256` checksum. |
| Deploy | `ops/deploy/deploy.sh` must run preflight and backup before compose rollout, then migrate after services are up. |
| Rollback | `ops/deploy/rollback.sh` must require an explicit git ref and back up before checkout. |
| Restart | `ops/deploy/restart-verify.sh` must restart core services and wait for API health. |
| Smoke | `ops/smoke/t21-deploy-smoke.mjs` must fail strict mode when any required smoke step is skipped. |
| Compose | `compose.prod.yml` must keep restart policies, health checks, and persistent volumes. |

## Review Result

Local dry-run coverage is now sufficient to prevent accidental removal of critical production operations safeguards. This is not proof that production recovery works, because no real server, production `.env`, disposable restore target, or external DNS/HTTPS environment is available in the repository.
