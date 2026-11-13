# Verification and test plan

## Current automated coverage

`npm test` runs the demo-engine unit tests. The suite covers:

- non-redeemable demo mode and zero platform fee;
- binary prediction choices for supported markets;
- creator stake reservation and audit event;
- acceptance, matched pool and single settlement payout;
- void settlement and refund;
- self-exclusion blocking new challenges.

## Required pre-production suites

| Suite | Examples | Exit evidence |
| --- | --- | --- |
| Unit | Rule validation, fee math, state transitions, limits, voids | Green CI report |
| Integration | API/auth/DB/queue/provider adapters | Contract test report |
| Ledger | Balanced entries, reservation release, reconciliation | Zero-break report |
| Concurrency | Two accepts, duplicate settlement, retry storms | Idempotency and race report |
| Integrity | Stale feeds, contradictory results, provider outage | Suspension/void report |
| Fraud/AML | Multi-account, collusion, velocity, sanctions hits | Case workflow evidence |
| Responsible play | Self-exclusion, cooling-off, limits, marketing suppression | Safety test report |
| Security | AuthZ, injection, secrets, SSRF, session, headers, dependency scan | Remediation sign-off |
| Resilience | Backup restore, queue replay, partial payout, failover | RPO/RTO evidence |
| Accessibility | Keyboard, screen reader, contrast, focus, mobile layout | Accessibility review |
| Load | Marketplace browse, acceptance, settlement queue | Capacity report |
| Legal/compliance | Market allowlist, age/geo, copy, audit and complaints | Counsel/compliance approval |

## Release gates

No production-money release is complete until all high/critical findings are closed or formally accepted, the ledger reconciliation is clean, the launch checklist is signed, provider/payment contracts are active, and the approved jurisdiction/market allowlist is deployed.
