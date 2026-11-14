import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { readRuntimeConfig, realMoneyGate } from "../src/backend/config.mjs";
import { ownedDatabaseGate, readDatabaseConfig } from "../src/backend/database.mjs";
import {
  DisabledOwnedPostgresClient,
  OwnedPostgresProcedureClient,
  createOwnedPostgresProcedureClientFromEnv
} from "../src/backend/owned-postgres.mjs";
import {
  AdminRepositoryError,
  DisabledAdminRepository,
  SupabaseAdminRepository,
  createAdminRepositoryFromEnv
} from "../src/backend/admin.mjs";
import { SecurityEventLogger } from "../src/backend/security-events.mjs";
import {
  assertBalanced,
  calculateSharedPoolPayout,
  fromMinorUnits,
  makeBalancedTransaction,
  toMinorUnits
} from "../src/backend/ledger.mjs";
import {
  createPaymentProvider,
  createPaymentProviderFromEnv,
  MockPaymentProvider,
  PAYMENT_PROVIDER_MANIFEST,
  verifyPaystackWebhook,
  verifySeevWebhook
} from "../src/backend/payments.mjs";
import { determineSettlement } from "../src/backend/settlement.mjs";
import { SlidingWindowRateLimiter } from "../src/backend/rate-limit.mjs";
import {
  AuthProviderError,
  DisabledAuthProvider,
  SupabaseAuthProvider,
  createAuthProviderFromEnv
} from "../src/backend/auth.mjs";
import {
  SessionBoundaryError,
  extractBearerToken,
  optionalAuthenticatedSession,
  requireAuthenticatedSession,
  revokeAuthenticatedSession
} from "../src/backend/auth-session.mjs";
import { AuthorizationError, requireAdminSession, requireRole, rolesForUser } from "../src/backend/authorization.mjs";
import {
  CatalogueRepositoryError,
  DisabledCatalogueRepository,
  SupabaseCatalogueRepository,
  createCatalogueRepositoryFromEnv
} from "../src/backend/catalogue.mjs";
import {
  ChallengeRepositoryError,
  DisabledChallengeRepository,
  SupabaseChallengeRepository,
  createChallengeRepositoryFromEnv
} from "../src/backend/challenges.mjs";
import {
  DisabledProfileRepository,
  ProfileRepositoryError,
  SupabaseProfileRepository,
  createProfileRepositoryFromEnv,
  sanitizeProfilePatch
} from "../src/backend/profiles.mjs";

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

test("external providers fail closed until approved credentials are configured", async () => {
  const provider = createPaymentProvider("paystack");
  assert.equal(provider.getCapabilities().collection, false);
  assert.equal(provider.supportsPayout(), false);
  assert.equal(provider.getCapabilities().manifest.endpoints.initializePayment, PAYMENT_PROVIDER_MANIFEST.paystack.endpoints.initializePayment);
  await assert.rejects(() => provider.initializePayment({ reference: "order-1", amountMinor: 100 }));
});

test("SeevPlus sandbox adapter follows the documented checkout and raw-body webhook boundary", async () => {
  const calls = [];
  const secret = "seev-webhook-secret";
  const timestamp = "1794595200";
  const rawBody = JSON.stringify({ event: "payment.succeeded", data: { transaction: { reference: "PAY-1", status: "completed" } } });
  const signature = `v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
  const provider = createPaymentProvider("seevplus", {
    mode: "sandbox",
    apiKey: "sv_sandbox_test",
    webhookSecret: secret,
    now: () => Number(timestamp) * 1000,
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
      return new Response(JSON.stringify({ data: { reference: "PAY-1", status: "pending", checkout_url: "https://pay.seev.test/PAY-1" } }), { status: 201 });
    }
  });

  const created = await provider.initializePayment({
    reference: "peerarena-order-1",
    amountMinor: "10000",
    currency: "GHS",
    customerName: "Kwame Asante",
    customerEmail: "kwame@example.com",
    redirectUrl: "https://peerarena.example/payment/callback"
  });
  assert.equal(created.provider, "seevplus");
  assert.equal(created.status, "PENDING");
  assert.equal(calls[0].url, "https://api.seevplus.com/api/v1/developer/payments");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sv_sandbox_test");
  assert.equal(calls[0].init.headers["Idempotency-Key"], "peerarena-order-1");
  assert.equal(calls[0].body.amount, 10000);
  assert.equal(calls[0].body.meta.peerarena_reference, "peerarena-order-1");
  assert.equal(provider.verifyWebhook({ rawBody, timestamp, signature }), true);
  assert.equal(provider.verifyWebhook({ rawBody: JSON.stringify(JSON.parse(rawBody)), timestamp, signature: `${signature}x` }), false);
  assert.equal(provider.getCapabilities().payout, false);
  assert.throws(() => provider.createPayout({ reference: "payout-1" }), /payouts are disabled/);
});

test("Paystack sandbox adapter uses server-side secret authentication and raw webhook signatures", async () => {
  const calls = [];
  const secret = "sk_test_peerarena";
  const rawBody = JSON.stringify({ event: "charge.success", data: { reference: "PA-1", status: "success", amount: 5000, currency: "GHS" } });
  const signature = createHmac("sha512", secret).update(rawBody).digest("hex");
  const provider = createPaymentProvider("paystack", {
    mode: "sandbox",
    apiKey: secret,
    webhookSecret: secret,
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
      return new Response(JSON.stringify({ status: true, data: { reference: "PA-1", status: "success", amount: 5000, currency: "GHS", authorization_url: "https://checkout.paystack.test/PA-1", access_code: "test-access" } }), { status: 200 });
    }
  });

  const created = await provider.initializePayment({ reference: "peerarena-paystack-1", amountMinor: 5000, customerEmail: "kwame@example.com", redirectUrl: "https://peerarena.example/payment/callback" });
  const verified = await provider.verifyPayment("PA-1");
  assert.equal(created.checkoutUrl, "https://checkout.paystack.test/PA-1");
  assert.equal(created.accessCode, "test-access");
  assert.equal(verified.status, "SUCCESS");
  assert.equal(calls[0].url, "https://api.paystack.co/transaction/initialize");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${secret}`);
  assert.equal(calls[0].body.amount, 5000);
  assert.equal(calls[1].url, "https://api.paystack.co/transaction/verify/PA-1");
  assert.equal(provider.verifyWebhook({ rawBody, signature }), true);
  assert.equal(verifyPaystackWebhook({ rawBody, signature: `${signature}0`, secret }), false);
});

test("provider factory only enables external adapters for explicit non-production sandbox mode", () => {
  const sandbox = createPaymentProviderFromEnv({
    PAYMENT_MODE: "sandbox",
    PAYMENT_PROVIDER: "paystack",
    PAYSTACK_SECRET_KEY: "sk_test_peerarena",
    PAYSTACK_WEBHOOK_SECRET: "webhook-secret",
    APP_ENV: "staging",
    REAL_MONEY_ENABLED: "false"
  }, async () => new Response("{}", { status: 200 }));
  assert.equal(sandbox.getCapabilities().sandboxReady, true);
  assert.equal(sandbox.getCapabilities().realMoney, false);

  const production = createPaymentProviderFromEnv({
    PAYMENT_MODE: "sandbox",
    PAYMENT_PROVIDER: "paystack",
    PAYSTACK_SECRET_KEY: "sk_test_peerarena",
    APP_ENV: "production",
    REAL_MONEY_ENABLED: "false"
  });
  assert.equal(production.getCapabilities().collection, false);
});

test("provider signature helpers reject stale Seev events and malformed signatures safely", () => {
  const secret = "secret";
  const timestamp = "1794595200";
  const rawBody = "{\"event\":\"payment.succeeded\"}";
  const signature = `v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
  assert.equal(verifySeevWebhook({ rawBody, timestamp, signature, secret, now: () => Number(timestamp) * 1000 }), true);
  assert.equal(verifySeevWebhook({ rawBody, timestamp, signature, secret, now: () => Number(timestamp) * 1000 + 301_000 }), false);
  assert.equal(verifySeevWebhook({ rawBody, timestamp, signature: "v1=bad", secret, now: () => Number(timestamp) * 1000 }), false);
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

test("runtime configuration defaults to synthetic auth and requires explicit Supabase mode", () => {
  assert.equal(readRuntimeConfig({}).authMode, "demo");
  assert.equal(readRuntimeConfig({}).paymentProvider, "mock");
  assert.equal(readRuntimeConfig({ AUTH_MODE: "supabase" }).authMode, "supabase");
  assert.equal(readRuntimeConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://peerarena.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" }).supabaseConfigured, true);
  assert.equal(readRuntimeConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://peerarena.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test" }).supabasePersistenceConfigured, true);
});

test("owned database configuration accepts only allowlisted PostgreSQL with verified TLS", () => {
  const owned = readDatabaseConfig({
    APP_ENV: "production",
    DATABASE_PROVIDER: "owned-postgres",
    DATABASE_URL: "postgresql://peerarena@db.internal/peerarena",
    DATABASE_SSL_MODE: "verify-full",
    DATABASE_CA_CERT: "-----BEGIN CERTIFICATE-----test-ca-----END CERTIFICATE-----",
    DATABASE_ALLOWED_HOSTS: "db.internal"
  });
  assert.equal(owned.productionReady, true);
  assert.equal(owned.host, "db.internal");
  assert.equal(owned.caConfigured, true);
  assert.equal(ownedDatabaseGate(owned).enabled, true);

  const hosted = readDatabaseConfig({
    APP_ENV: "production",
    DATABASE_PROVIDER: "supabase",
    DATABASE_URL: "https://example.supabase.co",
    DATABASE_SSL_MODE: "verify-full",
    DATABASE_ALLOWED_HOSTS: "example.supabase.co"
  });
  assert.equal(hosted.productionReady, false);
  assert.match(ownedDatabaseGate(hosted).blockers.join(" "), /owned-postgres/);

  const mismatchedTls = readDatabaseConfig({
    APP_ENV: "production",
    DATABASE_PROVIDER: "owned-postgres",
    DATABASE_URL: "postgresql://peerarena@db.internal/peerarena?sslmode=disable",
    DATABASE_SSL_MODE: "verify-full",
    DATABASE_ALLOWED_HOSTS: "db.internal"
  });
  assert.equal(mismatchedTls.productionReady, false);
  assert.match(mismatchedTls.errors.join(" "), /sslmode must match/);
});

function fakePostgresPool({ failProcedure = false } = {}) {
  const calls = [];
  const connection = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (failProcedure && text.includes("peerarena_api.create_challenge")) {
        const error = new Error("simulated procedure failure");
        error.code = "23514";
        throw error;
      }
      if (text === "select 1 as ok") return { rows: [{ ok: 1 }] };
      if (text.includes("peerarena_api.create_challenge")) return { rows: [{ challenge_id: "challenge-1", challenge_status: "AWAITING_ACCEPTANCE", replayed: false }] };
      if (text.includes("peerarena_api.accept_challenge")) return { rows: [{ challenge_id: "challenge-1", challenge_status: "FUNDS_CONFIRMED", ledger_transaction_id: "ledger-1", replayed: false }] };
      if (text.includes("peerarena_api.verify_and_settle_synthetic_challenge")) return { rows: [{ challenge_id: "challenge-1", challenge_status: "SETTLED", settlement_id: "settlement-1", ledger_transaction_id: "ledger-2", settlement_status: "COMPLETED", replayed: false }] };
      return { rows: [] };
    },
    release() {
      calls.push({ text: "release", values: [] });
    }
  };
  return {
    pool: {
      async connect() { return connection; },
      async end() {}
    },
    calls
  };
}

test("owned PostgreSQL client stays fail-closed without a complete private configuration", async () => {
  const client = createOwnedPostgresProcedureClientFromEnv({});
  assert.ok(client instanceof DisabledOwnedPostgresClient);
  assert.equal(client.getCapabilities().configured, false);
  await assert.rejects(client.health(), (error) => {
    assert.equal(error.code, "PERSISTENCE_NOT_CONFIGURED");
    assert.equal(error.status, 503);
    return true;
  });
});

test("owned PostgreSQL client uses only reviewed procedures and transaction-local context", async () => {
  const fake = fakePostgresPool();
  const client = new OwnedPostgresProcedureClient({
    pool: fake.pool,
    config: { sslMode: "verify-full" }
  });
  const actorUserId = "11111111-1111-4111-8111-111111111111";
  const challengeId = "22222222-2222-4222-8222-222222222222";
  const workerUserId = "33333333-3333-4333-8333-333333333333";

  assert.deepEqual(await client.health(), { ok: true, provider: "owned-postgres" });
  assert.equal((await client.createChallenge({
    actorUserId,
    requestId: "req-create-1",
    marketId: challengeId,
    visibility: "PUBLIC",
    creatorSide: "HOME",
    stakeMinor: "1000",
    currency: "usd",
    rulesVersion: "rules-v1",
    expiresAt: "2026-11-15T00:00:00Z",
    idempotencyKey: "idem-create-1"
  })).challenge_status, "AWAITING_ACCEPTANCE");
  assert.equal((await client.acceptChallenge({
    actorUserId,
    requestId: "req-accept-1",
    challengeId,
    side: "AWAY",
    idempotencyKey: "idem-accept-1"
  })).challenge_status, "FUNDS_CONFIRMED");
  assert.equal((await client.verifyAndSettleSyntheticChallenge({
    workerUserId,
    requestId: "req-settle-1",
    challengeId,
    verifiedOutcome: "HOME",
    providerEventId: "synthetic-event-1",
    resultPayloadHash: "a".repeat(64),
    rulesVersion: "rules-v1",
    idempotencyKey: "idem-settle-1"
  })).settlement_status, "COMPLETED");

  const queryText = fake.calls.map(({ text }) => text).join("\n");
  assert.match(queryText, /peerarena\.actor_user_id/);
  assert.match(queryText, /peerarena\.request_id/);
  assert.match(queryText, /peerarena\.worker_user_id/);
  assert.match(queryText, /peerarena_api\.create_challenge/);
  assert.match(queryText, /peerarena_api\.accept_challenge/);
  assert.match(queryText, /peerarena_api\.verify_and_settle_synthetic_challenge/);
  assert.doesNotMatch(queryText, /insert\s+into\s+public/i);
  assert.doesNotMatch(queryText, /update\s+public/i);
  assert.equal(client.getCapabilities().directTableWrites, false);
});

test("owned PostgreSQL client rolls back and maps procedure failures safely", async () => {
  const fake = fakePostgresPool({ failProcedure: true });
  const client = new OwnedPostgresProcedureClient({ pool: fake.pool, config: { sslMode: "verify-full" } });
  await assert.rejects(client.createChallenge({
    actorUserId: "11111111-1111-4111-8111-111111111111",
    marketId: "22222222-2222-4222-8222-222222222222",
    visibility: "PUBLIC",
    creatorSide: "HOME",
    stakeMinor: "1000",
    currency: "USD",
    rulesVersion: "rules-v1",
    expiresAt: "2026-11-15T00:00:00Z",
    idempotencyKey: "idem-create-2"
  }), (error) => {
    assert.equal(error.code, "DATABASE_COMMAND_FAILED");
    assert.equal(error.status, 503);
    return true;
  });
  assert.ok(fake.calls.some(({ text }) => text === "rollback"));
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

test("rate limiter caps distinct keys and throttles overflow safely", () => {
  const limiter = new SlidingWindowRateLimiter({ windowMs: 1_000, maxRequests: 1, maxKeys: 2 });
  assert.equal(limiter.consume("client-1").allowed, true);
  assert.equal(limiter.consume("client-2").allowed, true);
  assert.equal(limiter.consume("client-3").allowed, false);
  assert.equal(limiter.consume("client-4").allowed, false);
  assert.ok(limiter.buckets.size <= 2);
});

test("Supabase Auth remains disabled when public project configuration is absent", () => {
  const provider = createAuthProviderFromEnv({});
  assert.ok(provider instanceof DisabledAuthProvider);
  assert.equal(provider.getCapabilities().configured, false);
  assert.throws(() => provider.signInWithPassword({ email: "demo@example.com", password: "not-a-real-password" }), (error) => {
    assert.equal(error.code, "AUTH_NOT_CONFIGURED");
    assert.equal(error.status, 503);
    return true;
  });
  const publishableProvider = createAuthProviderFromEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://peerarena.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test"
  }, async () => new Response("{}", { status: 200 }));
  assert.equal(publishableProvider.getCapabilities().configured, true);
});

test("Supabase Auth adapter maps account, session and recovery operations to Auth API requests", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const path = new URL(url).pathname;
    const payload = path.endsWith("/signup")
      ? { user: { id: "user-1" }, session: null }
      : path.endsWith("/token")
        ? { access_token: "access-token-1", user: { id: "user-1" } }
        : path.endsWith("/user")
          ? { id: "user-1", email: "demo@example.com" }
          : { ok: true };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const provider = new SupabaseAuthProvider({
    url: "https://peerarena.supabase.co",
    anonKey: "public-anon-key",
    defaultRedirectUrl: "https://peerarena.example/auth/callback",
    fetchImpl
  });

  const signUp = await provider.signUp({ email: "Demo@Example.com", password: "strong-demo-password", metadata: { source: "demo" } });
  const signIn = await provider.signInWithPassword({ email: "demo@example.com", password: "strong-demo-password" });
  const recovery = await provider.requestPasswordRecovery({ email: "demo@example.com" });
  const user = await provider.getUser(signIn.access_token);
  const logout = await provider.signOut(signIn.access_token);

  assert.equal(signUp.user.id, "user-1");
  assert.equal(signIn.access_token, "access-token-1");
  assert.deepEqual(recovery, { ok: true });
  assert.equal(user.email, "demo@example.com");
  assert.deepEqual(logout, { ok: true });
  assert.deepEqual(calls.map(({ url, init }) => [new URL(url).pathname, init.method]), [
    ["/auth/v1/signup", "POST"],
    ["/auth/v1/token", "POST"],
    ["/auth/v1/recover", "POST"],
    ["/auth/v1/user", "GET"],
    ["/auth/v1/logout", "POST"]
  ]);
  assert.deepEqual(calls[0].body, {
    email: "demo@example.com",
    password: "strong-demo-password",
    data: { source: "demo" }
  });
  assert.equal(new URL(calls[0].url).searchParams.get("redirect_to"), "https://peerarena.example/auth/callback");
  assert.equal(calls[1].url, "https://peerarena.supabase.co/auth/v1/token?grant_type=password");
  assert.equal(new URL(calls[2].url).searchParams.get("redirect_to"), "https://peerarena.example/auth/callback");
  assert.deepEqual(calls[2].body, { email: "demo@example.com" });
  assert.equal(calls[3].init.headers.Authorization, "Bearer access-token-1");
  assert.equal(calls[4].init.headers.Authorization, "Bearer access-token-1");
});

test("Supabase Auth adapter creates an allowlisted Google OAuth URL without making a network call", () => {
  let calls = 0;
  const provider = new SupabaseAuthProvider({
    url: "https://peerarena.supabase.co",
    anonKey: "public-anon-key",
    fetchImpl: async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }
  });
  const oauthUrl = new URL(provider.getGoogleOAuthUrl({ redirectTo: "https://peerarena.example/auth/callback" }));
  assert.equal(oauthUrl.pathname, "/auth/v1/authorize");
  assert.equal(oauthUrl.searchParams.get("provider"), "google");
  assert.equal(oauthUrl.searchParams.get("redirect_to"), "https://peerarena.example/auth/callback");
  assert.equal(calls, 0);
});

test("Supabase Auth adapter sanitizes provider errors and never includes credentials in messages", async () => {
  const secret = "strong-demo-password";
  const provider = new SupabaseAuthProvider({
    url: "https://peerarena.supabase.co",
    anonKey: "public-anon-key",
    fetchImpl: async () => new Response(JSON.stringify({ error_code: "invalid_credentials", msg: `bad password: ${secret}` }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    })
  });
  await assert.rejects(() => provider.signInWithPassword({ email: "demo@example.com", password: secret }), (error) => {
    assert.ok(error instanceof AuthProviderError);
    assert.equal(error.code, "AUTH_PROVIDER_REJECTED");
    assert.equal(error.providerCode, "invalid_credentials");
    assert.equal(error.status, 400);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});

test("session boundary accepts only a well-formed bearer token and supports optional sessions", async () => {
  assert.equal(extractBearerToken({ headers: { authorization: "Bearer token-123" } }), "token-123");
  assert.equal(extractBearerToken({ headers: { Authorization: "bearer token-456" } }), "token-456");
  assert.equal(extractBearerToken({ headers: {} }), null);
  assert.throws(() => extractBearerToken({ headers: { authorization: "Basic token-123" } }), (error) => {
    assert.ok(error instanceof SessionBoundaryError);
    assert.equal(error.code, "AUTH_INVALID_HEADER");
    return true;
  });

  let lookups = 0;
  const provider = { getUser: async (token) => { lookups += 1; return { id: token, email: "demo@example.com" }; } };
  assert.deepEqual(await optionalAuthenticatedSession({ request: { headers: {} }, provider }), { authenticated: false, user: null });
  assert.deepEqual(await optionalAuthenticatedSession({ request: { headers: { authorization: "Bearer token-123" } }, provider }), {
    authenticated: true,
    user: { id: "token-123", email: "demo@example.com" }
  });
  assert.equal(lookups, 1);
});

test("session boundary maps provider validation and logout failures to safe HTTP errors", async () => {
  await assert.rejects(
    () => requireAuthenticatedSession({ request: { headers: {} }, provider: { getUser: async () => ({ id: "user-1" }) } }),
    (error) => {
      assert.equal(error.code, "AUTH_REQUIRED");
      assert.equal(error.status, 401);
      return true;
    }
  );
  await assert.rejects(
    () => requireAuthenticatedSession({ request: { headers: { authorization: "Bearer bad-token" } }, provider: {
      getUser: async () => { throw new AuthProviderError("provider details must not escape", { code: "AUTH_PROVIDER_REJECTED", status: 400 }); }
    } }),
    (error) => {
      assert.equal(error.code, "AUTH_INVALID_SESSION");
      assert.equal(error.status, 401);
      assert.equal(error.message.includes("provider details"), false);
      return true;
    }
  );
  await assert.rejects(
    () => requireAuthenticatedSession({ request: { headers: { authorization: "Bearer token-123" } }, provider: new DisabledAuthProvider() }),
    (error) => {
      assert.equal(error.code, "AUTH_NOT_CONFIGURED");
      assert.equal(error.status, 503);
      return true;
    }
  );

  let revokedToken;
  const result = await revokeAuthenticatedSession({
    request: { headers: { authorization: "Bearer token-123" } },
    provider: { signOut: async (token) => { revokedToken = token; } }
  });
  assert.deepEqual(result, { revoked: true });
  assert.equal(revokedToken, "token-123");
});

test("authorization reads admin roles only from server-controlled app metadata", async () => {
  const adminUser = { id: "user-1", app_metadata: { roles: ["support", "ADMIN"] }, user_metadata: { roles: ["admin"] } };
  assert.deepEqual(rolesForUser(adminUser), ["admin", "support"]);
  const adminSession = requireRole({ authenticated: true, user: adminUser }, "admin");
  assert.deepEqual(adminSession.roles, ["admin", "support"]);

  assert.throws(() => requireRole({ authenticated: true, user: { id: "user-2", user_metadata: { roles: ["admin"] } } }, "admin"), (error) => {
    assert.ok(error instanceof AuthorizationError);
    assert.equal(error.code, "AUTH_FORBIDDEN");
    assert.equal(error.status, 403);
    return true;
  });
  await assert.rejects(
    () => requireAdminSession({ request: { headers: { authorization: "Bearer token-123" } }, provider: {
      getUser: async () => ({ id: "user-2", app_metadata: { roles: ["member"] } })
    } }),
    (error) => {
      assert.equal(error.code, "AUTH_FORBIDDEN");
      assert.equal(error.status, 403);
      return true;
    }
  );
  await assert.rejects(
    () => requireAdminSession({ request: { headers: {} }, provider: { getUser: async () => adminUser } }),
    (error) => {
      assert.equal(error.code, "AUTH_REQUIRED");
      assert.equal(error.status, 401);
      return true;
    }
  );
});

test("profile patch validation rejects identity and authorization fields", () => {
  assert.deepEqual(sanitizeProfilePatch({ username: "Accra_Gunner", country: "gh", preferred_language: "EN" }), {
    username: "Accra_Gunner",
    country: "GH",
    preferred_language: "en"
  });
  assert.throws(() => sanitizeProfilePatch({ account_status: "ELIGIBLE_FOR_PLAY" }), (error) => {
    assert.ok(error instanceof ProfileRepositoryError);
    assert.equal(error.code, "PROFILE_FIELD_NOT_ALLOWED");
    assert.equal(error.status, 400);
    return true;
  });
  assert.throws(() => sanitizeProfilePatch({ username: "bad name" }), /Username must be/);
});

test("Supabase profile repository uses a server-only secret key and scopes writes by auth user", async () => {
  const authUserId = "550e8400-e29b-41d4-a716-446655440000";
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const profile = {
      id: "650e8400-e29b-41d4-a716-446655440000",
      auth_user_id: authUserId,
      username: "Accra_Gunner",
      country: "GH",
      preferred_language: "en",
      account_status: "REGISTERED"
    };
    return new Response(JSON.stringify([profile]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const repository = new SupabaseProfileRepository({ url: "https://peerarena.supabase.co", secretKey: "sb_secret_test", fetchImpl });
  const found = await repository.getByAuthUserId(authUserId);
  const updated = await repository.updateByAuthUserId(authUserId, { username: "Accra_Gunner", full_name: "Accra Gunner" });

  assert.equal(found.auth_user_id, authUserId);
  assert.equal(updated.username, "Accra_Gunner");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers.apikey, "sb_secret_test");
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(new URL(calls[0].url).searchParams.get("auth_user_id"), `eq.${authUserId}`);
  assert.equal(calls[1].init.method, "PATCH");
  assert.equal(calls[1].init.headers.Prefer, "return=representation");
  assert.deepEqual(calls[1].body, { username: "Accra_Gunner", full_name: "Accra Gunner" });
});

test("profile repository factory fails closed without server persistence credentials", () => {
  const disabled = createProfileRepositoryFromEnv({});
  assert.ok(disabled instanceof DisabledProfileRepository);
  assert.equal(disabled.getCapabilities().configured, false);
  const configured = createProfileRepositoryFromEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://peerarena.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "legacy-service-role"
  }, async () => new Response("[]", { status: 200 }));
  assert.equal(configured.getCapabilities().configured, true);
  assert.equal(configured.getCapabilities().keyType, "legacy-service-role");
});

test("Supabase challenge repository reads only public open rows through a server-only key", async () => {
  const challengeId = "550e8400-e29b-41d4-a716-446655440000";
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify([{
      id: challengeId,
      creator_id: "650e8400-e29b-41d4-a716-446655440000",
      market_id: "750e8400-e29b-41d4-a716-446655440000",
      challenge_status: "AWAITING_ACCEPTANCE",
      visibility: "PUBLIC",
      stake_amount_minor: "5000",
      currency: "GHS"
    }]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const repository = new SupabaseChallengeRepository({ url: "https://peerarena.supabase.co", secretKey: "sb_secret_test", fetchImpl });
  const listed = await repository.listPublic({ limit: "10", offset: "5" });
  const found = await repository.getPublicById(challengeId);

  assert.equal(listed[0].id, challengeId);
  assert.equal(found.id, challengeId);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers.apikey, "sb_secret_test");
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(new URL(calls[0].url).searchParams.get("visibility"), "eq.PUBLIC");
  assert.equal(new URL(calls[0].url).searchParams.get("challenge_status"), "in.(AWAITING_ACCEPTANCE,ACTIVE,FUNDS_CONFIRMED)");
  assert.equal(new URL(calls[0].url).searchParams.get("limit"), "10");
  assert.equal(new URL(calls[0].url).searchParams.get("offset"), "5");
  assert.equal(new URL(calls[1].url).searchParams.get("id"), `eq.${challengeId}`);
  assert.equal(repository.getCapabilities().writes, "blocked-until-transactional-procedure");
});

test("challenge repository factory fails closed without server persistence credentials", () => {
  const disabled = createChallengeRepositoryFromEnv({});
  assert.ok(disabled instanceof DisabledChallengeRepository);
  assert.equal(disabled.getCapabilities().configured, false);
  assert.throws(() => disabled.listPublic(), (error) => {
    assert.ok(error instanceof ChallengeRepositoryError);
    assert.equal(error.code, "PERSISTENCE_NOT_CONFIGURED");
    assert.equal(error.status, 503);
    return true;
  });

  const configured = createChallengeRepositoryFromEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://peerarena.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "legacy-service-role"
  }, async () => new Response("[]", { status: 200 }));
  assert.equal(configured.getCapabilities().configured, true);
  assert.equal(configured.getCapabilities().keyType, "legacy-service-role");
});

test("Supabase catalogue repository exposes only enabled public sports data", async () => {
  const eventId = "550e8400-e29b-41d4-a716-446655440000";
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/sports")) {
      return new Response(JSON.stringify([{ id: "650e8400-e29b-41d4-a716-446655440000", slug: "football", name: "Football", enabled: true }]), { status: 200 });
    }
    if (parsed.pathname.endsWith("/sporting_events")) {
      return new Response(JSON.stringify([{
        id: eventId,
        sport_id: "650e8400-e29b-41d4-a716-446655440000",
        competition_id: "750e8400-e29b-41d4-a716-446655440000",
        home_participant: "Hearts of Oak",
        away_participant: "Asante Kotoko",
        scheduled_start: "2026-11-13T12:00:00.000Z",
        event_status: "LIVE",
        current_score: { scoreHome: 1, scoreAway: 0 },
        sports: { name: "Football", slug: "football", enabled: true },
        competitions: { name: "Ghana Premier League", country_code: "GH" }
      }]), { status: 200 });
    }
    return new Response(JSON.stringify([{
      id: "850e8400-e29b-41d4-a716-446655440000",
      event_id: eventId,
      market_type: "TOTAL_GOALS",
      market_description: "Total goals",
      possible_outcomes: ["Over 2.5", "Under 2.5"],
      settlement_rules: { rule: "official_result" },
      rules_version: "catalogue-v1",
      market_status: "OPEN",
      closing_time: "2026-11-13T11:55:00.000Z"
    }]), { status: 200 });
  };

  const repository = new SupabaseCatalogueRepository({ url: "https://peerarena.supabase.co", publishableKey: "sb_publishable_test", fetchImpl });
  const sports = await repository.listSports();
  const events = await repository.listLiveEvents();
  const event = await repository.getEventById(eventId);
  const markets = await repository.listMarketsForEvent(eventId);

  assert.equal(sports[0].name, "Football");
  assert.equal(events[0].home, "Hearts of Oak");
  assert.equal(events[0].league, "Ghana Premier League");
  assert.deepEqual(events[0].live, { scoreHome: 1, scoreAway: 0 });
  assert.equal(event.id, eventId);
  assert.equal(markets[0].market, "TOTAL_GOALS");
  assert.deepEqual(markets[0].outcomes, ["Over 2.5", "Under 2.5"]);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].init.headers.apikey, "sb_publishable_test");
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(new URL(calls[0].url).searchParams.get("enabled"), "eq.true");
  assert.equal(new URL(calls[1].url).searchParams.get("event_status"), "eq.LIVE");
  assert.equal(new URL(calls[2].url).searchParams.get("id"), `eq.${eventId}`);
  assert.equal(new URL(calls[3].url).searchParams.get("market_status"), "in.(OPEN,SUSPENDED,CLOSED)");
  assert.equal(repository.getCapabilities().writes, "disabled");
});

test("catalogue repository factory fails closed without public Supabase configuration", () => {
  const disabled = createCatalogueRepositoryFromEnv({});
  assert.ok(disabled instanceof DisabledCatalogueRepository);
  assert.equal(disabled.getCapabilities().configured, false);
  assert.throws(() => disabled.listEvents(), (error) => {
    assert.ok(error instanceof CatalogueRepositoryError);
    assert.equal(error.code, "PERSISTENCE_NOT_CONFIGURED");
    assert.equal(error.status, 503);
    return true;
  });

  const configured = createCatalogueRepositoryFromEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://peerarena.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy-anon"
  }, async () => new Response("[]", { status: 200 }));
  assert.equal(configured.getCapabilities().configured, true);
  assert.equal(configured.getCapabilities().keyType, "legacy-anon");
});

test("Supabase admin repository uses server-only reads and exact protected-table counts", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (init.method === "HEAD") return new Response(null, { status: 200, headers: { "Content-Range": "0-0/7" } });
    const table = new URL(url).pathname.split("/").pop();
    const payload = table === "profiles"
      ? [{ id: "550e8400-e29b-41d4-a716-446655440000", username: "admin", account_status: "ELIGIBLE_FOR_PLAY" }]
      : table === "settlement_records"
        ? [{ id: "650e8400-e29b-41d4-a716-446655440000", challenge_id: "750e8400-e29b-41d4-a716-446655440000", settlement_status: "PENDING" }]
        : [{ id: "850e8400-e29b-41d4-a716-446655440000" }];
    return new Response(JSON.stringify(payload), { status: 200 });
  };

  const repository = new SupabaseAdminRepository({ url: "https://peerarena.supabase.co", secretKey: "sb_secret_test", fetchImpl });
  const overview = await repository.getOverview();
  const users = await repository.listUsers({ limit: "10", offset: "2" });
  const settlements = await repository.listSettlements();

  assert.equal(overview.totalUsers, 7);
  assert.equal(overview.reconciliationRequiredTransactions, 7);
  assert.equal(users.users[0].username, "admin");
  assert.equal(users.total, 7);
  assert.equal(settlements.settlements[0].settlement_status, "PENDING");
  assert.equal(settlements.total, 7);
  assert.ok(calls.every(({ init }) => init.headers.apikey === "sb_secret_test"));
  assert.ok(calls.every(({ init }) => init.headers.Authorization === undefined));
  const userListCall = calls.find(({ url, init }) => init.method === "GET" && new URL(url).pathname.endsWith("/profiles"));
  assert.equal(new URL(userListCall.url).searchParams.get("limit"), "10");
  assert.equal(new URL(userListCall.url).searchParams.get("offset"), "2");
  const verifiedCountCall = calls.find(({ url, init }) => init.method === "HEAD" && new URL(url).searchParams.get("account_status"));
  assert.equal(new URL(verifiedCountCall.url).searchParams.get("account_status"), "in.(EMAIL_VERIFIED,PHONE_VERIFIED,IDENTITY_REVIEW,IDENTITY_VERIFIED,ELIGIBLE_FOR_PLAY)");
  assert.equal(repository.getCapabilities().writes, "disabled");
});

test("admin repository factory fails closed without server persistence credentials", () => {
  const disabled = createAdminRepositoryFromEnv({});
  assert.ok(disabled instanceof DisabledAdminRepository);
  assert.equal(disabled.getCapabilities().configured, false);
  assert.throws(() => disabled.getOverview(), (error) => {
    assert.ok(error instanceof AdminRepositoryError);
    assert.equal(error.code, "PERSISTENCE_NOT_CONFIGURED");
    assert.equal(error.status, 503);
    return true;
  });

  const configured = createAdminRepositoryFromEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://peerarena.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test"
  }, async () => new Response(null, { status: 200, headers: { "Content-Range": "0-0/0" } }));
  assert.equal(configured.getCapabilities().configured, true);
  assert.equal(configured.getCapabilities().keyType, "secret");
});

test("security event logger redacts paths, bounds memory and preserves safe summaries", () => {
  const emitted = [];
  const alerts = [];
  const logger = new SecurityEventLogger({ maxEvents: 2, now: () => Date.parse("2026-11-13T00:00:00.000Z"), onEvent: (event) => emitted.push(event), onAlert: (event) => alerts.push(event) });
  logger.record("csrf origin rejected", {
    requestId: "request-1\nsecret",
    method: "POST",
    path: "/api/challenges?token=should-not-be-stored",
    status: 403,
    code: "CSRF_ORIGIN_REJECTED"
  });
  logger.record("RATE_LIMITED", { method: "GET", path: "/api/health", status: 429, code: "RATE_LIMITED" });
  logger.record("AUTH_REQUIRED", { method: "GET", path: "/api/admin/users", status: 401, code: "AUTH_REQUIRED" });

  assert.equal(emitted.length, 3);
  assert.equal(logger.snapshot().length, 2);
  assert.equal(logger.snapshot()[0].path, "/api/admin/users");
  assert.equal(logger.snapshot()[1].path, "/api/health");
  assert.equal(logger.summary().bufferedEvents, 2);
  assert.deepEqual(logger.summary().byType, { AUTH_REQUIRED: 1, RATE_LIMITED: 1 });
  assert.deepEqual(logger.summary().bySeverity, { MODERATE: 2 });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, "CSRF_ORIGIN_REJECTED");
  assert.equal(alerts[0].severity, "HIGH");
  assert.equal(logger.snapshot()[1].requestId, undefined);
  assert.equal(logger.snapshot()[1].code, "RATE_LIMITED");
  assert.equal(logger.snapshot()[1].severity, "MODERATE");
});
