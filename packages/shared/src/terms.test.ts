import { describe, expect, it } from "vitest";
import { signupSchema, termsVersion } from "./validation.js";

const registration = {
  firstName: "Alex",
  lastName: "Test",
  email: "test@example.test",
  acceptTerms: true,
  termsVersion,
};

describe("signup terms acceptance", () => {
  it.each([undefined, null, false, "true", "on", 1])(
    "rejects non-explicit acceptance %s",
    (acceptTerms) => {
      expect(
        signupSchema.safeParse({ ...registration, acceptTerms }).success,
      ).toBe(false);
    },
  );
  it.each([undefined, null, "", "old-version", "2099-01-01"])(
    "rejects missing or different terms version %s",
    (version) => {
      expect(
        signupSchema.safeParse({ ...registration, termsVersion: version })
          .success,
      ).toBe(false);
    },
  );
  it("accepts only the current version without a client-supplied timestamp", () => {
    expect(signupSchema.parse(registration).termsVersion).toBe(termsVersion);
    expect(
      signupSchema.safeParse({
        ...registration,
        termsAcceptedAt: "2020-01-01T00:00:00Z",
      }).success,
    ).toBe(false);
  });
});
