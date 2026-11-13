-- PeerArena role bootstrap contract for an owner-operated PostgreSQL cluster.
--
-- Run as a cluster administrator before the migrations. This file creates no
-- login and no password. Provision a separate certificate/password login
-- outside source control, then grant it membership in the least-privileged
-- role required for its job.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'peerarena_procedure_owner') then
    create role peerarena_procedure_owner no login noinherit nosuperuser nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'peerarena_runtime') then
    create role peerarena_runtime no login noinherit nosuperuser nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'peerarena_reporter') then
    create role peerarena_reporter no login noinherit nosuperuser nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'peerarena_backup') then
    create role peerarena_backup no login noinherit nosuperuser nobypassrls;
  end if;
end;
$$;

alter role peerarena_procedure_owner no login noinherit nosuperuser nobypassrls connection limit 5;
alter role peerarena_runtime no login noinherit nosuperuser nobypassrls connection limit 100;
alter role peerarena_reporter no login noinherit nosuperuser nobypassrls connection limit 5;
alter role peerarena_backup no login noinherit nosuperuser nobypassrls connection limit 2;

-- Avoid accidental object lookup through a caller-controlled search_path.
alter role peerarena_procedure_owner set search_path = pg_catalog;
alter role peerarena_runtime set search_path = pg_catalog;
alter role peerarena_reporter set search_path = pg_catalog;
alter role peerarena_backup set search_path = pg_catalog;

-- Bound stuck requests and transactions. Procedure-level work may set a
-- narrower timeout, but no application role may remove these defaults without
-- an explicit reviewed role change.
alter role peerarena_runtime set statement_timeout = '15s';
alter role peerarena_runtime set lock_timeout = '5s';
alter role peerarena_runtime set idle_in_transaction_session_timeout = '30s';
alter role peerarena_reporter set statement_timeout = '30s';
alter role peerarena_reporter set idle_in_transaction_session_timeout = '30s';
alter role peerarena_backup set statement_timeout = '10min';
alter role peerarena_backup set idle_in_transaction_session_timeout = '2min';

revoke create on schema public from public;
