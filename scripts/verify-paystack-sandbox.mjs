import { pathToFileURL } from "node:url";
import { createPaymentProviderFromEnv, PaymentProviderError } from "../src/backend/payments.mjs";

export async function verifySandboxTransaction({ args, env = process.env, fetchImpl = globalThis.fetch }) {
  if (env.APP_ENV !== "staging" || env.PAYMENT_MODE !== "sandbox"
    || env.PAYMENT_PROVIDER !== "paystack" || env.REAL_MONEY_ENABLED !== "false"
    || !/^sk_test_[A-Za-z0-9]+$/.test(env.PAYSTACK_SECRET_KEY ?? "")) {
    throw new PaymentProviderError("Staging, Paystack sandbox mode, REAL_MONEY_ENABLED=false and a test secret are required.", {
      code: "PAYMENT_SANDBOX_NOT_CONFIGURED", status: 503
    });
  }
  if (args.length !== 3) {
    throw new PaymentProviderError("Usage: npm run payments:verify -- REFERENCE AMOUNT_MINOR CURRENCY", {
      code: "PAYMENT_INVALID_INPUT", status: 400
    });
  }
  const [reference, amountMinor, currency] = args;
  const provider = createPaymentProviderFromEnv(env, fetchImpl);
  return provider.verifyExpectedPayment({ reference, amountMinor, currency });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await verifySandboxTransaction({ args: process.argv.slice(2) });
    console.log(JSON.stringify(result));
    if (result.status !== "SUCCESS") process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      code: error instanceof PaymentProviderError ? error.code : "PAYMENT_VERIFICATION_FAILED",
      error: error instanceof PaymentProviderError ? error.message : "Sandbox verification could not be completed."
    }));
    process.exitCode = 1;
  }
}
