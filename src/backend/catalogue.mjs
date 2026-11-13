const SPORT_FIELDS = Object.freeze(["id", "slug", "name", "enabled"]);
const EVENT_FIELDS = Object.freeze([
  "id",
  "sport_id",
  "competition_id",
  "home_participant",
  "away_participant",
  "scheduled_start",
  "event_status",
  "current_score",
  "last_provider_update",
  "sports!inner(name,slug,enabled)",
  "competitions(name,country_code)"
]);
const MARKET_FIELDS = Object.freeze([
  "id",
  "event_id",
  "market_type",
  "market_description",
  "possible_outcomes",
  "settlement_rules",
  "rules_version",
  "market_status",
  "closing_time"
]);
const PUBLIC_EVENT_STATUSES = Object.freeze(["SCHEDULED", "LIVE", "POSTPONED", "SUSPENDED"]);
const PUBLIC_MARKET_STATUSES = Object.freeze(["OPEN", "SUSPENDED", "CLOSED"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CatalogueRepositoryError extends Error {
  constructor(message, { code = "CATALOGUE_REPOSITORY_ERROR", providerCode = undefined, status = 500, cause = undefined } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CatalogueRepositoryError";
    this.code = code;
    this.providerCode = providerCode;
    this.status = status;
  }
}

function requiredString(value, name, { maxLength = 2_048 } = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CatalogueRepositoryError(`${name} is required.`, { code: "CATALOGUE_INVALID_INPUT", status: 400 });
  }
  if (value.length > maxLength) {
    throw new CatalogueRepositoryError(`${name} is too long.`, { code: "CATALOGUE_INVALID_INPUT", status: 400 });
  }
  return value.trim();
}

function supabaseUrl(value) {
  const raw = requiredString(value, "Supabase URL").replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CatalogueRepositoryError("Supabase URL is invalid.", { code: "CATALOGUE_INVALID_CONFIG", status: 500 });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new CatalogueRepositoryError("Supabase URL must use HTTP or HTTPS.", { code: "CATALOGUE_INVALID_CONFIG", status: 500 });
  }
  return parsed.href.replace(/\/+$/, "");
}

function uuid(value, name) {
  const id = requiredString(value, name, { maxLength: 64 });
  if (!UUID_PATTERN.test(id)) {
    throw new CatalogueRepositoryError(`${name} is invalid.`, { code: "CATALOGUE_INVALID_INPUT", status: 400 });
  }
  return id;
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
    throw new CatalogueRepositoryError(`${resource} persistence returned an invalid response.`, { code: "PERSISTENCE_INVALID_RESPONSE", status: 502 });
  }
  return payload;
}

function relatedObject(value) {
  if (Array.isArray(value)) return value[0] ?? {};
  return value && typeof value === "object" ? value : {};
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function normalizeSportRow(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    sport: row.name,
    enabled: row.enabled === true
  };
}

export function normalizeEventRow(row) {
  const sport = relatedObject(row.sports);
  const competition = relatedObject(row.competitions);
  const currentScore = safeObject(row.current_score);
  return {
    id: row.id,
    sportId: row.sport_id,
    sport: sport.name ?? row.sport_id,
    competitionId: row.competition_id,
    league: competition.name ?? row.competition_id ?? "Unassigned competition",
    home: row.home_participant,
    away: row.away_participant,
    venue: null,
    kickoffAt: row.scheduled_start,
    status: row.event_status,
    currentScore,
    lastProviderUpdate: row.last_provider_update ?? null,
    dataSource: "Supabase sports catalogue",
    dataConfidence: "PERSISTED",
    ...(row.event_status === "LIVE" ? { live: currentScore } : {})
  };
}

export function normalizeMarketRow(row) {
  return {
    id: row.id,
    eventId: row.event_id,
    market: row.market_type,
    description: row.market_description,
    outcomes: Array.isArray(row.possible_outcomes) ? row.possible_outcomes : [],
    settlementRules: safeObject(row.settlement_rules),
    rulesVersion: row.rules_version,
    status: row.market_status,
    closingAt: row.closing_time
  };
}

function publicEventQuery({ id, status } = {}) {
  const query = new URLSearchParams({
    select: EVENT_FIELDS.join(","),
    "sports.enabled": "eq.true",
    order: "scheduled_start.asc"
  });
  if (id) query.set("id", `eq.${id}`);
  if (status === "LIVE") query.set("event_status", "eq.LIVE");
  else query.set("event_status", `in.(${PUBLIC_EVENT_STATUSES.join(",")})`);
  if (id) query.set("limit", "1");
  return query;
}

function publicMarketQuery(eventId) {
  return new URLSearchParams({
    select: MARKET_FIELDS.join(","),
    event_id: `eq.${eventId}`,
    market_status: `in.(${PUBLIC_MARKET_STATUSES.join(",")})`,
    order: "closing_time.asc"
  });
}

export class SupabaseCatalogueRepository {
  #baseUrl;
  #apiKey;
  #keyType;
  #fetchImpl;

  constructor({ url, publishableKey, anonKey, fetchImpl = globalThis.fetch } = {}) {
    this.#baseUrl = supabaseUrl(url);
    const key = publishableKey ?? anonKey;
    if (typeof key !== "string" || key.trim() === "") {
      throw new CatalogueRepositoryError("A Supabase public key is required.", { code: "CATALOGUE_INVALID_CONFIG", status: 500 });
    }
    if (typeof fetchImpl !== "function") {
      throw new CatalogueRepositoryError("A fetch implementation is required.", { code: "CATALOGUE_INVALID_CONFIG", status: 500 });
    }
    this.#apiKey = key.trim();
    this.#keyType = publishableKey ? "publishable" : "legacy-anon";
    this.#fetchImpl = fetchImpl;
  }

  getCapabilities() {
    return Object.freeze({
      provider: "supabase-rest",
      configured: true,
      keyType: this.#keyType,
      tables: Object.freeze(["sports", "sporting_events", "prediction_markets"]),
      methods: Object.freeze(["listSports", "listEvents", "listLiveEvents", "getEventById", "listMarketsForEvent"]),
      writes: "disabled"
    });
  }

  async listSports() {
    const query = new URLSearchParams({ select: SPORT_FIELDS.join(","), enabled: "eq.true", order: "name.asc" });
    return rows(await this.#request(`/sports?${query}`), "Sports").map(normalizeSportRow);
  }

  async listEvents() {
    return rows(await this.#request(`/sporting_events?${publicEventQuery()}`), "Event").map(normalizeEventRow);
  }

  async listLiveEvents() {
    return rows(await this.#request(`/sporting_events?${publicEventQuery({ status: "LIVE" })}`), "Live event").map(normalizeEventRow);
  }

  async getEventById(rawId) {
    const id = uuid(rawId, "Event ID");
    const eventRows = rows(await this.#request(`/sporting_events?${publicEventQuery({ id })}`), "Event").map(normalizeEventRow);
    return eventRows[0] ?? null;
  }

  async listMarketsForEvent(rawEventId) {
    const eventId = uuid(rawEventId, "Event ID");
    return rows(await this.#request(`/prediction_markets?${publicMarketQuery(eventId)}`), "Market").map(normalizeMarketRow);
  }

  async #request(path) {
    let response;
    try {
      response = await this.#fetchImpl(`${this.#baseUrl}/rest/v1${path}`, {
        method: "GET",
        headers: { Accept: "application/json", apikey: this.#apiKey }
      });
    } catch (error) {
      throw new CatalogueRepositoryError("Catalogue persistence service is unavailable.", { code: "PERSISTENCE_NETWORK_ERROR", status: 503, cause: error });
    }

    const payload = await responsePayload(response);
    if (!response.ok) {
      throw new CatalogueRepositoryError("Catalogue persistence request was rejected.", {
        code: "PERSISTENCE_PROVIDER_REJECTED",
        providerCode: safeProviderCode(payload),
        status: response.status
      });
    }
    return payload;
  }
}

export class DisabledCatalogueRepository {
  getCapabilities() {
    return Object.freeze({
      provider: "disabled",
      configured: false,
      tables: Object.freeze(["sports", "sporting_events", "prediction_markets"]),
      methods: Object.freeze(["listSports", "listEvents", "listLiveEvents", "getEventById", "listMarketsForEvent"]),
      writes: "disabled"
    });
  }

  #disabled() {
    throw new CatalogueRepositoryError("Catalogue persistence is not configured.", { code: "PERSISTENCE_NOT_CONFIGURED", status: 503 });
  }

  listSports() { return this.#disabled(); }
  listEvents() { return this.#disabled(); }
  listLiveEvents() { return this.#disabled(); }
  getEventById() { return this.#disabled(); }
  listMarketsForEvent() { return this.#disabled(); }
}

export function createCatalogueRepositoryFromEnv(env = process.env, fetchImpl = globalThis.fetch) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || (!publishableKey && !anonKey)) return new DisabledCatalogueRepository();
  try {
    return new SupabaseCatalogueRepository({ url, publishableKey, anonKey, fetchImpl });
  } catch {
    return new DisabledCatalogueRepository();
  }
}
