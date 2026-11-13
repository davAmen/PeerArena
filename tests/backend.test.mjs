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

test("Supabase Auth remains disabled when public project configuration is absent", () => {
  const provider = createAuthProviderFromEnv({});
  assert.ok(provider instanceof DisabledAuthProvider);
  assert.equal(provider.getCapabilities().configured, false);
  assert.throws(() => provider.signInWithPassword({ email: "demo@example.com", password: "not-a-real-password" }), (error) => {
    assert.equal(error.code, "AUTH_NOT_CONFIGURED");
    assert.equal(error.status, 503);
    return true;
  });
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
