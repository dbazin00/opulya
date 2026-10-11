import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { ReferenceCache, referenceCacheId } from "./reference-cache.js";
import type { Database } from "./db.js";

const row = {
  symbol: "EXM",
  name: "Example ETF",
  assetType: "ETF" as const,
  currency: "EUR",
  exchange: "XETRA",
  mic: "XETR",
  isin: null,
  timeZone: "UTC",
};
function fixture() {
  let saved: { version: number; payload: Uint8Array; fetchedAt: Date } | null =
    null;
  const findUnique = vi.fn(async () => saved);
  const upsert = vi.fn(async ({ create }) => {
    saved = create;
    return saved;
  });
  const release = vi.fn(async () => ({ count: 1 }));
  const db = {
    instrumentDirectoryCache: { findUnique, upsert },
    marketJob: { upsert: vi.fn(async () => ({})), updateMany: release },
  };
  const service = new ReferenceCache(db as unknown as Database);
  return {
    service,
    findUnique,
    upsert,
    release,
    db,
    save: (value: typeof saved) => {
      saved = value;
    },
  };
}
describe("persistent public reference snapshots", () => {
  it("hydrates only the selected currency without redownloading the stored feed", async () => {
    const f = fixture();
    f.save({
      version: 1,
      payload: gzipSync(JSON.stringify([row, { ...row, currency: "USD" }])),
      fetchedAt: new Date(),
    });
    expect((await f.service.read("ETF", "EUR"))?.rows).toEqual([row]);
    expect((await f.service.read("ETF", "USD"))?.rows).toEqual([
      { ...row, currency: "USD" },
    ]);
    expect(f.upsert).not.toHaveBeenCalled();
    expect(f.release).not.toHaveBeenCalled();
  });
  it("persists compressed metadata and reuses it through a new service without provider calls", async () => {
    const f = fixture(),
      retrieve = vi.fn(async () => [row]);
    await f.service.refresh("ETF", retrieve);
    const restarted = new ReferenceCache(f.db as unknown as Database);
    expect((await restarted.read("ETF"))?.rows).toEqual([row]);
    expect((await restarted.refresh("ETF", retrieve)).rows).toEqual([row]);
    expect(retrieve).toHaveBeenCalledOnce();
    expect(f.upsert).toHaveBeenCalledOnce();
    expect(f.release).toHaveBeenCalledTimes(2);
    expect(f.upsert.mock.calls[0]![0].create.id).toBe(referenceCacheId("ETF"));
  });
  it("returns stale metadata immediately and preserves the saved snapshot when refresh fails", async () => {
    const f = fixture();
    const date = new Date(Date.now() - 25 * 3600000);
    f.save({
      version: 1,
      payload: gzipSync(JSON.stringify([row])),
      fetchedAt: date,
    });
    expect((await f.service.read("ETF"))?.rows).toEqual([row]);
    await expect(
      f.service.refresh("ETF", async () => {
        throw new Error("MARKET_UNAVAILABLE");
      }),
    ).rejects.toThrow("MARKET_UNAVAILABLE");
    expect((await f.service.read("ETF"))?.fetchedAt).toEqual(date);
    expect(f.release).toHaveBeenCalledTimes(2);
    expect(f.upsert).not.toHaveBeenCalled();
  });
  it("rejects malformed, wrong-version or future snapshots and unvalidated metadata", async () => {
    const f = fixture();
    for (const value of [
      { version: 2, payload: gzipSync("[]"), fetchedAt: new Date() },
      { version: 1, payload: Buffer.from("not gzip"), fetchedAt: new Date() },
      {
        version: 1,
        payload: gzipSync(JSON.stringify([{ ...row, currency: "BAD" }])),
        fetchedAt: new Date(),
      },
      {
        version: 1,
        payload: gzipSync("[]"),
        fetchedAt: new Date(Date.now() + 600000),
      },
    ]) {
      f.save(value);
      expect(await f.service.read("ETF")).toBeNull();
    }
    f.save(null);
    await expect(
      f.service.refresh("ETF", async () => [{ ...row, currency: "BAD" }]),
    ).rejects.toThrow();
    expect(f.upsert).not.toHaveBeenCalled();
  });
  it("a worker waiting on another publisher reuses its snapshot rather than retrieving the feed", async () => {
    const f = fixture();
    f.release.mockResolvedValue({ count: 0 });
    const retrieve = vi.fn(async () => [row]);
    vi.useFakeTimers();
    try {
      const pending = f.service.refresh("ETF", retrieve);
      await vi.advanceTimersByTimeAsync(1);
      f.save({
        version: 1,
        payload: gzipSync(JSON.stringify([row])),
        fetchedAt: new Date(),
      });
      await vi.advanceTimersByTimeAsync(2000);
      expect((await pending).rows).toEqual([row]);
      expect(retrieve).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
