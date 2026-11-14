import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Vercel API adapter delegates to the hardened Node request handler", async () => {
  const nestedRoutePaths = [
    "../api/events/live.mjs",
    "../api/events/[id].mjs",
    "../api/events/[id]/markets.mjs",
    "../api/challenges/[id].mjs",
    "../api/challenges/[id]/accept.mjs",
    "../api/challenges/[id]/cancel.mjs",
    "../api/challenges/[id]/participants.mjs",
    "../api/users/me.mjs",
    "../api/users/me/challenges.mjs",
    "../api/users/me/transactions.mjs",
    "../api/users/me/payout-destination.mjs",
    "../api/auth/session.mjs",
    "../api/auth/logout.mjs",
    "../api/auth/recovery.mjs",
    "../api/auth/google.mjs",
    "../api/auth/register.mjs",
    "../api/auth/login.mjs",
    "../api/payments/checkout.mjs",
    "../api/payments/[id].mjs",
    "../api/webhooks/seevplus.mjs",
    "../api/webhooks/paystack.mjs",
    "../api/payouts/index.mjs",
    "../api/payouts/[id].mjs",
    "../api/admin/overview.mjs",
    "../api/admin/users.mjs",
    "../api/admin/challenges.mjs",
    "../api/admin/transactions.mjs",
    "../api/admin/settlements.mjs",
    "../api/admin/security.mjs"
  ];
  const [server, adapter, packageText, vercelText, quickstart, ...nestedRoutes] = await Promise.all([
    readFile(new URL("../server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../api/[...path].mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
    readFile(new URL("../docs/STRANGER_QUICKSTART.md", import.meta.url), "utf8"),
    ...nestedRoutePaths.map((routePath) => readFile(new URL(routePath, import.meta.url), "utf8"))
  ]);
  const vercel = JSON.parse(vercelText);
  assert.match(server, /export async function handleRequest/);
  assert.match(server, /process\.env\.VERCEL !== "1"/);
  assert.match(server, /url\.pathname === "\/api\/readiness"/);
  assert.match(server, /PROTECTED_SYNTHETIC_PILOT/);
  assert.match(adapter, /handleRequest\(request, response\)/);
  assert.match(JSON.parse(packageText).scripts.check, /node --check api\/\[\.\.\.path\]\.mjs/);
  assert.equal(vercel.outputDirectory, "dist");
  assert.equal(vercel.buildCommand, "npm run build:vercel");
  assert.match(quickstart, /\/api\/readiness/);
  assert.match(quickstart, /no real-money account/);
  for (const routeText of nestedRoutes) assert.match(routeText, /handleRequest\(request, response\)/);
});
