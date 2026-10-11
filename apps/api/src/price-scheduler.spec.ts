import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PriceScheduler } from "./price-scheduler.js";
import type { MarketPriceSync } from "./instruments.js";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("immediate first-price scheduling", () => {
  function setup() {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", "fixture-not-a-real-key");
    vi.stubEnv("MARKET_SCHEDULER_ENABLED", "true");
    const run = vi.fn().mockResolvedValue({ updated: 1 });
    return {
      run,
      scheduler: new PriceScheduler({ run } as unknown as MarketPriceSync),
    };
  }
  it("coalesces purchase kicks and runs without waiting for the minute timer", async () => {
    const { run, scheduler } = setup();
    scheduler.onModuleInit();
    scheduler.requestRefresh();
    scheduler.requestRefresh();
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(run).toHaveBeenCalledOnce();
    await scheduler.onModuleDestroy();
  });
  it("keeps an on-demand warmup available when an external cron replaces the daily timer", async () => {
    const { run, scheduler } = setup();
    vi.stubEnv("MARKET_SCHEDULER_ENABLED", "false");
    scheduler.onModuleInit();
    scheduler.requestRefresh();
    await vi.advanceTimersByTimeAsync(50);
    expect(run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(120000);
    expect(run).toHaveBeenCalledOnce();
    await scheduler.onModuleDestroy();
  });
  it("does not overlap an active sync and runs one queued follow-up", async () => {
    const { run, scheduler } = setup();
    let complete!: () => void;
    run.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    scheduler.requestRefresh();
    await vi.advanceTimersByTimeAsync(50);
    scheduler.requestRefresh();
    scheduler.requestRefresh();
    expect(run).toHaveBeenCalledOnce();
    complete();
    await vi.advanceTimersByTimeAsync(50);
    expect(run).toHaveBeenCalledTimes(2);
    await scheduler.onModuleDestroy();
  });
  it("contains provider errors and does not start requests after shutdown or without configuration", async () => {
    const { run, scheduler } = setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    run.mockRejectedValueOnce(new Error("upstream failed"));
    scheduler.requestRefresh();
    await vi.advanceTimersByTimeAsync(50);
    expect(run).toHaveBeenCalledOnce();
    await scheduler.onModuleDestroy();
    scheduler.requestRefresh();
    await vi.advanceTimersByTimeAsync(60000);
    expect(run).toHaveBeenCalledOnce();
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", "");
    const fresh = new PriceScheduler({ run } as unknown as MarketPriceSync);
    fresh.requestRefresh();
    await vi.advanceTimersByTimeAsync(50);
    expect(run).toHaveBeenCalledOnce();
    await fresh.onModuleDestroy();
  });
});
