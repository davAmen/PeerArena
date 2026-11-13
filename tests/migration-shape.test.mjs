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
