import assert from "node:assert/strict";
import test from "node:test";

process.env.VERCEL = "1";
const { handleRequest } = await import("../server.mjs");
const { default: vercelHandler } = await import("../api/index.mjs");

function responseRecorder() {
  return {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; }
  };
}

for (const [name, handler, address] of [["Node", handleRequest, "192.0.2.1"], ["Vercel", vercelHandler, "192.0.2.2"]]) {
  for (const [kind, limit, methods] of [["read", 120, ["GET", "HEAD"]], ["mutation", 30, ["POST", "PATCH", "PUT", "DELETE"]]]) {
    test(`${name} shares the ${kind} allowance across paths and methods`, async () => {
      for (let i = 0; i <= limit; i++) {
        const response = responseRecorder();
        const route = `/api/nonexistent-rate-test-${kind}-${i}`;
        await handler({
          url: name === "Vercel" ? `/api/index?__peerarena_path=${encodeURIComponent(route)}` : route,
          method: methods[i % methods.length], headers: {}, socket: { remoteAddress: address }
        }, response);
        if (i < limit) {
          assert.notEqual(response.status, 429);
        } else {
          assert.equal(response.status, 429);
          assert.equal(JSON.parse(response.body).code, "RATE_LIMITED");
          assert.ok(Number(response.headers["Retry-After"]) > 0);
          assert.equal(response.headers["X-Content-Type-Options"], "nosniff");
        }
      }
      const otherClient = responseRecorder();
      await handler({ url: "/api/health", method: methods[0], headers: {}, socket: { remoteAddress: `${address}0` } }, otherClient);
      assert.notEqual(otherClient.status, 429);
    });
  }
}
