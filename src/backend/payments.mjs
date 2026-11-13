export const PAYMENT_PROVIDERS = Object.freeze(["seevplus", "paystack", "mock"]);

export const PAYMENT_PROVIDER_MANIFEST = Object.freeze({
  seevplus: Object.freeze({
    provider: "seevplus",
    credential: "SEEV_CHECKOUT_API_KEY",
    docs: "https://docs.seevcash.com/docs",
    endpoints: Object.freeze({
      initializePayment: "https://api.seevplus.com/api/v1/developer/payments",
      verifyPayment: "https://api.seevplus.com/api/v1/developer/payments/{sessionReference}"
    }),
    webhookSignature: "PENDING_PROVIDER_CONFIRMATION",
    payoutCapability: "PENDING_WRITTEN_PROVIDER_CONFIRMATION"
  }),
  paystack: Object.freeze({
    provider: "paystack",
    credential: "PAYSTACK_SECRET_KEY",
    docs: "https://paystack.com/docs",
    endpoints: Object.freeze({
      initializePayment: "https://api.paystack.co/transaction/initialize",
      verifyPayment: "https://api.paystack.co/transaction/verify/{reference}",
      createTransfer: "https://api.paystack.co/transfer",
      verifyTransfer: "https://api.paystack.co/transfer/verify/{reference}"
    }),
    webhookSignature: "Paystack-Signature-or-x-paystack-signature",
    payoutCapability: "PENDING_WRITTEN_PROVIDER_CONFIRMATION"
  })
});

class DisabledProvider {
  constructor(name) {
    this.name = name;
    this.manifest = PAYMENT_PROVIDER_MANIFEST[name];
  }

  getCapabilities() {
    return Object.freeze({
      provider: this.name,
      collection: false,
      payout: false,
      webhook: false,
      sandboxReady: false,
      manifest: this.manifest,
      reason: "Provider credentials and approved gaming use case are not configured."
    });
  }

  supportsCollection() { return false; }
  supportsPayout() { return false; }
  initializePayment() { throw new Error(`${this.name} collection adapter is disabled until provider approval and credentials are configured.`); }
  verifyPayment() { throw new Error(`${this.name} verification adapter is disabled.`); }
  verifyWebhook() { return false; }
  reconcilePayment() { throw new Error(`${this.name} reconciliation adapter is disabled.`); }
  createPayout() { throw new Error(`${this.name} payout adapter is disabled; no payout capability is assumed.`); }
  getPayoutStatus() { throw new Error(`${this.name} payout adapter is disabled.`); }
}

export class SeevPlusProvider extends DisabledProvider {
  constructor() { super("seevplus"); }
}

export class PaystackProvider extends DisabledProvider {
  constructor() { super("paystack"); }
}

export class MockPaymentProvider {
  constructor() {
    this.name = "mock";
    this.payments = new Map();
    this.payouts = new Map();
    this.webhookEvents = new Set();
  }

  getCapabilities() { return Object.freeze({ provider: this.name, collection: true, payout: true, webhook: true, simulated: true }); }
  supportsCollection() { return true; }
  supportsPayout() { return true; }

  initializePayment({ reference, amountMinor, currency = "GHS", outcome = "SUCCESS", delayed = false }) {
    if (this.payments.has(reference)) return this.payments.get(reference);
    const desiredStatus = String(outcome).toUpperCase();
    if (!["SUCCESS", "FAILED"].includes(desiredStatus)) throw new Error("Mock payment outcome must be SUCCESS or FAILED.");
    const payment = Object.freeze({ provider: this.name, reference, amountMinor: String(amountMinor), currency, status: "PENDING", desiredStatus, delayed: Boolean(delayed), simulated: true });
    this.payments.set(reference, payment);
    return payment;
  }

  verifyPayment(reference) {
    const current = this.payments.get(reference);
    if (!current) return { provider: this.name, reference, status: "NOT_FOUND", simulated: true };
    if (current.delayed && current.status === "PENDING") return current;
    const verified = Object.freeze({ ...current, status: current.desiredStatus, providerReference: `MOCK-${reference}` });
    this.payments.set(reference, verified);
    return verified;
  }

  simulatePayment(reference, status) {
    const current = this.payments.get(reference);
    if (!current) throw new Error("Mock payment not found.");
    const nextStatus = String(status).toUpperCase();
    if (!["PENDING", "SUCCESS", "FAILED"].includes(nextStatus)) throw new Error("Unsupported mock payment status.");
    const updated = Object.freeze({ ...current, status: nextStatus, delayed: nextStatus === "PENDING", desiredStatus: nextStatus === "PENDING" ? current.desiredStatus : nextStatus });
    this.payments.set(reference, updated);
    return updated;
  }

  verifyWebhook(rawBody, signature) {
    return signature === "mock-valid" && typeof rawBody === "string";
  }

  processWebhook({ eventReference, reference, rawBody, signature, status = "SUCCESS" }) {
    if (!this.verifyWebhook(rawBody, signature)) throw new Error("Mock webhook signature is invalid.");
    if (this.webhookEvents.has(eventReference)) return Object.freeze({ provider: this.name, eventReference, duplicate: true, status: "IGNORED" });
    this.webhookEvents.add(eventReference);
    const payment = this.simulatePayment(reference, status);
    return Object.freeze({ provider: this.name, eventReference, duplicate: false, status: "APPLIED", payment });
  }

  reconcilePayment(reference) { return this.verifyPayment(reference); }

  createPayout({ reference, userId, amountMinor, currency = "GHS", outcome = "SUCCESS", delayed = false }) {
    if (this.payouts.has(reference)) return this.payouts.get(reference);
    const desiredStatus = String(outcome).toUpperCase();
    if (!["SUCCESS", "FAILED"].includes(desiredStatus)) throw new Error("Mock payout outcome must be SUCCESS or FAILED.");
    const payout = Object.freeze({ provider: this.name, reference, userId, amountMinor: String(amountMinor), currency, status: delayed ? "PROVIDER_PENDING" : desiredStatus === "SUCCESS" ? "COMPLETED" : "FAILED", desiredStatus, delayed: Boolean(delayed), simulated: true, providerReference: `MOCK-PAYOUT-${reference}` });
    this.payouts.set(reference, payout);
    return payout;
  }

  simulatePayout(reference, status) {
    const current = this.payouts.get(reference);
    if (!current) throw new Error("Mock payout not found.");
    const nextStatus = String(status).toUpperCase();
    const statusMap = { PENDING: "PROVIDER_PENDING", SUCCESS: "COMPLETED", FAILED: "FAILED" };
    if (!statusMap[nextStatus]) throw new Error("Unsupported mock payout status.");
    const updated = Object.freeze({ ...current, status: statusMap[nextStatus], delayed: nextStatus === "PENDING", desiredStatus: nextStatus === "PENDING" ? current.desiredStatus : nextStatus });
    this.payouts.set(reference, updated);
    return updated;
  }

  getPayoutStatus(reference) { return this.payouts.get(reference) ?? { provider: this.name, reference, status: "NOT_FOUND", simulated: true }; }
}

export function createPaymentProvider(name = "mock", { mockPaymentsEnabled = true } = {}) {
  const normalized = String(name).toLowerCase();
  if (normalized === "mock" && mockPaymentsEnabled) return new MockPaymentProvider();
  if (normalized === "seevplus") return new SeevPlusProvider();
  if (normalized === "paystack") return new PaystackProvider();
  throw new Error(`Unsupported payment provider: ${name}`);
}
