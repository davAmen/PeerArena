import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  acceptChallenge,
  canViewChallenge,
  cancelChallenge,
  createChallenge,
  createInitialState,
  getPredictionChoices,
  getSupportedMarkets,
  getAdminOverview,
  setSelfExclusion,
  settleChallenge
} from "./src/demo-engine.mjs";
import { AuthProviderError, createAuthProviderFromEnv } from "./src/backend/auth.mjs";
import { AdminRepositoryError, createAdminRepositoryFromEnv } from "./src/backend/admin.mjs";
import { requireAuthenticatedSession, revokeAuthenticatedSession } from "./src/backend/auth-session.mjs";
import { requireAdminSession } from "./src/backend/authorization.mjs";
import { CatalogueRepositoryError, createCatalogueRepositoryFromEnv } from "./src/backend/catalogue.mjs";
import { ChallengeRepositoryError, createChallengeRepositoryFromEnv } from "./src/backend/challenges.mjs";
import { readRuntimeConfig } from "./src/backend/config.mjs";
import { ProfileRepositoryError, createProfileRepositoryFromEnv } from "./src/backend/profiles.mjs";
import { SlidingWindowRateLimiter, requestAddress } from "./src/backend/rate-limit.mjs";
import { SecurityEventLogger } from "./src/backend/security-events.mjs";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.join(projectRoot, "dist");
const MAX_JSON_BODY_BYTES = 1_000_000;
let state = createInitialState();
const runtimeConfig = readRuntimeConfig();
const authProvider = createAuthProviderFromEnv();
const adminRepository = createAdminRepositoryFromEnv();
const catalogueRepository = createCatalogueRepositoryFromEnv();
const challengeRepository = createChallengeRepositoryFromEnv();
const profileRepository = createProfileRepositoryFromEnv();
const apiRateLimiter = new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 120, maxKeys: 10_000 });
const mutationRateLimiter = new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 30, maxKeys: 10_000 });
const trustProxyHeaders = process.env.TRUST_PROXY_HEADERS === "true";
const securityEvents = new SecurityEventLogger({
  onEvent: (event) => console.warn(JSON.stringify({ securityEvent: event })),
  onAlert: (event) => console.error(JSON.stringify({ securityAlert: event }))
});

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function securityHeaders(extra = {}) {
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Permitted-Cross-Domain-Policies": "none",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'",
    ...extra
  };
  if (process.env.APP_ENV === "production") headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return headers;
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, securityHeaders({ "Content-Type": "application/json; charset=utf-8", "X-Request-ID": response.peerArenaRequestId ?? randomUUID() }));
  response.end(body);
}

function sendError(response, status, error) {
  const actualStatus = Number.isInteger(error?.status) ? error.status : status;
  const safeCodes = new Set([
    "AUTH_NOT_CONFIGURED",
    "PRODUCTION_AUTH_REQUIRED",
    "PERSISTENCE_NOT_CONFIGURED",
    "CHALLENGE_TRANSACTION_REQUIRED",
    "DEMO_STATE_DISABLED",
    "ORIGIN_NOT_CONFIGURED",
    "CSRF_ORIGIN_REJECTED",
    "RATE_LIMITED",
    "REQUEST_BODY_TOO_LARGE",
    "INVALID_PATH"
  ]);
  const exposeMessage = actualStatus < 500 || safeCodes.has(error?.code);
  const payload = {
    error: exposeMessage ? (error instanceof Error ? error.message : String(error)) : "Request could not be completed.",
    requestId: response.peerArenaRequestId ?? randomUUID()
  };
  if (error?.code) payload.code = error.code;
  sendJson(response, actualStatus, payload);
}

function productionAuthEnabled() {
  return runtimeConfig.authMode === "supabase";
}

function readinessSnapshot() {
  const authConfigured = authProvider.getCapabilities().configured === true;
  const productionAuthRequired = runtimeConfig.appEnv === "production" && !productionAuthEnabled();
  return Object.freeze({
    release: productionAuthRequired ? "PRODUCTION_CONFIGURATION_BLOCKED" : "PROTECTED_SYNTHETIC_PILOT",
    frontend: "ACTIVE",
    api: productionAuthRequired ? "BLOCKED" : "ACTIVE",
    access: "VERCEL_AUTHENTICATION_REQUIRED",
    authentication: productionAuthRequired ? "PRODUCTION_AUTH_REQUIRED" : productionAuthEnabled() ? (authConfigured ? "ACTIVE" : "BLOCKED") : "DEMO_SESSION_ONLY",
    database: runtimeConfig.ownedDatabaseReady ? "ACTIVE" : "DISABLED_DEMO_ONLY",
    marketData: "SYNTHETIC_ONLY",
    payments: "DISABLED",
    payouts: "DISABLED",
    realMoney: "BLOCKED",
    nextProductionGates: Object.freeze([
      "PRIVATE_POSTGRESQL_PROVISIONED",
      "FIRST_PARTY_AUTHENTICATION_REVIEWED",
      "ATOMIC_LEDGER_AND_SETTLEMENT_PROCEDURES",
      "WAF_CENTRAL_ALERTING_AND_INCIDENT_OWNER",
      "LICENSED_DATA_AND_PAYMENT_APPROVALS",
      "INDEPENDENT_SECURITY_AND_COMPLIANCE_REVIEW"
    ])
  });
}

function assertProductionAuthConfigured() {
  if (!productionAuthEnabled()) return;
  if (!authProvider.getCapabilities().configured) {
    throw new AuthProviderError("Production authentication is not configured.", { code: "AUTH_NOT_CONFIGURED", status: 503 });
  }
}

function productionPersistenceDisabled(response, resource) {
  return sendJson(response, 503, {
    error: `${resource} persistence is not configured.`,
    code: "PERSISTENCE_NOT_CONFIGURED",
    productionAuth: "SUPABASE"
  });
}

function assertProfilePersistenceConfigured() {
  if (!profileRepository.getCapabilities().configured) {
    throw new ProfileRepositoryError("Profile persistence is not configured.", { code: "PERSISTENCE_NOT_CONFIGURED", status: 503 });
  }
}

function assertChallengePersistenceConfigured() {
  if (!challengeRepository.getCapabilities().configured) {
    throw new ChallengeRepositoryError("Challenge persistence is not configured.", { code: "PERSISTENCE_NOT_CONFIGURED", status: 503 });
  }
}

function assertCataloguePersistenceConfigured() {
  if (!catalogueRepository.getCapabilities().configured) {
    throw new CatalogueRepositoryError("Catalogue persistence is not configured.", { code: "PERSISTENCE_NOT_CONFIGURED", status: 503 });
  }
}

function assertAdminPersistenceConfigured() {
  if (!adminRepository.getCapabilities().configured) {
    throw new AdminRepositoryError("Admin persistence is not configured.", { code: "PERSISTENCE_NOT_CONFIGURED", status: 503 });
  }
}

function adminPage(url) {
  return {
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined
  };
}

function requestSecurityError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function enforceMutationOrigin(request) {
  const originChecksRequired = runtimeConfig.appEnv === "production" || productionAuthEnabled() || process.env.VERCEL === "1";
  if (!originChecksRequired || !["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) return;
  const origin = request.headers.origin;
  if (origin === undefined) return;
  if (typeof origin !== "string" || origin.length > 2_048) {
    throw requestSecurityError("Request origin is invalid.", "CSRF_ORIGIN_REJECTED", 403);
  }
  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!configuredAppUrl) {
    throw requestSecurityError("The application origin is not configured.", "ORIGIN_NOT_CONFIGURED", 503);
  }
  let allowedOrigin;
  try {
    allowedOrigin = new URL(configuredAppUrl).origin;
  } catch {
    throw requestSecurityError("The application origin is invalid.", "ORIGIN_NOT_CONFIGURED", 503);
  }
  if (origin !== allowedOrigin) throw requestSecurityError("Request origin is not allowed.", "CSRF_ORIGIN_REJECTED", 403);
}

function enforceProductionRuntime(url) {
  if (runtimeConfig.appEnv !== "production" || productionAuthEnabled()) return;
  if (["/api/health", "/api/readiness"].includes(url.pathname)) return;
  throw requestSecurityError("Production authentication must be configured before API access is enabled.", "PRODUCTION_AUTH_REQUIRED", 503);
}

function recordSecurityFailure(request, response, url, error) {
  const code = typeof error?.code === "string" ? error.code : error?.status >= 500 ? "REQUEST_FAILURE" : undefined;
  if (!code) return;
  securityEvents.record(code, {
    requestId: response.peerArenaRequestId,
    method: request.method,
    path: url.pathname,
    status: Number.isInteger(error?.status) ? error.status : 500
  });
}

function runtimeSecurityReport() {
  const recentEvents = securityEvents.snapshot(100);
  return {
    runtimeSecurity: securityEvents.summary(),
    recentSecurityAlerts: recentEvents.filter((event) => ["CRITICAL", "HIGH"].includes(event.severity))
  };
}

function challengeOperationBlocked(response, operation) {
  return sendJson(response, 503, {
    error: `${operation} requires a transactional server procedure and is not enabled yet.`,
    code: "CHALLENGE_TRANSACTION_REQUIRED",
    productionAuth: "SUPABASE"
  });
}

async function readJson(request) {
  let raw = "";
  let bodyBytes = 0;
  for await (const chunk of request) {
    bodyBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    if (bodyBytes > MAX_JSON_BODY_BYTES) throw requestSecurityError("Request body is too large.", "REQUEST_BODY_TOO_LARGE", 413);
    raw += chunk;
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function findEvent(eventId) {
  const event = state.events.find((item) => item.id === eventId);
  if (!event) throw new Error("Event not found.");
  return event;
}

function findChallenge(challengeId) {
  const challenge = state.challenges.find((item) => item.id === challengeId);
  if (!challenge) throw new Error("Challenge not found.");
  return challenge;
}

function publicChallenge(challenge) {
  return challenge.visibility === "PUBLIC" && ["AWAITING_ACCEPTANCE", "ACTIVE", "FUNDS_CONFIRMED"].includes(challenge.status);
}

function demoDisabled(response, message = "This capability is disabled in the simulated-funds environment.") {
  return sendJson(response, 403, { error: message, code: "REAL_MONEY_DISABLED", demoMode: true });
}

function applyRateLimit(request, response, url) {
  const limiter = ["POST", "PATCH", "PUT", "DELETE"].includes(request.method) ? mutationRateLimiter : apiRateLimiter;
  const decision = limiter.consume(`${requestAddress(request, { trustForwardedFor: trustProxyHeaders })}:${request.method}:${url.pathname}`);
  if (decision.allowed) return true;
  securityEvents.record("RATE_LIMITED", {
    requestId: response.peerArenaRequestId,
    method: request.method,
    path: url.pathname,
    status: 429
  });
  response.writeHead(429, securityHeaders({
    "Content-Type": "application/json; charset=utf-8",
    "Retry-After": String(decision.retryAfterSeconds),
    "X-RateLimit-Limit": String(decision.limit),
    "X-RateLimit-Remaining": "0"
  }));
  response.end(JSON.stringify({ error: "Too many requests.", code: "RATE_LIMITED", retryAfterSeconds: decision.retryAfterSeconds }));
  return false;
}

async function handleApi(request, response, url) {
  try {
    if (!applyRateLimit(request, response, url)) return;
    enforceMutationOrigin(request);
    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { ok: true, demoMode: runtimeConfig.appEnv !== "production" && !productionAuthEnabled(), realMoneyEnabled: false, databaseProvider: runtimeConfig.databaseProvider, ownedDatabaseReady: runtimeConfig.ownedDatabaseReady, service: runtimeConfig.appEnv === "production" ? "peerarena-api" : "peerarena-demo" });
    }
    if (request.method === "GET" && url.pathname === "/api/readiness") {
      return sendJson(response, 200, readinessSnapshot());
    }
    enforceProductionRuntime(url);
    if (request.method === "GET" && url.pathname === "/api/state") {
      if (productionAuthEnabled()) return sendJson(response, 503, { error: "Synthetic demo state is disabled in Supabase mode.", code: "DEMO_STATE_DISABLED", productionAuth: "SUPABASE" });
      return sendJson(response, 200, state);
    }
    if (request.method === "GET" && url.pathname === "/api/live") {
      if (productionAuthEnabled()) {
        assertCataloguePersistenceConfigured();
        return sendJson(response, 200, { source: "Supabase sports catalogue", freshness: "PERSISTED", events: await catalogueRepository.listLiveEvents() });
      }
      return sendJson(response, 200, {
        source: "Synthetic event feed",
        freshness: "DEMO",
        events: state.events.filter((event) => event.status === "LIVE")
      });
    }
    if (request.method === "GET" && url.pathname === "/api/sports") {
      if (productionAuthEnabled()) {
        assertCataloguePersistenceConfigured();
        const sports = await catalogueRepository.listSports();
        return sendJson(response, 200, { sports: sports.map((sport) => ({ sport: sport.name, markets: [] })) });
      }
      return sendJson(response, 200, {
        sports: ["Football", "Basketball", "Tennis"].map((sport) => ({ sport, markets: getSupportedMarkets(sport) }))
      });
    }
    if (request.method === "GET" && url.pathname === "/api/events") {
      if (productionAuthEnabled()) {
        assertCataloguePersistenceConfigured();
        return sendJson(response, 200, { events: await catalogueRepository.listEvents() });
      }
      return sendJson(response, 200, { events: state.events });
    }
    if (request.method === "GET" && url.pathname === "/api/events/live") {
      if (productionAuthEnabled()) {
        assertCataloguePersistenceConfigured();
        return sendJson(response, 200, { source: "Supabase sports catalogue", events: await catalogueRepository.listLiveEvents() });
      }
      return sendJson(response, 200, { source: "Synthetic event feed", events: state.events.filter((event) => event.status === "LIVE") });
    }
    const eventMarketsMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/markets$/);
    if (request.method === "GET" && eventMarketsMatch) {
      if (productionAuthEnabled()) {
        assertCataloguePersistenceConfigured();
        const eventId = decodeURIComponent(eventMarketsMatch[1]);
        const event = await catalogueRepository.getEventById(eventId);
        if (!event) return sendJson(response, 404, { error: "Event not found.", code: "EVENT_NOT_FOUND" });
        return sendJson(response, 200, { eventId: event.id, markets: await catalogueRepository.listMarketsForEvent(eventId) });
      }
      const event = findEvent(decodeURIComponent(eventMarketsMatch[1]));
      return sendJson(response, 200, { eventId: event.id, markets: getSupportedMarkets(event.sport).map((market) => ({ market, outcomes: getPredictionChoices(event, market), status: event.status === "LIVE" ? "OPEN_OR_SUSPENDABLE" : "OPEN" })) });
    }
    const eventMatch = url.pathname.match(/^\/api\/events\/([^/]+)$/);
    if (request.method === "GET" && eventMatch) {
      if (productionAuthEnabled()) {
        assertCataloguePersistenceConfigured();
        const event = await catalogueRepository.getEventById(decodeURIComponent(eventMatch[1]));
        if (!event) return sendJson(response, 404, { error: "Event not found.", code: "EVENT_NOT_FOUND" });
        return sendJson(response, 200, event);
      }
      return sendJson(response, 200, findEvent(decodeURIComponent(eventMatch[1])));
    }
    if (productionAuthEnabled() && url.pathname.startsWith("/api/admin/")) {
      assertProductionAuthConfigured();
      await requireAdminSession({ request, provider: authProvider });
      assertAdminPersistenceConfigured();
    }
    if (request.method === "GET" && url.pathname === "/api/admin/overview") {
      if (productionAuthEnabled()) return sendJson(response, 200, await adminRepository.getOverview());
      return sendJson(response, 200, getAdminOverview(state));
    }
    if (request.method === "GET" && url.pathname === "/api/admin/users") {
      if (productionAuthEnabled()) return sendJson(response, 200, await adminRepository.listUsers(adminPage(url)));
      return sendJson(response, 200, { users: [{ ...state.user, balance: undefined }], total: 4, verified: 3 });
    }
    if (request.method === "GET" && url.pathname === "/api/admin/challenges") {
      if (productionAuthEnabled()) return sendJson(response, 200, await adminRepository.listChallenges(adminPage(url)));
      return sendJson(response, 200, { challenges: state.challenges });
    }
    if (request.method === "GET" && url.pathname === "/api/admin/transactions") {
      if (productionAuthEnabled()) return sendJson(response, 200, await adminRepository.listTransactions(adminPage(url)));
      return sendJson(response, 200, { transactions: state.transactions });
    }
    if (request.method === "GET" && url.pathname === "/api/admin/settlements") {
      if (productionAuthEnabled()) return sendJson(response, 200, await adminRepository.listSettlements(adminPage(url)));
      return sendJson(response, 200, { settlements: state.challenges.filter((challenge) => challenge.settlement).map((challenge) => ({ challengeId: challenge.id, ...challenge.settlement })) });
    }
    if (request.method === "GET" && url.pathname === "/api/admin/security") {
      if (productionAuthEnabled()) return sendJson(response, 200, { ...(await adminRepository.getSecurity()), ...runtimeSecurityReport() });
      return sendJson(response, 200, { realMoneyGate: "BLOCKED", authentication: "DEMO_SESSION_ONLY", suspiciousActivity: [], providerAnomalies: [], ...runtimeSecurityReport() });
    }
    if (request.method === "GET" && url.pathname === "/api/auth/session") {
      if (productionAuthEnabled()) {
        assertProductionAuthConfigured();
        const session = await requireAuthenticatedSession({ request, provider: authProvider });
        return sendJson(response, 200, { authenticated: true, demoMode: false, user: session.user, productionAuth: "SUPABASE" });
      }
      return sendJson(response, 200, { authenticated: true, demoMode: true, user: state.user, productionAuth: "NOT_CONFIGURED" });
    }
    if (request.method === "POST" && url.pathname === "/api/auth/register") {
      if (productionAuthEnabled()) {
        assertProductionAuthConfigured();
        const body = await readJson(request);
        const auth = await authProvider.signUp({ email: body.email, password: body.password, metadata: body.metadata, redirectTo: body.redirectTo });
        return sendJson(response, 201, { auth, productionAuth: "SUPABASE" });
      }
      return demoDisabled(response, "Production authentication is not connected; use the demo identity walkthrough.");
    }
    if (request.method === "POST" && url.pathname === "/api/auth/login") {
      if (productionAuthEnabled()) {
        assertProductionAuthConfigured();
        const body = await readJson(request);
        const auth = await authProvider.signInWithPassword({ email: body.email, password: body.password });
        return sendJson(response, 200, { auth, productionAuth: "SUPABASE" });
      }
      return demoDisabled(response, "Production authentication is not connected; use the demo identity walkthrough.");
    }
    if (request.method === "POST" && url.pathname === "/api/auth/recovery") {
      if (productionAuthEnabled()) {
        assertProductionAuthConfigured();
        const body = await readJson(request);
        await authProvider.requestPasswordRecovery({ email: body.email, redirectTo: body.redirectTo });
        return sendJson(response, 202, { ok: true, productionAuth: "SUPABASE" });
      }
      return demoDisabled(response, "Production authentication is not connected; use the demo identity walkthrough.");
    }
    if (request.method === "GET" && url.pathname === "/api/auth/google") {
      if (productionAuthEnabled()) {
        assertProductionAuthConfigured();
        const redirectTo = url.searchParams.get("redirectTo") ?? undefined;
        return sendJson(response, 200, { provider: "google", url: authProvider.getGoogleOAuthUrl({ redirectTo }), productionAuth: "SUPABASE" });
      }
      return demoDisabled(response, "Google authentication is not connected in the simulated demo.");
    }
    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      if (productionAuthEnabled()) {
        assertProductionAuthConfigured();
        const result = await revokeAuthenticatedSession({ request, provider: authProvider });
        return sendJson(response, 200, { ...result, productionAuth: "SUPABASE" });
      }
      return sendJson(response, 200, { ok: true, demoMode: true });
    }
    if (request.method === "GET" && url.pathname === "/api/users/me") {
      if (productionAuthEnabled()) {
        assertProductionAuthConfigured();
        const session = await requireAuthenticatedSession({ request, provider: authProvider });
        assertProfilePersistenceConfigured();
        const profile = await profileRepository.getByAuthUserId(session.user.id);
        if (!profile) throw new ProfileRepositoryError("Profile was not found.", { code: "PROFILE_NOT_FOUND", status: 404 });
        return sendJson(response, 200, { user: session.user, profile, productionAuth: "SUPABASE" });
      }
      return sendJson(response, 200, { user: state.user });
    }
    if (request.method === "GET" && url.pathname === "/api/users/me/challenges") {
      if (productionAuthEnabled()) {
        assertProductionAuthConfigured();
        await requireAuthenticatedSession({ request, provider: authProvider });
        return productionPersistenceDisabled(response, "User challenge");
      }
      return sendJson(response, 200, { challenges: state.challenges.filter((challenge) => challenge.creatorId === state.user.id || challenge.challengerId === state.user.id) });
    }
    if (request.method === "GET" && url.pathname === "/api/users/me/transactions") {
      if (productionAuthEnabled()) {
        assertProductionAuthConfigured();
        await requireAuthenticatedSession({ request, provider: authProvider });
        return productionPersistenceDisabled(response, "User transaction");
      }
      return sendJson(response, 200, { transactions: state.transactions });
    }
    if (request.method === "PATCH" && url.pathname === "/api/users/me") {
      if (productionAuthEnabled()) {
        assertProductionAuthConfigured();
        const session = await requireAuthenticatedSession({ request, provider: authProvider });
        assertProfilePersistenceConfigured();
        const profile = await profileRepository.updateByAuthUserId(session.user.id, await readJson(request));
        if (!profile) throw new ProfileRepositoryError("Profile was not found.", { code: "PROFILE_NOT_FOUND", status: 404 });
        return sendJson(response, 200, { profile, productionAuth: "SUPABASE" });
      }
      return demoDisabled(response, "Profile persistence is not connected in the simulated demo.");
    }
    if (request.method === "POST" && url.pathname === "/api/users/me/payout-destination") {
      if (productionAuthEnabled()) {
        assertProductionAuthConfigured();
        await requireAuthenticatedSession({ request, provider: authProvider });
        return productionPersistenceDisabled(response, "Payout-destination");
      }
      return demoDisabled(response, "Payout destinations are disabled until an approved provider and identity flow are configured.");
    }
    const publicChallengeMatch = url.pathname.match(/^\/api\/challenges\/([^/]+)$/);
    if (productionAuthEnabled() && request.method === "GET" && url.pathname === "/api/challenges") {
      assertProductionAuthConfigured();
      assertChallengePersistenceConfigured();
      const challenges = await challengeRepository.listPublic({
        limit: url.searchParams.get("limit") ?? undefined,
        offset: url.searchParams.get("offset") ?? undefined
      });
      return sendJson(response, 200, { challenges, productionAuth: "SUPABASE" });
    }
    if (productionAuthEnabled() && request.method === "GET" && publicChallengeMatch) {
      assertProductionAuthConfigured();
      assertChallengePersistenceConfigured();
      const challenge = await challengeRepository.getPublicById(decodeURIComponent(publicChallengeMatch[1]));
      if (!challenge) return sendJson(response, 404, { error: "Challenge not found.", code: "CHALLENGE_NOT_FOUND" });
      return sendJson(response, 200, { challenge, productionAuth: "SUPABASE" });
    }
    if (productionAuthEnabled() && (url.pathname === "/api/challenges" || url.pathname.startsWith("/api/challenges/"))) {
      assertProductionAuthConfigured();
      await requireAuthenticatedSession({ request, provider: authProvider });
      assertChallengePersistenceConfigured();
      return challengeOperationBlocked(response, "Challenge writes and participant reads");
    }
    if (request.method === "GET" && url.pathname === "/api/challenges") {
      return sendJson(response, 200, { challenges: state.challenges.filter(publicChallenge) });
    }
    if (request.method === "POST" && url.pathname === "/api/challenges") {
      const challenge = createChallenge(state, await readJson(request));
      return sendJson(response, 201, { challenge, state });
    }

    const participantMatch = url.pathname.match(/^\/api\/challenges\/([^/]+)\/participants$/);
    if (request.method === "GET" && participantMatch) {
      const challenge = findChallenge(decodeURIComponent(participantMatch[1]));
      if (!canViewChallenge(challenge, state.user.id)) return sendJson(response, 404, { error: "Challenge not found.", code: "CHALLENGE_NOT_FOUND" });
      return sendJson(response, 200, { challengeId: challenge.id, participants: challenge.participants ?? [] });
    }

    const challengeCancelMatch = url.pathname.match(/^\/api\/challenges\/([^/]+)\/cancel$/);
    if (request.method === "POST" && challengeCancelMatch) {
      const challenge = cancelChallenge(state, decodeURIComponent(challengeCancelMatch[1]));
      return sendJson(response, 200, { challenge, state });
    }

    const challengeMatch = url.pathname.match(/^\/api\/challenges\/([^/]+)$/);
    if (request.method === "GET" && challengeMatch) {
      const challenge = findChallenge(decodeURIComponent(challengeMatch[1]));
      if (!canViewChallenge(challenge, state.user.id)) return sendJson(response, 404, { error: "Challenge not found.", code: "CHALLENGE_NOT_FOUND" });
      return sendJson(response, 200, { challenge });
    }

    const acceptMatch = url.pathname.match(/^\/api\/challenges\/([^/]+)\/accept$/);
    if (request.method === "POST" && acceptMatch) {
      const challengeToAccept = findChallenge(decodeURIComponent(acceptMatch[1]));
      if (!canViewChallenge(challengeToAccept, state.user.id)) return sendJson(response, 404, { error: "Challenge not found.", code: "CHALLENGE_NOT_FOUND" });
      const challenge = acceptChallenge(state, decodeURIComponent(acceptMatch[1]));
      return sendJson(response, 200, { challenge, state });
    }

    const settleMatch = url.pathname.match(/^\/api\/challenges\/([^/]+)\/settle$/);
    if (request.method === "POST" && settleMatch) {
      const body = await readJson(request);
      const challenge = settleChallenge(state, decodeURIComponent(settleMatch[1]), body.outcome);
      return sendJson(response, 200, { challenge, state });
    }

    if (request.method === "POST" && url.pathname === "/api/responsible/self-exclusion") {
      if (productionAuthEnabled()) {
        assertProductionAuthConfigured();
        await requireAuthenticatedSession({ request, provider: authProvider });
        return productionPersistenceDisabled(response, "Responsible-play");
      }
      const body = await readJson(request);
      const responsible = setSelfExclusion(state, body.enabled);
      return sendJson(response, 200, { responsible, state });
    }

    if (request.method === "POST" && url.pathname === "/api/payments/checkout") return demoDisabled(response, "Payment checkout is disabled; no provider or customer funds are connected.");
    const paymentMatch = url.pathname.match(/^\/api\/payments\/([^/]+)$/);
    if (request.method === "GET" && paymentMatch) return sendJson(response, 200, { paymentId: decodeURIComponent(paymentMatch[1]), status: "DISABLED", demoMode: true });
    if (request.method === "POST" && ["/api/webhooks/seevplus", "/api/webhooks/paystack"].includes(url.pathname)) return demoDisabled(response, "Payment webhooks are not enabled in the demo.");
    if (request.method === "GET" && url.pathname === "/api/payouts") return sendJson(response, 200, { payouts: [], status: "DISABLED" });
    const payoutMatch = url.pathname.match(/^\/api\/payouts\/([^/]+)$/);
    if (request.method === "GET" && payoutMatch) return sendJson(response, 200, { payoutId: decodeURIComponent(payoutMatch[1]), status: "DISABLED", demoMode: true });

    if (request.method === "POST" && url.pathname === "/api/admin/reset") {
      if (productionAuthEnabled()) return productionPersistenceDisabled(response, "Admin reset");
      state = createInitialState();
      return sendJson(response, 200, { state, reset: true });
    }

    return sendJson(response, 404, { error: "API route not found." });
  } catch (error) {
    recordSecurityFailure(request, response, url, error);
    return sendError(response, 400, error);
  }
}

async function serveStatic(request, response, url) {
  let requested;
  try {
    requested = decodeURIComponent(url.pathname);
  } catch {
    return sendError(response, 400, requestSecurityError("Invalid URL encoding.", "INVALID_PATH", 400));
  }
  if (requested === "/") requested = "/index.html";
  if (requested.includes("..")) return sendError(response, 400, "Invalid path.");
  const filePath = path.join(distRoot, requested);
  if (!filePath.startsWith(distRoot) || !existsSync(filePath)) return sendError(response, 404, "Not found.");
  try {
    const body = await readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, securityHeaders({ "Content-Type": contentTypes[extension] ?? "application/octet-stream" }));
    response.end(body);
  } catch (error) {
    sendError(response, 500, error);
  }
}

export async function handleRequest(request, response) {
  response.peerArenaRequestId = randomUUID();
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname.startsWith("/api/")) return handleApi(request, response, url);
  return serveStatic(request, response, url);
}

if (process.env.VERCEL !== "1") {
  const server = http.createServer({
    maxHeaderSize: 16 * 1024,
    requestTimeout: 15_000,
    headersTimeout: 10_000,
    keepAliveTimeout: 5_000
  }, handleRequest);
  const port = Number(process.env.PEERARENA_PORT || 4174);
  server.listen(port, "127.0.0.1", () => {
    console.log(`PeerArena demo running at http://127.0.0.1:${port}`);
    console.log("Real-money mode: disabled; all balances and settlements are synthetic.");
  });
}
