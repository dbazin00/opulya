import { expect, it, vi } from "vitest";
import { Database, isTransactionConflict } from "./db.js";
import { Prisma } from "./generated/prisma/client.js";

it("recognizes Prisma serialization conflicts", () => {
  const error = new Prisma.PrismaClientKnownRequestError("Fixture conflict", {
    code: "P2034",
    clientVersion: "fixture",
  });
  expect(isTransactionConflict(error)).toBe(true);
});
it("recognizes driver-adapter transaction conflicts", () => {
  const error = Object.assign(new Error("Fixture conflict"), {
    name: "DriverAdapterError",
    cause: { kind: "TransactionWriteConflict" },
  });
  expect(isTransactionConflict(error)).toBe(true);
});
it("does not retry unrelated errors or unknown commit outcomes", () => {
  const constraint = new Prisma.PrismaClientKnownRequestError("Fixture error", {
    code: "P2002",
    clientVersion: "fixture",
  });
  for (const error of [
    constraint,
    new Error("Connection lost"),
    Object.assign(new Error("Fixture error"), {
      name: "DriverAdapterError",
      cause: { kind: "UniqueConstraintViolation" },
    }),
    { name: "DriverAdapterError", cause: { kind: "TransactionWriteConflict" } },
    null,
    undefined,
  ])
    expect(isTransactionConflict(error)).toBe(false);
});

it.each(["", "   "])("rejects missing database credentials: %j", (value) => {
  vi.stubEnv("DATABASE_URL", value);
  try {
    expect(() => new Database()).toThrow("DATABASE_URL is required");
  } finally {
    vi.unstubAllEnvs();
  }
});
