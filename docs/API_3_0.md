# PeerArena API 3.0 boundary

The local Node service exposes the application contract below. It is a simulated-funds service: the identity is a demo session, sports data is synthetic, and payment/payout routes fail closed. The routes are intentionally shaped so that a Supabase-backed Route Handler or separately deployed API can replace the in-memory implementation without changing the client contract.

The local API now applies an in-memory sliding-window limiter: 120 read requests and 30 mutation requests per client address and route per minute. Exceeded mutation calls return `429`, `Retry-After`, and `RATE_LIMITED`. A production deployment must replace this process-local limiter with a shared store/WAF policy so limits remain consistent across instances.

The repository also contains a fail-closed Supabase Auth adapter in `src/backend/auth.mjs` and bearer-session boundary in `src/backend/auth-session.mjs`. The default `AUTH_MODE=demo` keeps the synthetic session. Setting `AUTH_MODE=supabase` explicitly enables the Auth routes through those boundaries; absent or invalid Supabase configuration produces `AUTH_NOT_CONFIGURED` with `503` and never falls back to the demo identity.

In `AUTH_MODE=supabase`, `GET /api/challenges` and `GET /api/challenges/:id` use the server-only challenge repository in `src/backend/challenges.mjs`. The repository selects only `PUBLIC` challenges in `AWAITING_ACCEPTANCE`, `ACTIVE` or `FUNDS_CONFIRMED` state, and missing server persistence configuration returns `503 PERSISTENCE_NOT_CONFIGURED` instead of reading the in-memory demo state. The owned PostgreSQL path contains reviewed `create_challenge`, synthetic-only `accept_challenge`, and trusted-worker-only synthetic settlement procedures. `src/backend/owned-postgres.mjs` is the server-side, parameterized procedure client boundary: it uses transaction-local actor/request context, verified TLS pool settings, bounded timeouts and no direct table writes. HTTP command wiring remains fail-closed until first-party authentication and a provisioned private database are connected and exercised.

In `AUTH_MODE=supabase`, sports, event, live-event and market reads use the public catalogue repository in `src/backend/catalogue.mjs`. It selects only enabled sports, public event states and non-settled markets, and excludes provider payloads and official results from the API projection. `/api/state` and synthetic admin reads are disabled in Supabase mode rather than returning in-memory fixtures.

Supabase-mode `/api/admin/*` reads require the server-controlled `admin` role and the server-only persistence key. `src/backend/admin.mjs` returns paginated users, challenges, financial transactions, settlement records, exact protected-table counts and security exception counts. It performs no admin writes; reset and all financial/challenge mutations remain blocked.

## Public and demo routes

| Method | Route | Demo behavior |
| --- | --- | --- |
| GET | `/api/health` | Reports service health and the blocked real-money gate. |
| GET | `/api/readiness` | Reports active, demo-only and blocked capability states without exposing secrets. |
| GET | `/api/state` | Returns the full synthetic demo state. |
| GET | `/api/sports` | Returns supported sports and markets. |
| GET | `/api/events` | Returns synthetic events. |
| GET | `/api/events/live` | Returns the synthetic live feed. |
| GET | `/api/events/:id` | Returns one event. |
| GET | `/api/events/:id/markets` | Returns event markets and outcomes. |
| GET | `/api/challenges` | Returns public open/active challenges. |
| GET | `/api/challenges/:id` | Returns one challenge. |
| GET | `/api/challenges/:id/participants` | Returns participant records. |
| POST | `/api/challenges` | Creates a synthetic challenge after server-side validation. |
| POST | `/api/challenges/:id/accept` | Reserves synthetic stake and joins a challenge. |
| POST | `/api/challenges/:id/cancel` | Creator-only cancellation and synthetic refund. |
| POST | `/api/challenges/:id/settle` | Local synthetic settlement control for demonstration only. |
| POST | `/api/responsible/self-exclusion` | Toggles the demo account's self-exclusion state. |

## Identity and user routes

With the default demo mode, registration, login, recovery, profile persistence and payout-destination writes remain disabled. With explicit `AUTH_MODE=supabase`, the Auth routes use the configured Auth provider and bearer boundary, and profile GET/PATCH routes use the server-only profile repository when its key is configured. Admin routes require an `admin` role in server-controlled Supabase `app_metadata`. Challenge ownership, eligibility and payout-destination writes remain unconnected; missing persistence returns `PERSISTENCE_NOT_CONFIGURED`, while configured-but-not-transactional challenge operations return `CHALLENGE_TRANSACTION_REQUIRED`.

When `SUPABASE_SECRET_KEY` (preferred) or the legacy `SUPABASE_SERVICE_ROLE_KEY` is configured server-side, `GET /api/users/me` reads the matching `profiles` row and `PATCH /api/users/me` applies only the allowlisted profile fields. The repository never accepts an `auth_user_id` from the request body and never exposes the server key to the browser. Without that key, profile routes return `503 PERSISTENCE_NOT_CONFIGURED` after authentication.

In demo mode, `GET /api/auth/session`, `POST /api/auth/logout`, `GET /api/users/me`, `GET /api/users/me/challenges`, and `GET /api/users/me/transactions` expose the synthetic session and its state. In Supabase mode, session and profile routes use the configured Auth/profile boundaries; user challenge and transaction reads remain blocked until durable participant and ledger repositories are available.

## Payments and payouts

`POST /api/payments/checkout`, both provider webhook routes, and payout creation are disabled in the public demo API. Read-only payment and payout lookups return an explicit `DISABLED` status. No browser request can create a real payment or payout.

The service modules in `src/backend/` define the replacement boundary:

- `config.mjs` applies the default-deny activation gate.
- `auth.mjs` defines the fail-closed Supabase Auth boundary for email/password, recovery, bearer-token lookup/logout and Google OAuth URL creation.
- `auth-session.mjs` defines bearer-token extraction, required/optional session validation and safe logout error mapping.
- `admin.mjs` defines server-only, read-only admin reporting over protected Supabase tables.
- `catalogue.mjs` defines public Supabase REST reads for enabled sports, sporting events, live events and prediction markets.
- `challenges.mjs` defines the server-only Supabase public challenge read boundary and keeps challenge writes blocked until a transactional procedure exists.
- `profiles.mjs` defines the server-only Supabase REST repository and allowlisted profile patch validation.
- `database.mjs` defines the owned-PostgreSQL-only configuration gate; it never logs or exposes database credentials.
- `owned-postgres.mjs` defines the fail-closed PostgreSQL pool and reviewed-procedure client; it never exposes direct table writes or enables persistence without an allowlisted private host and verified TLS.
- `security-events.mjs` defines bounded, redacted runtime security telemetry; it never stores request bodies, credentials or query strings.

The owned PostgreSQL procedure boundary exposes three reviewed database procedures: `create_challenge` validates actor context, active/open eligibility, self-exclusion, market outcomes, rule version, expiry, idempotency and audit evidence; `accept_challenge` validates the opposing side and open market, locks the challenge and demo ledger accounts, checks available synthetic balance, writes a balanced reservation, inserts the participant, records idempotency and appends audit evidence; `verify_and_settle_synthetic_challenge` is restricted to the settlement-worker role, requires a closed/suspended market and a completed/terminal synthetic result, then writes one balanced demo payout/refund transaction with deterministic remainder allocation. None of these procedures calls an external provider. The Node client boundary is implemented and tested, but production HTTP commands remain disabled until the private database and first-party auth gates are actually satisfied.
- `ledger.mjs` represents amounts as integer minor units.
- `payments.mjs` defines the working mock provider plus explicit SeevPlus and Paystack sandbox adapters. External adapters require an explicit non-production sandbox mode, server-only credentials and raw-body signature verification; both report payout support as disabled.
- `settlement.mjs` calculates a deterministic shared-pool distribution.
- `api-contract.mjs` keeps the route inventory explicit.

## Production replacement requirements

Before the remaining routes can be connected to the owned PostgreSQL procedures or external providers, complete secure cookie/session handling, profile provisioning, schema validation, shared rate limiting, durable payment-attempt and webhook-event idempotency records, production result verification, reconciliation/dispute/reversal controls and provider payout procedures. The SQL migration deliberately denies direct client access to authoritative financial tables.
