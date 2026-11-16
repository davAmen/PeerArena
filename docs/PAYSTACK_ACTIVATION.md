# Paystack activation handoff

Historical reference only: on 2026-11-16 the operator replaced Paystack with SeevCash and instructed us to avoid Paystack. Do not continue the Paystack account, authenticator recovery or key setup for this project. Follow [SeevCash setup](SEEVCASH_SETUP.md) instead. The instructions below document the earlier implementation, not the current provider choice.

The operator confirmed Paystack as the payment provider and Ghana (GH) as the operating country on 2026-11-14. Real-money activation is incomplete. The repository remains a protected synthetic pilot; this operating-country decision does not establish gaming authorization or provider approval.

## Completed and tested

- Server-side Paystack initialization, verification and HMAC-SHA512 webhook signature checking.
- Sandbox collection rejects live or malformed keys before any network call.
- Verification requires an API-success response, test domain, exact transaction reference, safe positive integer amount, valid currency and recognized transaction status.
- Expected-transaction verification compares the server's expected amount and currency, returns a redacted observation and explicitly reports fundsCredited=false.
- Provider deadlines cover response headers and bodies. Errors do not expose provider payloads or credentials.
- A read-only operator command verifies an existing test transaction; it does not create a collection, save an event, credit a balance or initiate a payout.

These checks follow the response fields and distinction between API and transaction status in [Paystack verification documentation](https://paystack.com/docs/payments/verify-payments/). Idempotent fulfillment still requires durable storage.

## Run an existing sandbox transaction check

Inject these settings into an isolated staging process using the secret manager:

- APP_ENV=staging
- PAYMENT_MODE=sandbox
- PAYMENT_PROVIDER=paystack
- REAL_MONEY_ENABLED=false
- PAYSTACK_SECRET_KEY: the account's test secret, never a live key

Then run:

```text
npm run payments:verify -- YOUR_TEST_REFERENCE 5000 GHS
```

Supply the actual expected amount in minor units and currency from the original test attempt. The example uses GHS for the Ghana operating scope; verify it against the original attempt. Exit code 0 means matching test SUCCESS; 2 means matching but pending, failed or reversed; 1 means invalid configuration/input, provider error or mismatch. A successful check is not proof of durable reconciliation, eligibility, funding or production readiness.

## Remaining engineering and evidence

| Work | Dependency / acceptance evidence |
| --- | --- |
| Exercise Paystack test-account verification | Test secret through secret manager plus an existing test reference and expected amount/currency. Neither is available in this runtime. |
| Apply and exercise database migrations | Isolated private PostgreSQL URL, verified TLS configuration and migration/runtime roles. No URL or local PostgreSQL/Docker/Podman tooling is available here. |
| Implement durable payment attempts, webhook inbox and reconciliation | Private database with transaction tests: exact ownership/reference/amount/currency, unique event and reference constraints, concurrent duplicate delivery, reordered events, uncertain transport outcomes, replay and reversal handling. Do not credit funds from a redirect or this operator command. |
| Connect production identity and customer eligibility | Reviewed first-party identity mapping, age/KYC/jurisdiction and self-exclusion decisions for Ghana. Operating country is confirmed; eligibility rules and approval evidence still require review. |
| Production collections, withdrawals and winner payouts | Reviewed authoritative ledger and reconciliation implementation, destination ownership and verification, provider approval covering the actual betting model and payout capability, safeguarding and operational authorization. Existing adapters and public routes do not implement these. |
| Operational readiness | Shared rate limiting/WAF, central alerts and incident ownership, backup/restore and independent security review evidence. |

Current evidence is local automated testing with injected provider responses. No real Paystack transaction, PostgreSQL execution, production deployment or approval verification was performed in this change. No approved document location or infrastructure location was supplied.
