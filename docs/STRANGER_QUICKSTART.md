# PeerArena protected pilot quickstart

PeerArena is live at [peerarena.vercel.app](https://peerarena.vercel.app) as a protected synthetic pilot. A visitor must use the authorized Vercel sign-in; there is no protection bypass and no real-money account.

## Fast path

1. Open the Vercel URL and complete the authorized access prompt.
2. Choose **Explore challenges** to see open synthetic fixtures.
3. Open a challenge and choose the available demo action.
4. Use **Create challenge** to publish a binary prediction with non-redeemable `DEMO` credits.
5. Check **My challenges**, **Ledger** and **Responsible play** to see the complete synthetic lifecycle.
6. Use **Help** to review the product boundaries and why deposits, withdrawals, payments and payouts are unavailable.

## Truthful status check

Authorized visitors can open `/api/readiness` to see the live capability state. The current state is:

- Frontend and API: active.
- Authentication: demo session only.
- Database: disabled for demo mode.
- Market data: synthetic only.
- Payments, payouts and real money: blocked.

The site is easy to explore, but it is not presented as a live-money service. Durable accounts, private PostgreSQL, first-party authentication, licensed data, payment approval, compliance controls and independent security review must be completed before those capabilities can be activated.
