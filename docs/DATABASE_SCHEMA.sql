-- PeerArena production-oriented PostgreSQL sketch.
-- This is a design artifact, not used by the simulated demo.
-- Do not store real customer funds until the legal/payment gates are approved.

create extension if not exists pgcrypto;

create type user_status as enum ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'SELF_EXCLUDED');
create type challenge_status as enum ('CREATED', 'AWAITING_ACCEPTANCE', 'MATCHED', 'FUNDS_CONFIRMED', 'ACTIVE', 'SUSPENDED', 'AWAITING_VERIFICATION', 'SETTLED', 'VOIDED', 'REFUNDED', 'DISPUTED', 'CLOSED');
create type ledger_entry_type as enum ('RESERVE', 'RELEASE', 'PAYOUT', 'REFUND', 'FEE', 'ADJUSTMENT');
create type settlement_status as enum ('PENDING', 'VERIFIED', 'VOID', 'DISPUTED', 'REVERSED');

create table users (
  id uuid primary key default gen_random_uuid(),
  public_username text not null unique,
  email_hash bytea unique,
  phone_hash bytea unique,
  country_code char(2) not null,
  status user_status not null default 'PENDING',
  legal_age_verified_at timestamptz,
  identity_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_profiles (
  user_id uuid primary key references users(id),
  display_name text,
  timezone text not null default 'Africa/Accra',
  language_code text not null default 'en',
  notification_preferences jsonb not null default '{}'::jsonb,
  verification_provider text,
  verification_reference text,
  retention_until timestamptz
);

create table jurisdiction_rules (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null,
  version text not null,
  effective_from timestamptz not null,
  effective_to timestamptz,
  minimum_age smallint not null,
  enabled boolean not null default false,
  policy jsonb not null,
  unique(country_code, version)
);

create table events (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  competition text not null,
  home_name text,
  away_name text,
  starts_at timestamptz not null,
  provider_name text not null,
  provider_event_id text not null,
  status text not null default 'SCHEDULED',
  provider_payload_hash text,
  created_at timestamptz not null default now(),
  unique(provider_name, provider_event_id)
);

create table event_markets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id),
  market_key text not null,
  title text not null,
  outcome_set jsonb not null,
  settlement_rule_version text not null,
  closes_at timestamptz not null,
  status text not null default 'OPEN',
  enabled_by uuid references users(id),
  unique(event_id, market_key)
);

create table challenges (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references event_markets(id),
  creator_id uuid not null references users(id),
  status challenge_status not null default 'CREATED',
  visibility text not null check (visibility in ('PUBLIC', 'PRIVATE')),
  creator_side text not null,
  stake_minor bigint not null check (stake_minor > 0),
  currency char(3) not null,
  fee_rule_version text,
  settlement_rule_version text not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table challenge_participants (
  challenge_id uuid not null references challenges(id),
  user_id uuid not null references users(id),
  side text not null,
  stake_minor bigint not null check (stake_minor > 0),
  reserved_ledger_tx_id uuid,
  joined_at timestamptz not null default now(),
  primary key(challenge_id, user_id),
  unique(challenge_id, side)
);

create table ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references users(id),
  account_code text not null unique,
  currency char(3) not null,
  account_type text not null check (account_type in ('CUSTOMER', 'CUSTOMER_RESERVED', 'PLATFORM', 'SUSPENSE')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  transaction_type ledger_entry_type not null,
  challenge_id uuid references challenges(id),
  external_reference text,
  rule_version text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references ledger_transactions(id),
  account_id uuid not null references ledger_accounts(id),
  direction text not null check (direction in ('DEBIT', 'CREDIT')),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  created_at timestamptz not null default now()
);

create table settlements (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null unique references challenges(id),
  status settlement_status not null default 'PENDING',
  provider_name text not null,
  provider_event_id text not null,
  result_payload_hash text,
  outcome text,
  gross_pool_minor bigint,
  fee_minor bigint not null default 0,
  payout_minor bigint,
  rule_version text not null,
  verified_by uuid references users(id),
  verified_at timestamptz,
  review_until timestamptz,
  created_at timestamptz not null default now()
);

create table responsible_controls (
  user_id uuid primary key references users(id),
  self_excluded_until timestamptz,
  cooling_off_until timestamptz,
  deposit_limit_minor bigint,
  loss_limit_minor bigint,
  session_limit_minutes integer,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  request_id text,
  previous_hash text,
  event_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table data_provider_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id),
  provider_name text not null,
  provider_event_id text not null,
  payload jsonb not null,
  payload_hash text not null,
  observed_at timestamptz not null default now()
);

create table disputes (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges(id),
  opened_by uuid not null references users(id),
  reason_code text not null,
  status text not null default 'OPEN',
  resolution text,
  resolved_by uuid references users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index challenges_market_status_idx on challenges(market_id, status);
create index challenges_creator_idx on challenges(creator_id, created_at desc);
create index ledger_entries_account_idx on ledger_entries(account_id, created_at desc);
create index audit_events_entity_idx on audit_events(entity_type, entity_id, created_at desc);
create index provider_snapshots_event_idx on data_provider_snapshots(event_id, observed_at desc);

-- Application-level invariants:
-- 1. A ledger transaction must have at least one debit and one credit.
-- 2. Debits and credits must sum exactly by currency.
-- 3. A challenge has at most two participants for the MVP.
-- 4. Settlement and refund commands require unique idempotency keys.
-- 5. Production customer accounts must never be marked is_demo=true.
