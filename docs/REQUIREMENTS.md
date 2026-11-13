# Product requirements document

## Product boundary

PeerArena lets eligible users form two-person prediction challenges around objectively verifiable events. The demonstration validates the user journey and accounting logic with non-redeemable synthetic credits. Real-money operation, payments, withdrawals, licensed identity verification, live markets and external data are explicitly out of scope until the launch gates are complete.

## MVP goals

- Make a binary event market easy to understand before acceptance.
- Let a creator reserve a synthetic stake and publish a public or private challenge.
- Let another demo user accept the opposing side once.
- Keep event, market, side, stake, expiry and settlement terms immutable after matching.
- Show challenge state, gross pool, deductions and payout transparently.
- Record auditable challenge, ledger and responsible-play events.
- Provide an admin demonstration queue for settlement and operational visibility.
- Keep safety controls accessible even when new challenge actions are blocked.

## Explicit non-goals

- No purchase, transfer, redemption or exchange of demo credits.
- No deposits, withdrawals, cash-out, PSP, bank, mobile-money or card integration.
- No production authentication, KYC vendor, sanctions vendor or real identity store.
- No live or real-time market feed; fixtures are synthetic.
- No real-money fee, commission, tax calculation or customer-funds custody.
- No claim that the product is licensed, legal or commercially ready in any jurisdiction.

## User stories and acceptance criteria

### Browse

As a visitor, I can see that the environment is demo-only before I interact with a stake. The dashboard shows synthetic currency, no-deposit language and a safety route.

### Create

As a demo user, I can choose a supported event, binary market, side and stake within the demo limit; the server rejects unsupported markets, invalid amounts and self-excluded users. A successful creation reserves exactly one synthetic stake and writes an audit event.

### Accept

As a demo user, I can inspect both sides, stake, pool, expiry and settlement terms before accepting. The server accepts a challenge only once, requires the opposite side, reserves the second stake and moves the challenge to `FUNDS_CONFIRMED`.

### Settle

As an authorized demo operator, I can choose a valid winning side or void outcome for an eligible challenge. Settlement is idempotent, creates one payout/refund event, and cannot be repeated to create more synthetic balance.

### Safety

As a user, I can enable self-exclusion. Once enabled, new challenge creation and acceptance fail while responsible-play information remains available.

### Audit

As an operator, I can see a stable challenge identifier, ledger references, lifecycle state and audit entries for material actions.

## Initial market rules

The first catalogue uses two-person binary markets only:

- Football: total goals over/under 2.5; team-vs-team result represented as a two-side challenge.
- Basketball: team-vs-team result.
- Tennis: match winner.

The market definition includes an event ID, provider/source placeholder, start time, close time, outcome set, settlement rule, void rule and review state. A market is not enabled merely because an administrator can type a name.

## Lifecycle

`CREATED → AWAITING_ACCEPTANCE → MATCHED → FUNDS_CONFIRMED → ACTIVE → AWAITING_VERIFICATION → SETTLED`

Alternate terminal paths are `VOIDED → REFUNDED`, `DISPUTED`, and `CLOSED`. Suspension must stop new acceptance and settlement until the operator resolves the feed or integrity issue.

## Settlement rule

For two matched demo stakes:

```text
grossPool = creatorStake + accepterStake
demoCommission = 0
netPayout = grossPool - demoCommission
```

The demo never charges a platform fee. A production fee engine must disclose the exact fee before confirmation, apply only an approved configuration, and write an immutable versioned rule reference. If no valid winner exists, the market is voided and each reserved stake is refunded once.

## Phase roadmap

1. Legal feasibility and licensed-operator discovery.
2. Product, settlement-rule and data-provider design review.
3. Synthetic demonstration and usability testing.
4. Security, reconciliation, concurrency, dispute and failure testing.
5. Regulated integration only after written approvals.
6. Restricted authorized launch with small market scope and monitoring.

## Definition of done for a production candidate

The demo must be replaced or hardened with authenticated services, persistent double-entry ledger, authorization, licensed data, provider-approved payments, KYC/AML, jurisdiction rules, rate limits, idempotency, monitoring, backups, disaster recovery, independent security review and counsel-approved legal copy. The current repository is not that production candidate.
