# PeerArena

PeerArena is a working, simulated-funds demonstration of a peer-to-peer prediction challenge platform for a Ghana pilot concept.

This repository deliberately does **not** implement real-money betting, deposits, withdrawals, payment collection, custody, cash-out, or redeemable balances. All balances use a non-redeemable `DEMO` unit, and the server marks real-money mode as disabled. The demo is a product and architecture prototype, not a licence or legal opinion.

## Run locally

Requirements: Node.js 20 or newer.

```powershell
npm install
npm test
npm start
```

Open `http://127.0.0.1:4174` in a browser. The in-memory service resets when the process restarts. The port can be changed with `PEERARENA_PORT`.

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
| `dist/index.html` | Demo shell |
| `dist/app.js` | Responsive single-page frontend |
| `dist/styles.css` | Dark, responsive product UI |
| `tests/demo-engine.test.mjs` | Unit tests for lifecycle, accounting and safety controls |
| `docs/` | Feasibility, requirements, architecture, schema, API, security, operations and legal drafts |

## Security boundary

The demo is intentionally small and in-memory. It has no real authentication, persistent database, payment provider, licensed sports-data feed, identity provider, production secrets, or external notification service. Those integrations remain blocked until the legal, licensing, payment, data-provider and security gates in `docs/LEGAL_REVIEW_CHECKLIST.md` are independently cleared.

## Verification

```powershell
npm test
node --check server.mjs
node --check src/demo-engine.mjs
node --check dist/app.js
```

The test suite proves that synthetic funds are non-redeemable, binary challenge choices are constrained, stakes are reserved once, settlement cannot duplicate the pool, voids refund stakes, and self-exclusion blocks new challenges.

## Production handoff rule

Do not connect payment rails, allow purchase or redemption of `DEMO`, activate real-money fees, or serve a regulated market from this codebase until qualified Ghana counsel, the Gaming Commission, an authorized payment arrangement, an approved data-provider contract, and an independent security/compliance review have each produced written evidence. See `docs/FEASIBILITY.md` and `docs/LEGAL_REVIEW_CHECKLIST.md`.
