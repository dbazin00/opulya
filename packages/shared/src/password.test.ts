import { describe, expect, it } from "vitest";
import {
  loginSchema,
  signupPasswordSchema,
  signupSchema,
  verifyEmailSchema,
} from "./validation.js";

describe("verification password policy", () => {
  it.each([0, 1, 14, 129])("rejects passwords of length %i", (length) => {
    expect(signupPasswordSchema.safeParse("a".repeat(length)).success).toBe(
      false,
    );
  });
  it.each([15, 128])("accepts the length boundary %i", (length) => {
    expect(signupPasswordSchema.parse("a".repeat(length))).toBe(
      "a".repeat(length),
    );
  });
  it("preserves spaces, Unicode and passphrases without composition rules", () => {
    const password = "  moja jedinstvena duga fraza žć  ";
    expect(signupPasswordSchema.parse(password)).toBe(password);
    expect(
      verifyEmailSchema.parse({
        token: "a".repeat(64),
        password,
      }).password,
    ).toBe(password);
  });
  it("registers without a password and rejects signup credentials", () => {
    const user = {
      firstName: "Test",
      lastName: "User",
      email: "test@example.test",
    };
    expect(signupSchema.parse(user)).not.toHaveProperty("password");
    expect(
      signupSchema.safeParse({ ...user, password: "a".repeat(15) }).success,
    ).toBe(false);
    expect(
      signupSchema.safeParse({ ...user, repeatPassword: "a".repeat(15) })
        .success,
    ).toBe(false);
  });
  it("keeps login compatible with existing passwords", () => {
    expect(
      loginSchema.safeParse({ email: "test@example.test", password: "old" })
        .success,
    ).toBe(true);
  });
});
