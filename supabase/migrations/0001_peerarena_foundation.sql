-- PeerArena Directive 3.0 foundation migration.
-- Apply with Supabase migrations only after reviewing environment and RLS policies.
-- Monetary values use integer minor units. Client applications must not write authoritative finance tables.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  username text not null unique,
  full_name text,
  email text,
  phone text,
  country char(2),
  preferred_language text not null default 'en',
  avatar_url text,
  account_status text not null default 'REGISTERED' check (account_status in ('REGISTERED', 'EMAIL_VERIFIED', 'PHONE_VERIFIED', 'IDENTITY_REVIEW', 'IDENTITY_VERIFIED', 'ELIGIBLE_FOR_PLAY', 'SUSPENDED', 'SELF_EXCLUDED', 'CLOSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_verifications (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  verification_status text not null default 'PENDING',
  age_verified boolean not null default false,
  identity_verified boolean not null default false,
  jurisdiction_eligible boolean not null default false,
  verification_provider_reference text,
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.sports (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null unique,
  enabled boolean not null default false,
  requires_integrity_review boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  sport_id uuid not null references public.sports(id),
  name text not null,
  country_code char(2),
  provider_name text,
  enabled boolean not null default false,
  unique(sport_id, name)
);

create table public.sporting_events (
  id uuid primary key default gen_random_uuid(),
  external_provider_id text,
  sport_id uuid not null references public.sports(id),
  competition_id uuid references public.competitions(id),
  home_participant text not null,
  away_participant text not null,
  scheduled_start timestamptz not null,
  event_status text not null default 'SCHEDULED' check (event_status in ('SCHEDULED', 'LIVE', 'COMPLETED', 'POSTPONED', 'CANCELLED', 'SUSPENDED', 'DISPUTED')),
  current_score jsonb not null default '{}'::jsonb,
  official_result jsonb,
  last_provider_update timestamptz,
  provider_payload_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(external_provider_id)
);

create table public.prediction_markets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.sporting_events(id) on delete cascade,
  market_type text not null,
  market_description text not null,
  possible_outcomes jsonb not null,
  settlement_rules jsonb not null,
  rules_version text not null,
  market_status text not null default 'OPEN' check (market_status in ('OPEN', 'SUSPENDED', 'CLOSED', 'SETTLED', 'VOIDED')),
  closing_time timestamptz not null,
  created_at timestamptz not null default now(),
  unique(event_id, market_type)
);

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id),
  market_id uuid not null references public.prediction_markets(id),
  challenge_type text not null default 'ONE_VS_ONE' check (challenge_type in ('ONE_VS_ONE', 'ONE_VS_MANY', 'MULTIPLAYER_POOL')),
  participation_limit integer not null default 2 check (participation_limit between 2 and 8),
  stake_amount_minor bigint not null check (stake_amount_minor > 0),
  currency char(3) not null default 'GHS',
  access_fee_minor bigint not null default 0 check (access_fee_minor >= 0),
  commission_rate_bps integer not null default 0 check (commission_rate_bps between 0 and 10000),
  visibility text not null default 'PUBLIC' check (visibility in ('PUBLIC', 'PRIVATE')),
  challenge_status text not null default 'CREATED' check (challenge_status in ('CREATED', 'AWAITING_ACCEPTANCE', 'MATCHED', 'FUNDS_CONFIRMED', 'ACTIVE', 'SUSPENDED', 'AWAITING_VERIFICATION', 'SETTLED', 'VOIDED', 'REFUNDED', 'DISPUTED', 'CLOSED')),
  closing_time timestamptz not null,
  rules_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.challenge_participants (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  selected_prediction text not null,
  acceptance_timestamp timestamptz not null default now(),
  participation_status text not null default 'ACCEPTED' check (participation_status in ('INVITED', 'ACCEPTED', 'FUNDS_RESERVED', 'ACTIVE', 'WINNER', 'LOSER', 'REFUNDED', 'DISPUTED', 'REMOVED')),
  stake_reservation_id uuid,
  unique(challenge_id, user_id)
);

create table public.payout_destinations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('SEEVPLUS', 'PAYSTACK', 'BANK', 'MOCK')),
  network text,
  encrypted_or_tokenized_destination text not null,
  masked_account_identifier text not null,
  ownership_verification_status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  unique(user_id, provider, masked_account_identifier)
);

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references public.profiles(id),
  account_code text not null unique,
  account_type text not null check (account_type in ('CUSTOMER_LIABILITY', 'RESERVED_STAKES', 'SETTLEMENT_OBLIGATION', 'REFUND_OBLIGATION', 'PLATFORM_REVENUE', 'PROVIDER_CLEARING', 'SUSPENSE')),
  currency char(3) not null,
  is_demo boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_type text not null,
  transaction_status text not null default 'PENDING' check (transaction_status in ('PENDING', 'POSTED', 'FAILED', 'REVERSED', 'RECONCILIATION_REQUIRED')),
  reference text not null unique,
  currency char(3) not null,
  idempotency_key text not null unique,
  challenge_id uuid references public.challenges(id),
  provider_reference text,
  created_at timestamptz not null default now()
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  account_id uuid not null references public.financial_accounts(id),
  direction text not null check (direction in ('DEBIT', 'CREDIT')),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  created_at timestamptz not null default now()
);

create table public.settlement_records (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null unique references public.challenges(id),
  verified_result text not null,
  rules_version text not null,
  result_source text not null,
  result_payload_hash text,
  settlement_status text not null default 'PENDING' check (settlement_status in ('PENDING', 'VERIFIED', 'SETTLED', 'VOID', 'DISPUTED', 'REVERSED')),
  gross_pool_minor bigint not null default 0 check (gross_pool_minor >= 0),
  commission_minor bigint not null default 0 check (commission_minor >= 0 and commission_minor <= gross_pool_minor),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  settlement_id uuid not null references public.settlement_records(id),
  provider text not null check (provider in ('SEEVPLUS', 'PAYSTACK', 'MOCK')),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  destination_id uuid references public.payout_destinations(id),
  payout_status text not null default 'CREATED' check (payout_status in ('CREATED', 'AWAITING_APPROVAL', 'AUTHORIZED', 'PROCESSING', 'PROVIDER_PENDING', 'COMPLETED', 'FAILED', 'RECONCILIATION_REQUIRED', 'CANCELLED')),
  provider_reference text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(settlement_id, user_id)
);

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  provider text not null,
  transaction_id uuid references public.financial_transactions(id),
  provider_reference text,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  status text not null default 'CREATED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_reference text not null,
  transaction_reference text,
  event_type text not null,
  provider_timestamp timestamptz,
  processing_status text not null default 'RECEIVED',
  raw_payload jsonb not null,
  received_at timestamptz not null default now(),
  unique(provider, event_reference)
);

create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null,
  title text not null,
  body text not null,
  delivery_status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid references public.challenges(id),
  opened_by uuid not null references public.profiles(id),
  reason_code text not null,
  description text not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED')),
  resolution text,
  resolved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  previous_hash text,
  event_hash text not null,
  created_at timestamptz not null default now()
);

create table public.system_settings (
  key text primary key,
  value jsonb not null,
  is_public boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create index sporting_events_status_idx on public.sporting_events(event_status, scheduled_start);
create index prediction_markets_event_status_idx on public.prediction_markets(event_id, market_status, closing_time);
create index challenges_status_idx on public.challenges(challenge_status, closing_time);
create index challenges_creator_idx on public.challenges(creator_id, created_at desc);
create index challenge_participants_user_idx on public.challenge_participants(user_id, acceptance_timestamp desc);
create index financial_transactions_challenge_idx on public.financial_transactions(challenge_id, created_at desc);
create index ledger_entries_account_idx on public.ledger_entries(account_id, created_at desc);
create index payouts_user_status_idx on public.payouts(user_id, payout_status, created_at desc);
create index notifications_user_idx on public.user_notifications(user_id, read_at, created_at desc);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);

create or replace function public.assert_posted_ledger_transaction_balanced()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  transaction_key uuid;
  debit_total numeric;
  credit_total numeric;
  entry_count integer;
  currency_count integer;
begin
  if tg_table_name = 'financial_transactions' then
    transaction_key := new.id;
  elsif tg_op = 'DELETE' then
    transaction_key := old.transaction_id;
  else
    transaction_key := new.transaction_id;
  end if;

  if exists (
    select 1 from public.financial_transactions ft
    where ft.id = transaction_key and ft.transaction_status = 'POSTED'
  ) then
    select
      count(*)::integer,
      count(distinct le.currency)::integer,
      coalesce(sum(le.amount_minor) filter (where le.direction = 'DEBIT'), 0),
      coalesce(sum(le.amount_minor) filter (where le.direction = 'CREDIT'), 0)
    into entry_count, currency_count, debit_total, credit_total
    from public.ledger_entries le
    where le.transaction_id = transaction_key;

    if entry_count < 2 or currency_count <> 1 or debit_total <= 0 or debit_total <> credit_total then
      raise exception 'Posted ledger transaction % is not balanced', transaction_key;
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create constraint trigger ledger_entries_must_balance
after insert or update or delete on public.ledger_entries
deferrable initially deferred
for each row execute procedure public.assert_posted_ledger_transaction_balanced();

create constraint trigger posted_transactions_must_balance
after insert or update of transaction_status on public.financial_transactions
deferrable initially deferred
for each row execute procedure public.assert_posted_ledger_transaction_balanced();

alter table public.profiles enable row level security;
alter table public.user_verifications enable row level security;
alter table public.sports enable row level security;
alter table public.competitions enable row level security;
alter table public.sporting_events enable row level security;
alter table public.prediction_markets enable row level security;
alter table public.challenges enable row level security;
alter table public.challenge_participants enable row level security;
alter table public.payout_destinations enable row level security;
alter table public.financial_accounts enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.settlement_records enable row level security;
alter table public.payouts enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.payment_webhook_events enable row level security;
alter table public.user_notifications enable row level security;
alter table public.disputes enable row level security;
alter table public.audit_logs enable row level security;
alter table public.system_settings enable row level security;

-- Security-definer predicates avoid policy recursion when a private challenge
-- and its participant rows are checked together. They expose only booleans.
create or replace function public.is_current_user_profile(profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = profile_id and p.auth_user_id = auth.uid());
$$;

create or replace function public.is_challenge_public(challenge_key uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.challenges c where c.id = challenge_key and c.visibility = 'PUBLIC');
$$;

create or replace function public.is_challenge_member(challenge_key uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.challenge_participants cp
    join public.profiles p on p.id = cp.user_id
    where cp.challenge_id = challenge_key and p.auth_user_id = auth.uid()
  );
$$;

create policy profiles_self_select on public.profiles for select using (auth.uid() = auth_user_id);
create policy profiles_self_update on public.profiles for update using (auth.uid() = auth_user_id) with check (auth.uid() = auth_user_id);
create policy verifications_self_select on public.user_verifications for select using (public.is_current_user_profile(user_verifications.user_id));
create policy sports_public_select on public.sports for select using (enabled = true);
create policy competitions_public_select on public.competitions for select using (enabled = true);
create policy events_public_select on public.sporting_events for select using (true);
create policy markets_public_select on public.prediction_markets for select using (true);
create policy challenges_public_or_member_select on public.challenges for select using (
  visibility = 'PUBLIC' or
  public.is_current_user_profile(challenges.creator_id) or
  public.is_challenge_member(challenges.id)
);
create policy participants_member_select on public.challenge_participants for select using (
  public.is_current_user_profile(challenge_participants.user_id) or
  public.is_challenge_public(challenge_participants.challenge_id)
);
create policy payout_destinations_self_select on public.payout_destinations for select using (public.is_current_user_profile(payout_destinations.user_id));
create policy notifications_self_select on public.user_notifications for select using (public.is_current_user_profile(user_notifications.user_id));
create policy disputes_member_select on public.disputes for select using (public.is_current_user_profile(disputes.opened_by));
create policy public_settings_select on public.system_settings for select using (is_public = true);

-- No client-facing policies are created for financial accounts, transactions, ledger entries,
-- settlements, payouts, payment attempts, webhook events or audit logs. RLS therefore denies
-- direct client access; trusted server-side roles must perform controlled operations.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (auth_user_id, username, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(coalesce(new.email, 'demo-user'), '@', 1) || '-' || substr(new.id::text, 1, 6)),
    new.raw_user_meta_data ->> 'full_name',
    new.email
  )
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

insert into public.system_settings (key, value, is_public)
values
  ('real_money_enabled', 'false'::jsonb, true),
  ('payment_mode', '"mock"'::jsonb, true),
  ('regulated_launch_gate', '"BLOCKED"'::jsonb, true)
on conflict (key) do nothing;
