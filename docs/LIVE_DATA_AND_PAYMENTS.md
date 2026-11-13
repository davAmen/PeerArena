# Live data and Mobile Money architecture

**Current state:** all sports data and balances are synthetic. No payment provider, wallet, PIN, OTP, bank account or withdrawal route is connected.

## Live-data adapter

The target adapter boundary is:

```text
Licensed provider webhook/poll
        ↓ signature + schema validation
Provider snapshot store + payload hash
        ↓ freshness / event identity / correction checks
Market state machine
        ↓ review window + rule version
Settlement service → ledger transaction → notification
```

`GET /api/live` exposes the current synthetic live fixtures for the demonstration. Production adapters must verify provider signatures, reject stale or out-of-order updates, preserve raw evidence, suspend affected markets on feed failure, and use deterministic server-side rules. AI may flag anomalies but cannot be the sole source of a financial result.

## Payment adapter

Use a provider abstraction for approved MTN Mobile Money, Telecel Cash, AT Money, bank and other methods only after the provider expressly approves the gaming use case and the legal/payment structure is cleared.

```text
Customer intent
  → eligibility + limit + fraud check
  → provider authorization / wallet ownership
  → signed provider callback
  → idempotent payment attempt
  → double-entry ledger
  → reconciliation report
```

Never request or store a Mobile Money PIN. Do not disguise gambling transactions as ordinary retail activity. Store provider references and statuses, not unnecessary credentials. Every deposit, reservation, refund and payout uses integer minor units, a unique idempotency key, provider confirmation and reconciliation.

## Sandbox roadmap

1. Define provider contracts, approved use case and flow-of-funds diagram.
2. Add a sandbox-only adapter with fake provider callbacks and signed fixtures.
3. Test duplicate callbacks, timeouts, retries, reversal, insufficient liquidity and reconciliation breaks.
4. Keep the feature flag off by default and ensure the demo cannot create redeemable value.
5. Activate only after licensing, safeguarding, provider and independent security approvals.
