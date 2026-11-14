import assert from "node:assert/strict";
import test from "node:test";
import { createPaymentProvider } from "../src/backend/payments.mjs";
import { verifySandboxTransaction } from "../scripts/verify-paystack-sandbox.mjs";

const transaction = { reference: "test-reference", status: "success", domain: "test", amount: 5000, currency: "GHS" };
const expected = { reference: transaction.reference, amountMinor: "5000", currency: "GHS" };
const environment = {
  APP_ENV: "staging", PAYMENT_MODE: "sandbox", PAYMENT_PROVIDER: "paystack",
  REAL_MONEY_ENABLED: "false", PAYSTACK_SECRET_KEY: "sk_test_fixture"
};
function provider(data = transaction, status = true) {
  return createPaymentProvider("paystack", {
    mode: "sandbox", apiKey: "sk_test_fixture",
    fetchImpl: async () => new Response(JSON.stringify({ status, data }))
  });
}

test("Paystack rejects live or malformed credentials before collection or verification", async () => {
  for (const apiKey of ["sk_live_fixture", "pk_test_fixture", "arbitrary-key", ""]) {
    let calls = 0;
    const client = createPaymentProvider("paystack", { apiKey, fetchImpl: async () => { calls++; } });
    assert.equal(client.getCapabilities().collection, false);
    await assert.rejects(() => client.initializePayment({}), { code: "PAYMENT_PROVIDER_DISABLED" });
    await assert.rejects(() => client.verifyPayment("test-reference"), { code: "PAYMENT_PROVIDER_DISABLED" });
    assert.equal(calls, 0);
  }
});

for (const [label, patch] of [
  ["live environment", { domain: "live" }], ["missing environment", { domain: undefined }],
  ["different reference", { reference: "another-reference" }], ["missing reference", { reference: undefined }],
  ["negative amount", { amount: -1 }], ["fractional amount", { amount: 50.5 }],
  ["unsafe amount", { amount: Number.MAX_SAFE_INTEGER + 1 }], ["string amount", { amount: "5000" }],
  ["missing currency", { currency: undefined }], ["invalid currency", { currency: "ghs" }],
  ["unknown status", { status: "invented" }]
]) {
  test(`Paystack verification rejects ${label}`, async () => {
    await assert.rejects(() => provider({ ...transaction, ...patch }).verifyPayment(transaction.reference),
      { code: "PAYMENT_VERIFICATION_INVALID" });
  });
}

test("Paystack API success flag cannot be confused with transaction success", async () => {
  await assert.rejects(() => provider(transaction, false).verifyPayment(transaction.reference),
    { code: "PAYMENT_VERIFICATION_INVALID" });
  const pending = await provider({ ...transaction, status: "pending" }).verifyExpectedPayment(expected);
  assert.equal(pending.status, "PENDING");
  assert.equal(pending.fundsCredited, false);
});

test("Paystack verification matches exact amount and currency", async () => {
  for (const patch of [{ amountMinor: "4999" }, { currency: "NGN" }]) {
    await assert.rejects(() => provider().verifyExpectedPayment({ ...expected, ...patch }),
      { code: "PAYMENT_VERIFICATION_MISMATCH" });
  }
  const result = await provider({ ...transaction, customer: { email: "private@example.com" } }).verifyExpectedPayment(expected);
  assert.deepEqual(result, {
    provider: "paystack", reference: transaction.reference, status: "SUCCESS",
    amountMinor: "5000", currency: "GHS", sandbox: true, matched: true, fundsCredited: false
  });
  assert.equal(JSON.stringify(result).includes("private@example.com"), false);
});

test("sandbox verification tool makes only a GET and returns redacted evidence", async () => {
  let calls = 0;
  const result = await verifySandboxTransaction({
    env: environment, args: ["test-reference", "5000", "GHS"],
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url, "https://api.paystack.co/transaction/verify/test-reference");
      assert.equal(init.method, "GET");
      assert.equal(init.headers.Authorization, "Bearer sk_test_fixture");
      return new Response(JSON.stringify({ status: true, data: transaction }));
    }
  });
  assert.equal(calls, 1);
  assert.equal(result.fundsCredited, false);
});

test("sandbox verification tool rejects unsafe configuration before network access", async () => {
  for (const patch of [
    { APP_ENV: "production" }, { APP_ENV: undefined }, { PAYMENT_MODE: "live" },
    { PAYMENT_PROVIDER: "mock" }, { REAL_MONEY_ENABLED: "true" },
    { PAYSTACK_SECRET_KEY: "sk_live_fixture" }, { PAYSTACK_SECRET_KEY: undefined }
  ]) {
    await assert.rejects(() => verifySandboxTransaction({
      env: { ...environment, ...patch }, args: ["test-reference", "5000", "GHS"],
      fetchImpl: async () => assert.fail("must not call provider")
    }), { code: "PAYMENT_SANDBOX_NOT_CONFIGURED" });
  }
});
