# Authentication and identity architecture

**Current state:** demonstration identity remains the default identity used by the running local service. A fail-closed Supabase Auth adapter and route boundary now exist in `src/backend/auth.mjs` and `src/backend/auth-session.mjs`. They are reachable only when `AUTH_MODE=supabase` is explicitly selected with valid project configuration; the browser still does not create a production account in the default demo mode, verify a phone, or determine eligibility.

## Supabase Auth adapter boundary

`SupabaseAuthProvider` uses the public Supabase project URL and publishable key (with a legacy anon-key fallback) to model the server-side Auth contract without adding a dependency or storing a local session. It supports:

| Adapter method | Supabase Auth operation |
| --- | --- |
| `signUp` | Email/password registration at `/auth/v1/signup` |
| `signInWithPassword` | Password sign-in at `/auth/v1/token?grant_type=password` |
| `requestPasswordRecovery` | Recovery email request at `/auth/v1/recover` |
| `getUser` | Bearer-token user lookup at `/auth/v1/user` |
| `signOut` | Bearer-token logout at `/auth/v1/logout` |
| `getGoogleOAuthUrl` | Google OAuth authorization URL at `/auth/v1/authorize` |

`createAuthProviderFromEnv()` returns `DisabledAuthProvider` when `NEXT_PUBLIC_SUPABASE_URL` or both public-key names are absent or invalid. The disabled provider returns `AUTH_NOT_CONFIGURED` and never makes a network request. `NEXT_PUBLIC_APP_URL`, when present, supplies the default redirect URL; every redirect still needs to be registered in the Supabase Auth redirect allowlist. The adapter never accepts or uses a server secret key.

`auth-session.mjs` is the server-side bearer-session boundary around that provider. It accepts only a single `Authorization: Bearer <token>` value, supports required and optional session resolution, validates the returned user shape, maps provider failures to safe `401`/`503` errors and revokes a bearer session without returning the token. It does not log or include credentials in error messages.

The boundary deliberately does not yet provide application session cookies, account-to-`profiles` provisioning, email-confirmation UX, MFA enrollment, eligibility decisions or authorization for financial/admin routes. Those are required integration work before the Auth route layer can be considered a production identity system.

## Route activation boundary

`AUTH_MODE=demo` is the safe default and preserves the existing synthetic session. `AUTH_MODE=supabase` is an explicit integration switch for the Auth and profile routes. It requires both public Supabase values; if either value is absent or invalid, the routes return `503 AUTH_NOT_CONFIGURED` and do not use the demo identity. Challenge, ledger and payout routes still require protected persistence and authorization work.

## Authorization boundary

The optional route layer protects `/api/admin/*` with `requireAdminSession()`. The required role is read only from Supabase `user.app_metadata.roles` or `user.app_metadata.role`; user-editable metadata is not accepted. Missing authentication returns `401`, an authenticated user without `admin` returns `403`, and provider/configuration failures remain sanitized. Synthetic profile, challenge and responsible-play mutations are blocked with `503 PERSISTENCE_NOT_CONFIGURED` when Supabase mode is selected.

The request shapes follow Supabase's documented email/password, password-recovery, user lookup, logout and OAuth flows: [email/password sign-up](https://supabase.com/docs/reference/javascript/auth-signup), [password sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithpassword), [user lookup](https://supabase.com/docs/reference/javascript/auth-getuser), [password recovery](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail), [logout](https://supabase.com/docs/reference/javascript/auth-signout), and [Google OAuth](https://supabase.com/docs/reference/javascript/auth-signinwithoauth).

## Production target

Use a managed OIDC-compatible identity service or an independently audited implementation with:

- Argon2id password hashing and password-reset token expiry;
- secure, HttpOnly, SameSite session cookies;
- short-lived access credentials and refresh-token rotation;
- MFA and step-up authentication for sensitive actions;
- verified Google Identity Services subject identifiers, issuer and audience checks;
- device/session listing and revocation;
- account recovery that does not weaken identity assurance;
- rate limiting, credential-stuffing detection and lockout safeguards;
- account states: `REGISTERED`, `EMAIL_VERIFIED`, `PHONE_VERIFIED`, `IDENTITY_REVIEW`, `IDENTITY_VERIFIED`, `ELIGIBLE_FOR_PLAY`, `SUSPENDED`, `SELF_EXCLUDED`, `CLOSED`.

## Demo behavior

The landing page's sign-in and registration forms provide a local product walkthrough. They show where authentication enters the journey, but the server keeps the existing synthetic demo user and never promotes a user to real-money eligibility. The Google button is intentionally a disabled architecture placeholder.

## Configuration handoff

Use `.env.example` as a name-only template. A development or staging Auth connection requires:

- `NEXT_PUBLIC_SUPABASE_URL` — the isolated project URL;
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — the browser-safe publishable key; the legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` remains a compatibility fallback; and
- `NEXT_PUBLIC_APP_URL` — the application origin used as the default redirect.

Durable profile routes additionally require the server-only `SUPABASE_SECRET_KEY`; the legacy `SUPABASE_SERVICE_ROLE_KEY` is accepted as a compatibility fallback. Secret keys belong only in the backend secret store and are used for controlled server-side PostgREST calls after the request's bearer identity and authorization checks.

Configure email confirmation, password recovery, Google OAuth credentials and exact local/preview/production redirect URLs in the Supabase dashboard before wiring the adapter into protected handlers. Supabase's [redirect URL guidance](https://supabase.com/docs/guides/auth/redirect-urls) requires the `redirectTo` value to match the configured allowlist. Recovery and sign-in UI must keep generic responses so it does not disclose whether an email address exists.

## Eligibility boundary

Authentication is not eligibility. A future eligible-for-play decision must combine verified age/identity, jurisdiction, licence scope, responsible-play status, sanctions/AML outcomes, account state and market availability. The client must display the decision but never make it.

## Data minimization

Do not move identity documents, passwords, API keys, provider tokens or user records between PeerArena and another project. Keep identity evidence with an approved processor or isolated service, expose only a verification reference to the challenge service, and log access without logging sensitive contents.
