# Payment provider status

Status as of the Directive 3.0 implementation: real-money collection and payouts are disabled.

## Current code boundary

`src/backend/payments.mjs` provides three explicit provider choices:

- `MockPaymentProvider` works without credentials and supports idempotent simulated checkout, verification, webhook acceptance, reconciliation, completed payouts and status lookup.
- `seevplus` is represented by a disabled adapter boundary. It returns no collection or payout capability and throws rather than making an unverified network call.
- `paystack` is represented by a disabled adapter boundary with the same fail-closed behavior.

This prevents a missing credential from silently becoming a live transaction and prevents a provider's ordinary merchant settlement from being treated as a per-user winner payout.

## Verified documentation references

The [Seev Plus developer documentation](https://docs.seevcash.com/docs) documents backend checkout creation, server-side verification, webhooks and payout schedules. Its [Checkout API](https://docs.seevcash.com/docs/payments/checkout) specifies the developer checkout routes, integer smallest-unit amounts and idempotency header. Its [webhook documentation](https://docs.seevcash.com/docs/developer/webhooks) describes the delivery envelope. These documents do not by themselves approve PeerArena's proposed regulated use case or establish that individual winner disbursements are available; those capabilities require written commercial/provider confirmation.

The [Paystack API reference](https://paystack.com/docs/api/) documents REST payment operations, and [Paystack authentication](https://paystack.com/docs/api/authentication/) requires backend secret-key authentication and distinguishes test from live environments. Paystack test-mode availability, business approval, Ghana payment channels, transfer permissions, settlement arrangements and betting classification must be confirmed with the provider before any production integration is enabled.

## Required access before implementation can be activated

1. Provider sandbox accounts and test credentials for the selected product(s).
2. Written confirmation that the proposed Ghana P2P prediction/betting model is permitted.
3. Written confirmation of collection, safeguarding, reconciliation and individual payout capabilities.
4. Provider webhook signing rules and a test webhook delivery for each product.
5. A reviewed payout-destination/KYC flow and an approved funds-control procedure.
6. A production authorization record that satisfies every gate in `src/backend/config.mjs`.

Until then, `PAYMENT_MODE=mock`, `MOCK_PAYMENTS_ENABLED=true`, and `REAL_MONEY_ENABLED=false` are the only supported operating defaults.
