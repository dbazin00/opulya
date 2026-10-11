import { describe, expect, it } from "vitest";
import { accountUpdateSchema } from "./validation.js";

describe("account updates", () => {
  it.each(["BANK", "CASH", "INVESTMENT"])(
    "accepts supported type %s",
    (type) => {
      expect(accountUpdateSchema.parse({ name: " Account ", type })).toEqual({
        name: "Account",
        type,
      });
    },
  );
  it("preserves rename/archive updates without a type", () => {
    expect(
      accountUpdateSchema.parse({ name: "Account", archived: true }),
    ).toEqual({ name: "Account", archived: true });
  });
  it.each([
    { type: "OTHER" },
    { type: null },
    { userId: "other" },
    { currency: "USD" },
    { canDelete: true },
    { initialBalance: "200" },
  ])("rejects invalid or server-owned fields: %j", (extra) => {
    expect(
      accountUpdateSchema.safeParse({ name: "Account", ...extra }).success,
    ).toBe(false);
  });
});
