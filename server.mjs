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

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.join(projectRoot, "dist");
let state = createInitialState();

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
  sendJson(response, status, { error: error instanceof Error ? error.message : String(error) });
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

async function handleApi(request, response, url) {
  try {
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
      return sendJson(response, 200, { realMoneyGate: "BLOCKED", authentication: "DEMO_SESSION_ONLY", suspiciousActivity: [], providerAnomalies: [] });
    }
    if (request.method === "GET" && url.pathname === "/api/auth/session") {
      return sendJson(response, 200, { authenticated: true, demoMode: true, user: state.user, productionAuth: "NOT_CONFIGURED" });
    }
    if (request.method === "POST" && ["/api/auth/register", "/api/auth/recovery"].includes(url.pathname)) {
      return demoDisabled(response, "Production authentication is not connected; use the demo identity walkthrough.");
    }
    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      return sendJson(response, 200, { ok: true, demoMode: true });
    }
    if (request.method === "GET" && url.pathname === "/api/users/me") {
      return sendJson(response, 200, { user: state.user });
    }
    if (request.method === "GET" && url.pathname === "/api/users/me/challenges") {
      return sendJson(response, 200, { challenges: state.challenges.filter((challenge) => challenge.creatorId === state.user.id || challenge.challengerId === state.user.id) });
    }
    if (request.method === "GET" && url.pathname === "/api/users/me/transactions") {
      return sendJson(response, 200, { transactions: state.transactions });
    }
    if (request.method === "PATCH" && url.pathname === "/api/users/me") {
      return demoDisabled(response, "Profile persistence is not connected in the simulated demo.");
    }
    if (request.method === "POST" && url.pathname === "/api/users/me/payout-destination") {
      return demoDisabled(response, "Payout destinations are disabled until an approved provider and identity flow are configured.");
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
