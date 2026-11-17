// Local development only. Does not change application or deployment settings.
import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = fileURLToPath(new URL("../", import.meta.url));
const local = path.join(root, "database/local");
const bin = path.join(local, "pgsql/bin");
const data = path.join(local, "data");
const settingsFile = path.join(local, "connection.json");
const action = process.argv[2] ?? "status";
function run(name, args) {
  return execFileSync(path.join(bin, name + ".exe"), args, {
    windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000
  });
}
function settings() { return JSON.parse(readFileSync(settingsFile, "utf8")); }
function connect(user = "admin", database = "peerarena_local") {
  const config = settings();
  return new pg.Client({
    host: "127.0.0.1", port: 55432, database,
    user: config[user].user, password: config[user].password,
    ssl: { rejectUnauthorized: true, ca: readFileSync(path.join(data, "server.crt"), "utf8") },
    connectionTimeoutMillis: 5000, query_timeout: 15000
  });
}
async function migrate() {
  const client = connect("admin", "postgres");
  await client.connect();
  try {
    if (!(await client.query("select 1 from pg_database where datname = 'peerarena_local'")).rowCount) {
      await client.query("create database peerarena_local");
    }
  } finally { await client.end(); }
  const db = connect();
  await db.connect();
  try {
    await db.query("create schema if not exists peerarena_setup; revoke all on schema peerarena_setup from public");
    await db.query("create table if not exists peerarena_setup.migrations (name text primary key, sha256 text not null)");
    for (const name of [
      "database/bootstrap/0000_roles.sql", "docs/DATABASE_SCHEMA.sql",
      "database/migrations/0001_owned_postgres_hardening.sql",
      "database/migrations/0002_owned_create_challenge_procedure.sql",
      "database/migrations/0003_owned_accept_challenge_procedure.sql",
      "database/migrations/0004_owned_verify_and_settle_synthetic_challenge.sql"
    ]) {
      const sql = readFileSync(path.join(root, name), "utf8");
      const hash = createHash("sha256").update(sql).digest("hex");
      const previous = (await db.query("select sha256 from peerarena_setup.migrations where name=$1", [name])).rows[0];
      if (previous) {
        if (previous.sha256 !== hash) throw new Error("Applied migration changed: " + name);
        continue;
      }
      await db.query("begin");
      try {
        await db.query(sql.replace(/^begin;\s*$/gmi, "").replace(/^commit;\s*$/gmi, ""));
        await db.query("insert into peerarena_setup.migrations values ($1,$2)", [name, hash]);
        await db.query("commit");
        console.log("Applied " + name);
      } catch (error) { await db.query("rollback"); throw error; }
    }
    const app = settings().app;
    if (!(await db.query("select 1 from pg_roles where rolname=$1", [app.user])).rowCount) {
      // The identifier is fixed; the secret is generated locally as hexadecimal.
      if (!/^[a-f0-9]{64}$/.test(app.password)) throw new Error("Invalid local secret format");
      await db.query("create role peerarena_local_app login inherit nosuperuser nocreatedb nocreaterole nobypassrls password '" + app.password + "'");
    }
    await db.query("grant peerarena_runtime to peerarena_local_app");
  } finally { await db.end(); }
}
async function check() {
  const admin = connect();
  await admin.connect();
  try {
    const tls = (await admin.query("select ssl from pg_stat_ssl where pid=pg_backend_pid()")).rows[0].ssl;
    if (!tls) throw new Error("TLS is not active");
    const migrations = (await admin.query("select count(*)::int as n from peerarena_setup.migrations")).rows[0].n;
    if (migrations !== 6) throw new Error("Migrations are incomplete");
    const unprotected = (await admin.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and (not c.relrowsecurity or not c.relforcerowsecurity)")).rows;
    if (unprotected.length) throw new Error("Unprotected public tables");
    const app = connect("app");
    await app.connect();
    try {
      const role = (await app.query("select rolsuper, rolbypassrls from pg_roles where rolname=current_user")).rows[0];
      if (role.rolsuper || role.rolbypassrls) throw new Error("Runtime role has elevated privileges");
      try { await app.query("select * from public.users"); throw new Error("Runtime read unexpectedly allowed"); }
      catch (error) { if (error.code !== "42501") throw error; }
      try { await app.query("delete from public.users"); throw new Error("Runtime write unexpectedly allowed"); }
      catch (error) { if (error.code !== "42501") throw error; }
      console.log(JSON.stringify({ ok: true, database: "peerarena_local", host: "127.0.0.1", port: 55432, tlsVerified: true, migrations, directRuntimeAccess: "DENIED", realMoney: "DISABLED" }));
    } finally { await app.end(); }
  } finally { await admin.end(); }
}
try {
  if (process.platform !== "win32") throw new Error("This local setup script targets Windows");
  if (action === "init") {
    if (existsSync(settingsFile) || existsSync(path.join(data, "PG_VERSION"))) throw new Error("Local database already initialized; use start or migrate");
    mkdirSync(local, { recursive: true });
    execFileSync("icacls", [local, "/inheritance:r", "/grant:r", process.env.USERDOMAIN + "\\" + process.env.USERNAME + ":(OI)(CI)F", "SYSTEM:(OI)(CI)F", "/T"], { windowsHide: true, stdio: "pipe" });
    const config = { admin: { user: "peerarena_local_admin", password: randomBytes(32).toString("hex") }, app: { user: "peerarena_local_app", password: randomBytes(32).toString("hex") } };
    writeFileSync(settingsFile, JSON.stringify(config), { mode: 0o600 });
    const passwordFile = path.join(local, "admin-password");
    writeFileSync(passwordFile, config.admin.password, { mode: 0o600 });
    run("initdb", ["-D", data, "-U", config.admin.user, "--pwfile=" + passwordFile, "-A", "scram-sha-256", "-E", "UTF8", "--locale=C"]);
    execFileSync("C:/Program Files/Git/usr/bin/openssl.exe", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "90", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-keyout", path.join(data, "server.key"), "-out", path.join(data, "server.crt")], { windowsHide: true, stdio: "pipe" });
    writeFileSync(path.join(data, "pg_hba.conf"), "hostssl all all 127.0.0.1/32 scram-sha-256\n");
    writeFileSync(path.join(data, "postgresql.conf"), "listen_addresses='127.0.0.1'\nport=55432\nssl=on\nssl_cert_file='server.crt'\nssl_key_file='server.key'\npassword_encryption='scram-sha-256'\nmax_connections=30\nshared_buffers='64MB'\nlog_statement='none'\n");
    run("pg_ctl", ["-D", data, "-l", path.join(local, "postgres.log"), "-w", "start"]);
    await migrate();
    await check();
  } else if (action === "start") {
    run("pg_ctl", ["-D", data, "-l", path.join(local, "postgres.log"), "-w", "start"]);
    await check();
  } else if (action === "stop") {
    console.log(run("pg_ctl", ["-D", data, "-w", "-m", "fast", "stop"]));
  } else if (action === "migrate") { await migrate(); await check(); }
  else if (action === "check") await check();
  else if (action === "status") console.log(run("pg_ctl", ["-D", data, "status"]));
  else throw new Error("Use init, start, stop, status, migrate or check");
} catch (error) {
  // Never dump child-process buffers, connection objects or SQL containing secrets.
  console.error(JSON.stringify({ ok: false, code: error.code ?? "LOCAL_DATABASE_ERROR", message: error.message.split("\n")[0] }));
  process.exitCode = 1;
}
