import { randomBytes, pbkdf2Sync, createHmac, createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  chmodSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parse } from "dotenv";
import pg from "pg";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const envPath = join(root, ".env");
const folder = join(root, ".secrets");
const secretPath = join(folder, "postgres-password");

function protect(path: string) {
  if (process.platform !== "win32") {
    chmodSync(path, path === folder ? 0o700 : 0o600);
    return;
  }
  const sid = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    ],
    { encoding: "utf8", windowsHide: true },
  ).trim();
  if (!/^S-1-5-\d+(?:-\d+)+$/.test(sid))
    throw new Error("Cannot determine the current Windows user");
  const rights = path === folder ? "(OI)(CI)F" : "F";
  execFileSync(
    "icacls.exe",
    [
      path,
      "/inheritance:r",
      "/grant:r",
      `*${sid}:${rights}`,
      `*S-1-5-18:${rights}`,
      `*S-1-5-32-544:${rights}`,
      "/Q",
    ],
    { stdio: "pipe", windowsHide: true },
  );
}

function replaceSettings(source: string, values: Record<string, string>) {
  const remaining = new Map(Object.entries(values));
  const lines = source.split(/\r?\n/).map((line) => {
    const key = /^\s*([A-Z_][A-Z0-9_]*)\s*=/.exec(line)?.[1];
    if (!key || !Object.hasOwn(values, key)) return line;
    const value = values[key]!;
    remaining.delete(key);
    return `${key}=${value}`;
  });
  return `${lines.join("\n").trimEnd()}\n${[...remaining].map(([key, value]) => `${key}=${value}\n`).join("")}`;
}

async function main() {
  const args = process.argv.slice(2);
  const rotate = args.length === 1 && args[0] === "--rotate-local";
  if (args.length && !rotate)
    throw new Error("Use no arguments for initial setup or --rotate-local");
  const source = readFileSync(envPath, "utf8"),
    env = parse(source);
  if (
    env.NODE_ENV !== "development" ||
    (process.env.NODE_ENV && process.env.NODE_ENV !== "development")
  )
    throw new Error("This helper only sets up local development credentials");
  if (!rotate && env.DATABASE_URL?.trim())
    throw new Error("An existing connection requires --rotate-local");
  if (existsSync(`${secretPath}.next`) || existsSync(`${envPath}.next`))
    throw new Error("Pending credential files require manual recovery first");
  const port = env.POSTGRES_PORT || "5434";
  if (
    port !== "5434" ||
    (env.POSTGRES_USER && env.POSTGRES_USER !== "opulya") ||
    (env.POSTGRES_DB && env.POSTGRES_DB !== "opulya")
  )
    throw new Error("This helper requires the local opulya configuration");
  let current: URL | undefined;
  if (rotate) {
    current = new URL(env.DATABASE_URL!);
    if (
      !["postgres:", "postgresql:"].includes(current.protocol) ||
      !["localhost", "127.0.0.1"].includes(current.hostname) ||
      current.port !== "5434" ||
      current.pathname !== "/opulya" ||
      current.username !== "opulya" ||
      !current.password
    )
      throw new Error("Rotation is restricted to localhost:5434/opulya");
    if (env.TEST_DATABASE_URL?.trim()) {
      const test = new URL(env.TEST_DATABASE_URL);
      if (
        test.protocol !== current.protocol ||
        test.hostname !== current.hostname ||
        test.port !== current.port ||
        test.username !== current.username ||
        test.password !== current.password ||
        test.pathname !== "/opulya_test"
      )
        throw new Error(
          "Test connection must use the same local PostgreSQL role",
        );
    }
  } else if (existsSync(secretPath)) {
    throw new Error(
      "Existing secret files require explicit recovery, not replacement",
    );
  }
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  protect(folder);
  const password = randomBytes(48).toString("hex");
  const url = new URL("postgresql://opulya@localhost:5434/opulya");
  url.password = password;
  const testUrl = new URL(url);
  testUrl.pathname = "/opulya_test";
  const settings = replaceSettings(source, {
    POSTGRES_PASSWORD_FILE: ".secrets/postgres-password",
    DATABASE_URL: url.toString(),
    TEST_DATABASE_URL: testUrl.toString(),
  });
  writeFileSync(`${secretPath}.next`, `${password}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  protect(`${secretPath}.next`);
  writeFileSync(`${envPath}.next`, settings, { flag: "wx", mode: 0o600 });
  protect(`${envPath}.next`);
  if (current) {
    const client = new pg.Client({
      connectionString: current.toString(),
      connectionTimeoutMillis: 5000,
    });
    try {
      await client.connect();
      const identity = await client.query(
        "SELECT current_user AS role, current_database() AS database",
      );
      if (
        identity.rows[0]?.role !== "opulya" ||
        identity.rows[0]?.database !== "opulya"
      )
        throw new Error("Unexpected local database identity");
      // Send a SCRAM verifier instead of a plaintext password in the administrative SQL.
      const salt = randomBytes(16),
        iterations = 65536;
      const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
      const clientKey = createHmac("sha256", salted)
        .update("Client Key")
        .digest();
      const stored = createHash("sha256").update(clientKey).digest("base64");
      const server = createHmac("sha256", salted)
        .update("Server Key")
        .digest("base64");
      const verifier = `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${stored}:${server}`;
      await client.query(`ALTER ROLE "opulya" PASSWORD '${verifier}'`);
    } finally {
      await client.end();
    }
  }
  renameSync(`${secretPath}.next`, secretPath);
  renameSync(`${envPath}.next`, envPath);
  console.log(
    rotate
      ? "Local database password rotated; existing data preserved."
      : "Local database credentials generated.",
  );
  console.log(
    "Private password: .secrets/postgres-password. Connection URLs updated in .env.",
  );
  console.log(
    "Restart the API and update saved pgAdmin credentials. Never reuse this password in production.",
  );
}

main().catch(() => {
  console.error(
    "Credential setup failed. No secret was printed. Check the local configuration and any private .next recovery files; do not reset the database.",
  );
  process.exitCode = 1;
});
