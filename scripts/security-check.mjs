import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

async function readProjectFile(relativePath) {
  return readFile(path.join(projectRoot, relativePath), "utf8");
}

const [vercelText, gitignore, packageText, serverText, configText, securityEventsText, databaseText, databaseMigrationText, databaseProcedureMigrationText, databaseBootstrapText, worklogText] = await Promise.all([
  readProjectFile("vercel.json"),
  readProjectFile(".gitignore"),
  readProjectFile("package.json"),
  readProjectFile("server.mjs"),
  readProjectFile("src/backend/config.mjs"),
  readProjectFile("src/backend/security-events.mjs"),
  readProjectFile("src/backend/database.mjs"),
  readProjectFile("database/migrations/0001_owned_postgres_hardening.sql"),
  readProjectFile("database/migrations/0002_owned_create_challenge_procedure.sql"),
  readProjectFile("database/bootstrap/0000_roles.sql"),
  readProjectFile("docs/WORKLOG.md")
]);

let vercel;
let packageJson;
try {
  vercel = JSON.parse(vercelText);
  packageJson = JSON.parse(packageText);
} catch (error) {
  failures.push(`Configuration JSON is invalid: ${error.message}`);
}

const vercelHeaders = new Map((vercel?.headers ?? []).flatMap((rule) => (rule.headers ?? []).map((header) => [header.key, header.value])));
for (const header of [
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "Cross-Origin-Opener-Policy",
  "Cross-Origin-Resource-Policy",
  "Strict-Transport-Security",
  "Content-Security-Policy"
]) requireCondition(vercelHeaders.has(header), `Vercel security header is missing: ${header}`);

const csp = vercelHeaders.get("Content-Security-Policy") ?? "";
for (const directive of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"]) {
  requireCondition(csp.includes(directive), `CSP directive is missing: ${directive}`);
}

for (const requiredLine of [".env", ".env.*", "!.env.example"]) {
  requireCondition(gitignore.split(/\r?\n/).includes(requiredLine), `.gitignore must protect ${requiredLine}`);
}

requireCondition(packageJson?.scripts?.["security:check"] === "node scripts/security-check.mjs", "security:check script is not wired in package.json");
for (const requiredSourceMarker of [
  "maxHeaderSize",
  "requestTimeout",
  "headersTimeout",
  "Request body is too large",
  "enforceMutationOrigin",
  "Strict-Transport-Security",
  "X-Request-ID",
  "runtimeSecurity",
  "ownedDatabaseReady"
]) requireCondition(serverText.includes(requiredSourceMarker), `Server hardening marker is missing: ${requiredSourceMarker}`);

for (const requiredTelemetryMarker of ["SecurityEventLogger", "MAX_BUFFERED_EVENTS", "MAX_SNAPSHOT_SIZE", "new URL"]) {
  requireCondition(securityEventsText.includes(requiredTelemetryMarker) || serverText.includes(requiredTelemetryMarker), `Security telemetry marker is missing: ${requiredTelemetryMarker}`);
}

for (const requiredDatabaseMarker of ["OWNED_POSTGRES_PROVIDER", "DATABASE_ALLOWED_HOSTS", "verify-full", "productionReady"]) {
  requireCondition(databaseText.includes(requiredDatabaseMarker) || configText.includes(requiredDatabaseMarker), `Owned database marker is missing: ${requiredDatabaseMarker}`);
}
for (const requiredMigrationMarker of ["revoke all on all tables in schema public from public", "force row level security", "reject_immutable_mutation", "chain_audit_event"]) {
  requireCondition(databaseMigrationText.toLowerCase().includes(requiredMigrationMarker.toLowerCase()), `Database hardening marker is missing: ${requiredMigrationMarker}`);
}
for (const requiredProcedureMarker of ["create or replace function peerarena_api.create_challenge", "current_actor_id", "command_idempotency", "revoke all on function peerarena_api.create_challenge", "peerarena_runtime"]) {
  requireCondition(databaseProcedureMigrationText.includes(requiredProcedureMarker), `Database procedure marker is missing: ${requiredProcedureMarker}`);
}
for (const requiredRoleMarker of ["no login", "nobypassrls", "statement_timeout", "idle_in_transaction_session_timeout"]) {
  requireCondition(databaseBootstrapText.includes(requiredRoleMarker), `Database role marker is missing: ${requiredRoleMarker}`);
}
requireCondition(worklogText.includes("PeerArena engineering worklog"), "Versioned engineering worklog is missing");

requireCondition(configText.includes("realMoneyEnabled: asBoolean(env.REAL_MONEY_ENABLED, false)"), "Real-money configuration must default to false");

let trackedFiles = [];
try {
  trackedFiles = execFileSync("git", ["ls-files"], { cwd: projectRoot, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
} catch (error) {
  failures.push(`Unable to inspect tracked files: ${error.message}`);
}

for (const trackedFile of trackedFiles) {
  requireCondition(!/^\.env(?:\.|$)/.test(trackedFile) || trackedFile === ".env.example", `Secret-bearing environment file is tracked: ${trackedFile}`);
}

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/
];
const textExtensions = new Set([".cjs", ".css", ".html", ".json", ".js", ".mjs", ".md", ".sql", ".ts", ".tsx", ".yml", ".yaml"]);
for (const trackedFile of trackedFiles.filter((file) => textExtensions.has(path.extname(file).toLowerCase()))) {
  const contents = await readProjectFile(trackedFile).catch(() => "");
  for (const pattern of secretPatterns) requireCondition(!pattern.test(contents), `High-confidence secret pattern found in tracked file: ${trackedFile}`);
}

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, checked: ["headers", "csp", "secret-hygiene", "runtime-defaults", "http-hardening"] }));
}
