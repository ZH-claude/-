# Language Catalog Self-Check

Scope: productized multilingual coverage for console language selection, public content localization, and backend announcement translation drafts.

## Locked Invariants

- `npm run qa:language-catalog` verifies the frontend language selector and backend default translation draft targets stay aligned.
- `user_entry_and_console_keep_language_selector_while_merchant_shell_has_none` verifies login/register/user console keep language switching while the merchant console does not expose a language selector.
- The console default language remains `zh-CN`.
- The language catalog keeps Japan and global English coverage through `ja-JP` and `en-US`.
- Backend announcement drafts target every supported language except the source `zh-CN`.
- RTL languages stay explicit in console direction metadata.
- VibeCoding package preset labels cover every supported console language.
- `chrome_user_notification_settings_localized_no_source_leak_smoke` verifies `/account/notificationSettings?language=es-ES` renders notification events, channels, delivery records, save action, and threshold copy in the selected language and fails on Chinese or English source-text leakage.
- `chrome_user_experience_localized_no_source_leak_smoke` verifies `/experience?language=es-ES` renders model experience controls, billing copy, balance, and localized model display names in the selected language and fails on Chinese source-text leakage.
- `chrome_user_recharge_localized_no_source_leak_smoke` verifies `/account/topup/recharge?language=es-ES` renders balance, recharge-code redemption, manual purchase instructions, contact notes, and recharge records in the selected language and fails on Chinese or English source-text leakage.
- `chrome_user_ai_recharge_localized_smoke` verifies `/ai-recharge?language=es-ES` renders merchant-published intro and VibeCoding daily/weekly product content in the selected language and fails on Chinese source-title leakage.
- `chrome_user_log_localized_no_source_leak_smoke` verifies `/log?language=es-ES` renders filters, summary, usage details, and the current-user Token leaderboard row in the selected language and fails on Chinese source-text leakage.
- `chrome_user_token_localized_no_source_leak_smoke` verifies `/token?language=es-ES` renders token filters, table headers, status, quota, and the seeded token row in the selected language and fails on Chinese source-text leakage.
- User/public content API helpers return localized fallback errors instead of raw backend `message` text.
- `npm run qa:release-gate` now requires `qa_language_catalog` before handoff.

## Current Result

This is a source-level QA guard. It does not claim professional human translation quality for every locale; it prevents product surfaces from drifting so a language cannot appear in one place while announcements or user-facing content silently miss it. It also does not prove real production availability; that requires a real public HTTPS deployment and production strict smoke evidence.
