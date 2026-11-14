# Vercel and owned-database handoff

## Current repository shape

This repository is a working static frontend plus a local Node HTTP demo service. It is not yet a Next.js App Router project. The 3.0 implementation preserves the working frontend and adds:

- `vercel.json` with a verified static `dist` output, security headers and a reproducible build command.
- `api/[...path].mjs` delegating same-origin `/api/*` requests to the hardened Node handler as a Vercel Function.
- `scripts/verify-build.mjs` and `npm run check` for CI/build verification.
- `supabase/migrations/0001_peerarena_foundation.sql` containing the PostgreSQL schema, constraints, indexes, trigger and RLS foundation.
- server-side service modules for exact-unit ledger calculations, settlement and provider boundaries, including explicitly gated SeevPlus and Paystack sandbox adapters.
- a fail-closed Supabase Auth adapter with mock-fetch contract tests; it is not yet wired into protected routes.
- a CI workflow at `.github/workflows/ci.yml`.

`vercel.json` does not claim that `server.mjs` itself is a Vercel Function. The catch-all adapter exposes the existing synthetic demo API on Vercel without turning the local HTTP listener into a serverless process. It remains in-memory per function instance and is not a durable production API.

## Deployment status

The PeerArena demo is deployed at [https://peerarena.vercel.app](https://peerarena.vercel.app). Vercel authentication protection remains enabled, so anonymous visitors are not granted access. The same-origin demo API is now routed through `api/[...path].mjs`; it uses synthetic in-memory state only. No production database, first-party authentication, payment, payout or real-money path is connected.

The latest production deployment is `dpl_AkrZd2qfE3gzfEnwe38bWeRmix31` and reported `READY`. Vercel's `vercel_authentication` protection was observed after deployment and was not changed. The post-deployment `/api/health`, `/api/readiness`, `/api/events/live` and `/api/admin/security` smoke tests passed; readiness confirmed `frontend=ACTIVE`, `api=ACTIVE`, `payments=DISABLED`, `payouts=DISABLED` and `realMoney=BLOCKED`. The redundant legacy adapter was removed; the deployment now contains one rewrite-backed `api/index` Vercel Function.

## Exact access/configuration needed

- Authorized private GitHub repository and permission to enable branch protection, pull-request checks, dependency review and secret scanning.
- Vercel team/project access, selected region, root directory and domain ownership if a custom domain is used.
- Owner-operated PostgreSQL host, role provisioning, private-network routing, backup policy and an approved migration window. Follow `database/README.md`.
- `AUTH_MODE=demo` for the default synthetic environment; first-party authentication is still required before durable accounts are enabled.
- Approved sports-data provider contract and sandbox API key.
- SeevPlus and/or Paystack sandbox account, test keys, webhook configuration and written approval for the intended business model. The repository now contains tested adapter code, but no provider account or credential is connected to this Vercel project.
- Security/compliance sign-off for identity, age, jurisdiction, AML, responsible-gambling, safeguarding and payout operations.

## Safe deployment sequence

1. Provision the owner-operated PostgreSQL roles and apply the owned migrations in `database/README.md`.
2. Implement first-party authentication and reviewed transactional procedures; keep direct table grants revoked.
3. Keep `AUTH_MODE=demo` and the real-money gate blocked while validating the Vercel Function adapter and synthetic API flows.
4. Keep the continuous sports monitor and settlement worker outside browser execution and do not depend on Vercel cron for low-latency monitoring.
5. Configure only sandbox provider keys in isolated environments. Store secrets in managed secret stores; never use `NEXT_PUBLIC_` for secrets.
6. Deploy with `vercel --prod --yes` to the existing protected project and verify `/api/health`, `/api/state` and a read-only synthetic route.
7. Run API, authentication, migration, RLS, settlement, reconciliation and rollback smoke tests against a private staging environment.
8. Keep the default-deny gate blocked until the documented operational authorization is verified independently.

## Environment rules

Use `.env.example` as the name-only template. Production values belong in the selected secret managers. Preview environments must not receive live payment credentials. `REAL_MONEY_ENABLED=true` is insufficient by itself: `APP_ENV`, operational authorization, gaming authorization, provider approval, safeguarding and independent security review must all pass the gate.

## Official configuration references

The [Vercel `vercel.json` documentation](https://vercel.com/docs/project-configuration/vercel-json) documents `buildCommand`, `outputDirectory` and security-header configuration. The [Vercel build documentation](https://vercel.com/docs/builds/configure-a-build) explains how a custom build command and output directory are used.
