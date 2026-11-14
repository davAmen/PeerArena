import { isIP } from "node:net";

export class SlidingWindowRateLimiter {
  constructor({ windowMs = 60_000, maxRequests = 60, maxKeys = 10_000, now = () => Date.now() } = {}) {
    if (!Number.isInteger(windowMs) || windowMs <= 0) throw new Error("windowMs must be a positive integer.");
    if (!Number.isInteger(maxRequests) || maxRequests <= 0) throw new Error("maxRequests must be a positive integer.");
    if (!Number.isInteger(maxKeys) || maxKeys < 1 || maxKeys > 100_000) throw new Error("maxKeys must be between 1 and 100000.");
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.maxKeys = maxKeys;
    this.now = now;
    this.buckets = new Map();
  }

  consume(key) {
    const requestedIdentifier = String(key || "anonymous");
    const currentTime = this.now();
    const overflowIdentifier = "__peerarena_rate_limit_overflow__";
    const identifier = this.buckets.has(requestedIdentifier) || this.buckets.size < Math.max(0, this.maxKeys - 1)
      ? requestedIdentifier
      : overflowIdentifier;
    const current = this.buckets.get(identifier);
    const bucket = current && current.resetAt > currentTime
      ? current
      : { count: 0, resetAt: currentTime + this.windowMs };

    bucket.count += 1;
    this.buckets.set(identifier, bucket);
    const allowed = bucket.count <= this.maxRequests;
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - currentTime) / 1000));

    return Object.freeze({
      allowed,
      limit: this.maxRequests,
      remaining: Math.max(0, this.maxRequests - bucket.count),
      retryAfterSeconds,
      resetAt: bucket.resetAt
    });
  }

  prune() {
    const currentTime = this.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= currentTime) this.buckets.delete(key);
    }
    return this.buckets.size;
  }

  clear() {
    this.buckets.clear();
  }
}

export function requestAddress(request, { trustForwardedFor = false } = {}) {
  const remoteAddress = typeof request.socket?.remoteAddress === "string" ? request.socket.remoteAddress : "unknown";
  if (!trustForwardedFor) return remoteAddress;
  const forwarded = request.headers?.["x-forwarded-for"];
  const firstForwarded = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "";
  return isIP(firstForwarded) ? firstForwarded : remoteAddress;
}
