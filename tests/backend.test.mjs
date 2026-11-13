import assert from "node:assert/strict";
import test from "node:test";
import { realMoneyGate } from "../src/backend/config.mjs";
import {
  assertBalanced,
  calculateSharedPoolPayout,
  fromMinorUnits,
  makeBalancedTransaction,
  toMinorUnits
} from "../src/backend/ledger.mjs";
import { createPaymentProvider, MockPaymentProvider, PAYMENT_PROVIDER_MANIFEST } from "../src/backend/payments.mjs";
import { determineSettlement } from "../src/backend/settlement.mjs";
import { SlidingWindowRateLimiter } from "../src/backend/rate-limit.mjs";

test("ledger converts exact minor units without floating point arithmetic", () => {
  assert.equal(toMinorUnits("20.05"), 2005n);
  assert.equal(fromMinorUnits(2005n), "20.05");
  assert.throws(() => toMinorUnits("20.051"));
});

test("ledger transactions must balance", () => {
  const transaction = makeBalancedTransaction({
    id: "txn-1",
    type: "STAKE_RESERVATION",
    currency: "GHS",
    reference: "challenge-1",
    entries: [
      { account: "customer-liability", direction: "DEBIT", amountMinor: 2000 },
      { account: "reserved-stakes", direction: "CREDIT", amountMinor: 2000 }
    ]
  });
  assert.deepEqual(assertBalanced(transaction.entries), { debits: 2000n, credits: 2000n });
  assert.throws(() => assertBalanced([{ direction: "DEBIT", amountMinor: 1 }, { direction: "CREDIT", amountMinor: 2 }]));
});

test("shared pool payout distributes integer remainder deterministically", () => {
  const result = calculateSharedPoolPayout({ grossPoolMinor: 10001, winnerIds: ["u1", "u2", "u3"] });
  assert.deepEqual(result.payouts, [
    { userId: "u1", amountMinor: "3334" },
    { userId: "u2", amountMinor: "3334" },
    { userId: "u3", amountMinor: "3333" }
  ]);
});

test("mock provider supports idempotent simulated collection, webhook and payout flows", () => {
  const provider = createPaymentProvider("mock");
  assert.ok(provider instanceof MockPaymentProvider);
  const first = provider.initializePayment({ reference: "order-1", amountMinor: 1000, currency: "GHS" });
  assert.equal(provider.initializePayment({ reference: "order-1", amountMinor: 9999 }).amountMinor, "1000");
  assert.equal(provider.verifyPayment(first.reference).status, "SUCCESS");
  assert.equal(provider.verifyWebhook("{}", "mock-valid"), true);
  assert.equal(provider.createPayout({ reference: "settlement-1", userId: "u1", amountMinor: 1000 }).status, "COMPLETED");
  assert.equal(provider.getPayoutStatus("settlement-1").status, "COMPLETED");
});

test("mock provider models delayed, failed and duplicate webhook scenarios", () => {
  const provider = new MockPaymentProvider();
  provider.initializePayment({ reference: "order-delayed", amountMinor: 1000, delayed: true });
  assert.equal(provider.verifyPayment("order-delayed").status, "PENDING");
  const applied = provider.processWebhook({ eventReference: "evt-1", reference: "order-delayed", rawBody: "{}", signature: "mock-valid", status: "SUCCESS" });
  assert.equal(applied.status, "APPLIED");
  assert.equal(provider.processWebhook({ eventReference: "evt-1", reference: "order-delayed", rawBody: "{}", signature: "mock-valid", status: "SUCCESS" }).duplicate, true);
  provider.initializePayment({ reference: "order-failed", amountMinor: 1000, outcome: "FAILED" });
  assert.equal(provider.verifyPayment("order-failed").status, "FAILED");
  assert.equal(provider.createPayout({ reference: "payout-pending", userId: "u1", amountMinor: 1000, delayed: true }).status, "PROVIDER_PENDING");
  assert.equal(provider.simulatePayout("payout-pending", "FAILED").status, "FAILED");
});

test("external providers fail closed until approved credentials are configured", () => {
  const provider = createPaymentProvider("paystack");
  assert.equal(provider.getCapabilities().collection, false);
  assert.equal(provider.supportsPayout(), false);
  assert.equal(provider.getCapabilities().manifest.endpoints.initializePayment, PAYMENT_PROVIDER_MANIFEST.paystack.endpoints.initializePayment);
  assert.throws(() => provider.initializePayment({ reference: "order-1", amountMinor: 100 }));
});

test("settlement handles multiple winners and preserves the pool total", () => {
  const result = determineSettlement({
    challenge: {
      participants: [
        { id: "u1", prediction: "HOME", stake: "10.00" },
        { id: "u2", prediction: "HOME", stake: "10.00" },
        { id: "u3", prediction: "AWAY", stake: "10.00" }
      ]
    },
    verifiedOutcome: "HOME"
  });
  assert.equal(result.status, "SETTLED");
  assert.equal(result.payouts.reduce((sum, payout) => sum + BigInt(payout.amountMinor), 0n), 3000n);
});

test("real-money activation is default-deny even when an individual flag is set", () => {
  const gate = realMoneyGate({
    appEnv: "production",
    realMoneyEnabled: true,
    productionAuthorization: "VERIFIED",
    paymentProviderApproved: true,
    gamingAuthorizationVerified: true,
    safeguardingVerified: false,
    securityReviewVerified: true
  });
  assert.equal(gate.enabled, false);
  assert.match(gate.blockers.join(" "), /safeguarding/);
});

test("rate limiter returns retry metadata and resets after its window", () => {
  let now = 1_000;
  const limiter = new SlidingWindowRateLimiter({ windowMs: 1_000, maxRequests: 2, now: () => now });
  assert.equal(limiter.consume("client-1").allowed, true);
  assert.equal(limiter.consume("client-1").remaining, 0);
  const blocked = limiter.consume("client-1");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 1);
  now += 1_000;
  assert.equal(limiter.consume("client-1").allowed, true);
});
