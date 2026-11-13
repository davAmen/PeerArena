-- PeerArena owned PostgreSQL hardening baseline.
--
-- Apply docs/DATABASE_SCHEMA.sql first, then apply this migration with a
-- dedicated migration owner. The runtime role must not be a superuser or the
-- table owner. No hosted database, payment, identity or data provider is
-- required by this database layer.
--
-- This migration deliberately defaults to deny. Application commands must be
-- exposed through reviewed SECURITY DEFINER procedures before a runtime role
-- receives EXECUTE privileges. Do not grant direct table access to the API.

begin;

create extension if not exists pgcrypto;
create schema if not exists peerarena_private;

revoke all on schema public from public;
revoke create on schema public from public;
revoke all on all tables in schema public from public;
revoke all on all sequences in schema public from public;
revoke all on all functions in schema public from public;
alter default privileges in schema public revoke all on tables from public;
alter default privileges in schema public revoke all on sequences from public;
alter default privileges in schema public revoke execute on functions from public;

-- FORCE RLS also applies to the table owner. A superuser still bypasses RLS,
-- so the application and job roles must never be superusers.
alter table public.users enable row level security;
alter table public.users force row level security;
alter table public.user_profiles enable row level security;
alter table public.user_profiles force row level security;
alter table public.jurisdiction_rules enable row level security;
alter table public.jurisdiction_rules force row level security;
alter table public.events enable row level security;
alter table public.events force row level security;
alter table public.event_markets enable row level security;
alter table public.event_markets force row level security;
alter table public.challenges enable row level security;
alter table public.challenges force row level security;
alter table public.challenge_participants enable row level security;
alter table public.challenge_participants force row level security;
alter table public.ledger_accounts enable row level security;
alter table public.ledger_accounts force row level security;
alter table public.ledger_transactions enable row level security;
alter table public.ledger_transactions force row level security;
alter table public.ledger_entries enable row level security;
alter table public.ledger_entries force row level security;
alter table public.settlements enable row level security;
alter table public.settlements force row level security;
alter table public.responsible_controls enable row level security;
alter table public.responsible_controls force row level security;
alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;
alter table public.data_provider_snapshots enable row level security;
alter table public.data_provider_snapshots force row level security;
alter table public.disputes enable row level security;
alter table public.disputes force row level security;

create or replace function peerarena_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists users_touch_updated_at on public.users;
create trigger users_touch_updated_at
before update on public.users
for each row execute function peerarena_private.touch_updated_at();

drop trigger if exists user_profiles_touch_updated_at on public.user_profiles;
create trigger user_profiles_touch_updated_at
before update on public.user_profiles
for each row execute function peerarena_private.touch_updated_at();

drop trigger if exists challenges_touch_updated_at on public.challenges;
create trigger challenges_touch_updated_at
before update on public.challenges
for each row execute function peerarena_private.touch_updated_at();

drop trigger if exists responsible_controls_touch_updated_at on public.responsible_controls;
create trigger responsible_controls_touch_updated_at
before update on public.responsible_controls
for each row execute function peerarena_private.touch_updated_at();

create or replace function peerarena_private.reject_immutable_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, peerarena_private
as $$
begin
  raise exception 'Immutable PeerArena record cannot be changed: %.%', tg_table_schema, tg_table_name
    using errcode = '42501';
end;
$$;

drop trigger if exists ledger_transactions_immutable on public.ledger_transactions;
create trigger ledger_transactions_immutable
before update or delete on public.ledger_transactions
for each row execute function peerarena_private.reject_immutable_mutation();

drop trigger if exists ledger_entries_immutable on public.ledger_entries;
create trigger ledger_entries_immutable
before update or delete on public.ledger_entries
for each row execute function peerarena_private.reject_immutable_mutation();

drop trigger if exists data_provider_snapshots_immutable on public.data_provider_snapshots;
create trigger data_provider_snapshots_immutable
before update or delete on public.data_provider_snapshots
for each row execute function peerarena_private.reject_immutable_mutation();

drop trigger if exists audit_events_immutable on public.audit_events;
create trigger audit_events_immutable
before update or delete on public.audit_events
for each row execute function peerarena_private.reject_immutable_mutation();

create or replace function peerarena_private.assert_ledger_entry_currency()
returns trigger
language plpgsql
set search_path = pg_catalog, public, peerarena_private
as $$
declare
  account_currency char(3);
begin
  select currency into account_currency
  from public.ledger_accounts
  where id = new.account_id;
  if account_currency is null or account_currency <> new.currency then
    raise exception 'Ledger entry currency does not match its account' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists ledger_entries_currency on public.ledger_entries;
create trigger ledger_entries_currency
before insert on public.ledger_entries
for each row execute function peerarena_private.assert_ledger_entry_currency();

create or replace function peerarena_private.assert_ledger_transaction_balanced()
returns trigger
language plpgsql
set search_path = pg_catalog, public, peerarena_private
as $$
declare
  transaction_key uuid;
  entry_count integer;
  currency_count integer;
  debit_total numeric;
  credit_total numeric;
begin
  transaction_key := coalesce(new.transaction_id, old.transaction_id);
  select
    count(*)::integer,
    count(distinct currency)::integer,
    coalesce(sum(amount_minor) filter (where direction = 'DEBIT'), 0),
    coalesce(sum(amount_minor) filter (where direction = 'CREDIT'), 0)
  into entry_count, currency_count, debit_total, credit_total
  from public.ledger_entries
  where transaction_id = transaction_key;

  if entry_count < 2 or currency_count <> 1 or debit_total <= 0 or debit_total <> credit_total then
    raise exception 'Ledger transaction % is not balanced', transaction_key using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists ledger_entries_must_balance on public.ledger_entries;
create constraint trigger ledger_entries_must_balance
after insert on public.ledger_entries
deferrable initially deferred
for each row execute function peerarena_private.assert_ledger_transaction_balanced();

drop trigger if exists ledger_transactions_must_balance on public.ledger_transactions;
create constraint trigger ledger_transactions_must_balance
after insert on public.ledger_transactions
deferrable initially deferred
for each row execute function peerarena_private.assert_ledger_transaction_balanced();

create or replace function peerarena_private.chain_audit_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, peerarena_private
as $$
declare
  prior_hash text;
begin
  -- Serialize chain-head selection so concurrent audit writers cannot fork it.
  perform pg_advisory_xact_lock(47291, 19001);
  select event_hash into prior_hash
  from public.audit_events
  order by created_at desc, id desc
  limit 1;

  if new.previous_hash is distinct from prior_hash and new.previous_hash is not null then
    raise exception 'Audit event previous_hash does not match the chain head' using errcode = '23514';
  end if;
  new.previous_hash := prior_hash;
  new.event_hash := encode(digest(
    concat_ws('|',
      coalesce(new.previous_hash, ''),
      new.action,
      new.entity_type,
      coalesce(new.entity_id::text, ''),
      coalesce(new.request_id, ''),
      new.metadata::text,
      new.created_at::text
    ),
    'sha256'
  ), 'hex');
  return new;
end;
$$;

drop trigger if exists audit_events_chain on public.audit_events;
create trigger audit_events_chain
before insert on public.audit_events
for each row execute function peerarena_private.chain_audit_event();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'audit_event_hash_format_chk') then
    alter table public.audit_events add constraint audit_event_hash_format_chk
      check (event_hash ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'audit_previous_hash_format_chk') then
    alter table public.audit_events add constraint audit_previous_hash_format_chk
      check (previous_hash is null or previous_hash ~ '^[0-9a-f]{64}$');
  end if;
end;
$$;

revoke all on schema peerarena_private from public;
revoke all on all functions in schema peerarena_private from public;

commit;
