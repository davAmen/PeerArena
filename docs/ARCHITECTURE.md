# Application architecture

## Design principles

1. Server-authoritative: the device never decides an outcome, payout or balance.
2. Ledger-first: every value movement is an immutable double-entry transaction.
3. Rule immutability: accepted terms and settlement rules are versioned and cannot be rewritten.
4. Compliance by jurisdiction: availability, market scope, limits and payment methods are policy decisions, not UI toggles.
5. Fail closed: stale, contradictory or unavailable data suspends settlement.
6. Safety is a first-class feature: controls cannot be hidden behind an active wager.
7. Explainability: every material decision has a stable reference and audit event.

## Target production topology

```text
Client web/mobile
        |
   Edge/WAF/CDN
        |
API gateway ─── Identity/KYC/geo policy
        |
Application services
  ├─ User and profile service
  ├─ Market catalogue and event service
  ├─ Challenge/matching service
  ├─ Ledger and funds reservation service
  ├─ Settlement and dispute service
  ├─ Responsible-play service
  ├─ Compliance/AML case service
  ├─ Notification service
  └─ Admin/control service
        |
PostgreSQL ─ Redis/jobs ─ Object storage/audit archive
        |
Licensed data providers / authorized PSP or EMI / KYC vendors
```

The current demo collapses these boundaries into one Node process and in-memory state so it can be inspected easily. It intentionally has no external integration credentials.

## Service responsibilities

| Service | Responsibility | Must not do |
| --- | --- | --- |
| Identity | Authentication, MFA, sessions, recovery, verified identity link | Decide a sporting result |
| Eligibility | Age, country, geo, licence and exclusion checks | Override a legal policy from the client |
| Market catalogue | Approved events, market definitions, close times and rules | Enable arbitrary admin-entered markets |
| Challenge | Create, publish, accept, cancel and suspend challenges | Mutate accepted terms |
| Ledger | Double-entry reservations, releases, payouts and reconciliation | Accept client-supplied balances |
| Settlement | Provider confirmation, review window, outcome decision and idempotency | Settle on stale/contradictory data |
| Responsible play | Limits, time-outs, self-exclusion and statements | Encourage higher stakes |
| Compliance | KYC, AML, sanctions, suspicious activity, complaints and evidence | Delete immutable audit evidence |
| Admin | Separation-of-duties workflows and operational controls | Bypass approval gates silently |

## Challenge state machine

`CREATED` is a draft. `AWAITING_ACCEPTANCE` exposes the published terms. A compatible opposing prediction creates `MATCHED`, then both reservations must be confirmed before `FUNDS_CONFIRMED`. The event then becomes `ACTIVE`. Once the provider reports completion, the challenge enters `AWAITING_VERIFICATION`; a policy-approved result moves it to `SETTLED`. Invalid, cancelled or unresolved events move to `VOIDED`/`REFUNDED` or `DISPUTED`. Every transition records actor, reason, previous state, next state, timestamp, rule version and request id.

## Ledger and consistency

- Use PostgreSQL transactions with row locks on the challenge and ledger accounts.
- Require an idempotency key for create, accept, settle, refund and payment callbacks.
- Enforce `sum(debits) = sum(credits)` per ledger transaction.
- Treat reservations as liabilities, not platform revenue.
- Store provider event/result payload hashes and the exact settlement rule version.
- Reconcile internal ledger, PSP reports and bank/safeguarding reports on a scheduled cadence.

## Real-time and background work

WebSockets or server-sent events can deliver market/status updates, but all commands remain ordinary authenticated API requests. Redis-backed jobs handle provider polling, discrepancy checks, settlement review windows, notifications, reconciliation and case queues. A queue retry must be idempotent and must not duplicate a payout.

## AI boundaries

AI may explain published rules, triage support and flag patterns for human review. It may not invent official results, change market terms, approve a payout, bypass KYC/AML, target vulnerable users or override the settlement engine. Any model-assisted signal is stored with model/version, inputs, confidence, reviewer and final action.

## Observability

Capture structured logs with correlation ID, actor, challenge ID, ledger transaction ID and provider event ID. Metrics include acceptance latency, suspended markets, settlement age, reconciliation breaks, payout failures, chargebacks, self-exclusion blocks, suspicious-activity cases and error budget. Never put identity documents, secrets, full payment credentials or unnecessary personal data in logs.
