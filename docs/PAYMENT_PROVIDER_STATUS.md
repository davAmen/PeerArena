# Payment provider status

Status after the sandbox adapter milestone: real-money collection, customer-fund custody and payouts remain disabled.

The activation gate explicitly reports that production payment processing, reconciliation and payouts are not implemented. Setting every approval flag cannot make this release report ready for real-money use. Completing those implementations and reviewing their evidence is a separate engineering prerequisite.

Sandbox provider requests keep their deadline active through response-body consumption, including verification calls. Timeouts return a sanitized 503; an interrupted verification must not be treated as a confirmed payment or automatically retried as a new collection. Injected deadlines must be integers between 1 and 30,000 milliseconds.

## Current code boundary

`src/backend/payments.mjs` provides three explicit provider choices:

- `MockPaymentProvider` works without credentials and supports idempotent simulated collection, verification, delayed and failed outcomes, duplicate webhook events, reconciliation, and simulated payout states.
- `SeevPlusProvider` implements the documented sandbox checkout creation, server-side verification and signed webhook verification boundary. It is enabled only when `PAYMENT_MODE=sandbox`, a Seev Checkout API key and webhook secret are supplied, the app is not production, and `REAL_MONEY_ENABLED=false`.
- `PaystackProvider` implements the documented sandbox/test transaction initialization, server-side verification and HMAC-SHA512 webhook verification boundary under the same fail-closed sandbox conditions.

Both external adapters explicitly report `payout: false`. No provider API call can create a winner payout from this repository until written provider approval, safeguarding controls, a reviewed payout-destination/KYC flow and an atomic authoritative ledger procedure exist.

The public demo API still keeps `/api/payments/checkout` and provider webhooks disabled. The adapters are a tested server-side integration boundary, not a claim that a sandbox account, payment contract or durable payment-event store is connected. A future route may use them only after adding durable payment-attempt and webhook-event persistence with idempotent reconciliation.

## Verified provider behavior implemented

SeevPlus's [Checkout API](https://docs.seevcash.com/docs/payments/checkout) uses `POST https://api.seevplus.com/api/v1/developer/payments`, integer smallest-unit amounts, a backend Bearer key, a stable `Idempotency-Key`, and `GET` verification by session reference. The adapter treats redirects as untrusted and only treats a verified completed/success status as paid.

SeevPlus's [webhook documentation](https://docs.seevcash.com/docs/developer/webhooks) requires the raw request body and documents `X-Seev-Timestamp` plus `X-Seev-Signature` as `v1=` HMAC-SHA256 over `timestamp + "." + rawBody`. The adapter compares signatures in constant time and rejects timestamps outside a five-minute replay window.

Paystack's [Accept Payments documentation](https://paystack.com/docs/payments/accept-payments/) requires server-side initialization at `POST https://api.paystack.co/transaction/initialize` with a secret Bearer key and smallest-unit amount. [Verify Payments](https://paystack.com/docs/payments/verify-payments/) requires server-side verification by transaction reference. [Webhooks](https://paystack.com/docs/payments/webhooks/) documents HMAC-SHA512 of the exact raw payload using `x-paystack-signature`; the adapter implements that check before any future event processing.

## Why payout remains blocked

Provider payment collection and ordinary merchant settlement are not the same thing as authorized individual winner disbursement. Paystack states that gambling-related activity requires prior approval and permitted jurisdictions; its [restricted-business guidance](https://support.paystack.com/en/articles/2127042) must be reviewed with the provider. SeevPlus's [payout documentation](https://docs.seevcash.com/docs/payments/payouts) describes organizational payout schedules, which is not by itself approval for PeerArena winner payouts.

## Safe sandbox configuration

Use only a private local/staging environment, never production:

```text
APP_ENV=staging
PAYMENT_MODE=sandbox
PAYMENT_PROVIDER=paystack        # or seevplus
REAL_MONEY_ENABLED=false
```

Supply the provider's sandbox/test secret and webhook secret through the deployment secret manager. Do not place them in `.env.example`, client code, logs, Git or Vercel preview variables shared with production. The current Vercel deployment remains on `PAYMENT_MODE=mock` and has no provider credentials.

## Required access before production activation

1. Provider sandbox accounts and test credentials for the selected product(s).
2. Written confirmation that the proposed Ghana P2P prediction/betting model is permitted.
3. Written confirmation of collection, safeguarding, reconciliation and individual payout capabilities.
4. Provider webhook registration and a test delivery for each product.
5. A reviewed payout-destination/KYC flow and approved funds-control procedure.
6. Durable payment-attempt and webhook-event storage with replay, ordering and reconciliation tests.
7. A production authorization record satisfying every gate in `src/backend/config.mjs`.

Until then, `PAYMENT_MODE=mock`, `PAYMENT_PROVIDER=mock`, `MOCK_PAYMENTS_ENABLED=true`, and `REAL_MONEY_ENABLED=false` remain the supported live-demo defaults.
