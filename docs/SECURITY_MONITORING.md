# PeerArena security monitoring

## Controls committed in the repository

- The Node service emits a fresh `X-Request-ID` for every response.
- Production responses add HSTS; all environments use CSP, `object-src 'none'`, `form-action 'self'`, `frame-ancestors 'none'`, no-sniff, restrictive referrer and permissions policies, same-origin isolation headers, and `X-Robots-Tag: noindex, nofollow, noarchive` for the protected synthetic pilot.
- Production and Vercel-hosted browser mutations reject an untrusted `Origin` and fail closed when `NEXT_PUBLIC_APP_URL` is missing or invalid.
- HTTP header size, request timeout, header timeout, keep-alive timeout and JSON body size are bounded.
- 5xx responses use a generic message unless the error code is an explicitly safe configuration/boundary code; request IDs remain available for investigation.
- Runtime security events are normalized, redacted to pathname/method/status/code, assigned a severity, bounded to an in-process ring buffer and exposed only through the protected admin security view. That view returns bounded severity counts and a recent high/critical alert list. High/critical events also emit a `securityAlert` log signal for the attached runtime log sink. Query strings, bodies, authorization headers, IP addresses and provider payloads are not stored.
- The owned-database gate accepts only private operator-controlled PostgreSQL with an exact host allowlist and `verify-full` TLS; the hardening migration uses forced RLS and default-deny privileges.
- `npm run security:check` verifies headers, CSP directives, secret-file hygiene, default-deny real-money configuration and server hardening markers.
- CI runs the baseline and dependency audit on pushes and pull requests. A scheduled GitHub workflow repeats both checks every six hours after the repository is connected to GitHub.

## Alerting boundary

The repository cannot independently watch a deployed service every second or send a user notification without an attached runtime, log sink and notification channel. The current runtime emits high/critical `securityAlert` records and exposes bounded severity counts to the protected admin view; Vercel log retention and an owner-controlled notification sink are still required for durable alert delivery. Scheduled workflow failures become GitHub check/notification events according to the repository owner's GitHub notification settings. Full runtime alerting still requires a production WAF/host, centralized logs, metrics, traces, secret-rotation events and an approved PagerDuty/email/Slack escalation path.

Do not treat a green local check as proof of production security. Before any real-money consideration, add independent penetration testing, DAST, dependency/SBOM provenance, backup-restore evidence, incident drills, MFA for staff, WAF rules, anomaly detection, alert deduplication and a 24/7 escalation owner.

## Severity response

| Severity | Examples | Immediate action |
| --- | --- | --- |
| Critical | Secret exposure, auth bypass, ledger imbalance, unauthorized payout | Stop affected actions, revoke/rotate secrets, preserve evidence, open an incident and notify security/compliance owners. |
| High | Origin bypass, privilege escalation, repeated provider discrepancy, data exfiltration signal | Restrict the affected route or account cohort, investigate request IDs and logs, patch and require review before reopening. |
| Moderate | Dependency vulnerability, rate-limit exhaustion, suspicious login velocity | Triage within the operating SLA, apply a temporary control, update dependencies and record the remediation. |
| Low | Header drift, stale documentation, non-sensitive monitoring gap | Fix in the next controlled change and keep the security check green. |
