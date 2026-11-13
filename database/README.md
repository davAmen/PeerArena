# PeerArena owned database boundary

PeerArena's production database target is self-hosted PostgreSQL operated by the PeerArena owner on a private network. This boundary deliberately avoids a hosted database, hosted identity service, payment processor, sports-data feed, or other third-party runtime dependency. The current demo remains in-memory and synthetic; it must not be pointed at customer data.

The repository still contains a disabled Supabase compatibility adapter from the earlier prototype. It is not the owned deployment path. Do not configure `AUTH_MODE=supabase`, Supabase secrets, or hosted database URLs for an owned deployment. Removing that adapter requires a separately reviewed first-party authentication implementation and is intentionally not being faked here.

## Database controls

- `docs/DATABASE_SCHEMA.sql` is the core PostgreSQL domain schema.
- `database/bootstrap/0000_roles.sql` defines non-login, non-superuser role intent and restrictive session defaults without creating credentials.
- `database/migrations/0001_owned_postgres_hardening.sql` is the self-hosted hardening layer.
- `database/migrations/0002_owned_create_challenge_procedure.sql` is the first reviewed write procedure. It creates an eligible challenge draft idempotently and records its audit event; it cannot reserve funds, settle, pay out or call a provider.
- The hardening migration revokes public privileges, enables and forces RLS, blocks direct default access, makes ledger/audit/provider evidence append-only, enforces ledger currency and double-entry balance, and creates a server-computed hash chain for audit events.
- The API role must be a non-superuser and must not own the tables. It receives `EXECUTE` only on reviewed `SECURITY DEFINER` procedures; it receives no direct table grants.
- Migration, runtime, read-only reporting, and encrypted-backup roles are separate. Credentials are provisioned outside the repository and rotated through the operator's secret process.
- PostgreSQL listens only on the private application network. Public database ingress is disabled; host firewall rules allow only the API and backup identities.
- TLS uses `verify-full` with an operator-controlled CA. Disk encryption, encrypted backups, restore tests, retention, and destruction are operational launch gates.
- The database never stores payment PINs, raw card data, identity documents, raw provider credentials, or unbounded request payloads. Sensitive references are tokenized or hashed, and audit metadata is allowlisted.

## Apply order

Run these steps from a controlled migration host, using a migration-only identity and a reviewed backup/rollback window:

1. Create an empty PostgreSQL database and a separate migration owner outside source control.
2. Apply `database/bootstrap/0000_roles.sql` as a cluster administrator; provision any login credentials separately and grant only the required role membership.
3. Apply `docs/DATABASE_SCHEMA.sql`.
4. Apply `database/migrations/0001_owned_postgres_hardening.sql`.
5. Apply `database/migrations/0002_owned_create_challenge_procedure.sql`; it fails closed if the procedure and runtime roles were not provisioned.
6. Create only reviewed stored procedures for the API role. Keep direct table privileges revoked; grant only the specific procedure `EXECUTE` privilege.
7. Run RLS, ledger-balance, append-only, audit-chain, backup-restore and concurrency tests before connecting any application worker.
8. Set `DATABASE_PROVIDER=owned-postgres`, `DATABASE_SSL_MODE=verify-full`, and an exact `DATABASE_ALLOWED_HOSTS` entry. Keep `AUTH_MODE=demo` and all real-money flags disabled until first-party authentication, transactional procedures, legal review and independent security review are complete.

The application configuration rejects every database provider other than `owned-postgres` or `disabled`. In production, the real-money gate also requires a configured private host allowlist and `verify-full` TLS. A database URL by itself cannot activate the product.
