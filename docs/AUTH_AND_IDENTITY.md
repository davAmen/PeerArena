# Authentication and identity architecture

**Current state:** demonstration identity remains the only identity used by the running local service. A fail-closed Supabase Auth adapter now exists in `src/backend/auth.mjs`, but it is not bound to the demo routes and remains disabled unless a Supabase URL and anon key are supplied. The browser still does not create a production account, persist a password, verify a phone, call Google, or determine eligibility.

## Supabase Auth adapter boundary

`SupabaseAuthProvider` uses the public Supabase project URL and anon key to model the server-side Auth contract without adding a dependency or storing a local session. It supports:

| Adapter method | Supabase Auth operation |
| --- | --- |
| `signUp` | Email/password registration at `/auth/v1/signup` |
| `signInWithPassword` | Password sign-in at `/auth/v1/token?grant_type=password` |
| `requestPasswordRecovery` | Recovery email request at `/auth/v1/recover` |
| `getUser` | Bearer-token user lookup at `/auth/v1/user` |
| `signOut` | Bearer-token logout at `/auth/v1/logout` |
| `getGoogleOAuthUrl` | Google OAuth authorization URL at `/auth/v1/authorize` |

`createAuthProviderFromEnv()` returns `DisabledAuthProvider` when `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` is absent or invalid. The disabled provider returns `AUTH_NOT_CONFIGURED` and never makes a network request. `NEXT_PUBLIC_APP_URL`, when present, supplies the default redirect URL; every redirect still needs to be registered in the Supabase Auth redirect allowlist. The adapter never accepts or uses the service-role key.

`auth-session.mjs` is the server-side bearer-session boundary around that provider. It accepts only a single `Authorization: Bearer <token>` value, supports required and optional session resolution, validates the returned user shape, maps provider failures to safe `401`/`503` errors and revokes a bearer session without returning the token. It does not log or include credentials in error messages.

The boundary deliberately does not yet provide application session cookies, route middleware, account-to-`profiles` provisioning, email-confirmation UX, MFA enrollment, eligibility decisions or authorization for financial/admin routes. Those are required integration work before any account-write route can be enabled.

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
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the project publishable/anon key; and
- `NEXT_PUBLIC_APP_URL` — the application origin used as the default redirect.

Configure email confirmation, password recovery, Google OAuth credentials and exact local/preview/production redirect URLs in the Supabase dashboard before wiring the adapter into protected handlers. Supabase's [redirect URL guidance](https://supabase.com/docs/guides/auth/redirect-urls) requires the `redirectTo` value to match the configured allowlist. Recovery and sign-in UI must keep generic responses so it does not disclose whether an email address exists.

## Eligibility boundary

Authentication is not eligibility. A future eligible-for-play decision must combine verified age/identity, jurisdiction, licence scope, responsible-play status, sanctions/AML outcomes, account state and market availability. The client must display the decision but never make it.

## Data minimization

Do not move identity documents, passwords, API keys, provider tokens or user records between PeerArena and another project. Keep identity evidence with an approved processor or isolated service, expose only a verification reference to the challenge service, and log access without logging sensitive contents.
