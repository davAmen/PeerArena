import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Vercel API adapter delegates to the hardened Node request handler", async () => {
  const [server, router, packageText, vercelText, quickstart] = await Promise.all([
    readFile(new URL("../server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../api/index.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
    readFile(new URL("../docs/STRANGER_QUICKSTART.md", import.meta.url), "utf8")
  ]);
  const vercel = JSON.parse(vercelText);
  assert.match(server, /export async function handleRequest/);
  assert.match(server, /process\.env\.VERCEL !== "1"/);
  assert.match(server, /url\.pathname === "\/api\/readiness"/);
  assert.match(server, /PROTECTED_SYNTHETIC_PILOT/);
  assert.match(server, /runtimeConfig\.appEnv === "production"/);
  assert.match(server, /PRODUCTION_AUTH_REQUIRED/);
  assert.match(server, /MAX_JSON_BODY_BYTES/);
  assert.match(server, /REQUEST_BODY_TOO_LARGE/);
  assert.match(server, /INVALID_PATH/);
  assert.match(router, /handleRequest\(routedRequest\(request\), response\)/);
  assert.match(JSON.parse(packageText).scripts.check, /node --check api\/index\.mjs/);
  assert.equal(vercel.outputDirectory, "dist");
  assert.equal(vercel.buildCommand, "npm run build:vercel");
  assert.deepEqual(vercel.rewrites, [
    { source: "/api", destination: "/api/index?__peerarena_path=/api" },
    { source: "/api/:path*", destination: "/api/index?__peerarena_path=/api/:path*" }
  ]);
  assert.match(router, /__peerarena_path/);
  assert.match(router, /Object\.create\(request\)/);
  assert.match(quickstart, /\/api\/readiness/);
  assert.match(quickstart, /no real-money account/);
});
