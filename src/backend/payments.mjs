import { createHmac, timingSafeEqual } from "node:crypto";

export const PAYMENT_PROVIDERS = Object.freeze(["seevplus", "paystack", "mock"]);

export const PAYMENT_PROVIDER_MANIFEST = Object.freeze({
  seevplus: Object.freeze({
    provider: "seevplus",
    sandbox: true,
    credential: "SEEV_CHECKOUT_API_KEY",
    docs: "https://docs.seevcash.com/docs",
    endpoints: Object.freeze({
      initializePayment: "https://api.seevplus.com/api/v1/developer/payments",
      verifyPayment: "https://api.seevplus.com/api/v1/developer/payments/{sessionReference}"
    }),
    webhookSignature: "HMAC-SHA256(timestamp + '.' + rawBody), X-Seev-Signature=v1=hex",
    payoutCapability: "DISABLED_UNTIL_WRITTEN_PROVIDER_APPROVAL"
  }),
  paystack: Object.freeze({
    provider: "paystack",
    sandbox: true,
    credential: "PAYSTACK_SECRET_KEY",
    docs: "https://paystack.com/docs",
    endpoints: Object.freeze({
      initializePayment: "https://api.paystack.co/transaction/initialize",
      verifyPayment: "https://api.paystack.co/transaction/verify/{reference}",
      createTransfer: "https://api.paystack.co/transfer",
      verifyTransfer: "https://api.paystack.co/transfer/verify/{reference}"
    }),
    webhookSignature: "HMAC-SHA512(rawBody), x-paystack-signature=hex",
    payoutCapability: "DISABLED_UNTIL_WRITTEN_PROVIDER_APPROVAL"
  })
});

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_SEEV_TIMESTAMP_WINDOW_SECONDS = 300;
const PAYMENT_SUCCESS_STATUSES = new Set(["success", "succeeded", "completed"]);
const PAYMENT_FAILURE_STATUSES = new Set(["failed", "cancelled", "canceled", "reversed", "abandoned"]);

export class PaymentProviderError extends Error {
  constructor(message, { code = "PAYMENT_PROVIDER_ERROR", status = 500, providerStatus = undefined, cause = undefined } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PaymentProviderError";
    this.code = code;
    this.status = status;
    this.providerStatus = providerStatus;
  }
}

function requiredString(value, name, { maxLength = 2_048 } = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PaymentProviderError(`${name} is required.`, { code: "PAYMENT_INVALID_INPUT", status: 400 });
  }
  if (value.length > maxLength) {
    throw new PaymentProviderError(`${name} is too long.`, { code: "PAYMENT_INVALID_INPUT", status: 400 });
  }
  return value.trim();
}

function emailAddress(value) {
  const email = requiredString(value, "Customer email", { maxLength: 320 }).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new PaymentProviderError("Customer email is invalid.", { code: "PAYMENT_INVALID_INPUT", status: 400 });
  }
  return email;
}

function minorAmount(value) {
  const text = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(text)) {
    throw new PaymentProviderError("Payment amount must be a positive integer in minor units.", { code: "PAYMENT_INVALID_INPUT", status: 400 });
  }
  const amount = BigInt(text);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PaymentProviderError("Payment amount exceeds the provider adapter limit.", { code: "PAYMENT_INVALID_INPUT", status: 400 });
  }
  return Number(amount);
}

function currencyCode(value = "GHS") {
  const currency = requiredString(value, "Payment currency", { maxLength: 3 }).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new PaymentProviderError("Payment currency is invalid.", { code: "PAYMENT_INVALID_INPUT", status: 400 });
  }
  return currency;
}

function httpUrl(value, name) {
  const raw = requiredString(value, name, { maxLength: 2_048 });
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new PaymentProviderError(`${name} is invalid.`, { code: "PAYMENT_INVALID_INPUT", status: 400 });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new PaymentProviderError(`${name} must use HTTP or HTTPS.`, { code: "PAYMENT_INVALID_INPUT", status: 400 });
  }
  return parsed.href;
}

function idempotencyKey(value) {
  const key = requiredString(value, "Idempotency key", { maxLength: MAX_IDEMPOTENCY_KEY_LENGTH });
  if (key.length < 8) {
    throw new PaymentProviderError("Idempotency key is too short.", { code: "PAYMENT_INVALID_INPUT", status: 400 });
  }
  return key;
}

function objectOrEmpty(value, name) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new PaymentProviderError(`${name} must be an object.`, { code: "PAYMENT_INVALID_INPUT", status: 400 });
  }
  return value;
}

function normalizePaymentStatus(value) {
  const status = String(value ?? "pending").trim().toLowerCase();
  if (PAYMENT_SUCCESS_STATUSES.has(status)) return "SUCCESS";
  if (PAYMENT_FAILURE_STATUSES.has(status)) return status === "reversed" ? "REVERSED" : "FAILED";
  return "PENDING";
}

function providerPayload(payload) {
  return payload && typeof payload === "object" ? payload : {};
}

async function readPayload(response) {
  const raw = await response.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { message: "Provider returned a non-JSON response." };
  }
}

async function providerRequest({ fetchImpl, url, method = "GET", headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (typeof fetchImpl !== "function") {
    throw new PaymentProviderError("Payment provider transport is unavailable.", { code: "PAYMENT_PROVIDER_UNAVAILABLE", status: 503 });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let payload;
  try {
    response = await fetchImpl(url, {
      method,
      headers: { Accept: "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal
    });
    payload = await readPayload(response);
  } catch (error) {
    throw new PaymentProviderError("Payment provider is unavailable.", {
      code: error?.name === "AbortError" ? "PAYMENT_PROVIDER_TIMEOUT" : "PAYMENT_PROVIDER_UNAVAILABLE",
      status: 503,
      cause: error
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new PaymentProviderError("Payment provider rejected the request.", {
      code: "PAYMENT_PROVIDER_REJECTED",
      status: 502,
      providerStatus: response.status
    });
  }
  return providerPayload(payload);
}

function safeHmacEqual({ algorithm, secret, message, signature, prefix = "" }) {
  if (typeof secret !== "string" || secret.length === 0 || typeof signature !== "string") return false;
  const expected = `${prefix}${createHmac(algorithm, secret).update(message, "utf8").digest("hex")}`;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(signature, "utf8");
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function verifySeevWebhook({ rawBody, timestamp, signature, secret, now = Date.now, maxAgeSeconds = DEFAULT_SEEV_TIMESTAMP_WINDOW_SECONDS } = {}) {
  if (typeof rawBody !== "string" || typeof timestamp !== "string" || !/^\d+$/.test(timestamp)) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds)) return false;
  if (Math.abs(now() / 1_000 - timestampSeconds) > maxAgeSeconds) return false;
  return safeHmacEqual({
    algorithm: "sha256",
    secret,
    message: `${timestamp}.${rawBody}`,
    signature,
    prefix: "v1="
  });
}

export function verifyPaystackWebhook({ rawBody, signature, secret } = {}) {
  if (typeof rawBody !== "string") return false;
  return safeHmacEqual({ algorithm: "sha512", secret, message: rawBody, signature });
}

class DisabledProvider {
  constructor(name, reason = "Provider credentials, sandbox mode or approval are not configured.") {
    this.name = name;
    this.manifest = PAYMENT_PROVIDER_MANIFEST[name];
    this.reason = reason;
  }

  getCapabilities() {
    return Object.freeze({
      provider: this.name,
      collection: false,
      payout: false,
      webhook: false,
      sandboxReady: false,
      simulated: false,
      reason: this.reason,
      manifest: this.manifest
    });
  }

  supportsCollection() { return false; }
  supportsPayout() { return false; }

  #disabled(operation) {
    throw new PaymentProviderError(`${this.name} ${operation} is disabled until its sandbox boundary is explicitly configured and approved.`, {
      code: "PAYMENT_PROVIDER_DISABLED",
      status: 503
    });
  }

  initializePayment() { return this.#disabled("collection"); }
  verifyPayment() { return this.#disabled("verification"); }
  verifyWebhook() { return false; }
  reconcilePayment() { return this.#disabled("reconciliation"); }
  createPayout() { return this.#disabled("payout"); }
  getPayoutStatus() { return this.#disabled("payout status"); }
}

class SandboxProvider {
  constructor({ name, apiKey, webhookSecret, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = DEFAULT_TIMEOUT_MS, mode = "sandbox", production = false, realMoneyEnabled = false } = {}) {
    this.name = name;
    this.manifest = PAYMENT_PROVIDER_MANIFEST[name];
    this.apiKey = typeof apiKey === "string" ? apiKey.trim() : "";
    this.webhookSecret = typeof webhookSecret === "string" ? webhookSecret.trim() : "";
    this.fetchImpl = fetchImpl;
    this.now = now;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
      throw new PaymentProviderError("Payment timeout must be between 1 and 30000 milliseconds.", { code: "PAYMENT_INVALID_CONFIG", status: 500 });
    }
    this.timeoutMs = timeoutMs;
    this.enabled = mode === "sandbox" && production !== true && realMoneyEnabled !== true && this.apiKey.length > 0;
  }

  getCapabilities() {
    return Object.freeze({
      provider: this.name,
      collection: this.enabled,
      payout: false,
      webhook: this.enabled && this.webhookSecret.length > 0,
      sandboxReady: this.enabled,
      simulated: false,
      realMoney: false,
      approvalRequired: true,
      reason: this.enabled ? "Sandbox adapter only; authoritative funds and payouts remain blocked." : "Sandbox mode and a provider key are required; production activation is fail-closed.",
      manifest: this.manifest
    });
  }

  supportsCollection() { return this.enabled; }
  supportsPayout() { return false; }

  assertCollection() {
    if (!this.enabled) {
      throw new PaymentProviderError(`${this.name} sandbox adapter is disabled.`, { code: "PAYMENT_PROVIDER_DISABLED", status: 503 });
    }
  }

  assertWebhook() {
    this.assertCollection();
    if (!this.webhookSecret) {
      throw new PaymentProviderError(`${this.name} webhook verification is not configured.`, { code: "PAYMENT_WEBHOOK_NOT_CONFIGURED", status: 503 });
    }
  }

  unsupportedPayout() {
    throw new PaymentProviderError(`${this.name} payouts are disabled until written provider approval and a reviewed funds-control procedure exist.`, {
      code: "PAYMENT_PAYOUT_DISABLED",
      status: 403
    });
  }

  getPayoutStatus() { return this.unsupportedPayout(); }
  createPayout() { return this.unsupportedPayout(); }
}

export class SeevPlusProvider extends SandboxProvider {
  constructor(options = {}) {
    super({ ...options, name: "seevplus" });
    this.baseUrl = String(options.baseUrl ?? "https://api.seevplus.com").replace(/\/+$/, "");
  }

  async initializePayment({ reference, amountMinor, currency = "GHS", customerName, customerEmail, customerPhone, redirectUrl, metadata, idempotencyKey: explicitIdempotencyKey } = {}) {
    this.assertCollection();
    const stableReference = requiredString(reference, "Payment reference", { maxLength: MAX_IDEMPOTENCY_KEY_LENGTH });
    const body = {
      type: "checkout",
      amount: minorAmount(amountMinor),
      currency: currencyCode(currency),
      recipient: {
        name: requiredString(customerName, "Customer name", { maxLength: 200 }),
        email: emailAddress(customerEmail),
        ...(customerPhone ? { phone: requiredString(customerPhone, "Customer phone", { maxLength: 40 }) } : {})
      },
      redirect_url: httpUrl(redirectUrl, "Redirect URL"),
      meta: { peerarena_reference: stableReference, ...objectOrEmpty(metadata, "Payment metadata") }
    };
    const payload = await providerRequest({
      fetchImpl: this.fetchImpl,
      url: `${this.baseUrl}/api/v1/developer/payments`,
      method: "POST",
      timeoutMs: this.timeoutMs,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey(explicitIdempotencyKey ?? stableReference)
      },
      body
    });
    const data = providerPayload(payload.data);
    return Object.freeze({
      provider: this.name,
      reference: data.reference ?? null,
      status: normalizePaymentStatus(data.status),
      checkoutUrl: data.checkout_url ?? null,
      providerStatus: data.status ?? null,
      sandbox: true,
      raw: payload
    });
  }

  async verifyPayment(reference) {
    this.assertCollection();
    const sessionReference = encodeURIComponent(requiredString(reference, "Payment reference", { maxLength: 256 }));
    const payload = await providerRequest({
      fetchImpl: this.fetchImpl,
      url: `${this.baseUrl}/api/v1/developer/payments/${sessionReference}`,
      timeoutMs: this.timeoutMs
    });
    const data = providerPayload(payload.data);
    return Object.freeze({
      provider: this.name,
      reference: data.reference ?? reference,
      status: normalizePaymentStatus(data.status),
      providerStatus: data.status ?? null,
      sandbox: true,
      raw: payload
    });
  }

  verifyWebhook({ rawBody, timestamp, signature } = {}) {
    this.assertWebhook();
    return verifySeevWebhook({ rawBody, timestamp, signature, secret: this.webhookSecret, now: this.now });
  }

  async reconcilePayment(reference) { return this.verifyPayment(reference); }
}

export class PaystackProvider extends SandboxProvider {
  constructor(options = {}) {
    super({ ...options, name: "paystack" });
    // Paystack test and live credentials share an API host. A mode flag alone
    // must never allow a live credential to initiate a real collection.
    this.enabled = this.enabled && /^sk_test_[A-Za-z0-9]+$/.test(this.apiKey);
    this.baseUrl = String(options.baseUrl ?? "https://api.paystack.co").replace(/\/+$/, "");
  }

  #headers() {
    return { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" };
  }

  async initializePayment({ reference, amountMinor, currency = "GHS", customerEmail, redirectUrl, metadata } = {}) {
    this.assertCollection();
    const stableReference = requiredString(reference, "Payment reference", { maxLength: 100 });
    const body = {
      email: emailAddress(customerEmail),
      amount: minorAmount(amountMinor),
      currency: currencyCode(currency),
      reference: stableReference,
      ...(redirectUrl ? { callback_url: httpUrl(redirectUrl, "Callback URL") } : {}),
      ...(metadata === undefined ? {} : { metadata: objectOrEmpty(metadata, "Payment metadata") })
    };
    const payload = await providerRequest({
      fetchImpl: this.fetchImpl,
      url: `${this.baseUrl}/transaction/initialize`,
      method: "POST",
      timeoutMs: this.timeoutMs,
      headers: this.#headers(),
      body
    });
    const data = providerPayload(payload.data);
    return Object.freeze({
      provider: this.name,
      reference: data.reference ?? stableReference,
      status: normalizePaymentStatus(data.status),
      checkoutUrl: data.authorization_url ?? null,
      accessCode: data.access_code ?? null,
      providerStatus: data.status ?? null,
      sandbox: true,
      raw: payload
    });
  }

  async verifyPayment(reference) {
    this.assertCollection();
    const transactionReference = encodeURIComponent(requiredString(reference, "Payment reference", { maxLength: 256 }));
    const payload = await providerRequest({
      fetchImpl: this.fetchImpl,
      url: `${this.baseUrl}/transaction/verify/${transactionReference}`,
      headers: this.#headers(),
      timeoutMs: this.timeoutMs
    });
    const data = providerPayload(payload.data);
    if (payload.status !== true || data.domain !== "test" || data.reference !== reference
      || !Number.isSafeInteger(data.amount) || data.amount <= 0
      || typeof data.currency !== "string" || !/^[A-Z]{3}$/.test(data.currency)
      || !["success", "failed", "abandoned", "ongoing", "pending", "processing", "queued", "reversed"].includes(data.status)) {
      throw new PaymentProviderError("Paystack verification returned an invalid or mismatched test transaction.", {
        code: "PAYMENT_VERIFICATION_INVALID", status: 502
      });
    }
    return Object.freeze({
      provider: this.name,
      reference: data.reference ?? reference,
      status: normalizePaymentStatus(data.status),
      amountMinor: data.amount === undefined ? undefined : String(data.amount),
      currency: data.currency ?? undefined,
      providerStatus: data.status ?? null,
      sandbox: true,
      raw: payload
    });
  }

  async verifyExpectedPayment({ reference, amountMinor, currency } = {}) {
    const expectedAmount = minorAmount(amountMinor);
    const expectedCurrency = currencyCode(requiredString(currency, "Expected currency", { maxLength: 3 }));
    const result = await this.verifyPayment(reference);
    if (result.amountMinor !== String(expectedAmount) || result.currency !== expectedCurrency) {
      throw new PaymentProviderError("Verified payment does not match the expected amount or currency.", {
        code: "PAYMENT_VERIFICATION_MISMATCH", status: 409
      });
    }
    // This observation is not ledger credit. Durable idempotent reconciliation
    // and ownership checks remain mandatory before any future fulfillment.
    return Object.freeze({
      provider: "paystack", reference: result.reference, status: result.status,
      amountMinor: result.amountMinor, currency: result.currency, sandbox: true,
      matched: true, fundsCredited: false
    });
  }

  verifyWebhook({ rawBody, signature } = {}) {
    this.assertWebhook();
    return verifyPaystackWebhook({ rawBody, signature, secret: this.webhookSecret });
  }

  async reconcilePayment(reference) { return this.verifyPayment(reference); }
}

export class MockPaymentProvider {
  constructor() {
    this.name = "mock";
    this.payments = new Map();
    this.payouts = new Map();
    this.webhookEvents = new Set();
  }

  getCapabilities() { return Object.freeze({ provider: this.name, collection: true, payout: true, webhook: true, simulated: true, realMoney: false }); }
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

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export function createPaymentProvider(name = "mock", options = {}) {
  const normalized = String(name).toLowerCase();
  if (normalized === "mock") return options.mockPaymentsEnabled === false ? new DisabledProvider("mock", "Mock payments are disabled by configuration.") : new MockPaymentProvider();
  if (normalized === "seevplus") return new SeevPlusProvider(options);
  if (normalized === "paystack") return new PaystackProvider(options);
  throw new PaymentProviderError(`Unsupported payment provider: ${name}`, { code: "PAYMENT_INVALID_PROVIDER", status: 400 });
}

export function createPaymentProviderFromEnv(env = process.env, fetchImpl = globalThis.fetch) {
  const mode = String(env.PAYMENT_MODE ?? "mock").trim().toLowerCase();
  const providerName = String(env.PAYMENT_PROVIDER ?? (mode === "sandbox" ? "mock" : mode)).trim().toLowerCase();
  const common = {
    mode,
    production: String(env.APP_ENV ?? "demo").toLowerCase() === "production",
    realMoneyEnabled: asBoolean(env.REAL_MONEY_ENABLED, false),
    fetchImpl
  };
  if (providerName === "seevplus") {
    return createPaymentProvider(providerName, { ...common, apiKey: env.SEEV_CHECKOUT_API_KEY, webhookSecret: env.SEEV_WEBHOOK_SECRET });
  }
  if (providerName === "paystack") {
    return createPaymentProvider(providerName, { ...common, apiKey: env.PAYSTACK_SECRET_KEY, webhookSecret: env.PAYSTACK_WEBHOOK_SECRET ?? env.PAYSTACK_SECRET_KEY });
  }
  return createPaymentProvider("mock", { mockPaymentsEnabled: asBoolean(env.MOCK_PAYMENTS_ENABLED, true) });
}
