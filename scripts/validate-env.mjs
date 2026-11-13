import { readRuntimeConfig, realMoneyGate } from "../src/backend/config.mjs";

const config = readRuntimeConfig();
const gate = realMoneyGate(config);

if (config.realMoneyEnabled && !gate.enabled) {
  throw new Error(`REAL_MONEY_ENABLED cannot be true while the activation gate is blocked: ${gate.blockers.join("; ")}`);
}

console.log(JSON.stringify({
  appEnv: config.appEnv,
  authMode: config.authMode,
  paymentMode: config.paymentMode,
  realMoneyEnabled: config.realMoneyEnabled,
  gate: gate.enabled ? "READY_FOR_SEPARATE_REVIEW" : "BLOCKED",
  blockers: gate.blockers
}, null, 2));
