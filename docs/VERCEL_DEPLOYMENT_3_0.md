# Vercel and Supabase handoff

## Current repository shape

This repository is a working static frontend plus a local Node HTTP demo service. It is not yet a Next.js App Router project. The 3.0 implementation preserves the working frontend and adds:

- `vercel.json` with a verified static `dist` output, security headers and a reproducible build command.
- `scripts/verify-build.mjs` and `npm run check` for CI/build verification.
- `supabase/migrations/0001_peerarena_foundation.sql` containing the PostgreSQL schema, constraints, indexes, trigger and RLS foundation.
- server-side service modules for exact-unit ledger calculations, settlement and provider boundaries.
- a fail-closed Supabase Auth adapter with mock-fetch contract tests; it is not yet wired into protected routes.
- a CI workflow at `.github/workflows/ci.yml`.

`vercel.json` does not claim that `server.mjs` is a Vercel Function. Vercel can publish the frontend from `dist`; the API must be migrated to Next.js Route Handlers or deployed as a separately managed backend/worker before a public full-stack launch.

## Deployment status

No Vercel, GitHub or Supabase deployment was attempted in this workspace. No account token, project identifier, repository permission, Supabase URL, database URL, provider sandbox key or production domain was available. Therefore there is no application URL or successful deployment confirmation to report.

## Exact access/configuration needed

- Authorized private GitHub repository and permission to enable branch protection, pull-request checks, dependency review and secret scanning.
- Vercel team/project access, selected region, root directory and domain ownership if a custom domain is used.
- Supabase project URL, anon key, service-role key, database connection string, backup policy and an approved migration window.
- `AUTH_MODE=demo` for the default synthetic environment; use `AUTH_MODE=supabase` only in an isolated Auth test environment after route and redirect checks pass.
- Supabase Auth configuration for email verification, password recovery, MFA and Google OAuth, including local, Vercel preview and production redirect URLs.
- Approved sports-data provider contract and sandbox API key.
- SeevPlus and/or Paystack sandbox account, test keys, webhook configuration and written approval for the intended business model.
- Security/compliance sign-off for identity, age, jurisdiction, AML, responsible-gambling, safeguarding and payout operations.

## Safe deployment sequence

1. Create isolated Supabase projects for development, staging and production.
2. Review and apply the migration using Supabase migrations; confirm RLS policies with two test users and a service-role-only finance test.
3. Configure redirect URLs, keep `AUTH_MODE=demo` by default, then enable `AUTH_MODE=supabase` only in an isolated environment and test the Auth routes with bearer sessions before enabling any other account-write route.
4. Move the API contract into authenticated server-side Route Handlers or a protected API service. Keep the continuous sports monitor and settlement worker outside browser execution and do not depend on a browser or Vercel cron for low-latency monitoring.
5. Configure only sandbox provider keys in development/preview. Store secrets in managed secret stores; never use `NEXT_PUBLIC_` for secrets.
6. Deploy the static frontend using `npm run build:vercel` and confirm the generated Vercel URL.
7. Run API, Auth, webhook, migration, RLS, settlement, reconciliation and rollback smoke tests against staging.
8. Keep the default-deny gate blocked until the documented operational authorization is verified independently.

## Environment rules

Use `.env.example` as the name-only template. Production values belong in the selected secret managers. Preview environments must not receive live payment credentials. `REAL_MONEY_ENABLED=true` is insufficient by itself: `APP_ENV`, operational authorization, gaming authorization, provider approval, safeguarding and independent security review must all pass the gate.

## Official configuration references

The [Vercel `vercel.json` documentation](https://vercel.com/docs/project-configuration/vercel-json) documents `buildCommand`, `outputDirectory` and security-header configuration. The [Vercel build documentation](https://vercel.com/docs/builds/configure-a-build) explains how a custom build command and output directory are used.
