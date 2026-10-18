import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { FinanceController } from "./controller.js";
import type { Database } from "./db.js";
import type { LedgerService } from "./ledger.js";
import type { ReportsService } from "./reports.js";
import type { BudgetsService } from "./budgets.js";
import type { InstrumentsService } from "./instruments.js";
import type { PriceScheduler } from "./price-scheduler.js";
import type { AuthRequest } from "./security.js";
import type { InstrumentDirectory } from "./instrument-directory.js";
describe("first price kicks after committed activity", () => {
  const request = { user: { id: "u" } } as AuthRequest;
  function controller(investment: ReturnType<typeof vi.fn>) {
    const requestRefresh = vi.fn();
    return {
      requestRefresh,
      api: new FinanceController(
        {} as Database,
        { investment } as unknown as LedgerService,
        {} as ReportsService,
        {} as BudgetsService,
        {} as InstrumentsService,
        { requestRefresh } as unknown as PriceScheduler,
        {} as InstrumentDirectory,
      ),
    };
  }
  it("returns the saved activity and never waits for the price provider", async () => {
    let finish!: (entry: unknown) => void;
    const { api, requestRefresh } = controller(
      vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const saved = { id: "buy", type: "BUY", voidedAt: null };
    const pending = api.investment(request, {});
    expect(requestRefresh).not.toHaveBeenCalled();
    finish(saved);
    await expect(pending).resolves.toBe(saved);
    expect(requestRefresh).toHaveBeenCalledOnce();
  });
  it("never kicks for failed writes, non-purchases or retries of a voided purchase", async () => {
    const failed = controller(
      vi.fn().mockRejectedValue(new Error("invalid trade")),
    );
    await expect(failed.api.investment(request, {})).rejects.toThrow(
      "invalid trade",
    );
    expect(failed.requestRefresh).not.toHaveBeenCalled();
    for (const entry of [
      { type: "SELL", voidedAt: null },
      { type: "BUY", voidedAt: new Date() },
    ]) {
      const { api, requestRefresh } = controller(
        vi.fn().mockResolvedValue(entry),
      );
      await api.investment(request, {});
      expect(requestRefresh).not.toHaveBeenCalled();
    }
  });
});
