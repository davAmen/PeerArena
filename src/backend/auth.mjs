const AUTH_METHODS = Object.freeze([
  "signUp",
  "signInWithPassword",
  "requestPasswordRecovery",
  "getUser",
  "signOut",
  "getGoogleOAuthUrl"
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthProviderError extends Error {
  constructor(message, { code = "AUTH_PROVIDER_ERROR", providerCode = undefined, status = 500, cause = undefined } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AuthProviderError";
    this.code = code;
    this.providerCode = providerCode;
    this.status = status;
  }
}

function requiredString(value, name, { maxLength = 1024 } = {}) {
  if (typeof value !== "string" || value.trim() === "") throw new AuthProviderError(`${name} is required.`, { code: "AUTH_INVALID_INPUT", status: 400 });
  if (value.length > maxLength) throw new AuthProviderError(`${name} is too long.`, { code: "AUTH_INVALID_INPUT", status: 400 });
  return value;
}

function emailAddress(value) {
  const email = requiredString(value, "Email address", { maxLength: 320 }).trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new AuthProviderError("Email address is invalid.", { code: "AUTH_INVALID_INPUT", status: 400 });
  return email;
}

function password(value) {
  return requiredString(value, "Password", { maxLength: 1024 });
}

function accessToken(value) {
  return requiredString(value, "Access token", { maxLength: 16_384 });
}

function redirectUrl(value, name = "Redirect URL") {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = requiredString(value, name, { maxLength: 2_048 });
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AuthProviderError(`${name} is invalid.`, { code: "AUTH_INVALID_INPUT", status: 400 });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new AuthProviderError(`${name} must use HTTP or HTTPS.`, { code: "AUTH_INVALID_INPUT", status: 400 });
  }
  return parsed.href;
}

function supabaseUrl(value) {
  const raw = requiredString(value, "Supabase URL", { maxLength: 2_048 }).replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AuthProviderError("Supabase URL is invalid.", { code: "AUTH_INVALID_CONFIG", status: 500 });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new AuthProviderError("Supabase URL must use HTTP or HTTPS.", { code: "AUTH_INVALID_CONFIG", status: 500 });
  }
  return parsed.href.replace(/\/+$/, "");
}

function safeProviderCode(payload) {
  const candidate = payload && typeof payload === "object"
    ? payload.error_code ?? payload.code ?? payload.error
    : undefined;
  if (typeof candidate !== "string" || candidate.trim() === "") return undefined;
  return candidate.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "_").slice(0, 100);
}

function withQuery(path, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, value);
  }
  const encoded = query.toString();
  return encoded ? `${path}?${encoded}` : path;
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

export class SupabaseAuthProvider {
  constructor({ url, anonKey, fetchImpl = globalThis.fetch, defaultRedirectUrl } = {}) {
    this.baseUrl = supabaseUrl(url);
    this.anonKey = requiredString(anonKey, "Supabase anon key", { maxLength: 16_384 });
    if (typeof fetchImpl !== "function") throw new AuthProviderError("A fetch implementation is required.", { code: "AUTH_INVALID_CONFIG", status: 500 });
    this.fetchImpl = fetchImpl;
    this.defaultRedirectUrl = redirectUrl(defaultRedirectUrl, "Default redirect URL");
  }

  getCapabilities() {
    return Object.freeze({
      provider: "supabase",
      configured: true,
      methods: AUTH_METHODS,
      sessionValidation: "bearer-token"
    });
  }

  async signUp({ email, password: rawPassword, metadata, redirectTo } = {}) {
    const body = { email: emailAddress(email), password: password(rawPassword), data: metadata ?? {} };
    const redirect = this.#redirect(redirectTo);
    return this.#request(withQuery("/auth/v1/signup", { redirect_to: redirect }), { method: "POST", body });
  }

  async signInWithPassword({ email, password: rawPassword } = {}) {
    return this.#request("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: { email: emailAddress(email), password: password(rawPassword) }
    });
  }

  async requestPasswordRecovery({ email, redirectTo } = {}) {
    const body = { email: emailAddress(email) };
    const redirect = this.#redirect(redirectTo);
    return this.#request(withQuery("/auth/v1/recover", { redirect_to: redirect }), { method: "POST", body });
  }

  async getUser(rawAccessToken) {
    return this.#request("/auth/v1/user", { accessToken: accessToken(rawAccessToken) });
  }

  async signOut(rawAccessToken) {
    return this.#request("/auth/v1/logout", { method: "POST", accessToken: accessToken(rawAccessToken) });
  }

  getGoogleOAuthUrl({ redirectTo } = {}) {
    const target = new URL(`${this.baseUrl}/auth/v1/authorize`);
    target.searchParams.set("provider", "google");
    const redirect = this.#redirect(redirectTo);
    if (redirect) target.searchParams.set("redirect_to", redirect);
    return target.href;
  }

  #redirect(value) {
    return redirectUrl(value, "Redirect URL") ?? this.defaultRedirectUrl;
  }

  async #request(path, { method = "GET", body, accessToken: rawAccessToken } = {}) {
    const headers = {
      Accept: "application/json",
      apikey: this.anonKey
    };
    if (rawAccessToken) headers.Authorization = `Bearer ${rawAccessToken}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch (error) {
      throw new AuthProviderError("Authentication service is unavailable.", {
        code: "AUTH_NETWORK_ERROR",
        status: 503,
        cause: error
      });
    }

    const payload = await responsePayload(response);
    if (!response.ok) {
      throw new AuthProviderError("Authentication request was rejected.", {
        code: "AUTH_PROVIDER_REJECTED",
        providerCode: safeProviderCode(payload),
        status: response.status
      });
    }
    return payload;
  }
}

export class DisabledAuthProvider {
  constructor(reason = "Supabase Auth is not configured.") {
    this.reason = reason;
  }

  getCapabilities() {
    return Object.freeze({
      provider: "disabled",
      configured: false,
      methods: AUTH_METHODS,
      sessionValidation: "unavailable"
    });
  }

  #disabled() {
    throw new AuthProviderError(this.reason, { code: "AUTH_NOT_CONFIGURED", status: 503 });
  }

  signUp() { return this.#disabled(); }
  signInWithPassword() { return this.#disabled(); }
  requestPasswordRecovery() { return this.#disabled(); }
  getUser() { return this.#disabled(); }
  signOut() { return this.#disabled(); }
  getGoogleOAuthUrl() { return this.#disabled(); }
}

export function createAuthProviderFromEnv(env = process.env, fetchImpl = globalThis.fetch) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return new DisabledAuthProvider();
  try {
    return new SupabaseAuthProvider({
      url,
      anonKey,
      fetchImpl,
      defaultRedirectUrl: env.NEXT_PUBLIC_APP_URL
    });
  } catch {
    return new DisabledAuthProvider("Supabase Auth configuration is invalid.");
  }
}
