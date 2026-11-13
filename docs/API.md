# API design

The current demo API is intentionally small and in-memory. Production APIs must add authentication, authorization, persistence, rate limits, idempotency, request signing where required, audit correlation and jurisdiction checks.

Base URL: `http://127.0.0.1:4174` for the local demo.

## Common conventions

- JSON request and response bodies.
- ISO-8601 timestamps.
- Stable UUID-like resource IDs.
- `DEMO` is the only supported currency in the demo and has no monetary value.
- Mutating production requests require `Idempotency-Key`.
- Every response should include `X-Request-Id`; errors use `{ "error": "...", "code": "...", "requestId": "..." }`.
- Never accept a balance, payout or winner from the client without server-side recomputation.

## Health

`GET /api/health`

Response:

```json
{
  "ok": true,
  "demoMode": true,
  "realMoneyEnabled": false,
  "service": "peerarena-demo"
}
```

## Read model

`GET /api/state` returns the demo user, synthetic events, challenges, transactions, responsible controls and audit log.

`GET /api/admin/overview` returns queue, metrics, health and audit data for the demo admin screen.

`GET /api/live` returns synthetic fixtures whose event status is `LIVE`, with a source label, freshness marker, score, period and statistics. It is a demonstration feed and must not be treated as an official settlement source.

Production should expose scoped read models rather than the complete state object.

## Create a challenge

`POST /api/challenges`

Request:

```json
{
  "eventId": "event-hearts-kotoko",
  "market": "total_goals",
  "side": "Over 2.5",
  "stake": 25,
  "visibility": "PUBLIC"
}
```

The server validates the event, market, side, stake limit, close time, user state and demo-only currency. Success returns `201` with the created challenge and updated demo state.

## Accept a challenge

`POST /api/challenges/{challengeId}/accept`

The server checks that the challenge is open, unexpired, not self-excluded, and that the requested user is taking the opposing side. It reserves the synthetic stake exactly once and returns the updated challenge.

## Settle a challenge (demo admin)

`POST /api/challenges/{challengeId}/settle`

Request:

```json
{ "outcome": "Over 2.5" }
```

Supported demo outcome is the declared side or `VOID`. Production must not accept a free-form operator result; it must consume a provider snapshot, apply the versioned market rule, observe any review window and require an authorized workflow for exceptions.

## Self-exclusion

`POST /api/responsible/self-exclusion`

Request:

```json
{ "enabled": true }
```

The demo marks the user self-excluded and blocks future create/accept commands. Production should support temporary and permanent duration, identity matching, marketing suppression, support workflow and independent audit.

## Admin reset (demo only)

`POST /api/admin/reset`

Resets all in-memory synthetic state. This endpoint must not exist in production.

## Error semantics

| HTTP | Meaning |
| --- | --- |
| 400 | Invalid JSON, invalid field, unsupported side or blocked business rule |
| 401 | Missing/invalid authentication in production |
| 403 | Authenticated but not eligible or not authorized |
| 404 | Resource or route not found |
| 409 | State conflict, duplicate acceptance or idempotency mismatch |
| 422 | Valid request shape but unprocessable market/payment/compliance state |
| 429 | Rate limit or abuse control |
| 500 | Unexpected service failure; no financial mutation should be assumed |

## Production additions

Required before regulated integration: OpenAPI specification, OAuth/OIDC or managed identity, admin MFA, role/permission matrix, webhook signature verification, payment callback idempotency, provider result reconciliation, pagination, optimistic locking/version fields, audit references, dispute endpoints, complaint endpoints, limits endpoints and a versioned fee/rule configuration API.
