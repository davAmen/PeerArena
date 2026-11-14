import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Supabase foundation migration declares the required protected domain", async () => {
  const sql = await readFile(new URL("../supabase/migrations/0001_peerarena_foundation.sql", import.meta.url), "utf8");
  for (const table of [
    "profiles",
    "user_verifications",
    "sports",
    "competitions",
    "sporting_events",
    "prediction_markets",
    "challenges",
    "challenge_participants",
    "payout_destinations",
    "financial_accounts",
    "financial_transactions",
    "ledger_entries",
    "settlement_records",
    "payouts",
    "payment_attempts",
    "payment_webhook_events",
    "user_notifications",
    "disputes",
    "audit_logs",
    "system_settings"
  ]) {
    assert.match(sql, new RegExp(`create table public\\.${table}\\b`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(sql, /assert_posted_ledger_transaction_balanced/);
  assert.match(sql, /'real_money_enabled', 'false'::jsonb/);
  assert.doesNotMatch(sql, /REAL_MONEY_ENABLED=true/);
});

test("owned PostgreSQL hardening migration is default-deny and preserves integrity evidence", async () => {
  const sql = await readFile(new URL("../database/migrations/0001_owned_postgres_hardening.sql", import.meta.url), "utf8");
  assert.match(sql, /revoke all on all tables in schema public from public/i);
  assert.match(sql, /force row level security/i);
  assert.match(sql, /reject_immutable_mutation/);
  assert.match(sql, /assert_ledger_transaction_balanced/);
  assert.match(sql, /assert_ledger_entry_currency/);
  assert.match(sql, /chain_audit_event/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.doesNotMatch(sql, /grant\s+all\s+on\s+all\s+tables/i);
  assert.doesNotMatch(sql, /create\s+role\s+\w+\s+login/i);
});

test("owned create-challenge procedure is narrow, idempotent and not publicly executable", async () => {
  const sql = await readFile(new URL("../database/migrations/0002_owned_create_challenge_procedure.sql", import.meta.url), "utf8");
  assert.match(sql, /create or replace function peerarena_api\.create_challenge/);
  assert.match(sql, /current_actor_id/);
  assert.match(sql, /command_idempotency/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /self_excluded_until/);
  assert.match(sql, /AWAITING_ACCEPTANCE/);
  assert.match(sql, /revoke all on function peerarena_api\.create_challenge/);
  assert.match(sql, /grant execute on function peerarena_api\.create_challenge[\s\S]*peerarena_runtime/);
  assert.doesNotMatch(sql, /function\s+peerarena_api\.(settle|payout|payment)/i);
});

test("owned accept-challenge procedure reserves synthetic stake atomically", async () => {
  const sql = await readFile(new URL("../database/migrations/0003_owned_accept_challenge_procedure.sql", import.meta.url), "utf8");
  assert.match(sql, /create or replace function peerarena_api\.accept_challenge/);
  assert.match(sql, /peerarena_private\.current_actor_id/);
  assert.match(sql, /ACCEPT_CHALLENGE/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /self-exclusion blocks challenge acceptance/i);
  assert.match(sql, /is_demo = true/);
  assert.match(sql, /ledger_transactions/);
  assert.match(sql, /reserved_account_id/);
  assert.match(sql, /FUNDS_CONFIRMED/);
  assert.match(sql, /synthetic_only/);
  assert.match(sql, /revoke all on function peerarena_api\.accept_challenge/);
  assert.match(sql, /grant execute on function peerarena_api\.accept_challenge[\s\S]*peerarena_runtime/);
  assert.doesNotMatch(sql, /create or replace function peerarena_api\.(settle|payout|payment)/i);
});

test("owned database role bootstrap creates no credentials and constrains sessions", async () => {
  const sql = await readFile(new URL("../database/bootstrap/0000_roles.sql", import.meta.url), "utf8");
  assert.match(sql, /no login/i);
  assert.match(sql, /nosuperuser/i);
  assert.match(sql, /nobypassrls/i);
  assert.match(sql, /statement_timeout/);
  assert.match(sql, /idle_in_transaction_session_timeout/);
  assert.doesNotMatch(sql, /password\s+'[^']+'/i);
  assert.doesNotMatch(sql, /create\s+role\s+\w+\s+login/i);
});
