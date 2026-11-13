# PeerArena API 3.0 boundary

The local Node service exposes the application contract below. It is a simulated-funds service: the identity is a demo session, sports data is synthetic, and payment/payout routes fail closed. The routes are intentionally shaped so that a Supabase-backed Route Handler or separately deployed API can replace the in-memory implementation without changing the client contract.

The local API now applies an in-memory sliding-window limiter: 120 read requests and 30 mutation requests per client address and route per minute. Exceeded mutation calls return `429`, `Retry-After`, and `RATE_LIMITED`. A production deployment must replace this process-local limiter with a shared store/WAF policy so limits remain consistent across instances.

The repository also contains a fail-closed Supabase Auth adapter in `src/backend/auth.mjs` and bearer-session boundary in `src/backend/auth-session.mjs`. The default `AUTH_MODE=demo` keeps the synthetic session. Setting `AUTH_MODE=supabase` explicitly enables the Auth routes through those boundaries; absent or invalid Supabase configuration produces `AUTH_NOT_CONFIGURED` with `503` and never falls back to the demo identity.

## Public and demo routes

| Method | Route | Demo behavior |
| --- | --- | --- |
| GET | `/api/health` | Reports service health and the blocked real-money gate. |
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

With the default demo mode, registration, login, recovery, profile persistence and payout-destination writes remain disabled. With explicit `AUTH_MODE=supabase`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/recovery`, `GET /api/auth/google`, `GET /api/auth/session` and `POST /api/auth/logout` use the configured Auth provider and bearer boundary. Profile persistence, challenge ownership, eligibility and payout-destination writes remain unconnected and must not be treated as production-ready.

`GET /api/auth/session`, `POST /api/auth/logout`, `GET /api/users/me`, `GET /api/users/me/challenges`, and `GET /api/users/me/transactions` expose the synthetic session and its state.

## Payments and payouts

`POST /api/payments/checkout`, both provider webhook routes, and payout creation are disabled. Read-only payment and payout lookups return an explicit `DISABLED` status. No browser request can create a real payment or payout.

The service modules in `src/backend/` define the replacement boundary:

- `config.mjs` applies the default-deny activation gate.
- `auth.mjs` defines the fail-closed Supabase Auth boundary for email/password, recovery, bearer-token lookup/logout and Google OAuth URL creation.
- `auth-session.mjs` defines bearer-token extraction, required/optional session validation and safe logout error mapping.
- `ledger.mjs` represents amounts as integer minor units.
- `payments.mjs` defines the provider interface and a working mock provider.
- `settlement.mjs` calculates a deterministic shared-pool distribution.
- `api-contract.mjs` keeps the route inventory explicit.

## Production replacement requirements

Before these routes can be connected to Supabase Auth/PostgreSQL or external providers, bind the adapter to a server-side session strategy, add schema validation, shared rate limiting, signed webhook verification against the raw body, durable idempotency records, transaction boundaries, role-based admin authorization, and audit logging. The SQL migration deliberately denies direct client access to authoritative financial tables.
