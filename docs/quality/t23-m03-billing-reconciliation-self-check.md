# T23 M03 Billing Reconciliation Self-Check

Status: local real-flow check and hard release-gate entry added; production verification is still blocked by missing T21 external inputs.

## Scope

- Promote `npm run qa:t23:billing-reconciliation`, `npm run qa:t23:route-metering`, `npm run qa:t25:stream-billing-guard`, `npm run qa:t26:payment-orders`, and `npm run qa:t27:model-experience` into the release gate.
- Strengthen the T23 route metering QA so a failed upstream request remains traceable but cannot debit a wallet.
- Document the remaining production boundary: no real server, DNS, production `.env`, real upstream key, or strict smoke account is available in the repository.

## Review

- Success path: the QA already verifies a real `/v1/chat/completions` call against a temporary HTTP upstream, then reconciles `x-request-id`, `x-usage-event-id`, `usage_events`, `wallet_transactions`, `request_logs`, wallet balance, and API-token used amount.
- Failure path: the QA now verifies a forced upstream HTTP failure creates a `FAILED` usage event and request log with the same `requestId`, `costCents=0`, no wallet transaction, and no fallback to the other single-route upstream.
- Stream-start guard: the QA verifies stream requests cannot begin without enough estimated balance and that stream guard estimates stay independent from model multipliers.
- Payment-order path: the QA verifies pending payment orders do not credit balances, unconfigured provider callbacks do not credit, admin-paid orders reconcile into wallet transactions and recharge records, and duplicate payment success is idempotent.
- Model-experience path: the QA verifies `/experience/models` uses route-level USD prices and `/experience/chat` routes through a real temporary upstream, creates or reuses the experience token, records usage/request logs, and debits the wallet using converted CNY cost.
- Release process: `qa_t23_billing_reconciliation`, `qa_t23_route_metering`, `qa_t25_stream_billing_guard`, `qa_t26_payment_orders`, and `qa_t27_model_experience` are now part of `npm run qa:release-gate`, so billing, relay, stream, model-experience, and payment-order changes cannot bypass these reconciliation checks.
- Hard gate contract: `billing_reconciliation_release_gate_covers_route_stream_payment_and_experience` proves the named M03 entry stays wired to route metering, stream-start balance guards, payment-order reconciliation, and model-experience wallet debit evidence.

## QA

Required validation for this slice:

- `npm run typecheck`
- `npm run qa:t23:billing-reconciliation`
- `npm run qa:t23:route-metering`
- `npm run qa:t25:stream-billing-guard`
- `npm run qa:t26:payment-orders`
- `npm run qa:t27:model-experience`
- `npm run qa:release-gate`

## Remaining Risk

- This is a local real-flow check using a temporary upstream. It proves the billing contract in the controlled local environment, but it does not prove production server, DNS, HTTPS, production `.env`, real upstream key, real payment, or real notification readiness.
- T23 overall remains incomplete until production strict smoke, production billing reconciliation, security review, operational drill, and launch decision evidence are all collected.
