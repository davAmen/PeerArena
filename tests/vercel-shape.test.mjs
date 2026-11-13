import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Vercel API adapter delegates to the hardened Node request handler", async () => {
  const [server, adapter, packageText, vercelText] = await Promise.all([
    readFile(new URL("../server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../api/[...path].mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8")
  ]);
  const vercel = JSON.parse(vercelText);
  assert.match(server, /export async function handleRequest/);
  assert.match(server, /process\.env\.VERCEL !== "1"/);
  assert.match(adapter, /handleRequest\(request, response\)/);
  assert.match(JSON.parse(packageText).scripts.check, /node --check api\/\[\.\.\.path\]\.mjs/);
  assert.equal(vercel.outputDirectory, "dist");
  assert.equal(vercel.buildCommand, "npm run build:vercel");
});
