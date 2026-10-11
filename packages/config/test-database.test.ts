import { expect, it, vi } from "vitest";
import { testDatabaseUrl } from "./test-database.js";

it("requires private test credentials instead of a default password", () => {
  vi.stubEnv("TEST_DATABASE_URL", "");
  try {
    expect(() => testDatabaseUrl()).toThrow("TEST_DATABASE_URL is required");
  } finally {
    vi.unstubAllEnvs();
  }
});
it.each([
  "not-a-url-with-private-secret",
  "postgresql://user:fixture@localhost/opulya",
  "postgresql://user:fixture@localhost/opulya_test_backup",
  "postgresql://user:fixture@localhost/path/opulya_test",
  "https://user:fixture@localhost/opulya_test",
  "postgresql://user@localhost/opulya_test",
])("rejects unsafe test targets without reflecting credentials: %s", (url) => {
  expect(() => testDatabaseUrl(url)).toThrow();
  try {
    testDatabaseUrl(url);
  } catch (error) {
    expect(String(error)).not.toContain("fixture");
    expect(String(error)).not.toContain("private-secret");
  }
});
it("accepts an explicitly configured isolated PostgreSQL database", () => {
  const value = "postgresql://tester:fixture@localhost:5434/opulya_test";
  expect(testDatabaseUrl(value)).toBe(value);
});
