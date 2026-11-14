-- PeerArena second reviewed write procedure.
--
-- This procedure is intentionally synthetic-only. It atomically accepts a
-- second participant and reserves a demo stake in the owned ledger. It does
-- not settle an event, create a payout, call a provider, or enable real money.
-- Apply after 0002_owned_create_challenge_procedure.sql.

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

-- The procedure owner receives only the rows required for this command. The
-- runtime role still receives no direct table access.
grant select on public.challenges, public.challenge_participants, public.events,
  public.event_markets, public.responsible_controls, public.ledger_accounts,
  public.ledger_entries to peerarena_procedure_owner;
grant insert on public.challenge_participants, public.ledger_transactions,
  public.ledger_entries, public.audit_events to peerarena_procedure_owner;
grant update on public.challenges to peerarena_procedure_owner;

drop policy if exists challenges_accept_procedure_owner on public.challenges;
create policy challenges_accept_procedure_owner
on public.challenges
for select
using (current_user = 'peerarena_procedure_owner');

drop policy if exists challenges_accept_update_procedure_owner on public.challenges;
create policy challenges_accept_update_procedure_owner
on public.challenges
for update
using (current_user = 'peerarena_procedure_owner')
with check (current_user = 'peerarena_procedure_owner');

drop policy if exists challenge_participants_accept_procedure_owner on public.challenge_participants;
create policy challenge_participants_accept_procedure_owner
on public.challenge_participants
for select
using (current_user = 'peerarena_procedure_owner');

drop policy if exists challenge_participants_accept_insert_procedure_owner on public.challenge_participants;
create policy challenge_participants_accept_insert_procedure_owner
on public.challenge_participants
for insert
with check (current_user = 'peerarena_procedure_owner');

drop policy if exists ledger_accounts_accept_procedure_owner on public.ledger_accounts;
create policy ledger_accounts_accept_procedure_owner
on public.ledger_accounts
for select
using (current_user = 'peerarena_procedure_owner');

drop policy if exists ledger_entries_accept_procedure_owner on public.ledger_entries;
create policy ledger_entries_accept_procedure_owner
on public.ledger_entries
for select
using (current_user = 'peerarena_procedure_owner');

drop policy if exists ledger_entries_accept_insert_procedure_owner on public.ledger_entries;
create policy ledger_entries_accept_insert_procedure_owner
on public.ledger_entries
for insert
with check (current_user = 'peerarena_procedure_owner');

drop policy if exists ledger_transactions_accept_insert_procedure_owner on public.ledger_transactions;
create policy ledger_transactions_accept_insert_procedure_owner
on public.ledger_transactions
for insert
with check (current_user = 'peerarena_procedure_owner');

create or replace function peerarena_api.accept_challenge(
  p_challenge_id uuid,
  p_side text,
  p_idempotency_key text
)
returns table (
  challenge_id uuid,
  challenge_status text,
  ledger_transaction_id uuid,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, peerarena_private
as $$
declare
  actor_id uuid;
  request_id text;
  normalized_side text;
  normalized_idempotency_key text;
  request_hash text;
  existing_hash text;
  existing_response jsonb;
  challenge_row record;
  market_row record;
  customer_account_id uuid;
  reserved_account_id uuid;
  available_balance numeric;
  ledger_transaction_id uuid;
  response jsonb;
begin
  actor_id := peerarena_private.current_actor_id();
  request_id := peerarena_private.current_request_id();
  normalized_side := btrim(coalesce(p_side, ''));
  normalized_idempotency_key := btrim(coalesce(p_idempotency_key, ''));

  if p_challenge_id is null then
    raise exception 'Challenge id is required' using errcode = '22023';
  end if;
  if length(normalized_side) not between 1 and 80 then
    raise exception 'Prediction side is invalid' using errcode = '22023';
  end if;
  if length(normalized_idempotency_key) not between 8 and 128 then
    raise exception 'Idempotency key is invalid' using errcode = '22023';
  end if;

  request_hash := encode(digest(
    concat_ws('|', p_challenge_id::text, normalized_side),
    'sha256'
  ), 'hex');

  -- Serialize retries for this actor/key and all acceptors of the challenge.
  perform pg_advisory_xact_lock(hashtextextended(
    actor_id::text || ':ACCEPT_CHALLENGE:' || normalized_idempotency_key,
    47291
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'ACCEPT_CHALLENGE:' || p_challenge_id::text,
    47291
  ));

  select ci.request_hash, ci.response
  into existing_hash, existing_response
  from peerarena_private.command_idempotency ci
  where ci.actor_user_id = actor_id
    and ci.command_name = 'ACCEPT_CHALLENGE'
    and ci.idempotency_key = normalized_idempotency_key;

  if found then
    if existing_hash <> request_hash then
      raise exception 'Idempotency key was already used with different command data' using errcode = '23505';
    end if;
    return query select
      (existing_response ->> 'challenge_id')::uuid,
      existing_response ->> 'challenge_status',
      (existing_response ->> 'ledger_transaction_id')::uuid,
      true;
    return;
  end if;

  select u.status::text as actor_status
  into challenge_row
  from public.users u
  where u.id = actor_id
  for share;
  if not found or challenge_row.actor_status <> 'ACTIVE' then
    raise exception 'User is not eligible to accept a challenge' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.responsible_controls rc
    where rc.user_id = actor_id
      and rc.self_excluded_until is not null
      and rc.self_excluded_until > clock_timestamp()
  ) then
    raise exception 'Self-exclusion blocks challenge acceptance' using errcode = '42501';
  end if;

  select
    c.id,
    c.creator_id,
    c.market_id,
    c.status::text as status,
    c.creator_side,
    c.stake_minor,
    c.currency,
    c.settlement_rule_version,
    c.expires_at
  into challenge_row
  from public.challenges c
  where c.id = p_challenge_id
  for update;
  if not found then
    raise exception 'Challenge was not found' using errcode = 'P0002';
  end if;
  if challenge_row.status <> 'AWAITING_ACCEPTANCE' then
    raise exception 'Challenge is not accepting participants' using errcode = '42501';
  end if;
  if challenge_row.expires_at <= clock_timestamp() then
    raise exception 'Challenge has expired' using errcode = '42501';
  end if;
  if challenge_row.creator_id = actor_id then
    raise exception 'Challenge creator cannot accept their own challenge' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id
      and cp.user_id = actor_id
  ) then
    raise exception 'User already participates in this challenge' using errcode = '23505';
  end if;
  if (select count(*) from public.challenge_participants cp where cp.challenge_id = p_challenge_id) >= 2 then
    raise exception 'Challenge participation limit has been reached' using errcode = '42501';
  end if;
  if normalized_side = btrim(challenge_row.creator_side) then
    raise exception 'The accepting prediction must be different from the creator prediction' using errcode = '22023';
  end if;

  select
    em.status::text as market_status,
    em.settlement_rule_version,
    em.outcome_set,
    e.status::text as event_status
  into market_row
  from public.event_markets em
  join public.events e on e.id = em.event_id
  where em.id = challenge_row.market_id
  for share;
  if not found or market_row.market_status <> 'OPEN' or market_row.event_status not in ('SCHEDULED', 'LIVE') then
    raise exception 'Market is not open for challenge acceptance' using errcode = '42501';
  end if;
  if market_row.settlement_rule_version <> challenge_row.settlement_rule_version then
    raise exception 'Challenge settlement rule does not match the market' using errcode = '22023';
  end if;
  if jsonb_typeof(market_row.outcome_set) <> 'array' or not (market_row.outcome_set ? normalized_side) then
    raise exception 'Prediction is not an outcome of the market' using errcode = '22023';
  end if;

  -- Account rows are the concurrency lock for available-balance calculations.
  -- Only demo accounts are eligible here; enabling real-money accounts requires
  -- a separately reviewed procedure and activation gate.
  perform la.id
  from public.ledger_accounts la
  where la.owner_user_id = actor_id
    and la.account_type in ('CUSTOMER', 'CUSTOMER_RESERVED')
    and la.currency = challenge_row.currency
    and la.is_demo = true
  order by la.id
  for update;

  select la.id
  into customer_account_id
  from public.ledger_accounts la
  where la.owner_user_id = actor_id
    and la.account_type = 'CUSTOMER'
    and la.currency = challenge_row.currency
    and la.is_demo = true
  order by la.id
  limit 1;

  select la.id
  into reserved_account_id
  from public.ledger_accounts la
  where la.owner_user_id = actor_id
    and la.account_type = 'CUSTOMER_RESERVED'
    and la.currency = challenge_row.currency
    and la.is_demo = true
  order by la.id
  limit 1;

  if customer_account_id is null or reserved_account_id is null then
    raise exception 'Synthetic customer ledger accounts are not provisioned' using errcode = '55000';
  end if;

  select coalesce(sum(
    case when le.direction = 'DEBIT' then le.amount_minor else -le.amount_minor end
  ), 0)
  into available_balance
  from public.ledger_entries le
  where le.account_id = customer_account_id;

  if available_balance < challenge_row.stake_minor then
    raise exception 'Insufficient synthetic balance' using errcode = '42501';
  end if;

  insert into public.ledger_transactions (
    idempotency_key, transaction_type, challenge_id, rule_version, created_by, metadata
  ) values (
    'ACCEPT_CHALLENGE:' || actor_id::text || ':' || normalized_idempotency_key,
    'RESERVE',
    p_challenge_id,
    challenge_row.settlement_rule_version,
    actor_id,
    jsonb_build_object('synthetic_only', true, 'side', normalized_side, 'request_hash', request_hash)
  ) returning id into ledger_transaction_id;

  -- A reservation moves synthetic value from available customer balance to
  -- the customer's reserved account. The hardening trigger enforces balance.
  insert into public.ledger_entries (
    transaction_id, account_id, direction, amount_minor, currency
  ) values
    (ledger_transaction_id, reserved_account_id, 'DEBIT', challenge_row.stake_minor, challenge_row.currency),
    (ledger_transaction_id, customer_account_id, 'CREDIT', challenge_row.stake_minor, challenge_row.currency);

  insert into public.challenge_participants (
    challenge_id, user_id, side, stake_minor, reserved_ledger_tx_id
  ) values (
    p_challenge_id, actor_id, normalized_side, challenge_row.stake_minor, ledger_transaction_id
  );

  update public.challenges
  set status = 'FUNDS_CONFIRMED',
      accepted_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = p_challenge_id;

  response := jsonb_build_object(
    'challenge_id', p_challenge_id,
    'challenge_status', 'FUNDS_CONFIRMED',
    'ledger_transaction_id', ledger_transaction_id
  );

  insert into peerarena_private.command_idempotency (
    actor_user_id, command_name, idempotency_key, request_hash, response
  ) values (
    actor_id, 'ACCEPT_CHALLENGE', normalized_idempotency_key, request_hash, response
  );

  insert into public.audit_events (
    actor_user_id, action, entity_type, entity_id, request_id, event_hash, metadata
  ) values (
    actor_id,
    'ACCEPT_CHALLENGE',
    'challenge',
    p_challenge_id,
    request_id,
    repeat('0', 64),
    jsonb_build_object(
      'synthetic_only', true,
      'side', normalized_side,
      'stake_minor', challenge_row.stake_minor,
      'currency', challenge_row.currency,
      'ledger_transaction_id', ledger_transaction_id,
      'request_hash', request_hash
    )
  );

  return query select p_challenge_id, 'FUNDS_CONFIRMED'::text, ledger_transaction_id, false;
end;
$$;

alter function peerarena_api.accept_challenge(uuid, text, text) owner to peerarena_procedure_owner;
revoke all on function peerarena_api.accept_challenge(uuid, text, text) from public;
grant usage on schema peerarena_api to peerarena_runtime;
grant execute on function peerarena_api.accept_challenge(uuid, text, text) to peerarena_runtime;

commit;
