import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
type Tool = "pg_dump" | "pg_restore";

/** Client tools are a local prerequisite; the rehearsal never downloads executables. */
function executable(tool: Tool): string {
  const directory = process.env.PG_CLIENT_BIN_DIR ?? process.env.PG_BIN_DIR;
  const name = `${tool}${process.platform === "win32" ? ".exe" : ""}`;
  if (!directory) return name;
  if (!path.isAbsolute(directory)) throw new Error("PG_CLIENT_BIN_DIR / PG_BIN_DIR must be an absolute directory.");
  return path.join(directory, name);
}

export async function checkClientTools(): Promise<string[]> {
  const versions: string[] = [];
  for (const tool of ["pg_dump", "pg_restore"] as const) {
    try {
      const { stdout } = await execute(executable(tool), ["--version"], { timeout: 10_000, windowsHide: true });
      assert.match(stdout, new RegExp(`^${tool} \\(PostgreSQL\\) 17\\.`));
      versions.push(stdout.trim());
    } catch (cause) {
      throw new Error(`Install PostgreSQL 17 client tools and set PG_CLIENT_BIN_DIR to their bin directory (or add it to PATH). ${tool} must report version 17.`, { cause });
    }
  }
  return versions;
}

/** Only accepts the disposable harness database, never an ambient DATABASE_URL or service. */
export async function runDatabaseTool(tool: Tool, databaseUrl: string, args: string[]): Promise<void> {
  const connection = new URL(databaseUrl);
  assert.equal(connection.hostname, "127.0.0.1");
  assert.equal(connection.pathname, "/aisistent_test");
  assert.equal(connection.username, "render_owner");
  assert.ok(connection.port);
  const env = { ...process.env };
  // Prevent inherited libpq service, hostaddr, options or credentials from redirecting the drill.
  for (const key of Object.keys(env)) if (/^PG/i.test(key)) delete env[key];
  env.PGPASSWORD = decodeURIComponent(connection.password); // Synthetic harness credential only.
  env.PGCONNECT_TIMEOUT = "5";
  env.PGSSLMODE = "disable";
  const { stderr } = await execute(executable(tool), [
    "--host=127.0.0.1", `--port=${connection.port}`, "--username=render_owner",
    "--dbname=aisistent_test", "--no-password", ...args,
  ], { env, timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 });
  assert.equal(stderr.trim(), "", `${tool} emitted a warning`);
}
