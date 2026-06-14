# QA Report - localhost:3000 - 2026-06-14

## Summary

- Target: `http://127.0.0.1:3000/`
- API target: `http://127.0.0.1:3001/health`
- Framework: Next.js frontend, NestJS/Fastify backend, Docker Compose runtime
- Scope: T01/T02 scaffold verification plus current UI shell
- Final health score: 100/100 for current scaffold scope
- Issues found: 2
- Issues fixed: 2 verified
- Deferred issues: 0
- GitHub repository: `https://github.com/ZH-claude/-.git`

## Commands Run

| Check | Result |
| --- | --- |
| `npm run install:all` | Passed, 0 vulnerabilities during install audits |
| `npm run build` | Passed |
| `npm run typecheck` | Passed when run serially after build |
| `npm audit --prefix apps/api --audit-level=moderate` | Passed, 0 vulnerabilities |
| `npm audit --prefix apps/web --audit-level=moderate` | Passed, 0 vulnerabilities |
| `docker compose -p nested-api-relay config --quiet` | Passed |
| `docker compose -p nested-api-relay up --build -d` | Passed |
| `curl http://127.0.0.1:3001/health` | Passed, HTTP 200 |
| `curl http://127.0.0.1:3000/` | Passed, HTTP 200 |
| Browser desktop QA at 1280x720 | Passed after fixes, no console errors |
| Browser mobile QA at 375x812 | Passed after fixes, no horizontal overflow, no console errors |
| Sensitive scan for real passwords/API keys | Passed, only placeholders/default examples matched |

## Issue 001 - Ant Design Shell Rendered Like Bare HTML

- Severity: High
- Category: Visual / UX
- Status: Verified fixed
- Evidence before: `.gstack/qa-reports/screenshots/home-desktop.png`
- Evidence after: `.gstack/qa-reports/screenshots/home-desktop-final-verified.png`
- Root cause: Ant Design component CSS was not reliably available in the Next.js app shell. Menu, card, statistic, and tag components rendered without enough visual styling.
- Fix: Imported Ant Design CSS and added local scaffold fallback CSS for the current shell page.
- Files changed:
  - `apps/web/app/layout.tsx`
  - `apps/web/app/globals.css`
- Verification:
  - Desktop screenshot shows visible menu labels, card framing, readable stats, and stable header.
  - Browser console returned no errors or warnings.

## Issue 002 - Mobile Layout Had Horizontal Overflow

- Severity: Medium
- Category: Responsive UX
- Status: Verified fixed
- Evidence before: `.gstack/qa-reports/screenshots/home-mobile-final.png`
- Evidence after: `.gstack/qa-reports/screenshots/home-mobile-final-fixed.png`
- Root cause: The scaffold fallback CSS forced the sidebar to 224px at all breakpoints, leaving too little width for the 375px mobile viewport.
- Fix: Added a mobile breakpoint that collapses the sidebar to a 72px icon rail, hides sidebar text, and reduces page/header padding.
- Verification:
  - Browser-reported `clientWidth=375`, `scrollWidth=375`, `hasHorizontalOverflow=false`.
  - Browser console returned no errors or warnings.

## Runtime Evidence

- Docker services:
  - `nested-api-relay-api-1`: Up
  - `nested-api-relay-web-1`: Up
  - `nested-api-relay-postgres-1`: Up and healthy
  - `nested-api-relay-redis-1`: Up and healthy
- API response:
  - `{"status":"ok","service":"nested-api-relay-api", ...}`
- Web response:
  - HTTP 200
- Container log scan:
  - No `error`, `exception`, `failed`, or `unhandled` entries found in recent API/Web logs.

## Notes

- The strict gstack `/qa` workflow requires an `AskUserQuestion` tool that is not exposed in this environment. I ran the practical equivalent validation path directly and recorded evidence here.
- The first failed `typecheck` happened because `typecheck` and `build` were run in parallel, creating a temporary race in `.next/types`. Running them serially passed.
- Root `npm audit` is not applicable because the root package has no root `package-lock.json`; audits were run against `apps/api` and `apps/web`, where the lockfiles exist.
- The repository is public. No real `.env`, database password, upstream API key, or token was committed.

