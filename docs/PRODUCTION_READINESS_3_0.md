# PeerArena production readiness checklist

## Implemented in the repository

- [x] Existing simulated-funds product experience preserved.
- [x] Local API route inventory covers the 3.0 contract.
- [x] Supabase schema migration with required domain tables, indexes, constraints and RLS foundation.
- [x] Financial amounts represented as integer minor units in the backend ledger and demo mutation paths.
- [x] Double-entry balance assertion and deterministic shared-pool distribution.
- [x] Idempotent mock collection and payout behavior with provider capability reporting.
- [x] SeevPlus and Paystack fail-closed provider boundaries; no unverified network call.
- [x] Default-deny real-money activation gate.
- [x] Local API sliding-window rate limiting with explicit `429` responses.
- [x] Fail-closed Supabase Auth adapter with mock-fetch contract tests.
- [x] Server-side bearer-session boundary with required/optional validation and safe logout mapping.
- [x] Explicit `AUTH_MODE=supabase` Auth route wiring with demo-mode default and fail-closed configuration handling.
- [x] Vercel static build configuration, security headers and CI workflow.
- [x] Automated lifecycle, settlement, ledger, provider and activation-gate tests.

## Blocked pending external access or approval

- [ ] Next.js Route Handlers or protected API service connected to Supabase Auth/PostgreSQL with secure cookie/session handling and durable profiles.
- [ ] Shared production rate limiting/WAF policy across API instances.
- [ ] Email/password, Google OAuth, password recovery, email verification and MFA configured and exercised in an isolated Supabase project.
- [ ] Migration applied to isolated development/staging Supabase projects and RLS tested with multiple roles.
- [ ] Licensed sports-data provider selected, contracted and wired to a durable monitor/worker.
- [ ] SeevPlus/Paystack sandbox credentials and webhook signature details supplied.
- [ ] Provider approval for the intended regulated model, collection, safeguarding and winner disbursement.
- [ ] KYC, age, jurisdiction, AML, fraud, responsible-gambling and dispute procedures implemented.
- [ ] Independent security review and restore/reconciliation drills completed.
- [ ] Vercel project/GitHub repository connected and deployment smoke-tested.
- [ ] Production operational authorization recorded and reviewed.

The application remains demonstration-only until every applicable gate is complete. A frontend flag or environment variable alone cannot activate real-money operation.
