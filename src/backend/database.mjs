const OWNED_POSTGRES_PROVIDER = "owned-postgres";
const DISABLED_PROVIDER = "disabled";
const SUPPORTED_PROVIDERS = new Set([DISABLED_PROVIDER, OWNED_POSTGRES_PROVIDER]);
const SUPPORTED_SSL_MODES = new Set(["disable", "require", "verify-ca", "verify-full"]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function allowedHosts(value) {
  return Object.freeze([...new Set(text(value).split(",").map((host) => host.trim().toLowerCase()).filter(Boolean))]);
}

function parseUrl(value) {
  const raw = text(value);
  if (!raw) return { parsed: undefined, error: undefined };
  try {
    const parsed = new URL(raw);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) return { parsed: undefined, error: "DATABASE_URL must use postgres:// or postgresql://." };
    if (!parsed.hostname || !parsed.username) return { parsed: undefined, error: "DATABASE_URL must include a database host and username." };
    return { parsed, error: undefined };
  } catch {
    return { parsed: undefined, error: "DATABASE_URL is invalid." };
  }
}

export const DATABASE_PROVIDERS = Object.freeze({ disabled: DISABLED_PROVIDER, ownedPostgres: OWNED_POSTGRES_PROVIDER });

export function readDatabaseConfig(env = process.env) {
  const appEnv = text(env.APP_ENV) || "demo";
  const provider = (text(env.DATABASE_PROVIDER) || DISABLED_PROVIDER).toLowerCase();
  const { parsed, error: urlError } = parseUrl(env.DATABASE_URL);
  const sslMode = (text(env.DATABASE_SSL_MODE) || (appEnv === "production" ? "verify-full" : "disable")).toLowerCase();
  const allowlistedHosts = allowedHosts(env.DATABASE_ALLOWED_HOSTS);
  const errors = [];
  const urlSslMode = parsed?.searchParams.get("sslmode")?.toLowerCase();

  if (!SUPPORTED_PROVIDERS.has(provider)) errors.push("DATABASE_PROVIDER must be disabled or owned-postgres.");
  if (urlError) errors.push(urlError);
  if (provider === OWNED_POSTGRES_PROVIDER && !parsed) errors.push("owned-postgres requires DATABASE_URL.");
  if (provider === DISABLED_PROVIDER && parsed) errors.push("DATABASE_URL cannot be used while DATABASE_PROVIDER is disabled.");
  if (!SUPPORTED_SSL_MODES.has(sslMode)) errors.push("DATABASE_SSL_MODE is invalid.");
  if (urlSslMode && urlSslMode !== sslMode) errors.push("DATABASE_URL sslmode must match DATABASE_SSL_MODE.");

  const host = parsed?.hostname.toLowerCase() ?? "";
  const hostAllowlisted = Boolean(host) && allowlistedHosts.includes(host);
  const configured = provider === OWNED_POSTGRES_PROVIDER && Boolean(parsed) && errors.length === 0;
  const productionReady = configured && appEnv === "production" && sslMode === "verify-full" && hostAllowlisted;
  return Object.freeze({
    provider,
    appEnv,
    configured,
    host: host || undefined,
    sslMode,
    allowlistedHosts,
    hostAllowlisted,
    productionReady,
    errors: Object.freeze(errors)
  });
}

export function ownedDatabaseGate(config = readDatabaseConfig()) {
  const blockers = [];
  if (config.provider !== OWNED_POSTGRES_PROVIDER) blockers.push("database provider is not owned-postgres");
  if (!config.configured) blockers.push("owned PostgreSQL configuration is incomplete");
  if (config.sslMode !== "verify-full") blockers.push("database TLS mode is not verify-full");
  if (!config.hostAllowlisted) blockers.push("database host is not explicitly allowlisted");
  blockers.push(...(config.errors ?? []));
  return Object.freeze({ enabled: blockers.length === 0, blockers: Object.freeze([...new Set(blockers)]) });
}
