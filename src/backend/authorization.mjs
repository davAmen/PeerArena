import { requireAuthenticatedSession } from "./auth-session.mjs";

export class AuthorizationError extends Error {
  constructor(message, { code = "AUTH_FORBIDDEN", status = 403 } = {}) {
    super(message);
    this.name = "AuthorizationError";
    this.code = code;
    this.status = status;
  }
}

function normalizedRoles(user) {
  const metadata = user?.app_metadata;
  const candidates = metadata?.roles ?? metadata?.role ?? [];
  const values = Array.isArray(candidates) ? candidates : [candidates];
  return new Set(values.filter((role) => typeof role === "string" && role.trim() !== "").map((role) => role.trim().toLowerCase()));
}

export function rolesForUser(user) {
  return Object.freeze([...normalizedRoles(user)].sort());
}

export function requireRole(session, role) {
  const requiredRole = typeof role === "string" ? role.trim().toLowerCase() : "";
  if (!requiredRole) throw new AuthorizationError("A required role was not specified.", { code: "AUTH_INVALID_POLICY", status: 500 });
  if (!session?.authenticated || !session.user) {
    throw new AuthorizationError("Authentication required.", { code: "AUTH_REQUIRED", status: 401 });
  }
  const roles = normalizedRoles(session.user);
  if (!roles.has(requiredRole)) throw new AuthorizationError("You are not authorized for this action.", { code: "AUTH_FORBIDDEN", status: 403 });
  return Object.freeze({ ...session, roles: Object.freeze([...roles].sort()) });
}

export async function requireAdminSession({ request, provider } = {}) {
  const session = await requireAuthenticatedSession({ request, provider });
  return requireRole(session, "admin");
}
