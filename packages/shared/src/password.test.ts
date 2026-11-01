import { describe, expect, it } from "vitest";
import {
  loginSchema,
  signupPasswordSchema,
  signupSchema,
  verifyEmailSchema,
  termsVersion,
  resetPasswordSchema,
  forgotPasswordSchema,
} from "./validation.js";

describe("verification password policy", () => {
  it("uses the same strong password policy for resets and rejects extra input", () => {
    const token = "b".repeat(64);
    expect(
      resetPasswordSchema.safeParse({ token, password: "short" }).success,
    ).toBe(false);
    expect(
      resetPasswordSchema.parse({ token, password: "a".repeat(15) }).token,
    ).toBe(token);
    expect(
      resetPasswordSchema.safeParse({
        token,
        password: "a".repeat(15),
        userId: "other",
      }).success,
    ).toBe(false);
    expect(
      forgotPasswordSchema.parse({ email: " OWNER@EXAMPLE.TEST " }).email,
    ).toBe("owner@example.test");
    expect(
      forgotPasswordSchema.safeParse({ email: "owner@example.test", token })
        .success,
    ).toBe(false);
  });
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
      acceptTerms: true,
      termsVersion,
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
