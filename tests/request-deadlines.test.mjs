import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseProfileRepository } from "../src/backend/profiles.mjs";
import { SupabaseChallengeRepository } from "../src/backend/challenges.mjs";
import { SupabaseCatalogueRepository } from "../src/backend/catalogue.mjs";
import { SupabaseAdminRepository } from "../src/backend/admin.mjs";
import { createPaymentProvider } from "../src/backend/payments.mjs";
import { realMoneyGate } from "../src/backend/config.mjs";

const options = {
  url: "https://peerarena.supabase.co",
  secretKey: "test-server-key",
  publishableKey: "test-public-key",
  timeoutMs: 20
};
const repositories = [
  ["profile", SupabaseProfileRepository, (repo) => repo.getByAuthUserId("00000000-0000-4000-8000-000000000001")],
  ["challenge", SupabaseChallengeRepository, (repo) => repo.listPublic()],
  ["catalogue", SupabaseCatalogueRepository, (repo) => repo.listSports()],
  ["admin", SupabaseAdminRepository, (repo) => repo.listUsers()]
];

function stalledFetch(stage, onAbort) {
  return async (_url, { signal }) => {
    const stall = () => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        onAbort();
        reject(signal.reason);
      }, { once: true });
    });
    return stage === "headers" ? stall() : { ok: true, text: stall };
  };
}

for (const [name, Repository, read] of repositories) {
  for (const stage of ["headers", "body"]) {
    test(`${name} repository aborts stalled ${stage} with a safe 503`, { timeout: 2_000 }, async () => {
      let aborted = false;
      const repo = new Repository({ ...options, fetchImpl: stalledFetch(stage, () => { aborted = true; }) });
      await assert.rejects(() => read(repo), (error) => {
        assert.equal(error.code, "PERSISTENCE_NETWORK_ERROR");
        assert.equal(error.status, 503);
        assert.match(error.message, /service is unavailable/);
        return true;
      });
      assert.equal(aborted, true);
    });
  }
  test(`${name} repository rejects invalid deadlines`, () => {
    for (const timeoutMs of [0, -1, 30_001, Infinity, NaN, "1000"]) {
      assert.throws(() => new Repository({ ...options, timeoutMs }), /timeout must be between/);
    }
  });
}

for (const name of ["paystack", "seevplus"]) {
  for (const stage of ["headers", "body"]) {
    test(`${name} payment verification aborts stalled ${stage}`, { timeout: 2_000 }, async () => {
      let aborted = false;
      const provider = createPaymentProvider(name, {
        mode: "sandbox", apiKey: "sandbox-key", timeoutMs: 20,
        fetchImpl: stalledFetch(stage, () => { aborted = true; })
      });
      await assert.rejects(() => provider.verifyPayment("reference-1"), {
        code: "PAYMENT_PROVIDER_TIMEOUT", status: 503,
        message: "Payment provider is unavailable."
      });
      assert.equal(aborted, true);
    });
  }
  test(`${name} rejects invalid deadlines`, () => {
    for (const timeoutMs of [0, -1, 30_001, Infinity, NaN, "1000"]) {
      assert.throws(() => createPaymentProvider(name, {
        mode: "sandbox", apiKey: "sandbox-key", timeoutMs
      }), { code: "PAYMENT_INVALID_CONFIG" });
    }
  });
}

test("approval flags cannot mark unimplemented real-money processing ready", () => {
  const gate = realMoneyGate({
    realMoneyEnabled: true, appEnv: "production",
    productionAuthorization: "VERIFIED", paymentProviderApproved: true,
    gamingAuthorizationVerified: true, safeguardingVerified: true,
    securityReviewVerified: true, ownedDatabaseReady: true
  });
  assert.equal(gate.enabled, false);
  assert.deepEqual(gate.blockers, ["production payment processing, reconciliation and payouts are not implemented"]);
});
