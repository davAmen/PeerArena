const USER_FIELDS = Object.freeze([
  "id",
  "username",
  "full_name",
  "country",
  "preferred_language",
  "account_status",
  "created_at",
  "updated_at"
]);
const CHALLENGE_FIELDS = Object.freeze([
  "id",
  "creator_id",
  "market_id",
  "challenge_type",
  "participation_limit",
  "stake_amount_minor",
  "currency",
  "access_fee_minor",
  "commission_rate_bps",
  "visibility",
  "challenge_status",
  "closing_time",
  "rules_version",
  "created_at",
  "updated_at"
]);
const TRANSACTION_FIELDS = Object.freeze([
  "id",
  "transaction_type",
  "transaction_status",
  "reference",
  "currency",
  "challenge_id",
  "provider_reference",
  "created_at"
]);
const SETTLEMENT_FIELDS = Object.freeze([
  "id",
  "challenge_id",
  "verified_result",
  "rules_version",
  "result_source",
  "settlement_status",
  "gross_pool_minor",
  "commission_minor",
  "approved_by",
  "approved_at",
  "created_at"
]);
const VERIFIED_ACCOUNT_STATUSES = Object.freeze(["EMAIL_VERIFIED", "PHONE_VERIFIED", "IDENTITY_REVIEW", "IDENTITY_VERIFIED", "ELIGIBLE_FOR_PLAY"]);
const ACTIVE_CHALLENGE_STATUSES = Object.freeze(["CREATED", "AWAITING_ACCEPTANCE", "MATCHED", "FUNDS_CONFIRMED", "ACTIVE", "SUSPENDED", "AWAITING_VERIFICATION"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LIMIT = 100;
const MAX_OFFSET = 100_000;

export class AdminRepositoryError extends Error {
  constructor(message, { code = "ADMIN_REPOSITORY_ERROR", providerCode = undefined, status = 500, cause = undefined } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AdminRepositoryError";
    this.code = code;
    this.providerCode = providerCode;
    this.status = status;
  }
}

function requiredString(value, name, { maxLength = 2_048 } = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AdminRepositoryError(`${name} is required.`, { code: "ADMIN_INVALID_INPUT", status: 400 });
  }
  if (value.length > maxLength) {
    throw new AdminRepositoryError(`${name} is too long.`, { code: "ADMIN_INVALID_INPUT", status: 400 });
  }
  return value.trim();
}

function supabaseUrl(value) {
  const raw = requiredString(value, "Supabase URL").replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AdminRepositoryError("Supabase URL is invalid.", { code: "ADMIN_INVALID_CONFIG", status: 500 });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new AdminRepositoryError("Supabase URL must use HTTP or HTTPS.", { code: "ADMIN_INVALID_CONFIG", status: 500 });
  }
  return parsed.href.replace(/\/+$/, "");
}

function pageNumber(value, name, fallback, maximum) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new AdminRepositoryError(`${name} is invalid.`, { code: "ADMIN_INVALID_INPUT", status: 400 });
  }
  return parsed;
}

function safeProviderCode(payload) {
  const candidate = payload && typeof payload === "object" ? payload.code ?? payload.message : undefined;
  if (typeof candidate !== "string" || candidate.trim() === "") return undefined;
  return candidate.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "_").slice(0, 100);
}

async function responsePayload(response) {
  const raw = await response.text();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function rows(payload, resource) {
  if (!Array.isArray(payload) || payload.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new AdminRepositoryError(`${resource} persistence returned an invalid response.`, { code: "PERSISTENCE_INVALID_RESPONSE", status: 502 });
  }
  return payload;
}

function countFromHeaders(headers) {
  const contentRange = typeof headers?.get === "function" ? headers.get("content-range") : undefined;
  const match = /\/(\d+)$/.exec(contentRange ?? "");
  if (!match) throw new AdminRepositoryError("Admin persistence returned no exact count.", { code: "PERSISTENCE_INVALID_RESPONSE", status: 502 });
  return Number(match[1]);
}

function queryFor({ select, filters = {}, order = "created_at.desc", limit, offset } = {}) {
  const query = new URLSearchParams({ select, ...filters });
  if (order) query.set("order", order);
  if (limit !== undefined) query.set("limit", String(limit));
  if (offset !== undefined) query.set("offset", String(offset));
  return query;
}

export class SupabaseAdminRepository {
  #baseUrl;
  #apiKey;
  #keyType;
  #fetchImpl;

  constructor({ url, secretKey, serviceRoleKey, fetchImpl = globalThis.fetch } = {}) {
    this.#baseUrl = supabaseUrl(url);
    const key = secretKey ?? serviceRoleKey;
    if (typeof key !== "string" || key.trim() === "") {
      throw new AdminRepositoryError("A Supabase server key is required.", { code: "ADMIN_INVALID_CONFIG", status: 500 });
    }
    if (typeof fetchImpl !== "function") {
      throw new AdminRepositoryError("A fetch implementation is required.", { code: "ADMIN_INVALID_CONFIG", status: 500 });
    }
    this.#apiKey = key.trim();
    this.#keyType = secretKey ? "secret" : "legacy-service-role";
    this.#fetchImpl = fetchImpl;
  }

  getCapabilities() {
    return Object.freeze({
      provider: "supabase-rest",
      configured: true,
      keyType: this.#keyType,
      tables: Object.freeze(["profiles", "challenges", "financial_transactions", "settlement_records", "disputes"]),
      methods: Object.freeze(["getOverview", "listUsers", "listChallenges", "listTransactions", "listSettlements", "getSecurity"]),
      writes: "disabled"
    });
  }

  async getOverview() {
    const [totalUsers, verifiedUsers, totalChallenges, activeChallenges, postedTransactions, reconciliationRequiredTransactions, openDisputes] = await Promise.all([
      this.#count("profiles"),
      this.#count("profiles", { account_status: `in.(${VERIFIED_ACCOUNT_STATUSES.join(",")})` }),
      this.#count("challenges"),
      this.#count("challenges", { challenge_status: `in.(${ACTIVE_CHALLENGE_STATUSES.join(",")})` }),
      this.#count("financial_transactions", { transaction_status: "eq.POSTED" }),
      this.#count("financial_transactions", { transaction_status: "eq.RECONCILIATION_REQUIRED" }),
      this.#count("disputes", { status: "in.(OPEN,UNDER_REVIEW)" })
    ]);
    return Object.freeze({
      totalUsers,
      verifiedUsers,
      totalChallenges,
      activeChallenges,
      postedTransactions,
      reconciliationRequiredTransactions,
      openDisputes,
      syntheticVolume: null,
      platformFees: null,
      realMoneyGate: "BLOCKED",
      productionAuth: "SUPABASE",
      persistence: "SUPABASE"
    });
  }

  async listUsers({ limit = 50, offset = 0 } = {}) {
    return this.#pagedList("profiles", USER_FIELDS, { limit, offset });
  }

  async listChallenges({ limit = 50, offset = 0 } = {}) {
    return this.#pagedList("challenges", CHALLENGE_FIELDS, { limit, offset });
  }

  async listTransactions({ limit = 50, offset = 0 } = {}) {
    return this.#pagedList("financial_transactions", TRANSACTION_FIELDS, { limit, offset });
  }

  async listSettlements({ limit = 50, offset = 0 } = {}) {
    return this.#pagedList("settlement_records", SETTLEMENT_FIELDS, { limit, offset });
  }

  async getSecurity() {
    const [openDisputes, reconciliationRequiredTransactions, failedTransactions] = await Promise.all([
      this.#count("disputes", { status: "in.(OPEN,UNDER_REVIEW)" }),
      this.#count("financial_transactions", { transaction_status: "eq.RECONCILIATION_REQUIRED" }),
      this.#count("financial_transactions", { transaction_status: "eq.FAILED" })
    ]);
    return Object.freeze({
      realMoneyGate: "BLOCKED",
      authentication: "SUPABASE_BEARER_ADMIN",
      suspiciousActivity: [],
      providerAnomalies: [],
      openDisputes,
      reconciliationRequiredTransactions,
      failedTransactions,
      productionAuth: "SUPABASE",
      persistence: "SUPABASE"
    });
  }

  async #pagedList(table, fields, { limit = 50, offset = 0 } = {}) {
    const boundedLimit = pageNumber(limit, "Limit", 50, MAX_LIMIT);
    const boundedOffset = pageNumber(offset, "Offset", 0, MAX_OFFSET);
    const query = queryFor({ select: fields.join(","), limit: boundedLimit, offset: boundedOffset });
    const [result, total] = await Promise.all([
      this.#request(`/${table}?${query}`),
      this.#count(table)
    ]);
    return Object.freeze({ [table === "profiles" ? "users" : table === "challenges" ? "challenges" : table === "financial_transactions" ? "transactions" : "settlements"]: rows(result.payload, table), total });
  }

  async #count(table, filters = {}) {
    const query = queryFor({ select: "id", filters, order: undefined, limit: 0 });
    const result = await this.#request(`/${table}?${query}`, { method: "HEAD", extraHeaders: { Prefer: "count=exact" } });
    return countFromHeaders(result.headers);
  }

  async #request(path, { method = "GET", extraHeaders = {} } = {}) {
    const headers = {
      Accept: "application/json",
      apikey: this.#apiKey,
      ...extraHeaders
    };
    if (this.#keyType === "legacy-service-role") headers.Authorization = `Bearer ${this.#apiKey}`;

    let response;
    try {
      response = await this.#fetchImpl(`${this.#baseUrl}/rest/v1${path}`, { method, headers });
    } catch (error) {
      throw new AdminRepositoryError("Admin persistence service is unavailable.", { code: "PERSISTENCE_NETWORK_ERROR", status: 503, cause: error });
    }

    const payload = await responsePayload(response);
    if (!response.ok) {
      throw new AdminRepositoryError("Admin persistence request was rejected.", {
        code: "PERSISTENCE_PROVIDER_REJECTED",
        providerCode: safeProviderCode(payload),
        status: response.status
      });
    }
    return { payload, headers: response.headers };
  }
}

export class DisabledAdminRepository {
  getCapabilities() {
    return Object.freeze({
      provider: "disabled",
      configured: false,
      tables: Object.freeze(["profiles", "challenges", "financial_transactions", "settlement_records", "disputes"]),
      methods: Object.freeze(["getOverview", "listUsers", "listChallenges", "listTransactions", "listSettlements", "getSecurity"]),
      writes: "disabled"
    });
  }

  #disabled() {
    throw new AdminRepositoryError("Admin persistence is not configured.", { code: "PERSISTENCE_NOT_CONFIGURED", status: 503 });
  }

  getOverview() { return this.#disabled(); }
  listUsers() { return this.#disabled(); }
  listChallenges() { return this.#disabled(); }
  listTransactions() { return this.#disabled(); }
  listSettlements() { return this.#disabled(); }
  getSecurity() { return this.#disabled(); }
}

export function createAdminRepositoryFromEnv(env = process.env, fetchImpl = globalThis.fetch) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || (!secretKey && !serviceRoleKey)) return new DisabledAdminRepository();
  try {
    return new SupabaseAdminRepository({ url, secretKey, serviceRoleKey, fetchImpl });
  } catch {
    return new DisabledAdminRepository();
  }
}
