const MAX_ACCESS_TOKEN_LENGTH = 16_384;

export class SessionBoundaryError extends Error {
  constructor(message, { code = "AUTH_SESSION_ERROR", status = 401, cause = undefined } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SessionBoundaryError";
    this.code = code;
    this.status = status;
  }
}

function authorizationHeader(request) {
  const headers = request?.headers;
  if (!headers || typeof headers !== "object") return "";
  const value = typeof headers.get === "function" ? headers.get("authorization") : headers.authorization ?? headers.Authorization;
  return typeof value === "string" ? value : "";
}

export function extractBearerToken(request) {
  const header = authorizationHeader(request).trim();
  if (!header) return null;
  const match = /^Bearer[ \t]+([^\s]+)$/i.exec(header);
  if (!match || match[1].length > MAX_ACCESS_TOKEN_LENGTH) {
    throw new SessionBoundaryError("Invalid authorization header.", { code: "AUTH_INVALID_HEADER", status: 401 });
  }
  return match[1];
}

function providerUnavailable(provider) {
  return !provider || typeof provider.getUser !== "function";
}

function mapProviderFailure(error) {
  if (error instanceof SessionBoundaryError) return error;
  if (error?.code === "AUTH_NOT_CONFIGURED" || error?.status === 503) {
    return new SessionBoundaryError("Authentication service is unavailable.", {
      code: error?.code === "AUTH_NOT_CONFIGURED" ? "AUTH_NOT_CONFIGURED" : "AUTH_UNAVAILABLE",
      status: 503,
      cause: error
    });
  }
  return new SessionBoundaryError("Authentication required.", {
    code: "AUTH_INVALID_SESSION",
    status: 401,
    cause: error
  });
}

function validUser(user) {
  if (!user || typeof user !== "object" || typeof user.id !== "string" || user.id.trim() === "") {
    throw new SessionBoundaryError("Authentication required.", { code: "AUTH_INVALID_SESSION", status: 401 });
  }
  return user;
}

async function authenticateToken(token, provider) {
  if (providerUnavailable(provider)) {
    throw new SessionBoundaryError("Authentication service is unavailable.", { code: "AUTH_NOT_CONFIGURED", status: 503 });
  }
  try {
    const user = validUser(await provider.getUser(token));
    return Object.freeze({ authenticated: true, user });
  } catch (error) {
    throw mapProviderFailure(error);
  }
}

export async function requireAuthenticatedSession({ request, provider } = {}) {
  const token = extractBearerToken(request);
  if (!token) throw new SessionBoundaryError("Authentication required.", { code: "AUTH_REQUIRED", status: 401 });
  return authenticateToken(token, provider);
}

export async function optionalAuthenticatedSession({ request, provider } = {}) {
  const token = extractBearerToken(request);
  if (!token) return Object.freeze({ authenticated: false, user: null });
  return authenticateToken(token, provider);
}

export async function revokeAuthenticatedSession({ request, provider } = {}) {
  const token = extractBearerToken(request);
  if (!token) throw new SessionBoundaryError("Authentication required.", { code: "AUTH_REQUIRED", status: 401 });
  if (!provider || typeof provider.signOut !== "function") {
    throw new SessionBoundaryError("Authentication service is unavailable.", { code: "AUTH_NOT_CONFIGURED", status: 503 });
  }
  try {
    await provider.signOut(token);
    return Object.freeze({ revoked: true });
  } catch (error) {
    throw mapProviderFailure(error);
  }
}
