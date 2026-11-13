# Authentication and identity architecture

**Current state:** demonstration identity only. The browser does not create a production account, persist a password, verify a phone, call Google, or determine eligibility.

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

## Eligibility boundary

Authentication is not eligibility. A future eligible-for-play decision must combine verified age/identity, jurisdiction, licence scope, responsible-play status, sanctions/AML outcomes, account state and market availability. The client must display the decision but never make it.

## Data minimization

Do not move identity documents, passwords, API keys, provider tokens or user records between PeerArena and another project. Keep identity evidence with an approved processor or isolated service, expose only a verification reference to the challenge service, and log access without logging sensitive contents.
