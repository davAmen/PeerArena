import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  acceptChallenge,
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
import { requireAuthenticatedSession, revokeAuthenticatedSession } from "./src/backend/auth-session.mjs";
import { requireAdminSession } from "./src/backend/authorization.mjs";
import { ChallengeRepositoryError, createChallengeRepositoryFromEnv } from "./src/backend/challenges.mjs";
import { readRuntimeConfig } from "./src/backend/config.mjs";
import { ProfileRepositoryError, createProfileRepositoryFromEnv } from "./src/backend/profiles.mjs";
import { SlidingWindowRateLimiter, requestAddress } from "./src/backend/rate-limit.mjs";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.join(projectRoot, "dist");
let state = createInitialState();
const runtimeConfig = readRuntimeConfig();
const authProvider = createAuthProviderFromEnv();
const challengeRepository = createChallengeRepositoryFromEnv();
const profileRepository = createProfileRepositoryFromEnv();
const apiRateLimiter = new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 120 });
const mutationRateLimiter = new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 30 });

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    ...extra
  };
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, securityHeaders({ "Content-Type": "application/json; charset=utf-8" }));
  response.end(body);
}

function sendError(response, status, error) {
  const actualStatus = Number.isInteger(error?.status) ? error.status : status;
  const payload = { error: error instanceof Error ? error.message : String(error) };
  if (error?.code) payload.code = error.code;
  sendJson(response, actualStatus, payload);
}

function productionAuthEnabled() {
  return runtimeConfig.authMode === "supabase";
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

function challengeOperationBlocked(response, operation) {
  return sendJson(response, 503, {
    error: `${operation} requires a transactional server procedure and is not enabled yet.`,
    code: "CHALLENGE_TRANSACTION_REQUIRED",
    productionAuth: "SUPABASE"
  });
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error("Request body is too large.");
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
  const decision = limiter.consume(`${requestAddress(request)}:${request.method}:${url.pathname}`);
  if (decision.allowed) return true;
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
    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { ok: true, demoMode: true, realMoneyEnabled: false, service: "peerarena-demo" });
    }
    if (request.method === "GET" && url.pathname === "/api/state") {
      return sendJson(response, 200, state);
    }
    if (request.method === "GET" && url.pathname === "/api/live") {
      return sendJson(response, 200, {
        source: "Synthetic event feed",
        freshness: "DEMO",
        events: state.events.filter((event) => event.status === "LIVE")
      });
    }
    if (request.method === "GET" && url.pathname === "/api/sports") {
      return sendJson(response, 200, {
        sports: ["Football", "Basketball", "Tennis"].map((sport) => ({ sport, markets: getSupportedMarkets(sport) }))
      });
    }
    if (request.method === "GET" && url.pathname === "/api/events") {
      return sendJson(response, 200, { events: state.events });
    }
    if (request.method === "GET" && url.pathname === "/api/events/live") {
      return sendJson(response, 200, { source: "Synthetic event feed", events: state.events.filter((event) => event.status === "LIVE") });
    }
    const eventMarketsMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/markets$/);
    if (request.method === "GET" && eventMarketsMatch) {
      const event = findEvent(decodeURIComponent(eventMarketsMatch[1]));
      return sendJson(response, 200, { eventId: event.id, markets: getSupportedMarkets(event.sport).map((market) => ({ market, outcomes: getPredictionChoices(event, market), status: event.status === "LIVE" ? "OPEN_OR_SUSPENDABLE" : "OPEN" })) });
    }
    const eventMatch = url.pathname.match(/^\/api\/events\/([^/]+)$/);
    if (request.method === "GET" && eventMatch) {
      return sendJson(response, 200, findEvent(decodeURIComponent(eventMatch[1])));
    }
    if (productionAuthEnabled() && url.pathname.startsWith("/api/admin/")) {
      assertProductionAuthConfigured();
      await requireAdminSession({ request, provider: authProvider });
    }
    if (request.method === "GET" && url.pathname === "/api/admin/overview") {
      return sendJson(response, 200, getAdminOverview(state));
    }
    if (request.method === "GET" && url.pathname === "/api/admin/users") {
      return sendJson(response, 200, { users: [{ ...state.user, balance: undefined }], total: 4, verified: 3 });
    }
    if (request.method === "GET" && url.pathname === "/api/admin/challenges") {
      return sendJson(response, 200, { challenges: state.challenges });
    }
    if (request.method === "GET" && url.pathname === "/api/admin/transactions") {
      return sendJson(response, 200, { transactions: state.transactions });
    }
    if (request.method === "GET" && url.pathname === "/api/admin/settlements") {
      return sendJson(response, 200, { settlements: state.challenges.filter((challenge) => challenge.settlement).map((challenge) => ({ challengeId: challenge.id, ...challenge.settlement })) });
    }
    if (request.method === "GET" && url.pathname === "/api/admin/security") {
      return sendJson(response, 200, { realMoneyGate: "BLOCKED", authentication: productionAuthEnabled() ? "SUPABASE_BEARER_ADMIN" : "DEMO_SESSION_ONLY", suspiciousActivity: [], providerAnomalies: [] });
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
      return sendJson(response, 200, { challenge });
    }

    const acceptMatch = url.pathname.match(/^\/api\/challenges\/([^/]+)\/accept$/);
    if (request.method === "POST" && acceptMatch) {
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
    return sendError(response, 400, error);
  }
}

async function serveStatic(request, response, url) {
  let requested = decodeURIComponent(url.pathname);
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

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname.startsWith("/api/")) return handleApi(request, response, url);
  return serveStatic(request, response, url);
});
const port = Number(process.env.PEERARENA_PORT || 4174);
server.listen(port, "127.0.0.1", () => {
  console.log(`PeerArena demo running at http://127.0.0.1:${port}`);
  console.log("Real-money mode: disabled; all balances and settlements are synthetic.");
});
