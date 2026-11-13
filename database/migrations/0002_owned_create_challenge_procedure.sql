-- PeerArena first reviewed write procedure.
--
-- This migration is intentionally narrow. It creates a challenge draft and
-- its audit record, but it does not reserve funds, settle a market, create a
-- payout, or contact a provider. Those operations require separate reviewed
-- procedures with their own concurrency and reconciliation tests.
--
-- Apply after 0001_owned_postgres_hardening.sql. The migration owner must
-- provision peerarena_procedure_owner and peerarena_runtime before applying.

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'peerarena_procedure_owner') then
    raise exception 'peerarena_procedure_owner must be provisioned before this migration';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'peerarena_runtime') then
    raise exception 'peerarena_runtime must be provisioned before this migration';
  end if;
end;
$$;

create schema if not exists peerarena_api;
revoke all on schema peerarena_api from public;
revoke all on schema peerarena_private from public;

create table peerarena_private.command_idempotency (
  actor_user_id uuid not null references public.users(id),
  command_name text not null check (length(command_name) between 1 and 80),
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (actor_user_id, command_name, idempotency_key)
);

alter table peerarena_private.command_idempotency enable row level security;
alter table peerarena_private.command_idempotency force row level security;

create policy command_idempotency_procedure_owner
on peerarena_private.command_idempotency
for all
using (current_user = 'peerarena_procedure_owner')
with check (current_user = 'peerarena_procedure_owner');

-- The procedure owner is not a superuser and is allowed to see only the rows
-- required by this reviewed procedure. The runtime role receives none of
-- these table privileges.
grant usage on schema public, peerarena_private to peerarena_procedure_owner;
grant select on public.users, public.responsible_controls, public.events, public.event_markets to peerarena_procedure_owner;
grant select, insert on public.challenges, public.audit_events to peerarena_procedure_owner;
grant select, insert on peerarena_private.command_idempotency to peerarena_procedure_owner;

create policy users_procedure_owner
on public.users
for select
using (current_user = 'peerarena_procedure_owner');

create policy responsible_controls_procedure_owner
on public.responsible_controls
for select
using (current_user = 'peerarena_procedure_owner');

create policy events_procedure_owner
on public.events
for select
using (current_user = 'peerarena_procedure_owner');

create policy event_markets_procedure_owner
on public.event_markets
for select
using (current_user = 'peerarena_procedure_owner');

create policy challenges_procedure_owner
on public.challenges
for insert
with check (current_user = 'peerarena_procedure_owner');

create policy audit_events_procedure_owner
on public.audit_events
for all
using (current_user = 'peerarena_procedure_owner')
with check (current_user = 'peerarena_procedure_owner');

create or replace function peerarena_private.current_actor_id()
returns uuid
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  raw_actor text;
begin
  raw_actor := nullif(current_setting('peerarena.actor_user_id', true), '');
  if raw_actor is null or raw_actor !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'Authenticated actor context is required' using errcode = '42501';
  end if;
  return raw_actor::uuid;
end;
$$;

create or replace function peerarena_private.current_request_id()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select left(nullif(current_setting('peerarena.request_id', true), ''), 128)
$$;

create or replace function peerarena_api.create_challenge(
  p_market_id uuid,
  p_visibility text,
  p_creator_side text,
  p_stake_minor bigint,
  p_currency char(3),
  p_settlement_rule_version text,
  p_expires_at timestamptz,
  p_idempotency_key text
)
returns table (challenge_id uuid, challenge_status text, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog, public, peerarena_private
as $$
declare
  actor_id uuid;
  actor_status text;
  normalized_visibility text;
  normalized_side text;
  normalized_currency text;
  normalized_rules text;
  normalized_idempotency_key text;
  request_hash text;
  request_id text;
  market_closes_at timestamptz;
  market_rules text;
  market_outcomes jsonb;
  existing_hash text;
  existing_response jsonb;
  created_challenge_id uuid;
begin
  actor_id := peerarena_private.current_actor_id();
  request_id := peerarena_private.current_request_id();
  normalized_visibility := upper(btrim(coalesce(p_visibility, '')));
  normalized_side := btrim(coalesce(p_creator_side, ''));
  normalized_currency := upper(btrim(coalesce(p_currency::text, '')));
  normalized_rules := btrim(coalesce(p_settlement_rule_version, ''));
  normalized_idempotency_key := btrim(coalesce(p_idempotency_key, ''));

  if normalized_visibility not in ('PUBLIC', 'PRIVATE') then
    raise exception 'Challenge visibility is invalid' using errcode = '22023';
  end if;
  if length(normalized_side) not between 1 and 80 then
    raise exception 'Challenge prediction is invalid' using errcode = '22023';
  end if;
  if p_stake_minor is null or p_stake_minor <= 0 then
    raise exception 'Challenge stake must be positive' using errcode = '22023';
  end if;
  if normalized_currency !~ '^[A-Z]{3}$' then
    raise exception 'Challenge currency is invalid' using errcode = '22023';
  end if;
  if length(normalized_rules) not between 1 and 80 then
    raise exception 'Settlement rule version is invalid' using errcode = '22023';
  end if;
  if length(normalized_idempotency_key) not between 8 and 128 then
    raise exception 'Idempotency key is invalid' using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= clock_timestamp() then
    raise exception 'Challenge expiry must be in the future' using errcode = '22023';
  end if;

  request_hash := encode(digest(
    concat_ws('|', p_market_id::text, normalized_visibility, normalized_side,
      p_stake_minor::text, normalized_currency, normalized_rules,
      p_expires_at::text),
    'sha256'
  ), 'hex');

  -- Serialize retries for this actor/key so two concurrent requests cannot
  -- create two challenges before the idempotency row exists.
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':' || normalized_idempotency_key, 47291));

  select ci.request_hash, ci.response
  into existing_hash, existing_response
  from peerarena_private.command_idempotency ci
  where ci.actor_user_id = actor_id
    and ci.command_name = 'CREATE_CHALLENGE'
    and ci.idempotency_key = normalized_idempotency_key;

  if found then
    if existing_hash <> request_hash then
      raise exception 'Idempotency key was already used with different command data' using errcode = '23505';
    end if;
    return query select (existing_response ->> 'challenge_id')::uuid, existing_response ->> 'challenge_status', true;
    return;
  end if;

  select u.status::text
  into actor_status
  from public.users u
  where u.id = actor_id
  for share;
  if not found or actor_status <> 'ACTIVE' then
    raise exception 'User is not eligible to create a challenge' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.responsible_controls rc
    where rc.user_id = actor_id
      and rc.self_excluded_until is not null
      and rc.self_excluded_until > clock_timestamp()
  ) then
    raise exception 'Self-exclusion blocks challenge creation' using errcode = '42501';
  end if;

  select em.closes_at, em.settlement_rule_version, em.outcome_set
  into market_closes_at, market_rules, market_outcomes
  from public.event_markets em
  join public.events e on e.id = em.event_id
  where em.id = p_market_id
    and em.status = 'OPEN'
    and e.status in ('SCHEDULED', 'LIVE')
  for share;
  if not found then
    raise exception 'Market is not open for challenge creation' using errcode = '42501';
  end if;
  if p_expires_at > market_closes_at then
    raise exception 'Challenge expiry cannot outlive the market' using errcode = '22023';
  end if;
  if normalized_rules <> btrim(market_rules) then
    raise exception 'Settlement rule version does not match the market' using errcode = '22023';
  end if;
  if jsonb_typeof(market_outcomes) <> 'array' or not (market_outcomes ? normalized_side) then
    raise exception 'Prediction is not an outcome of the market' using errcode = '22023';
  end if;

  insert into public.challenges (
    market_id, creator_id, status, visibility, creator_side, stake_minor,
    currency, settlement_rule_version, expires_at
  ) values (
    p_market_id, actor_id, 'AWAITING_ACCEPTANCE', normalized_visibility,
    normalized_side, p_stake_minor, normalized_currency, normalized_rules,
    p_expires_at
  )
  returning id into created_challenge_id;

  insert into peerarena_private.command_idempotency (
    actor_user_id, command_name, idempotency_key, request_hash, response
  ) values (
    actor_id, 'CREATE_CHALLENGE', normalized_idempotency_key, request_hash,
    jsonb_build_object('challenge_id', created_challenge_id, 'challenge_status', 'AWAITING_ACCEPTANCE')
  );

  insert into public.audit_events (
    actor_user_id, action, entity_type, entity_id, request_id, event_hash, metadata
  ) values (
    actor_id, 'CREATE_CHALLENGE', 'challenge', created_challenge_id, request_id,
    repeat('0', 64),
    jsonb_build_object(
      'currency', normalized_currency,
      'stake_minor', p_stake_minor,
      'visibility', normalized_visibility,
      'request_hash', request_hash
    )
  );

  return query select created_challenge_id, 'AWAITING_ACCEPTANCE'::text, false;
end;
$$;

alter function peerarena_private.chain_audit_event() owner to peerarena_procedure_owner;
alter function peerarena_api.create_challenge(uuid, text, text, bigint, char(3), text, timestamptz, text) owner to peerarena_procedure_owner;

revoke all on function peerarena_private.current_actor_id() from public;
revoke all on function peerarena_private.current_request_id() from public;
revoke all on function peerarena_api.create_challenge(uuid, text, text, bigint, char(3), text, timestamptz, text) from public;
grant usage on schema peerarena_api to peerarena_runtime;
grant execute on function peerarena_api.create_challenge(uuid, text, text, bigint, char(3), text, timestamptz, text) to peerarena_runtime;

commit;
