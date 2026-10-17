import { describe, expect, it } from "vitest";
import { verificationQuotas } from "./email-budget.js";
import { mailSettingsSchema } from "./mail.js";

describe("verification email budgets", () => {
  const settings = mailSettingsSchema.parse({});
  const now = new Date("2026-10-17T12:30:00Z");
  it("defaults to conservative global and recipient budgets", () => {
    expect(
      verificationQuotas("person@example.test", settings, now).map(
        (q) => q.limit,
      ),
    ).toEqual([20, 80, 3, 5]);
  });
  it("uses UTC hour/day windows and hashes normalized addresses", () => {
    const quotas = verificationQuotas(" Person@Example.Test ", settings, now);
    expect(quotas).toEqual(
      verificationQuotas("person@example.test", settings, now),
    );
    expect(quotas.map((q) => q.expiresAt.toISOString())).toEqual([
      "2026-10-17T13:00:00.000Z",
      "2026-10-18T00:00:00.000Z",
      "2026-10-17T13:00:00.000Z",
      "2026-10-18T00:00:00.000Z",
    ]);
    expect(JSON.stringify(quotas)).not.toContain("person@example.test");
    expect(quotas[2]?.key).toMatch(/recipient:[a-f0-9]{64}:hour:/);
  });
  it("starts a new budget at the next UTC window", () => {
    const before = verificationQuotas(
      "person@example.test",
      settings,
      new Date("2026-10-17T23:59:59Z"),
    );
    const after = verificationQuotas(
      "person@example.test",
      settings,
      new Date("2026-10-18T00:00:00Z"),
    );
    before.forEach((q, i) => expect(q.key).not.toBe(after[i]?.key));
  });
  it("supports a zero-send switch and rejects invalid configuration", () => {
    expect(
      mailSettingsSchema.parse({ EMAIL_SENDS_PER_DAY: "0" })
        .EMAIL_SENDS_PER_DAY,
    ).toBe(0);
    for (const value of ["-1", "1.5", "invalid"])
      expect(
        mailSettingsSchema.safeParse({ EMAIL_SENDS_PER_HOUR: value }).success,
      ).toBe(false);
  });
});
