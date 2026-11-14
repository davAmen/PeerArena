-- PeerArena third reviewed write procedure.
--
-- This procedure is limited to a trusted settlement-worker role and demo
-- ledger accounts. It verifies a closed/completed synthetic market result,
-- refunds a void/no-winner pool or distributes the pool to matching winners,
-- and writes one balanced immutable ledger transaction. It never contacts a
-- provider and it cannot operate on non-demo accounts.
-- Apply after 0003_owned_accept_challenge_procedure.sql.

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'peerarena_procedure_owner') then
    raise exception 'peerarena_procedure_owner must be provisioned before this migration';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'peerarena_settlement_worker') then
    raise exception 'peerarena_settlement_worker must be provisioned before this migration';
  end if;
end;
$$;

grant select on public.challenges, public.challenge_participants, public.events,
  public.event_markets, public.ledger_accounts to peerarena_procedure_owner;
grant insert on public.ledger_transactions, public.ledger_entries,
  public.settlements, public.audit_events to peerarena_procedure_owner;
grant update on public.challenges to peerarena_procedure_owner;

drop policy if exists settlements_worker_procedure_owner on public.settlements;
create policy settlements_worker_procedure_owner
on public.settlements
for select
using (current_user = 'peerarena_procedure_owner');

drop policy if exists settlements_worker_insert_procedure_owner on public.settlements;
create policy settlements_worker_insert_procedure_owner
on public.settlements
for insert
with check (current_user = 'peerarena_procedure_owner');

create or replace function peerarena_api.verify_and_settle_synthetic_challenge(
  p_challenge_id uuid,
  p_verified_outcome text,
  p_result_source text,
  p_provider_event_id text,
  p_result_payload_hash text,
  p_rules_version text,
  p_idempotency_key text
)
returns table (
  challenge_id uuid,
  challenge_status text,
  settlement_id uuid,
  ledger_transaction_id uuid,
  settlement_status text,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, peerarena_private
as $$
declare
  challenge_row record;
  market_row record;
  participant_row record;
  actor_id uuid;
  request_id text;
  normalized_outcome text;
  normalized_source text;
  normalized_provider_event_id text;
  normalized_rules_version text;
  normalized_idempotency_key text;
  request_hash text;
  existing_hash text;
  existing_response jsonb;
  settlement_id uuid;
  ledger_transaction_id uuid;
  customer_account_id uuid;
  reserved_account_id uuid;
  gross_pool_minor bigint;
  winner_count bigint;
  base_payout_minor bigint;
  remainder_minor bigint;
  payout_minor bigint;
  payout_total_minor bigint := 0;
  effective_outcome text;
  is_void boolean := false;
  response jsonb;
begin
  -- Function execution is granted only to the isolated settlement-worker
  -- role. A login role may inherit that role, so check membership rather than
  -- requiring the non-login role to be the session authorization itself.
  if not pg_has_role(session_user, 'peerarena_settlement_worker', 'member') then
    raise exception 'Settlement worker role is required' using errcode = '42501';
  end if;

  actor_id := nullif(current_setting('peerarena.worker_user_id', true), '')::uuid;
  request_id := left(nullif(current_setting('peerarena.request_id', true), ''), 128);
  normalized_outcome := btrim(coalesce(p_verified_outcome, ''));
  normalized_source := upper(btrim(coalesce(p_result_source, '')));
  normalized_provider_event_id := btrim(coalesce(p_provider_event_id, ''));
  normalized_rules_version := btrim(coalesce(p_rules_version, ''));
  normalized_idempotency_key := btrim(coalesce(p_idempotency_key, ''));

  if p_challenge_id is null then
    raise exception 'Challenge id is required' using errcode = '22023';
  end if;
  if length(normalized_outcome) not between 1 and 80 then
    raise exception 'Verified outcome is invalid' using errcode = '22023';
  end if;
  if normalized_source <> 'SYNTHETIC_REVIEWED' then
    raise exception 'Only the reviewed synthetic result source is enabled' using errcode = '42501';
  end if;
  if length(normalized_provider_event_id) not between 1 and 200 then
    raise exception 'Result event reference is invalid' using errcode = '22023';
  end if;
  if normalized_provider_event_id ~ '[\r\n]' then
    raise exception 'Result event reference contains control characters' using errcode = '22023';
  end if;
  if p_result_payload_hash is null or p_result_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Result payload hash is invalid' using errcode = '22023';
  end if;
  if length(normalized_rules_version) not between 1 and 80 then
    raise exception 'Settlement rule version is invalid' using errcode = '22023';
  end if;
  if length(normalized_idempotency_key) not between 8 and 128 then
    raise exception 'Idempotency key is invalid' using errcode = '22023';
  end if;

  request_hash := encode(digest(
    concat_ws('|', p_challenge_id::text, normalized_outcome, normalized_source,
      normalized_provider_event_id, p_result_payload_hash, normalized_rules_version),
    'sha256'
  ), 'hex');

  -- Serialize all settlement attempts for one challenge and serialize the
  -- worker retry key before reading the idempotency record.
  perform pg_advisory_xact_lock(hashtextextended(
    'VERIFY_SETTLE:' || p_challenge_id::text,
    47291
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'VERIFY_SETTLE:' || normalized_idempotency_key,
    47291
  ));

  select ci.request_hash, ci.response
  into existing_hash, existing_response
  from peerarena_private.command_idempotency ci
  where ci.actor_user_id = coalesce(actor_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and ci.command_name = 'VERIFY_SETTLE_SYNTHETIC'
    and ci.idempotency_key = normalized_idempotency_key;

  if found then
    if existing_hash <> request_hash then
      raise exception 'Idempotency key was already used with different settlement data' using errcode = '23505';
    end if;
    return query select
      (existing_response ->> 'challenge_id')::uuid,
      existing_response ->> 'challenge_status',
      (existing_response ->> 'settlement_id')::uuid,
      (existing_response ->> 'ledger_transaction_id')::uuid,
      existing_response ->> 'settlement_status',
      true;
    return;
  end if;

  if actor_id is null then
    raise exception 'Settlement worker user context is required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.users u where u.id = actor_id and u.status::text = 'ACTIVE'
  ) then
    raise exception 'Settlement worker user context is not an active operator' using errcode = '42501';
  end if;

  select
    c.id,
    c.market_id,
    c.status::text as status,
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
  if challenge_row.status not in ('FUNDS_CONFIRMED', 'ACTIVE', 'AWAITING_VERIFICATION') then
    raise exception 'Challenge is not eligible for synthetic settlement' using errcode = '42501';
  end if;
  if challenge_row.settlement_rule_version <> normalized_rules_version then
    raise exception 'Settlement rule version does not match the challenge' using errcode = '22023';
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
  if not found then
    raise exception 'Challenge market was not found' using errcode = 'P0002';
  end if;
  if market_row.settlement_rule_version <> normalized_rules_version then
    raise exception 'Settlement rule version does not match the market' using errcode = '22023';
  end if;
  if normalized_outcome = 'VOID' then
    is_void := true;
    if market_row.event_status not in ('CANCELLED', 'POSTPONED', 'SUSPENDED', 'COMPLETED') then
      raise exception 'Void settlement requires a terminal or suspended event' using errcode = '42501';
    end if;
  else
    if market_row.event_status <> 'COMPLETED' then
      raise exception 'Non-void settlement requires a completed event' using errcode = '42501';
    end if;
    if jsonb_typeof(market_row.outcome_set) <> 'array' or not (market_row.outcome_set ? normalized_outcome) then
      raise exception 'Verified outcome is not an outcome of the market' using errcode = '22023';
    end if;
  end if;
  if market_row.market_status not in ('CLOSED', 'SUSPENDED') then
    raise exception 'Market must be closed or suspended before settlement' using errcode = '42501';
  end if;

  select
    coalesce(sum(cp.stake_minor), 0)::bigint,
    count(*)::bigint
  into gross_pool_minor, winner_count
  from public.challenge_participants cp
  where cp.challenge_id = p_challenge_id;
  if gross_pool_minor <= 0 or winner_count < 2 then
    raise exception 'A funded challenge needs at least two positive stakes' using errcode = '42501';
  end if;

  if not is_void then
    select count(*)::bigint
    into winner_count
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id
      and cp.side = normalized_outcome;
    if winner_count = 0 then
      is_void := true;
      effective_outcome := 'NO_WINNER';
    else
      effective_outcome := normalized_outcome;
    end if;
  else
    effective_outcome := 'VOID';
  end if;

  -- Lock every participant's demo account in one deterministic order. Every
  -- future reservation/settlement procedure must use the same account locks.
  perform la.id
  from public.ledger_accounts la
  where la.owner_user_id in (
    select cp.user_id from public.challenge_participants cp where cp.challenge_id = p_challenge_id
  )
    and la.account_type in ('CUSTOMER', 'CUSTOMER_RESERVED')
    and la.currency = challenge_row.currency
    and la.is_demo = true
  order by la.id
  for update;

  for participant_row in
    select cp.user_id, cp.side, cp.stake_minor
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id
    order by cp.user_id
  loop
    select la.id
    into customer_account_id
    from public.ledger_accounts la
    where la.owner_user_id = participant_row.user_id
      and la.account_type = 'CUSTOMER'
      and la.currency = challenge_row.currency
      and la.is_demo = true
    order by la.id
    limit 1;

    select la.id
    into reserved_account_id
    from public.ledger_accounts la
    where la.owner_user_id = participant_row.user_id
      and la.account_type = 'CUSTOMER_RESERVED'
      and la.currency = challenge_row.currency
      and la.is_demo = true
    order by la.id
    limit 1;

    if customer_account_id is null or reserved_account_id is null then
      raise exception 'Synthetic ledger accounts are not provisioned for every participant' using errcode = '55000';
    end if;
  end loop;

  if is_void then
    payout_total_minor := gross_pool_minor;
  else
    base_payout_minor := gross_pool_minor / winner_count;
    remainder_minor := gross_pool_minor % winner_count;
    payout_total_minor := gross_pool_minor;
  end if;

  insert into public.ledger_transactions (
    idempotency_key, transaction_type, challenge_id, rule_version, created_by, metadata
  ) values (
    'VERIFY_SETTLE:' || p_challenge_id::text || ':' || normalized_idempotency_key,
    case when is_void then 'REFUND' else 'PAYOUT' end,
    p_challenge_id,
    normalized_rules_version,
    actor_id,
    jsonb_build_object(
      'synthetic_only', true,
      'result_source', normalized_source,
      'provider_event_id', normalized_provider_event_id,
      'result_payload_hash', p_result_payload_hash,
      'outcome', effective_outcome
    )
  ) returning id into ledger_transaction_id;

  -- Release every participant's reserved stake. The corresponding debit(s)
  -- below credit the winner/customer accounts, so the transaction balances.
  for participant_row in
    select cp.user_id, cp.side, cp.stake_minor
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id
    order by cp.user_id
  loop
    select la.id
    into reserved_account_id
    from public.ledger_accounts la
    where la.owner_user_id = participant_row.user_id
      and la.account_type = 'CUSTOMER_RESERVED'
      and la.currency = challenge_row.currency
      and la.is_demo = true
    order by la.id
    limit 1;

    insert into public.ledger_entries (
      transaction_id, account_id, direction, amount_minor, currency
    ) values (
      ledger_transaction_id, reserved_account_id, 'CREDIT', participant_row.stake_minor, challenge_row.currency
    );
  end loop;

  for participant_row in
    select cp.user_id, cp.side, cp.stake_minor
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id
    order by cp.user_id
  loop
    if is_void then
      payout_minor := participant_row.stake_minor;
    elsif participant_row.side = effective_outcome then
      payout_minor := base_payout_minor + case when remainder_minor > 0 then 1 else 0 end;
      if remainder_minor > 0 then remainder_minor := remainder_minor - 1; end if;
    else
      payout_minor := 0;
    end if;

    if payout_minor > 0 then
      select la.id
      into customer_account_id
      from public.ledger_accounts la
      where la.owner_user_id = participant_row.user_id
        and la.account_type = 'CUSTOMER'
        and la.currency = challenge_row.currency
        and la.is_demo = true
      order by la.id
      limit 1;

      insert into public.ledger_entries (
        transaction_id, account_id, direction, amount_minor, currency
      ) values (
        ledger_transaction_id, customer_account_id, 'DEBIT', payout_minor, challenge_row.currency
      );
    end if;
  end loop;

  insert into public.settlements (
    challenge_id, status, provider_name, provider_event_id,
    result_payload_hash, outcome, gross_pool_minor, fee_minor,
    payout_minor, rule_version, verified_by, verified_at
  ) values (
    p_challenge_id,
    case when is_void then 'VOID' else 'VERIFIED' end,
    normalized_source,
    normalized_provider_event_id,
    p_result_payload_hash,
    effective_outcome,
    gross_pool_minor,
    0,
    payout_total_minor,
    normalized_rules_version,
    null,
    clock_timestamp()
  ) returning id into settlement_id;

  update public.challenges
  set status = case when is_void then 'REFUNDED' else 'SETTLED' end,
      settled_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = p_challenge_id;

  response := jsonb_build_object(
    'challenge_id', p_challenge_id,
    'challenge_status', case when is_void then 'REFUNDED' else 'SETTLED' end,
    'settlement_id', settlement_id,
    'ledger_transaction_id', ledger_transaction_id,
    'settlement_status', case when is_void then 'VOID' else 'VERIFIED' end
  );

  insert into peerarena_private.command_idempotency (
    actor_user_id, command_name, idempotency_key, request_hash, response
  ) values (
    actor_id, 'VERIFY_SETTLE_SYNTHETIC', normalized_idempotency_key, request_hash, response
  );

  insert into public.audit_events (
    actor_user_id, action, entity_type, entity_id, request_id, event_hash, metadata
  ) values (
    actor_id,
    'VERIFY_AND_SETTLE_SYNTHETIC',
    'challenge',
    p_challenge_id,
    request_id,
    repeat('0', 64),
    jsonb_build_object(
      'synthetic_only', true,
      'result_source', normalized_source,
      'provider_event_id', normalized_provider_event_id,
      'result_payload_hash', p_result_payload_hash,
      'outcome', effective_outcome,
      'gross_pool_minor', gross_pool_minor,
      'payout_minor', payout_total_minor,
      'ledger_transaction_id', ledger_transaction_id
    )
  );

  return query select
    p_challenge_id,
    case when is_void then 'REFUNDED' else 'SETTLED' end,
    settlement_id,
    ledger_transaction_id,
    case when is_void then 'VOID' else 'VERIFIED' end,
    false;
end;
$$;

alter function peerarena_api.verify_and_settle_synthetic_challenge(uuid, text, text, text, text, text, text)
  owner to peerarena_procedure_owner;
revoke all on function peerarena_api.verify_and_settle_synthetic_challenge(uuid, text, text, text, text, text, text) from public;
grant usage on schema peerarena_api to peerarena_settlement_worker;
grant execute on function peerarena_api.verify_and_settle_synthetic_challenge(uuid, text, text, text, text, text, text)
  to peerarena_settlement_worker;

commit;
