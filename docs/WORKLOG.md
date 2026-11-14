# PeerArena engineering worklog

This is the durable project record for security, persistence, verification and release decisions. Each completed engineering milestone must add a dated entry with its commit, validation evidence and remaining blockers. The companion local memory store keeps a short searchable pointer; this file is the repository reference.

## Completed milestones

| Date | Commit | Record | Evidence / boundary |
| --- | --- | --- | --- |
| 2026-11-13 | `b17bf8c` | Added process-local API rate limiting. | Limits are bounded and tested; production still needs edge/WAF controls. |
| 2026-11-13 | `d789487` | Added the fail-closed Supabase Auth adapter boundary. | No provider credentials means no authentication fallback. |
| 2026-11-13 | `581a8fb` | Added bearer session validation. | Tokens are validated through the provider boundary. |
| 2026-11-13 | `9bbfe0e` | Wired opt-in authentication routes. | Demo mode remains synthetic and separate. |
| 2026-11-13 | `72f3926` | Enforced Supabase-mode authentication and authorization boundaries. | Admin role is server-controlled. |
| 2026-11-13 | `7af4b0e` | Added the durable profile repository boundary. | Writes are server-only and allowlisted. |
| 2026-11-13 | `8abfaf9` | Added the durable challenge read boundary. | Public-state filtering and fail-closed persistence. |
| 2026-11-13 | `a4096a8` | Added the durable sports catalogue boundary. | Enabled/public projections only. |
| 2026-11-13 | `2711bc5` | Added read-only durable admin reporting. | No admin financial or challenge mutation. |
| 2026-11-13 | `3b6cdc3` | Hardened HTTP controls. | Request IDs, headers, origin checks, bounded timeouts, generic 5xx errors and scheduled security checks. |
| 2026-11-13 | `0cd3f5b` | Added bounded redacted runtime security telemetry. | 36 tests, security baseline, build and dependency audit passed; no bodies, credentials, query strings or IPs are retained. |
| 2026-11-13 | `78be3a2` | Added the first owned-PostgreSQL procedure boundary. | Narrow idempotent challenge creation with actor, market, self-exclusion, rule, expiry and audit checks; 39 tests pass. |
| 2026-11-13 | `d21008b` | Added the owned-database role bootstrap contract. | No credentials in source control; runtime/procedure/reporting roles are non-login, non-superuser, non-bypass-RLS with bounded sessions; 40 tests pass. |
| 2026-11-13 | `c49331d` | Connected the protected synthetic API to Vercel through `api/[...path].mjs`. | Production deployment `dpl_5rX3aQwc6rTgdzFRo4uGvCxpGig6` is READY; `/api/health` and `/api/state` smoke tests pass; real money and database remain disabled. |
| 2026-11-14 | `c66b699` | Added a secret-free readiness endpoint and stranger-friendly protected-pilot walkthrough. | Deployment `dpl_E4wATUAUk5ZyAbHaVqV6J7S8qdNb` is READY; `/api/readiness` confirms active frontend/API and gated database/auth/payment capabilities. |
| 2026-11-14 | `87bbb41` | Added verified SeevPlus and Paystack sandbox adapters and published the safe release. | 45 tests, build, security check, dependency audit and syntax checks pass; exact-unit requests, idempotency and raw-body HMAC verification are covered; deployment `dpl_2pcnoSB8pWvdboX3Qd7hLaH3TZek` is READY with `vercel_authentication`; live `/api/readiness` confirms payments/payouts disabled and real money blocked. |
| 2026-11-14 | `9ce02c0` | Added owned-PostgreSQL `accept_challenge` procedure boundary and published the safe release. | Synthetic-only atomic participant acceptance and ledger reservation with account locks, balance checks, idempotency and audit evidence; 46 tests pass; deployment `dpl_AH7Y8XNFLF3mnKBn2UnN1hVdUJQX` is READY with `vercel_authentication`; live `/api/readiness` confirms settlement/payout/provider paths remain blocked. |
| 2026-11-14 | `23b60f9` | Added trusted-worker-only synthetic settlement boundary. | New worker role and migration verify a closed/result-hashed synthetic market, refund void/no-winner pools or distribute winners through one balanced demo ledger transaction; 47 tests pass; provider payouts remain blocked. |

## Current database sovereignty milestone

Committed as `f13e6c7`; procedure boundaries added in `78be3a2` and `9ce02c0`; role bootstrap added in `d21008b`; Vercel API adapter added in `c49331d`; readiness surface added in `c66b699`.

The production database target is now explicitly self-hosted PostgreSQL operated on a private, owner-controlled network. The application accepts only `owned-postgres` or `disabled` as database modes. Production readiness requires an exact host allowlist and `verify-full` TLS. The demo remains in-memory with synthetic, non-redeemable balances.

The owned PostgreSQL hardening layer revokes public privileges, enables and forces RLS, keeps the API role away from direct tables, makes ledger/audit/provider evidence append-only, enforces currency and double-entry balance, and computes an audit hash chain under an advisory lock. This is a database foundation, not a claim that a production database has already been provisioned or connected.

The earlier Supabase adapter remains compatibility code from the prototype and is not the owned deployment path. It must remain unconfigured for the owned architecture. First-party authentication and reviewed transactional procedures are still required before a self-hosted production API can be enabled.

## 2026-11-14 launch-readiness audit

Active and verified: protected Vercel frontend, same-origin synthetic API, health/state smoke tests, security headers, rate limiting, redacted telemetry, demo challenge lifecycle, synthetic ledger/settlement rules, owned-PostgreSQL migration artifacts, and automated checks.

Still gated: private PostgreSQL provisioning, first-party authentication, HTTP wiring for the reviewed procedures, durable profile/participant persistence, settlement/refund/reconciliation procedures, shared WAF/rate limiting, centralized alerting, licensed event data, payment/payout integrations, KYC/age/jurisdiction controls, independent security review and all real-money operation. These are external systems or approvals, not safe configuration toggles. The Vercel project remains protected and the demo gate remains blocked.

## Non-negotiable safety boundaries

- Real-money operation, customer-fund custody, deposits, withdrawals, payouts and redeemable balances remain disabled.
- No database or provider credential belongs in source control, client code, logs or this worklog.
- No production deployment is considered complete without migration review, RLS tests, concurrency tests, encrypted backup/restore evidence, independent security review and an incident/alert channel.
- Every future change must append a record here and a searchable memory pointer after its commit.
