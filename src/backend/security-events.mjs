import { randomUUID } from "node:crypto";

const MAX_EVENT_TYPE_LENGTH = 80;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_BUFFERED_EVENTS = 500;
const MAX_SNAPSHOT_SIZE = 100;
const SAFE_CODE_PATTERN = /^[A-Z0-9_.-]{1,100}$/;
const SAFE_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const SECURITY_SEVERITIES = Object.freeze(["CRITICAL", "HIGH", "MODERATE", "LOW"]);

function severityFor(type) {
  if (["SECRET_EXPOSURE", "LEDGER_IMBALANCE", "UNAUTHORIZED_PAYOUT", "REAL_MONEY_GATE_BYPASS"].includes(type)) return "CRITICAL";
  if (type === "CSRF_ORIGIN_REJECTED" || type.includes("AUTHORIZATION") || type.startsWith("ADMIN_")) return "HIGH";
  if (type === "RATE_LIMITED" || type.includes("AUTH") || type.includes("ORIGIN")) return "MODERATE";
  return "LOW";
}

function safeValue(value, maxLength) {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maxLength);
}

function safePath(value) {
  const raw = safeValue(value, 2_048);
  if (!raw) return undefined;
  try {
    return new URL(raw, "http://peerarena.invalid").pathname;
  } catch {
    return undefined;
  }
}

function safeEventType(value) {
  const type = safeValue(value, MAX_EVENT_TYPE_LENGTH)?.toUpperCase().replace(/[^A-Z0-9_.-]/g, "_");
  return type || "SECURITY_EVENT";
}

function safeStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}

export class SecurityEventLogger {
  #maxEvents;
  #events = [];
  #counts = new Map();
  #severityCounts = new Map();
  #now;
  #onEvent;
  #onAlert;

  constructor({ maxEvents = MAX_BUFFERED_EVENTS, now = () => Date.now(), onEvent = () => {}, onAlert = () => {} } = {}) {
    if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > MAX_BUFFERED_EVENTS) throw new Error("maxEvents must be between 1 and 500.");
    if (typeof now !== "function") throw new Error("now must be a function.");
    if (typeof onEvent !== "function") throw new Error("onEvent must be a function.");
    if (typeof onAlert !== "function") throw new Error("onAlert must be a function.");
    this.#maxEvents = maxEvents;
    this.#now = now;
    this.#onEvent = onEvent;
    this.#onAlert = onAlert;
  }

  record(type, { requestId, method, path, status, code } = {}) {
    const normalizedType = safeEventType(type);
    const severity = severityFor(normalizedType);
    const event = Object.freeze({
      id: randomUUID(),
      timestamp: new Date(this.#now()).toISOString(),
      type: normalizedType,
      severity,
      ...(safeValue(requestId, MAX_REQUEST_ID_LENGTH) ? { requestId: safeValue(requestId, MAX_REQUEST_ID_LENGTH) } : {}),
      ...(SAFE_METHODS.has(method) ? { method } : {}),
      ...(safePath(path) ? { path: safePath(path) } : {}),
      ...(safeStatus(status) !== undefined ? { status: safeStatus(status) } : {}),
      ...(typeof code === "string" && SAFE_CODE_PATTERN.test(code) ? { code } : {})
    });
    this.#events.unshift(event);
    this.#counts.set(event.type, (this.#counts.get(event.type) ?? 0) + 1);
    this.#severityCounts.set(event.severity, (this.#severityCounts.get(event.severity) ?? 0) + 1);
    while (this.#events.length > this.#maxEvents) {
      const removed = this.#events.pop();
      const remaining = (this.#counts.get(removed.type) ?? 1) - 1;
      if (remaining > 0) this.#counts.set(removed.type, remaining);
      else this.#counts.delete(removed.type);
      const remainingSeverity = (this.#severityCounts.get(removed.severity) ?? 1) - 1;
      if (remainingSeverity > 0) this.#severityCounts.set(removed.severity, remainingSeverity);
      else this.#severityCounts.delete(removed.severity);
    }
    try {
      this.#onEvent(event);
    } catch {
      // Security telemetry must never break the request path.
    }
    if (severity === "CRITICAL" || severity === "HIGH") {
      try {
        this.#onAlert(event);
      } catch {
        // Alert delivery must never break the request path.
      }
    }
    return event;
  }

  snapshot(limit = 50) {
    const boundedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 0), MAX_SNAPSHOT_SIZE) : 50;
    return Object.freeze(this.#events.slice(0, boundedLimit));
  }

  summary() {
    return Object.freeze({
      bufferedEvents: this.#events.length,
      capacity: this.#maxEvents,
      byType: Object.freeze(Object.fromEntries([...this.#counts.entries()].sort(([left], [right]) => left.localeCompare(right)))),
      bySeverity: Object.freeze(Object.fromEntries(SECURITY_SEVERITIES.filter((severity) => this.#severityCounts.has(severity)).map((severity) => [severity, this.#severityCounts.get(severity)])))
    });
  }

  clear() {
    this.#events = [];
    this.#counts.clear();
    this.#severityCounts.clear();
  }
}
