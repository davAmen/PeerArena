# Development Directive 2.0 delivery map

## Delivered in this iteration

- Replaced the dashboard-first home route with a responsive PEERARENA landing experience using the requested violet, midnight, lime and coral direction.
- Added a rights-safe fictional football hero treatment with an explicit “no player likeness used” notice rather than embedding Messi/Ronaldo imagery without permission.
- Added live synthetic ticker, live match center preview, sport gallery, challenge board, multiplayer explanation, security/payment/jurisdiction sections, FAQ and support handoff.
- Added local demo sign-in/registration walkthroughs. No password, Google token, identity document or eligibility decision is persisted.
- Added synthetic live event metadata and `GET /api/live`.
- Added participant records, challenge capacity and `MULTIPLAYER_POOL` demo metadata while preserving the two-person flow.
- Added pool-capacity controls to challenge creation and tests for live fixtures and participant growth.
- Added authentication, live-data and Mobile Money architecture documentation with activation gates.

## Explicitly deferred by design

- Google OIDC, phone verification, MFA and production session management.
- KYC/age/geo/sanctions integrations.
- Licensed live sports data.
- MTN Mobile Money, Telecel Cash, AT Money, bank and payout integrations.
- Redeemable balances, deposits, withdrawals and real-money fees.
- Native React Native/Expo client; the current mobile interface is responsive web.
- Production PostgreSQL, Redis, queues, WebSockets, WAF, managed secrets and cloud deployment.

These are not silently omitted: they require external credentials, contracts, provider approvals, legal classification, security assessment and operating procedures. The demo remains non-redeemable until those gates are independently verified.
