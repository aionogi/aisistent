import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { APP_LOGIN_ROLE } from "../../lib/db/config.ts";
import { ensureAppLogin, migrate } from "../../lib/db/migrator.ts";

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
export const APP_PASSWORD = "test-app-password-0123456789-abcdefghij";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

export type TestDatabase = {
  adminUrl: string;
  appUrl: string;
  /** A connected client for the migration owner. */
  admin: pg.Client;
  /** Pool for the restricted application login, as the web server uses it. */
  appPool: pg.Pool;
  stop: () => Promise<void>;
};

type Binaries = { initdb: string; postgres: string };

/**
 * PostgreSQL 17 binaries from the platform package installed with the
 * `embedded-postgres` dev dependency, or from PG_BIN_DIR if set. Windows cannot
 * load DLLs from very long directory paths, so the binaries are copied to a
 * short cache directory under the OS temp folder when needed.
 */
async function resolveBinaries(): Promise<Binaries> {
  const exe = process.platform === "win32" ? ".exe" : "";
  if (process.env.PG_BIN_DIR) {
    return { initdb: path.join(process.env.PG_BIN_DIR, `initdb${exe}`), postgres: path.join(process.env.PG_BIN_DIR, `postgres${exe}`) };
  }
  const platformPackage = `@embedded-postgres/${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
  const bundled = (await import(platformPackage)) as Binaries;
  const binDir = path.dirname(bundled.postgres);
  if (process.platform !== "win32" || binDir.length < 150) return bundled;

  const cacheRoot = path.join(os.tmpdir(), "aisistent-pg17");
  const nativeDir = path.dirname(binDir);
  if (!existsSync(path.join(cacheRoot, "bin", `postgres${exe}`))) await cp(nativeDir, cacheRoot, { recursive: true });
  return { initdb: path.join(cacheRoot, "bin", `initdb${exe}`), postgres: path.join(cacheRoot, "bin", `postgres${exe}`) };
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with ${code}: ${stderr}`))));
  });
}

async function waitForServer(config: pg.ClientConfig, server: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`postgres exited early with code ${server.exitCode}`);
    const client = new pg.Client(config);
    try {
      await client.connect();
      await client.end();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("PostgreSQL did not start within 10 seconds.");
}

/**
 * Starts a throwaway PostgreSQL 17 server and prepares it like Render does:
 * a non-superuser owner with CREATEROLE owns the database. Unless disabled,
 * migrations then run as that owner and the application connects as aisistent_app.
 */
export async function startTestDatabase(options: { migrate?: boolean; appPassword?: string } = {}): Promise<TestDatabase> {
  const appPassword = options.appPassword ?? APP_PASSWORD;
  const binaries = await resolveBinaries();
  const workDir = await mkdtemp(path.join(os.tmpdir(), "aisistent-pgdata-"));
  const dataDir = path.join(workDir, "data");
  const passwordFile = path.join(workDir, "pw");
  const superPassword = "superuser-test-password";
  await writeFile(passwordFile, superPassword);
  await run(binaries.initdb, ["-D", dataDir, "-U", "postgres", "--auth=scram-sha-256", `--pwfile=${passwordFile}`, "-E", "UTF8", "--locale=C"]);

  const port = await freePort();
  const server = spawn(binaries.postgres, ["-D", dataDir, "-p", String(port), "-c", "listen_addresses=127.0.0.1", "-c", `unix_socket_directories=${process.platform === "win32" ? "" : workDir}`], { stdio: "ignore" });
  const superuserConfig = { host: "127.0.0.1", port, user: "postgres", password: superPassword, database: "postgres" };
  await waitForServer(superuserConfig, server);

  const superuser = new pg.Client(superuserConfig);
  await superuser.connect();
  await superuser.query("CREATE ROLE render_owner LOGIN CREATEROLE PASSWORD 'owner-test-password'");
  await superuser.query("CREATE DATABASE aisistent_test OWNER render_owner");
  await superuser.end();

  const adminUrl = `postgresql://render_owner:owner-test-password@127.0.0.1:${port}/aisistent_test`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  if (options.migrate !== false) {
    await migrate(admin, MIGRATIONS_DIR);
    await ensureAppLogin(admin, appPassword);
  }

  const appUrl = `postgresql://${APP_LOGIN_ROLE}:${encodeURIComponent(appPassword)}@127.0.0.1:${port}/aisistent_test`;
  const appPool = new pg.Pool({ connectionString: appUrl, max: 4 });

  return {
    adminUrl,
    appUrl,
    admin,
    appPool,
    stop: async () => {
      await appPool.end();
      await admin.end();
      const exited = new Promise((resolve) => server.once("exit", resolve));
      server.kill();
      await exited;
      await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}
