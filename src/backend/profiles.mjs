const PROFILE_FIELDS = Object.freeze([
  "id",
  "auth_user_id",
  "username",
  "full_name",
  "email",
  "phone",
  "country",
  "preferred_language",
  "avatar_url",
  "account_status",
  "created_at",
  "updated_at"
]);

const PROFILE_PATCH_FIELDS = Object.freeze(["username", "full_name", "country", "preferred_language", "avatar_url"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ProfileRepositoryError extends Error {
  constructor(message, { code = "PROFILE_REPOSITORY_ERROR", providerCode = undefined, status = 500, cause = undefined } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProfileRepositoryError";
    this.code = code;
    this.providerCode = providerCode;
    this.status = status;
  }
}

function requiredString(value, name, { maxLength = 1024 } = {}) {
  if (typeof value !== "string" || value.trim() === "") throw new ProfileRepositoryError(`${name} is required.`, { code: "PROFILE_INVALID_INPUT", status: 400 });
  if (value.length > maxLength) throw new ProfileRepositoryError(`${name} is too long.`, { code: "PROFILE_INVALID_INPUT", status: 400 });
  return value;
}

function supabaseUrl(value) {
  const raw = requiredString(value, "Supabase URL", { maxLength: 2_048 }).replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ProfileRepositoryError("Supabase URL is invalid.", { code: "PROFILE_INVALID_CONFIG", status: 500 });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new ProfileRepositoryError("Supabase URL must use HTTP or HTTPS.", { code: "PROFILE_INVALID_CONFIG", status: 500 });
  return parsed.href.replace(/\/+$/, "");
}

function authUserId(value) {
  const id = requiredString(value, "Auth user ID", { maxLength: 64 }).trim();
  if (!UUID_PATTERN.test(id)) throw new ProfileRepositoryError("Auth user ID is invalid.", { code: "PROFILE_INVALID_INPUT", status: 400 });
  return id;
}

function optionalText(value, name, maxLength) {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return requiredString(value, name, { maxLength }).trim();
}

function profileUrl(value) {
  if (value === null || value === undefined) return value;
  const raw = requiredString(value, "Avatar URL", { maxLength: 2_048 });
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ProfileRepositoryError("Avatar URL is invalid.", { code: "PROFILE_INVALID_INPUT", status: 400 });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new ProfileRepositoryError("Avatar URL must use HTTP or HTTPS.", { code: "PROFILE_INVALID_INPUT", status: 400 });
  return parsed.href;
}

export function sanitizeProfilePatch(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ProfileRepositoryError("Profile update must be an object.", { code: "PROFILE_INVALID_INPUT", status: 400 });
  const unknown = Object.keys(input).filter((key) => !PROFILE_PATCH_FIELDS.includes(key));
  if (unknown.length > 0) throw new ProfileRepositoryError("Profile contains a field that cannot be changed here.", { code: "PROFILE_FIELD_NOT_ALLOWED", status: 400 });
  if (Object.keys(input).length === 0) throw new ProfileRepositoryError("Profile update is empty.", { code: "PROFILE_INVALID_INPUT", status: 400 });

  const patch = {};
  if (Object.hasOwn(input, "username")) {
    const username = requiredString(input.username, "Username", { maxLength: 64 }).trim();
    if (!/^[\p{L}\p{N}_.-]{3,64}$/u.test(username)) throw new ProfileRepositoryError("Username must be 3-64 letters, numbers, dots, dashes or underscores.", { code: "PROFILE_INVALID_INPUT", status: 400 });
    patch.username = username;
  }
  if (Object.hasOwn(input, "full_name")) patch.full_name = optionalText(input.full_name, "Full name", 120);
  if (Object.hasOwn(input, "country")) {
    const country = optionalText(input.country, "Country", 2);
    if (country !== null && country.length !== 2) throw new ProfileRepositoryError("Country must be an ISO two-letter code.", { code: "PROFILE_INVALID_INPUT", status: 400 });
    patch.country = country?.toUpperCase() ?? null;
  }
  if (Object.hasOwn(input, "preferred_language")) patch.preferred_language = requiredString(input.preferred_language, "Preferred language", { maxLength: 12 }).trim().toLowerCase();
  if (Object.hasOwn(input, "avatar_url")) patch.avatar_url = profileUrl(input.avatar_url);
  return Object.freeze(patch);
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

export class SupabaseProfileRepository {
  #baseUrl;
  #apiKey;
  #keyType;
  #fetchImpl;
  #timeoutMs;

  constructor({ url, secretKey, serviceRoleKey, fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
    this.#baseUrl = supabaseUrl(url);
    const key = secretKey ?? serviceRoleKey;
    if (typeof key !== "string" || key.trim() === "") throw new ProfileRepositoryError("A Supabase server key is required.", { code: "PROFILE_INVALID_CONFIG", status: 500 });
    if (typeof fetchImpl !== "function") throw new ProfileRepositoryError("A fetch implementation is required.", { code: "PROFILE_INVALID_CONFIG", status: 500 });
    this.#apiKey = key.trim();
    this.#keyType = secretKey ? "secret" : "legacy-service-role";
    this.#fetchImpl = fetchImpl;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
      throw new ProfileRepositoryError("Request timeout must be between 1 and 30000 milliseconds.", { code: "PROFILE_INVALID_CONFIG", status: 500 });
    }
    this.#timeoutMs = timeoutMs;
  }

  getCapabilities() {
    return Object.freeze({
      provider: "supabase-rest",
      configured: true,
      keyType: this.#keyType,
      table: "profiles",
      methods: Object.freeze(["getByAuthUserId", "updateByAuthUserId"])
    });
  }

  async getByAuthUserId(rawAuthUserId) {
    const authUserIdValue = authUserId(rawAuthUserId);
    const query = new URLSearchParams({
      select: PROFILE_FIELDS.join(","),
      auth_user_id: `eq.${authUserIdValue}`,
      limit: "1"
    });
    const rows = await this.#request(`/profiles?${query}`);
    if (!Array.isArray(rows)) throw new ProfileRepositoryError("Profile persistence returned an invalid response.", { code: "PERSISTENCE_INVALID_RESPONSE", status: 502 });
    return rows[0] ?? null;
  }

  async updateByAuthUserId(rawAuthUserId, input) {
    const authUserIdValue = authUserId(rawAuthUserId);
    const patch = sanitizeProfilePatch(input);
    const query = new URLSearchParams({
      auth_user_id: `eq.${authUserIdValue}`,
      select: PROFILE_FIELDS.join(","),
      limit: "1"
    });
    const rows = await this.#request(`/profiles?${query}`, {
      method: "PATCH",
      body: patch,
      extraHeaders: { Prefer: "return=representation" }
    });
    if (!Array.isArray(rows)) throw new ProfileRepositoryError("Profile persistence returned an invalid response.", { code: "PERSISTENCE_INVALID_RESPONSE", status: 502 });
    return rows[0] ?? null;
  }

  async #request(path, { method = "GET", body, extraHeaders = {} } = {}) {
    const headers = {
      Accept: "application/json",
      apikey: this.#apiKey,
      ...extraHeaders
    };
    if (this.#keyType === "legacy-service-role") headers.Authorization = `Bearer ${this.#apiKey}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response;
    let payload;
    try {
      response = await this.#fetchImpl(`${this.#baseUrl}/rest/v1${path}`, {
        method,
        headers,
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      payload = await responsePayload(response);
    } catch (error) {
      throw new ProfileRepositoryError("Profile persistence service is unavailable.", { code: "PERSISTENCE_NETWORK_ERROR", status: 503, cause: error });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new ProfileRepositoryError("Profile persistence request was rejected.", {
        code: "PERSISTENCE_PROVIDER_REJECTED",
        providerCode: safeProviderCode(payload),
        status: response.status
      });
    }
    return payload;
  }
}

export class DisabledProfileRepository {
  getCapabilities() {
    return Object.freeze({ provider: "disabled", configured: false, table: "profiles", methods: Object.freeze(["getByAuthUserId", "updateByAuthUserId"]) });
  }

  #disabled() {
    throw new ProfileRepositoryError("Profile persistence is not configured.", { code: "PERSISTENCE_NOT_CONFIGURED", status: 503 });
  }

  getByAuthUserId() { return this.#disabled(); }
  updateByAuthUserId() { return this.#disabled(); }
}

export function createProfileRepositoryFromEnv(env = process.env, fetchImpl = globalThis.fetch) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || (!secretKey && !serviceRoleKey)) return new DisabledProfileRepository();
  try {
    return new SupabaseProfileRepository({ url, secretKey, serviceRoleKey, fetchImpl });
  } catch {
    return new DisabledProfileRepository();
  }
}
