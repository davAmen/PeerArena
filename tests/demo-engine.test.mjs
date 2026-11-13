import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptChallenge,
  createChallenge,
  createInitialState,
  getPredictionChoices,
  setSelfExclusion,
  settleChallenge
} from "../src/demo-engine.mjs";

const NOW = Date.parse("2026-11-13T12:00:00.000Z");

test("demo state is explicitly non-redeemable", () => {
  const state = createInitialState(NOW);
  assert.equal(state.demoMode, true);
  assert.equal(state.realMoneyEnabled, false);
  assert.equal(state.platform.currency, "DEMO");
});
test("prediction choices remain binary for the MVP markets", () => {
  const state = createInitialState(NOW);
  const event = state.events[0];
  assert.deepEqual(getPredictionChoices(event, "Total goals"), ["Over 2.5", "Under 2.5"]);
  assert.deepEqual(getPredictionChoices(event, "Match result"), ["Hearts of Oak", "Asante Kotoko"]);
});

test("creator stake is reserved and challenge is auditable", () => {
  const state = createInitialState(NOW);
  const before = state.user.balance;
  const challenge = createChallenge(state, {
    eventId: "evt_hearts_kotoko",
    market: "Total goals",
    prediction: "Over 2.5",
    stake: 20,
    visibility: "PRIVATE",
    expiryHours: 6
  }, NOW);
  assert.equal(challenge.status, "AWAITING_ACCEPTANCE");
  assert.equal(state.user.balance, before - 20);
  assert.equal(state.transactions[0].type, "DEMO_STAKE_RESERVED");
  assert.equal(state.auditLog[0].action, "CHALLENGE_CREATED");
});

test("acceptance matches a challenge and settlement pays the synthetic pool once", () => {
  const state = createInitialState(NOW);
  const before = state.user.balance;
  const accepted = acceptChallenge(state, "ch_open_hearts", NOW);
  assert.equal(accepted.status, "FUNDS_CONFIRMED");
  assert.equal(accepted.grossPool, 100);
  assert.equal(state.user.balance, before - 50);
  const settled = settleChallenge(state, "ch_open_hearts", "CHALLENGER_WINS", NOW + 1000);
  assert.equal(settled.status, "SETTLED");
  assert.equal(settled.settlement.payout, 100);
  assert.equal(state.user.balance, before + 50);
  assert.equal(state.transactions[0].type, "DEMO_PAYOUT");
});

test("void settlement refunds the user's reserved stake", () => {
  const state = createInitialState(NOW);
  const before = state.user.balance;
  acceptChallenge(state, "ch_open_hearts", NOW);
  const afterAccept = state.user.balance;
  const voided = settleChallenge(state, "ch_open_hearts", "VOID", NOW + 1000);
  assert.equal(voided.status, "VOIDED");
  assert.equal(state.user.balance, afterAccept + 50);
  assert.equal(state.transactions[0].type, "DEMO_REFUND");
  assert.equal(state.user.balance, before);
});

test("self-exclusion blocks new challenges", () => {
  const state = createInitialState(NOW);
  setSelfExclusion(state, true, NOW);
  assert.throws(() => createChallenge(state, {
    eventId: "evt_hearts_kotoko",
    market: "Total goals",
    prediction: "Over 2.5",
    stake: 10
  }, NOW), /self-excluded/);
});
