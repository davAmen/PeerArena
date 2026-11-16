# SeevCash setup handoff

Selected by the operator on 2026-11-16 in place of Paystack. Ghana remains the operating country. Paystack setup is cancelled for PeerArena; its existing adapter is retained as inactive historical code.

## Existing integration

The repository names its SeevCash Checkout adapter `SeevPlusProvider` and selects it with `PAYMENT_PROVIDER=seevplus`. It reads `SEEV_CHECKOUT_API_KEY` and `SEEV_WEBHOOK_SECRET` on the server. This naming is the existing implementation; do not substitute `seevcash` as a configuration value without updating the provider factory.

## Next connection step

Use the operator's SeevCash account to obtain explicitly non-production test credentials for the documented Checkout API. Confirm with the provider that the credentials and endpoint cannot move real funds before exercising the adapter: setting `PAYMENT_MODE=sandbox` alone does not establish that the remote account is a test account.

Store the test key and webhook secret directly in the isolated staging secret manager, never in chat, Git or client files. Prepare staging with `APP_ENV=staging`, `PAYMENT_MODE=sandbox`, `PAYMENT_PROVIDER=seevplus`, and `REAL_MONEY_ENABLED=false`. Do not change the production demo defaults.

No SeevCash account or secret is confirmed connected by this provider-selection change. Public checkout and webhook routes remain disabled. Durable payment attempts, webhook persistence, idempotent reconciliation, reviewed identity/eligibility and provider approval for the Ghana prediction/betting model remain prerequisites. Payments, payouts, withdrawals and synthetic-funds redemption remain blocked.
