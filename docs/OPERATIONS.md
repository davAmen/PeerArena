# Deployment and operating procedures

## Local demonstration

```powershell
npm install
npm test
$env:PEERARENA_PORT = "4174"
npm start
```

The demo is a single Node process with static assets and in-memory state. Restarting it resets all synthetic activity. Never point a real customer or payment provider at this process.

## Production deployment outline (not enabled)

1. Build a pinned, reproducible Node container from a reviewed lockfile.
2. Run unit, integration, reconciliation, concurrency, security and accessibility tests.
3. Scan dependencies, image, SBOM and secrets; require signed artifact promotion.
4. Deploy API workers behind WAF/load balancer with private database and queue networks.
5. Apply database migrations with backup and rollback plan.
6. Configure secrets via managed secret store; never use `.env` in source control.
7. Enable centralized logs, metrics, traces, alerts and audit archive.
8. Run smoke tests for health, authentication, eligibility, create, accept, suspend, settle, void and reconciliation.
9. Require release approval from engineering, security, compliance and operations.
10. Roll out to an approved jurisdiction and market allowlist only.

## Settlement operating procedure

1. Confirm event completion from the licensed provider.
2. Confirm provider freshness, event identity, market rule version and no contradictory feed.
3. Keep the challenge in `AWAITING_VERIFICATION` through the configured review window.
4. Run automated integrity, eligibility, fraud and dispute checks.
5. If all checks pass, create one idempotent settlement transaction and balanced ledger entries.
6. Notify both participants with result, gross pool, approved deduction, net payout/refund and reference.
7. If data is stale, contradictory or disputed, suspend and route to the review queue; do not guess.
8. Reconcile provider result, internal settlement, ledger and payment status.

## Daily operations

- Review error budget, queue age, provider freshness, reconciliation breaks and failed notifications.
- Review self-exclusion, limit, suspicious-activity and complaint queues.
- Verify backups and audit ingestion.
- Review privileged actions and unusual admin behavior.

## Incident runbook

### Suspected ledger or payout defect

Immediately suspend affected market/actions; do not manually edit balances. Preserve logs, request IDs, provider payload hashes and audit evidence. Reconcile the affected challenge and ledger accounts, open an incident, notify finance/compliance, and use a maker-checker correction or void path only after review.

### Provider discrepancy

Suspend settlement for the event/market, record both snapshots, contact the provider through the contract channel, and apply the published void/dispute rule. Do not use social media or an unverified third-party result as settlement evidence.

### Account or AML concern

Restrict risky actions under policy, preserve evidence, open a compliance case, avoid tipping off where prohibited, and follow the MLRO/reporting procedure.

### Security incident

Contain access, rotate affected secrets, preserve forensic evidence, assess affected data, notify the incident owner/DPO/counsel and follow applicable notification requirements. Restore only from verified artifacts.

## Change management

Market definitions, settlement rules, fee configuration, jurisdiction policy, payment routing and responsible-play controls require versioned changes, testing, approval, effective timestamp, rollback plan and audit record. A code deploy must not silently alter accepted challenges.
