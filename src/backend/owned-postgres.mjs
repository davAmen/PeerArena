import pg from "pg";
import { ownedDatabaseGate, readDatabaseConfig } from "./database.mjs";

const { Pool } = pg;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export class OwnedPostgresError extends Error {
  constructor(message, { code = "OWNED_POSTGRES_ERROR", status = 500, cause = undefined } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "OwnedPostgresError";
    this.code = code;
    this.status = status;
  }
}

function requiredString(value, name, { maxLength = 2_048 } = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new OwnedPostgresError(`${name} is required.`, { code: "DATABASE_INVALID_INPUT", status: 400 });
  }
  if (value.length > maxLength) {
    throw new OwnedPostgresError(`${name} is too long.`, { code: "DATABASE_INVALID_INPUT", status: 400 });
  }
  return value.trim();
}

function uuid(value, name) {
  const normalized = requiredString(value, name, { maxLength: 64 });
  if (!UUID_PATTERN.test(normalized)) {
    throw new OwnedPostgresError(`${name} is invalid.`, { code: "DATABASE_INVALID_INPUT", status: 400 });
  }
  return normalized;
}

function idempotencyKey(value) {
  const normalized = requiredString(value, "Idempotency key", { maxLength: MAX_IDEMPOTENCY_KEY_LENGTH });
  if (normalized.length < 8) {
    throw new OwnedPostgresError("Idempotency key is too short.", { code: "DATABASE_INVALID_INPUT", status: 400 });
  }
  return normalized;
}

function requestId(value) {
  if (value === undefined || value === null || value === "") return "";
  return requiredString(value, "Request ID", { maxLength: MAX_REQUEST_ID_LENGTH });
}

function minorUnits(value, name) {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new OwnedPostgresError(`${name} must be a positive integer in minor units.`, { code: "DATABASE_INVALID_INPUT", status: 400 });
  }
  return normalized;
}

function safeDate(value, name) {
  const normalized = requiredString(value, name, { maxLength: 80 });
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new OwnedPostgresError(`${name} is invalid.`, { code: "DATABASE_INVALID_INPUT", status: 400 });
  }
  return parsed.toISOString();
}

function mapDatabaseFailure(error) {
  if (error instanceof OwnedPostgresError) return error;
  if (error?.code === "40001" || error?.code === "40P01") {
    return new OwnedPostgresError("The database command conflicted and can be retried safely.", { code: "DATABASE_RETRYABLE_CONFLICT", status: 409, cause: error });
  }
  if (error?.code === "57014" || error?.code === "55P03") {
    return new OwnedPostgresError("The database command timed out or could not obtain its lock.", { code: "DATABASE_BUSY", status: 503, cause: error });
  }
  return new OwnedPostgresError("The database command could not be completed.", { code: "DATABASE_COMMAND_FAILED", status: 503, cause: error });
}

class DisabledOwnedPostgresClient {
  constructor(reason = "Owned PostgreSQL is not configured.") {
    this.reason = reason;
  }

  getCapabilities() {
    return Object.freeze({ provider: "owned-postgres", configured: false, writes: "blocked", reason: this.reason });
  }

  #disabled() {
    throw new OwnedPostgresError(this.reason, { code: "PERSISTENCE_NOT_CONFIGURED", status: 503 });
  }

  async health() { return this.#disabled(); }
  async createChallenge() { return this.#disabled(); }
  async acceptChallenge() { return this.#disabled(); }
  async verifyAndSettleSyntheticChallenge() { return this.#disabled(); }
  close() { return Promise.resolve(); }
}

export class OwnedPostgresProcedureClient {
  constructor({ pool, config, poolFactory = Pool } = {}) {
    if (!pool || typeof pool.connect !== "function") {
      throw new OwnedPostgresError("A PostgreSQL pool is required.", { code: "DATABASE_INVALID_CONFIG", status: 500 });
    }
    this.pool = pool;
    this.config = config ?? Object.freeze({ provider: "owned-postgres", configured: true, sslMode: "verify-full" });
    this.poolFactory = poolFactory;
  }

  getCapabilities() {
    return Object.freeze({
      provider: "owned-postgres",
      configured: true,
      tls: this.config.sslMode,
      procedures: Object.freeze(["create_challenge", "accept_challenge", "verify_and_settle_synthetic_challenge"]),
      directTableWrites: false,
      writes: "reviewed-procedures-only"
    });
  }

  async health() {
    try {
      const client = await this.pool.connect();
      try {
        const result = await client.query("select 1 as ok");
        return Object.freeze({ ok: result.rows?.[0]?.ok === 1, provider: "owned-postgres" });
      } finally {
        client.release();
      }
    } catch (error) {
      throw mapDatabaseFailure(error);
    }
  }

  async #transaction({ actorUserId, workerUserId, requestId: rawRequestId }, operation) {
    const actor = uuid(actorUserId, "Actor user ID");
    const request = requestId(rawRequestId);
    const worker = workerUserId === undefined ? undefined : uuid(workerUserId, "Worker user ID");
    let client;
    try {
      client = await this.pool.connect();
      await client.query("begin");
      await client.query("set local statement_timeout = '15s'");
      await client.query("set local lock_timeout = '5s'");
      await client.query("select set_config('peerarena.actor_user_id', $1, true)", [actor]);
      await client.query("select set_config('peerarena.request_id', $1, true)", [request]);
      if (worker) await client.query("select set_config('peerarena.worker_user_id', $1, true)", [worker]);
      const result = await operation(client, { actor, request, worker });
      await client.query("commit");
      return result;
    } catch (error) {
      if (client) await client.query("rollback").catch(() => undefined);
      throw mapDatabaseFailure(error);
    } finally {
      client?.release();
    }
  }

  async createChallenge({ actorUserId, requestId: rawRequestId, marketId, visibility, creatorSide, stakeMinor, currency, rulesVersion, expiresAt, idempotencyKey: rawIdempotencyKey } = {}) {
    return this.#transaction({ actorUserId, requestId: rawRequestId }, async (client) => {
      const result = await client.query(
        `select challenge_id, challenge_status, replayed
         from peerarena_api.create_challenge($1::uuid, $2::text, $3::text, $4::bigint, $5::char(3), $6::text, $7::timestamptz, $8::text)`,
        [uuid(marketId, "Market ID"), requiredString(visibility, "Visibility", { maxLength: 16 }), requiredString(creatorSide, "Creator prediction", { maxLength: 80 }), minorUnits(stakeMinor, "Stake"), requiredString(currency, "Currency", { maxLength: 3 }).toUpperCase(), requiredString(rulesVersion, "Rules version", { maxLength: 80 }), safeDate(expiresAt, "Expiry"), idempotencyKey(rawIdempotencyKey)]
      );
      return result.rows[0] ?? null;
    });
  }

  async acceptChallenge({ actorUserId, requestId: rawRequestId, challengeId, side, idempotencyKey: rawIdempotencyKey } = {}) {
    return this.#transaction({ actorUserId, requestId: rawRequestId }, async (client) => {
      const result = await client.query(
        `select challenge_id, challenge_status, ledger_transaction_id, replayed
         from peerarena_api.accept_challenge($1::uuid, $2::text, $3::text)`,
        [uuid(challengeId, "Challenge ID"), requiredString(side, "Prediction side", { maxLength: 80 }), idempotencyKey(rawIdempotencyKey)]
      );
      return result.rows[0] ?? null;
    });
  }

  async verifyAndSettleSyntheticChallenge({ workerUserId, requestId: rawRequestId, challengeId, verifiedOutcome, resultSource = "SYNTHETIC_REVIEWED", providerEventId, resultPayloadHash, rulesVersion, idempotencyKey: rawIdempotencyKey } = {}) {
    return this.#transaction({ actorUserId: workerUserId, workerUserId, requestId: rawRequestId }, async (client) => {
      const result = await client.query(
        `select challenge_id, challenge_status, settlement_id, ledger_transaction_id, settlement_status, replayed
         from peerarena_api.verify_and_settle_synthetic_challenge($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text)`,
        [uuid(challengeId, "Challenge ID"), requiredString(verifiedOutcome, "Verified outcome", { maxLength: 80 }), requiredString(resultSource, "Result source", { maxLength: 40 }), requiredString(providerEventId, "Provider event ID", { maxLength: 200 }), requiredString(resultPayloadHash, "Result payload hash", { maxLength: 64 }), requiredString(rulesVersion, "Rules version", { maxLength: 80 }), idempotencyKey(rawIdempotencyKey)]
      );
      return result.rows[0] ?? null;
    });
  }

  async close() {
    if (typeof this.pool.end === "function") await this.pool.end();
  }
}

function poolOptions(env, config) {
  const ssl = config.sslMode === "verify-full"
    ? { rejectUnauthorized: true, ca: env.DATABASE_CA_CERT }
    : { rejectUnauthorized: false };
  return {
    connectionString: env.DATABASE_URL,
    ssl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
    query_timeout: 15_000,
    application_name: "peerarena-api"
  };
}

export function createOwnedPostgresProcedureClientFromEnv(env = process.env, PoolClass = Pool) {
  const config = readDatabaseConfig(env);
  const gate = ownedDatabaseGate(config);
  if (!gate.enabled) return new DisabledOwnedPostgresClient(gate.blockers.join("; "));
  try {
    const pool = new PoolClass(poolOptions(env, config));
    return new OwnedPostgresProcedureClient({ pool, config, poolFactory: PoolClass });
  } catch {
    return new DisabledOwnedPostgresClient("Owned PostgreSQL client configuration is invalid.");
  }
}

export { DisabledOwnedPostgresClient };
