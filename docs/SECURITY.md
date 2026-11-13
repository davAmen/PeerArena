# Security architecture and controls

## Security posture

The current demo is safe-by-boundary rather than production-secure: it has no real accounts, secrets, payments or persistent customer data. The repository now enforces a hardened HTTP baseline and repeatable security checks, but production still requires the external controls and independent review listed below. See `docs/SECURITY_MONITORING.md` for the monitoring and alerting boundary.

## Threat model

| Threat | Example | Primary controls |
| --- | --- | --- |
| Account takeover | Credential stuffing, SIM swap, session theft | MFA, risk-based login, recovery controls, device/session revocation |
| Client tampering | Altering stake, side, outcome or balance in browser | Server-authoritative validation, signed/session-bound commands, ledger recomputation |
| Double settlement | Retry, queue duplication or webhook replay | Idempotency keys, unique settlement constraint, transactional row locks |
| Collusion/manipulation | Coordinated accounts or fabricated result | KYC linkage, graph/risk signals, licensed data, human review, dispute trail |
| Money laundering | Mule accounts, rapid circular flows, high-value coordinated bets | CDD/EDD, sanctions, velocity rules, transaction monitoring, case management |
| Insider abuse | Admin changes fee or resolves in favor of an account | RBAC, MFA, maker-checker approval, immutable audit, separation of duties |
| Data breach | Identity, location, payment or responsible-play data exposed | Minimize, encrypt, isolate, access review, DLP, retention limits |
| Provider failure | Stale or contradictory score/result | Suspension, freshness checks, provider quorum/review, void policy |
| Denial of service | Marketplace flood or settlement queue exhaustion | WAF/rate limits, queue isolation, backpressure, autoscaling, runbook |
| Abuse of responsible-play gaps | Self-excluded user returns with duplicate account | Identity matching, exclusion propagation, device/behavior signals, support review |

## Required controls

- OIDC/managed authentication, strong password policy, MFA for users and mandatory MFA for staff.
- RBAC with least privilege and separate roles for support, trading, compliance, finance, engineering and release approval.
- Step-up authentication and dual approval for fee/rule changes, refunds, reversals, settlement overrides and customer-funds operations.
- TLS in transit; envelope encryption and managed keys at rest; separate production secrets from code and logs.
- Secret manager with rotation, expiry, access audit and break-glass process.
- Strict input validation, output encoding, parameterized queries and CSRF/origin controls.
- Security headers: CSP, HSTS in production, no-sniff, frame-ancestors, secure cookies, same-site cookies and referrer policy.
- Request correlation IDs, bounded HTTP timeouts/header sizes/body sizes and production Origin checks for browser mutations.
- Rate limits by IP, account, device and endpoint; abuse monitoring and progressive challenges.
- Immutable or append-only audit storage with hash chaining or signed archive export.
- Backups encrypted, access-controlled and restore-tested; documented RPO/RTO.
- Dependency scanning, SAST, DAST, container scanning, SBOM and signed build artifacts.
- Independent penetration test and remediation verification before launch.
- Automated `npm run security:check`, dependency audit and scheduled CI scans; CI status is not a substitute for runtime monitoring or independent testing.

## Financial integrity

The ledger must be double-entry. A reservation moves value between customer available and customer reserved accounts; it is not revenue. A payout moves the reserved pool to the winner. A void creates balanced releases/refunds. A fee, if legally authorized, is a separate disclosed entry using a versioned rule. Every command is transactional, idempotent and reconciled against the approved payment provider.

## Administrative security

Admin consoles must be private, authenticated, MFA-protected and audited. Production must not expose a reset endpoint. Settlement overrides require a reason, evidence link, second approver and notification to compliance. Emergency access is time-bound and reviewed after use.

## Privacy and retention

Collect the minimum identity, location, device, payment and behavior data needed for a stated purpose. Encrypt or tokenize high-risk fields, separate identity evidence from public profile data, enforce retention schedules, and support approved data-subject rights without deleting immutable financial/regulatory evidence.

## Security test gates

Before real-money integration, test authorization bypass, state transitions, duplicate callbacks, race conditions, ledger balancing, self-exclusion propagation, geo enforcement, stale provider data, PII leakage, secret exposure, backup restore, incident alerting and recovery from a partial payout failure.
