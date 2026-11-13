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

const PUBLIC_CHALLENGE_STATUSES = Object.freeze(["AWAITING_ACCEPTANCE", "ACTIVE", "FUNDS_CONFIRMED"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LIMIT = 100;
const MAX_OFFSET = 100_000;

export class ChallengeRepositoryError extends Error {
  constructor(message, { code = "CHALLENGE_REPOSITORY_ERROR", providerCode = undefined, status = 500, cause = undefined } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ChallengeRepositoryError";
    this.code = code;
    this.providerCode = providerCode;
    this.status = status;
  }
}

function requiredString(value, name, { maxLength = 2_048 } = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ChallengeRepositoryError(`${name} is required.`, { code: "CHALLENGE_INVALID_INPUT", status: 400 });
  }
  if (value.length > maxLength) {
    throw new ChallengeRepositoryError(`${name} is too long.`, { code: "CHALLENGE_INVALID_INPUT", status: 400 });
  }
  return value.trim();
}

function supabaseUrl(value) {
  const raw = requiredString(value, "Supabase URL").replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ChallengeRepositoryError("Supabase URL is invalid.", { code: "CHALLENGE_INVALID_CONFIG", status: 500 });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ChallengeRepositoryError("Supabase URL must use HTTP or HTTPS.", { code: "CHALLENGE_INVALID_CONFIG", status: 500 });
  }
  return parsed.href.replace(/\/+$/, "");
}

function challengeId(value) {
  const id = requiredString(value, "Challenge ID", { maxLength: 64 });
  if (!UUID_PATTERN.test(id)) {
    throw new ChallengeRepositoryError("Challenge ID is invalid.", { code: "CHALLENGE_INVALID_INPUT", status: 400 });
  }
  return id;
}

function pageNumber(value, name, fallback, maximum) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new ChallengeRepositoryError(`${name} is invalid.`, { code: "CHALLENGE_INVALID_INPUT", status: 400 });
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

function challengeRows(payload) {
  if (!Array.isArray(payload) || payload.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new ChallengeRepositoryError("Challenge persistence returned an invalid response.", { code: "PERSISTENCE_INVALID_RESPONSE", status: 502 });
  }
  return payload;
}

function publicChallengeQuery({ id, limit, offset } = {}) {
  const query = new URLSearchParams({
    select: CHALLENGE_FIELDS.join(","),
    visibility: "eq.PUBLIC",
    challenge_status: `in.(${PUBLIC_CHALLENGE_STATUSES.join(",")})`,
    order: "created_at.desc"
  });
  if (id) query.set("id", `eq.${id}`);
  if (limit !== undefined) query.set("limit", String(limit));
  if (offset !== undefined) query.set("offset", String(offset));
  return query;
}

export class SupabaseChallengeRepository {
  #baseUrl;
  #apiKey;
  #keyType;
  #fetchImpl;

  constructor({ url, secretKey, serviceRoleKey, fetchImpl = globalThis.fetch } = {}) {
    this.#baseUrl = supabaseUrl(url);
    const key = secretKey ?? serviceRoleKey;
    if (typeof key !== "string" || key.trim() === "") {
      throw new ChallengeRepositoryError("A Supabase server key is required.", { code: "CHALLENGE_INVALID_CONFIG", status: 500 });
    }
    if (typeof fetchImpl !== "function") {
      throw new ChallengeRepositoryError("A fetch implementation is required.", { code: "CHALLENGE_INVALID_CONFIG", status: 500 });
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
      table: "challenges",
      publicStatuses: PUBLIC_CHALLENGE_STATUSES,
      methods: Object.freeze(["listPublic", "getPublicById"]),
      writes: "blocked-until-transactional-procedure"
    });
  }

  async listPublic({ limit = 50, offset = 0 } = {}) {
    const boundedLimit = pageNumber(limit, "Limit", 50, MAX_LIMIT);
    const boundedOffset = pageNumber(offset, "Offset", 0, MAX_OFFSET);
    const rows = challengeRows(await this.#request(`/challenges?${publicChallengeQuery({ limit: boundedLimit, offset: boundedOffset })}`));
    return rows;
  }

  async getPublicById(rawId) {
    const id = challengeId(rawId);
    const rows = challengeRows(await this.#request(`/challenges?${publicChallengeQuery({ id, limit: 1 })}`));
    return rows[0] ?? null;
  }

  async #request(path) {
    const headers = {
      Accept: "application/json",
      apikey: this.#apiKey
    };
    if (this.#keyType === "legacy-service-role") headers.Authorization = `Bearer ${this.#apiKey}`;

    let response;
    try {
      response = await this.#fetchImpl(`${this.#baseUrl}/rest/v1${path}`, { method: "GET", headers });
    } catch (error) {
      throw new ChallengeRepositoryError("Challenge persistence service is unavailable.", { code: "PERSISTENCE_NETWORK_ERROR", status: 503, cause: error });
    }

    const payload = await responsePayload(response);
    if (!response.ok) {
      throw new ChallengeRepositoryError("Challenge persistence request was rejected.", {
        code: "PERSISTENCE_PROVIDER_REJECTED",
        providerCode: safeProviderCode(payload),
        status: response.status
      });
    }
    return payload;
  }
}

export class DisabledChallengeRepository {
  getCapabilities() {
    return Object.freeze({
      provider: "disabled",
      configured: false,
      table: "challenges",
      methods: Object.freeze(["listPublic", "getPublicById"]),
      writes: "blocked-until-transactional-procedure"
    });
  }

  #disabled() {
    throw new ChallengeRepositoryError("Challenge persistence is not configured.", { code: "PERSISTENCE_NOT_CONFIGURED", status: 503 });
  }

  listPublic() { return this.#disabled(); }
  getPublicById() { return this.#disabled(); }
}

export function createChallengeRepositoryFromEnv(env = process.env, fetchImpl = globalThis.fetch) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || (!secretKey && !serviceRoleKey)) return new DisabledChallengeRepository();
  try {
    return new SupabaseChallengeRepository({ url, secretKey, serviceRoleKey, fetchImpl });
  } catch {
    return new DisabledChallengeRepository();
  }
}
