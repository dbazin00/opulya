import { describe, expect, it } from "vitest";
import {
  confirmPasswordSchema,
  deleteUserSchema,
  profileSchema,
  registrationAllowed,
  restrictProcessingSchema,
} from "./privacy.js";

describe("privacy request validation", () => {
  it("does not allow callers to select a different user or change verified email", () => {
    expect(
      confirmPasswordSchema.safeParse({ password: "valid", userId: "other" })
        .success,
    ).toBe(false);
    expect(
      profileSchema.safeParse({
        firstName: "A",
        lastName: "B",
        email: "other@example.test",
      }).success,
    ).toBe(false);
    expect(profileSchema.parse({ firstName: " A ", lastName: " B " })).toEqual({
      firstName: "A",
      lastName: "B",
    });
  });
  it("requires an explicit erasure confirmation and valid password body", () => {
    expect(deleteUserSchema.safeParse({ password: "valid" }).success).toBe(
      false,
    );
    expect(
      deleteUserSchema.safeParse({ password: "valid", confirm: "delete" })
        .success,
    ).toBe(false);
    expect(
      deleteUserSchema.safeParse({ password: "", confirm: "DELETE" }).success,
    ).toBe(false);
    expect(
      deleteUserSchema.parse({ password: "valid", confirm: "DELETE" }).confirm,
    ).toBe("DELETE");
    expect(
      restrictProcessingSchema.safeParse({
        password: "valid",
        restricted: "false",
      }).success,
    ).toBe(false);
  });
});

describe("production privacy setup", () => {
  const complete = {
    NODE_ENV: "production",
    LEGAL_OPERATOR_NAME: "Example Operator",
    LEGAL_CONTACT_EMAIL: "privacy@example.test",
    LEGAL_NOTICE_REVIEWED: "true",
    LEGAL_RETENTION_DETAILS: "Reviewed schedule",
    LEGAL_TRANSFER_DETAILS: "Reviewed locations",
  };
  it("allows development/testing without pretending the deployment is reviewed", () => {
    expect(registrationAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(registrationAllowed({ NODE_ENV: "test" })).toBe(true);
  });
  it("blocks production registration unless every public detail has been supplied and reviewed", () => {
    expect(registrationAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(registrationAllowed(complete)).toBe(true);
    for (const key of Object.keys(complete).filter((key) => key !== "NODE_ENV"))
      expect(registrationAllowed({ ...complete, [key]: "" })).toBe(false);
  });
});
