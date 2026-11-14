# PeerArena

PeerArena is a working, simulated-funds demonstration of a peer-to-peer prediction challenge platform for a Ghana pilot concept.

This repository deliberately does **not** implement real-money betting, deposits, withdrawals, payment collection, custody, cash-out, or redeemable balances. All balances use a non-redeemable `DEMO` unit, and the server marks real-money mode as disabled. The demo is a product and architecture prototype, not a licence or legal opinion.

## Run locally

Requirements: Node.js 20 or newer.

```powershell
Set-Location "C:\Users\Administrator\Documents\ChatGPT\PEER-TO-PEER REAL-TIME PREDICTION AND BETTING PLATFORM"
npm install
npm test
npm start
```

Run npm commands from this repository directory. Running `npm install`, `npm test`, or `npm start` from `C:\Users\Administrator` produces an `ENOENT` error because that directory does not contain this project's `package.json`.

Open `http://127.0.0.1:4174` in a browser. The in-memory service resets when the process restarts. The port can be changed with `PEERARENA_PORT`. Keep `AUTH_MODE=demo` for the synthetic walkthrough; Supabase Auth routes require an explicit `AUTH_MODE=supabase` and configured project values.

## Demonstration path

1. Open Overview and inspect the synthetic balance, sample events and activity ledger.
2. Open Marketplace and take a side on an open challenge. The stake is reserved in the demo ledger.
3. Open Create challenge, choose a binary market, and publish a synthetic challenge.
4. Open My challenges to see lifecycle state and audit references.
5. Open Responsible play and enable self-exclusion. New challenge actions are then blocked.
6. Open Admin console and inspect the settlement queue, system health, audit log and production gate.

The admin route is a demonstration control surface only; it is not an authenticated production admin system.

## Repository map

| Path | Purpose |
| --- | --- |
| `server.mjs` | Node HTTP server, static hosting and demo API routes |
| `src/demo-engine.mjs` | Challenge lifecycle, synthetic ledger and settlement rules |
| `src/backend/` | Exact-unit ledger, settlement, authentication/session boundaries, authorization, database configuration, admin/catalogue/profile/challenge repositories, redacted security telemetry, payment-provider boundaries, runtime gate and API contract modules |
| `dist/index.html` | Demo shell |
| `dist/app.js` | Responsive single-page frontend |
| `dist/styles.css` | Dark, responsive product UI |
| `database/` | Self-hosted PostgreSQL hardening boundary and operator runbook |
| `docs/WORKLOG.md` | Versioned engineering, security and persistence record |
| `docs/STRANGER_QUICKSTART.md` | Short authorized visitor walkthrough and live capability status |
| `supabase/migrations/0001_peerarena_foundation.sql` | Versioned PostgreSQL schema, constraints, indexes and RLS foundation |
| `tests/*.test.mjs` | Lifecycle, exact-unit accounting, provider boundary and safety tests |
| `docs/` | Feasibility, requirements, architecture, schema, API, security, operations and legal drafts |

Directive 2.0 additions are mapped in `docs/DIRECTIVE_2_0_DELIVERY.md`. The redesigned home route is a responsive web experience; native React Native/Expo delivery remains a later production phase.
Directive 3.0 additions and their remaining external gates are mapped in `docs/DEPLOYMENT_REPORT_3_0.md`.

## Security boundary

The local service is intentionally small and in-memory by default. The 3.0 branch now includes reviewed PostgreSQL schemas, an owned-database hardening boundary, fail-closed authentication/session boundaries, server-only admin/catalogue/profile/public-challenge repositories, hardened HTTP controls, repeatable security checks, backend service boundaries, a mock provider, disabled external-provider adapters, a default-deny activation gate, and process-local API rate limiting. It still has no connected production database, first-party authentication implementation, licensed sports-data feed, production secrets, transactional challenge/ledger procedures, runtime alert channel, or external notification service. Those integrations remain blocked until the legal, licensing, payment, data-provider and security gates in `docs/LEGAL_REVIEW_CHECKLIST.md` are independently cleared.

## Verification

```powershell
npm test
npm run build
npm run check
npm run security:check
node --check server.mjs
node --check src/demo-engine.mjs
node --check dist/app.js
```

The test suite proves that synthetic funds are non-redeemable, binary challenge choices are constrained, stakes are reserved once, settlement cannot duplicate the pool, voids refund stakes, self-exclusion blocks new challenges, exact minor-unit transactions balance, mock payments are idempotent, and external providers fail closed.

## Production handoff rule

Do not connect payment rails, allow purchase or redemption of `DEMO`, activate real-money fees, or serve a regulated market from this codebase until qualified Ghana counsel, the Gaming Commission, an authorized payment arrangement, an approved data-provider contract, and an independent security/compliance review have each produced written evidence. See `docs/FEASIBILITY.md` and `docs/LEGAL_REVIEW_CHECKLIST.md`.
