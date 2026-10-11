import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";

loadEnv({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
  quiet: true,
});

export function testDatabaseUrl(value = process.env.TEST_DATABASE_URL): string {
  if (!value?.trim())
    throw new Error("TEST_DATABASE_URL is required for tests");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "TEST_DATABASE_URL must be a valid PostgreSQL connection URL",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.pathname !== "/opulya_test" ||
    !url.hostname ||
    !url.username ||
    !url.password
  )
    throw new Error("Tests require explicit credentials for opulya_test");
  return value;
}
