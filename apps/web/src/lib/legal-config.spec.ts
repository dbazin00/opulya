import { describe, expect, it } from "vitest";
import { legalDetails } from "./legal-config";

const complete = {
  LEGAL_OPERATOR_NAME: "Example Operator",
  LEGAL_CONTACT_EMAIL: "privacy@example.test",
  LEGAL_RETENTION_DETAILS: "Deployment retention schedule reviewed.",
  LEGAL_TRANSFER_DETAILS: "Deployment locations and safeguards reviewed.",
  LEGAL_NOTICE_REVIEWED: "true",
};

describe("public legal details", () => {
  it("keeps incomplete and unreviewed notices marked as drafts", () => {
    expect(legalDetails({}).draft).toBe(true);
    for (const key of Object.keys(complete))
      expect(legalDetails({ ...complete, [key]: "" }).draft).toBe(true);
    expect(
      legalDetails({ ...complete, LEGAL_NOTICE_REVIEWED: "false" }).draft,
    ).toBe(true);
  });

  it("publishes only the selected public fields after explicit review", () => {
    expect(
      legalDetails({
        ...complete,
        DATABASE_URL: "private",
        RESEND_API_KEY: "secret",
      }),
    ).toEqual({
      operator: complete.LEGAL_OPERATOR_NAME,
      email: complete.LEGAL_CONTACT_EMAIL,
      retention: complete.LEGAL_RETENTION_DETAILS,
      transfers: complete.LEGAL_TRANSFER_DETAILS,
      draft: false,
    });
  });

  it("rejects malformed contact addresses and normalizes valid addresses", () => {
    expect(
      legalDetails({ ...complete, LEGAL_CONTACT_EMAIL: "mailto:invalid" })
        .email,
    ).toBe("");
    expect(
      legalDetails({
        ...complete,
        LEGAL_CONTACT_EMAIL: "x@example.test\r\nBcc: other@example.test",
      }).draft,
    ).toBe(true);
    expect(
      legalDetails({
        ...complete,
        LEGAL_CONTACT_EMAIL: " Privacy@Example.Test ",
      }).email,
    ).toBe("privacy@example.test");
  });
});
