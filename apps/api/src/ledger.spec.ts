import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { LedgerService, monthBounds } from "./ledger.js";
import type { Database } from "./db.js";
describe("reporting time zones", () => {
  it("uses Zagreb month boundaries across DST", () => {
    const range = monthBounds("2026-03", "Europe/Zagreb");
    expect(range.from).toBe("2026-02-28T23:00:00.000Z");
    expect(range.to).toBe("2026-03-31T22:00:00.000Z");
  });
  it("includes the complete 25-hour day at the end of DST", () => {
    const service = new LedgerService(null as unknown as Database);
    const rows = [
      "2026-10-24T21:59:59.000Z",
      "2026-10-24T22:00:00.000Z",
      "2026-10-25T22:59:59.000Z",
      "2026-10-25T23:00:00.000Z",
    ].map((occurredAt, i) => ({
      id: String(i),
      type: "EXPENSE" as const,
      amount: "1",
      currency: "EUR",
      categoryId: null,
      sourceAccountId: "a",
      destinationAccountId: null,
      occurredAt,
      createdAt: occurredAt,
    }));
    expect(
      service
        .filter(
          rows,
          [],
          { currency: "EUR", startDate: "2026-10-25", endDate: "2026-10-25" },
          "Europe/Zagreb",
        )
        .map((t) => t.id),
    ).toEqual(["2", "1"]);
  });
});
