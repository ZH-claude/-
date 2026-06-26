# T30 VibeCoding, Leaderboard, Phone Auth And Recovery Self-Check

Date: 2026-06-26

## Scope

- Verify VibeCoding packages preserve hour quota, quota window, token quota, and daily-package fields from merchant setup through user-visible products.
- Verify fulfilled VibeCoding package orders create a real entitlement ledger entry and repeated fulfillment stays idempotent.
- Verify the Token leaderboard is backed by real usage rows and stays visible to ordinary users.
- Verify phone-number login is wired without breaking username login.
- Verify password recovery as a safe local/QA reset-code loop while keeping the SMS provider pluggable.
- Harden the release gate so auth regressions fail automatically.

## Implementation Evidence

- VibeCoding products store `quotaHours`, `quotaPeriodDays`, and `tokenQuota` in the database and expose the same fields through admin and user product APIs.
- Daily VibeCoding package presets keep a one-day quota window, and weekly presets keep a seven-day quota window.
- When an admin marks a VibeCoding order as fulfilled, the API creates one `VibeCodingEntitlement` for the ordering user with the package hours, quota window, token quota, start time, expiry, and active status.
- Fulfillment is idempotent: the same order cannot mint duplicate entitlement rows.
- Recharge-code VibeCoding packages also redeem into the entitlement ledger, and user recharge records expose both package quota fields and the linked entitlement.
- Token leaderboard rows are derived from seeded usage events, sorted by total tokens, and preserve the current user's own row.
- `/auth/phone-login` reuses the existing password login path, so username and phone login share password validation, account status checks, session cookie behavior, and audit logging.
- Phone login, password recovery request, and reset attempts are rate limited by IP and action through `security_audit_logs`.
- Phone auth audit metadata stores a `phoneDigest`, not the raw phone number.
- `/auth/password-recovery/request` creates an expiring hashed recovery code for registered phone numbers, returns the same public message for unknown numbers, and only exposes `debugCode` outside production or when explicitly enabled.
- `/auth/password-recovery/reset` verifies the code, consumes it once, updates the password, marks the phone verified, and revokes existing sessions.
- The web login page exposes a phone-login mode, request-code step, verification-code/new-password step, local debug-code display, and same-page success feedback.

## QA Evidence

Command:

```powershell
$env:DATABASE_URL='postgresql://nested_relay:change-me@localhost:5432/nested_relay?schema=public'
npm run qa:t30:vibecoding
npm run qa:release-gate
```

Result: passed.

VibeCoding and leaderboard checks include:

- `admin_can_create_vibecoding_package_product`
- `admin_can_update_vibecoding_package_fields`
- `admin_can_create_daily_vibecoding_product`
- `user_product_list_exposes_daily_vibecoding_package_fields`
- `fulfilled_daily_vibecoding_order_creates_entitlement_ledger`
- `fulfilled_daily_vibecoding_order_entitlement_is_idempotent`
- `usage/token-leaderboard_is_sorted_by_totalTokens_desc`
- `token-leaderboard preserves unmasked current user row for own userId`
- `token-leaderboard includes seeded userB tokens`

New T30 auth checks include:

- `duplicate_phone_registration_is_rejected_without_session`
- `username_login_still_supported_alongside_phone_login`
- `password-recovery/request_does_not_enumerate_unknown_phone`
- `password-recovery/request_rejects_invalid_phone_number`
- `password-recovery/request_creates_local_debug_code_for_existing_phone`
- `password-recovery/request_rate_limits_repeated_requests`
- `password-recovery-reset_accepts_valid_local_debug_code`
- `password-recovery-reset_invalidates_old_password`
- `password-recovery-reset_allows_new_password_phone_login`
- `password-recovery-reset_consumes_code_once`
- `password-recovery-reset_marks_phone_verified_and_code_consumed`
- `password-recovery-reset_rate_limits_repeated_attempts`
- `phone_login_supported_via_auth_phone_login`
- `phone_login_rejects_wrong_password_without_session`
- `phone_login_rejects_unknown_phone_without_session`
- `phone_login_rate_limits_repeated_phone_attempts`

## Review

- Accepted: VibeCoding package setup now covers custom and daily package fields, including hours, quota window, and token quota.
- Accepted: fulfilled VibeCoding orders and VibeCoding recharge codes now create entitlement ledger rows instead of only displaying package metadata.
- Accepted: entitlement minting is idempotent, so repeated fulfilled status updates cannot double-issue hours.
- Accepted: the Token leaderboard is covered by real usage-event data and current-user visibility checks.
- Accepted: phone login is available and now covered by positive and negative QA paths.
- Accepted: password recovery now has a working local/QA reset-code loop, does not leak whether an unknown phone exists through the public message, and is covered by per-minute abuse limits.
- Boundary: production SMS delivery is still a provider integration point. `debugCode` must remain disabled in production unless explicitly enabled for a controlled environment.
