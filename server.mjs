import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  acceptChallenge,
  createChallenge,
  createInitialState,
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
    if (request.method === "GET" && url.pathname === "/api/admin/overview") {
      return sendJson(response, 200, getAdminOverview(state));
    }
    if (request.method === "POST" && url.pathname === "/api/challenges") {
      const challenge = createChallenge(state, await readJson(request));
      return sendJson(response, 201, { challenge, state });
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
