# PeerArena Directive 3.0 deployment report

## Repository status

The repository contains the existing PeerArena simulated-funds experience plus the 3.0 backend foundation, Supabase migration, Vercel configuration, CI workflow and documentation. The project remains an intentionally small Node/static application rather than a completed Next.js migration.

## Application URL

The static frontend was deployed to [peerarena.vercel.app](https://peerarena.vercel.app). Vercel SSO protection remains enabled, so anonymous visitors are not granted access. This deployment publishes `dist` only; `server.mjs` is not a Vercel Function and the local API remains available only when started by the owner with `npm start`, normally at `http://127.0.0.1:4174`.

## Database status

`supabase/migrations/0001_peerarena_foundation.sql` is present and reviewed as source code. It has not been applied to a Supabase project because no project credentials or migration authorization were available. RLS is enabled in the migration; authoritative finance tables intentionally have no client policies.

## Authentication status

The demo uses a synthetic session by default. A fail-closed Supabase Auth adapter, server-side bearer-session boundary, explicit `AUTH_MODE=supabase` route wiring, public catalogue repository, read-only server admin repository, server-only profile repository and public challenge read repository now cover email/password registration and sign-in, password recovery, bearer-token user lookup/logout, Google OAuth URL creation, allowlisted profile reads/updates, filtered public sports/event/market reads, filtered public challenge reads and protected admin reporting. Admin routes require a server-controlled `app_metadata` admin role and a server persistence key; admin writes, synthetic state and challenge mutations do not leak through Supabase mode. The default remains `AUTH_MODE=demo`; missing or invalid Supabase configuration returns `503 AUTH_NOT_CONFIGURED`, while missing server persistence credentials return `503 PERSISTENCE_NOT_CONFIGURED`. Challenge ownership, eligibility, financial authorization, email verification and MFA remain unconfigured. The exact redirect URLs, project keys and server-key configuration are listed in `docs/VERCEL_DEPLOYMENT_3_0.md`.

## Payment integration status

The mock provider is executable and covered by tests. SeevPlus and Paystack are explicit disabled boundaries; the local API returns disabled responses and makes no provider call. Sandbox credentials, webhook configuration and written approval for the proposed business model are still required.

## Sports integration status

The current feed is synthetic. A licensed data-provider contract, sandbox key, result-verification policy and durable monitoring worker are required before settlement can be trusted.

## Testing results

Verified locally on 2026-11-13:

- `npm run check`: passed; 38 tests passed, environment gate validation passed, and JavaScript syntax checks passed.
- `npm run build`: passed; `dist/index.html`, `dist/app.js` and `dist/styles.css` were found.
- `npm run security:check`: passed; security headers/CSP, secret-file hygiene, default-deny real-money configuration and HTTP hardening markers verified.
- `npm audit --omit=dev --audit-level=moderate`: passed; 0 vulnerabilities reported.
- Temporary localhost API smoke test: passed for health, disabled real-money state, sports, live events, public challenges and the `429` rate-limit boundary.
- `git diff --check`: passed.
- Supabase SQL execution: not run; no connected Supabase project or local PostgreSQL instance was available.

The committed CI workflow repeats the Node/build checks on pushes and pull requests.

## Security and compliance restrictions

Real-money mode is blocked by code and configuration. No deposits, fees, withdrawals, customer-fund custody or redeemable balances are enabled. The activation gate requires production mode, explicit operational authorization, gaming authorization, provider approval, safeguarding verification and independent security review.

## Recommended next actions

1. Provide authorized GitHub, Vercel and Supabase access and create isolated environments.
2. Review/apply the migration and test RLS with separate user, admin and service roles.
3. Configure Supabase Auth and migrate the API contract into protected server-side handlers.
4. Obtain provider and sports-data sandbox access, then implement only documented sandbox calls with raw-body webhook verification.
5. Complete the compliance/security checklist and staging restore/reconciliation drills before any production consideration.
