import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetVerification,
  pendingVerification,
  rememberVerification,
} from "./pending-verification";

describe("pending verification context", () => {
  let storage: Map<string, string>;
  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("normalizes the address and restores the cooldown across page loads", () => {
    expect(rememberVerification(" Person@Example.Test ")).toEqual({
      email: "person@example.test",
      nextRequestAt: 1_060_000,
    });
    expect(pendingVerification()).toEqual({
      email: "person@example.test",
      nextRequestAt: 1_060_000,
    });
    expect([...storage.values()][0]).not.toContain("token");
  });
  it("supports an elapsed cooldown and clearing the address", () => {
    rememberVerification("person@example.test", 0);
    expect(pendingVerification()?.nextRequestAt).toBe(0);
    forgetVerification();
    expect(pendingVerification()).toBeNull();
  });
  it.each([
    "invalid-json",
    "null",
    "[]",
    "42",
    JSON.stringify({ email: "bad", nextRequestAt: 0 }),
    JSON.stringify({ email: "person@example.test", nextRequestAt: "0" }),
    '{"email":"person@example.test","nextRequestAt":1e999}',
  ])("rejects malformed stored data: %s", (value) => {
    storage.set("opulya.pending-verification", value);
    expect(pendingVerification()).toBeNull();
  });
  it("does not block verification when browser storage is unavailable", () => {
    vi.stubGlobal("window", {
      get sessionStorage() {
        throw new Error("Storage blocked");
      },
    });
    expect(pendingVerification()).toBeNull();
    expect(rememberVerification("person@example.test").email).toBe(
      "person@example.test",
    );
    expect(() => forgetVerification()).not.toThrow();
  });
});
