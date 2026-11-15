import assert from "node:assert/strict";
import test from "node:test";

// Import the serverless entry points without opening a listener.
process.env.VERCEL = "1";
const { handleRequest } = await import("../server.mjs");
const { default: vercelHandler } = await import("../api/index.mjs");

function responseRecorder() {
  return {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; }
  };
}

for (const [name, handler] of [["Node", handleRequest], ["Vercel", vercelHandler]]) {
  test(`${name} rejects malformed request URLs and serves subsequent requests`, async () => {
    for (const url of ["//[", "http://[invalid]/?secret=redacted"]) {
      const response = responseRecorder();
      await handler({ url, method: "GET", headers: {} }, response);
      assert.equal(response.status, 400);
      assert.equal(JSON.parse(response.body).code, "INVALID_PATH");
      assert.ok(response.headers["X-Request-ID"]);
      assert.equal(response.headers["X-Content-Type-Options"], "nosniff");
      assert.doesNotMatch(response.body, /secret|redacted|invalid\]/);
    }
    const response = responseRecorder();
    await handler({ url: "/", method: "GET", headers: {} }, response);
    assert.equal(response.status, 200);
    assert.match(response.headers["Content-Type"], /text\/html/);
  });
}
