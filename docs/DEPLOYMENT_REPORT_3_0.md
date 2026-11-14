# PeerArena Directive 3.0 deployment report

## Repository status

The repository contains the existing PeerArena simulated-funds experience plus the 3.0 backend foundation, owned PostgreSQL migrations, Vercel configuration, a same-origin demo API adapter, CI workflow and documentation. The project remains an intentionally small Node/static application rather than a completed durable full-stack production service.

## Application URL

The protected PeerArena demo was deployed to [peerarena.vercel.app](https://peerarena.vercel.app). Vercel authentication protection remains enabled, so anonymous visitors are not granted access. `dist` supplies the frontend and `api/[...path].mjs` exposes the synthetic `/api/*` contract through a Vercel Function; state is in-memory and resets across function instances.

Latest verified production deployment: `dpl_AH7Y8XNFLF3mnKBn2UnN1hVdUJQX`, status `READY`, target `production`, with `vercel_authentication` protection. Inspector: [Vercel deployment](https://vercel.com/amenukudavid20-9818s-projects/peerarena/AH7Y8XNFLF3mnKBn2UnN1hVdUJQX).

The protected pilot also exposes `GET /api/readiness`, a secret-free capability report for authorized visitors and operators. The live response confirms the frontend/API are active, while database/auth/payment/real-money capabilities remain gated. See `docs/STRANGER_QUICKSTART.md` for the shortest walkthrough.

## Database status

The owner-operated PostgreSQL schema, hardening migration, role bootstrap and reviewed `create_challenge`/synthetic-only `accept_challenge` procedures are present as source code. No production database has been provisioned or connected. RLS is forced, direct table access is denied, and settlement/payout/provider procedures remain blocked.

## Authentication status

The demo uses a synthetic session by default. A fail-closed Supabase Auth adapter, server-side bearer-session boundary, explicit `AUTH_MODE=supabase` route wiring, public catalogue repository, read-only server admin repository, server-only profile repository and public challenge read repository now cover email/password registration and sign-in, password recovery, bearer-token user lookup/logout, Google OAuth URL creation, allowlisted profile reads/updates, filtered public sports/event/market reads, filtered public challenge reads and protected admin reporting. Admin routes require a server-controlled `app_metadata` admin role and a server persistence key; admin writes, synthetic state and challenge mutations do not leak through Supabase mode. The default remains `AUTH_MODE=demo`; missing or invalid Supabase configuration returns `503 AUTH_NOT_CONFIGURED`, while missing server persistence credentials return `503 PERSISTENCE_NOT_CONFIGURED`. Challenge ownership, eligibility, financial authorization, email verification and MFA remain unconfigured. The exact redirect URLs, project keys and server-key configuration are listed in `docs/VERCEL_DEPLOYMENT_3_0.md`.

## Payment integration status

The mock provider is executable and covered by tests. SeevPlus and Paystack now have explicitly gated sandbox adapters with exact-unit request shaping and raw-body webhook verification; the public API still returns disabled responses and this Vercel project has no provider credentials. Sandbox credentials, webhook configuration, durable event persistence and written approval for the proposed business model are still required.

## Sports integration status

The current feed is synthetic. A licensed data-provider contract, sandbox key, result-verification policy and durable monitoring worker are required before settlement can be trusted.

## Testing results

Verified locally on 2026-11-14:

- `npm run check`: passed; 46 tests passed, environment gate validation passed, and JavaScript syntax checks passed.
- `npm run build`: passed; `dist/index.html`, `dist/app.js` and `dist/styles.css` were found.
- `npm run security:check`: passed; security headers/CSP, secret-file hygiene, default-deny real-money configuration and HTTP hardening markers verified.
- `npm audit --omit=dev --audit-level=moderate`: passed; 0 vulnerabilities reported.
- Provider adapter contract tests: passed for SeevPlus/Paystack sandbox request shape, idempotency, server-side authentication, HMAC signatures, replay-window rejection and disabled payout capability.
- Production Vercel smoke test: passed for `/api/readiness`; response confirmed synthetic-only market data, disabled payment/payout paths and a blocked real-money gate.
- Temporary localhost API smoke test: passed for health, disabled real-money state, sports, live events, public challenges and the `429` rate-limit boundary.
- `git diff --check`: passed.
- PostgreSQL migration execution: not run; no connected private PostgreSQL instance was available.

The committed CI workflow repeats the Node/build checks on pushes and pull requests.

## Security and compliance restrictions

Real-money mode is blocked by code and configuration. No deposits, fees, withdrawals, customer-fund custody or redeemable balances are enabled. The activation gate requires production mode, explicit operational authorization, gaming authorization, provider approval, safeguarding verification and independent security review.

## Recommended next actions

1. Provision the private owner-operated PostgreSQL cluster and apply the role/schema/procedure migrations.
2. Exercise the sandbox adapters against isolated provider accounts only after credentials and webhook endpoints are supplied; add durable payment-attempt/event persistence before any route wiring.
3. Implement first-party authentication and connect only reviewed stored procedures, with RLS/concurrency/restore tests.
4. Keep provider/data integrations and real-money gates disabled until contracts, licensing and independent review exist.
5. Complete the compliance/security checklist and staging restore/reconciliation drills before any production consideration.
