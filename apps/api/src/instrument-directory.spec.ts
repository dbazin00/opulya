import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InstrumentDirectory,
  directorySchema,
  referenceEntries,
} from "./instrument-directory.js";
import type {
  InstrumentProvider,
  InstrumentsService,
  InstrumentInput,
} from "./instruments.js";
import type { Database } from "./db.js";
import type { ReferenceCache, ReferenceSnapshot } from "./reference-cache.js";

afterEach(() => {
  vi.unstubAllEnvs();
});
const stock = {
  symbol: "EXM",
  name: "Example stock",
  currency: "USD",
  exchange: "United States",
  mic_code: "",
  type: "Common Stock",
  exchange_timezone: "America/New_York",
};
const etf = { ...stock, symbol: "ETF1", name: "Example ETF", type: "ETF" };
const crypto = {
  symbol: "BTC/USD",
  currency_base: "Bitcoin",
  available_exchanges: ["Alpha Vantage"],
};
function fixture() {
  const references = vi.fn(async (type: string) =>
    type === "STOCK"
      ? [stock]
      : type === "ETF"
        ? [etf]
        : type === "CRYPTO"
          ? [crypto, { ...crypto, symbol: "BTC/EUR" }]
          : [],
  );
  const remember = vi.fn(async () => ({ id: "stored" }));
  const list = vi.fn(
    async (): Promise<(InstrumentInput & { id: string })[]> => [],
  );
  const known = vi.fn(async (): Promise<{ id: string }[]> => []);
  const available = vi.fn(async (_userId: string, rows: { id: string }[]) => ({
    items: rows,
    ownedCount: 0,
  }));
  const saved = new Map<string, ReferenceSnapshot>();
  const snapshots = {
    read: vi.fn(async (type: string) => saved.get(type) ?? null),
    refresh: vi.fn(
      async (
        type: string,
        retrieve: () => Promise<ReferenceSnapshot["rows"]>,
      ) => {
        const snapshot = { rows: await retrieve(), fetchedAt: new Date() };
        saved.set(type, snapshot);
        return snapshot;
      },
    ),
  };
  const service = new InstrumentDirectory(
    {
      instrument: { findUnique: vi.fn(async () => null), findMany: known },
    } as unknown as Database,
    { references } as unknown as InstrumentProvider,
    { list, remember, available } as unknown as InstrumentsService,
    snapshots as unknown as ReferenceCache,
  );
  return {
    service,
    references,
    remember,
    available,
    known,
    snapshots,
    saved,
    list,
  };
}
async function ready(
  service: InstrumentDirectory,
  body: Record<string, unknown> = {},
) {
  const query = directorySchema.parse({ currency: "USD", ...body });
  for (let i = 0; i < 100; i++) {
    const result = await service.browse(query, "user-a");
    if (!result.loading.length) return result;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Fixture catalogue did not finish");
}
describe("Alpha Vantage reference directory", () => {
  it("warms only the public crypto reference without consuming stock searches", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", "fixture-key");
    const f = fixture();
    f.service.onModuleInit();
    await ready(f.service, { currency: "EUR", assetType: "CRYPTO" });
    expect(f.references).toHaveBeenCalledOnce();
    expect(f.references).toHaveBeenCalledWith("CRYPTO");
    expect(f.remember).not.toHaveBeenCalled();
  });
  it("reads persistent US stock/ETF and coin snapshots without downloading again", async () => {
    const f = fixture();
    for (const type of ["STOCK", "ETF", "CRYPTO"] as const)
      f.saved.set(type, {
        rows: referenceEntries(
          type,
          type === "STOCK" ? [stock] : type === "ETF" ? [etf] : [crypto],
        ),
        fetchedAt: new Date(),
      });
    expect((await ready(f.service)).total).toBe(3);
    expect(f.references).not.toHaveBeenCalled();
    expect(f.snapshots.refresh).not.toHaveBeenCalled();
    expect(f.list).not.toHaveBeenCalled();
  });
  it("does not pretend to have a bulk European or fund catalogue", async () => {
    const f = fixture();
    expect(
      (await ready(f.service, { currency: "EUR", assetType: "ETF" })).total,
    ).toBe(0);
    expect(
      (await ready(f.service, { currency: "USD", assetType: "FUND" })).total,
    ).toBe(0);
    expect(f.references).not.toHaveBeenCalled();
  });
  it("bounds US reference downloads to two concurrent feeds", async () => {
    const f = fixture();
    let active = 0,
      peak = 0;
    f.references.mockImplementation(async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return [];
    });
    await ready(f.service);
    expect(peak).toBe(2);
  });
  it("filters only the requesting user's assets before pagination", async () => {
    const f = fixture();
    f.available.mockImplementation(async (userId, rows) => ({
      items: userId === "user-a" ? [] : rows,
      ownedCount: userId === "user-a" ? rows.length : 0,
    }));
    const owned = await ready(f.service);
    expect(owned.total).toBe(0);
    expect(owned.ownedCount).toBe(3);
    expect(owned.hasMore).toBe(false);
    const other = await f.service.browse(
      directorySchema.parse({ currency: "USD" }),
      "user-b",
    );
    expect(other.total).toBe(3);
    expect(other.ownedCount).toBe(0);
    expect(directorySchema.safeParse({ mode: "match" }).success).toBe(false);
  });
  it("shows genuine US stocks, ETFs and crypto without saving or pricing every reference", async () => {
    const f = fixture();
    const result = await ready(f.service);
    expect(new Set(result.items.map((row) => row.assetType))).toEqual(
      new Set(["STOCK", "ETF", "CRYPTO"]),
    );
    expect(f.references).toHaveBeenCalledTimes(3);
    expect(f.remember).not.toHaveBeenCalled();
    await ready(f.service);
    expect(f.references).toHaveBeenCalledTimes(3);
    await f.service.onModuleDestroy();
  });
  it("keeps one coin per quote currency and rejects malformed source metadata", () => {
    expect(referenceEntries("CRYPTO", [crypto])).toMatchObject([
      { symbol: "BTC/USD", exchange: "Alpha Vantage" },
    ]);
    expect(
      referenceEntries("STOCK", [
        { ...stock, currency: "GBX" },
        { ...stock, symbol: "BAD?" },
      ]),
    ).toHaveLength(0);
  });
  it("separates currencies and pages genuine US references beyond forty results", async () => {
    const f = fixture();
    f.references.mockImplementation(async () =>
      Array.from({ length: 90 }, (_, i) => ({
        ...etf,
        symbol: "ETF" + i,
        name: "ETF " + String(i).padStart(3, "0"),
      })).concat([{ ...etf, currency: "EUR" }]),
    );
    const first = await ready(f.service, { assetType: "ETF" });
    const second = await ready(f.service, { assetType: "ETF", page: 1 });
    expect(first.total).toBe(90);
    expect(first.items).toHaveLength(40);
    expect(first.hasMore).toBe(true);
    expect(second.items).toHaveLength(40);
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
    expect(first.items.every((row) => row.currency === "USD")).toBe(true);
    expect(
      (await ready(f.service, { assetType: "ETF", search: "ETF 089" })).total,
    ).toBe(1);
  });
  it("resolves only the chosen reference without a second billed lookup", async () => {
    const f = fixture();
    const result = await ready(f.service, { assetType: "STOCK" });
    expect(result.items[0]!.id.length).toBeLessThanOrEqual(64);
    expect(await f.service.resolve(result.items[0]!.id)).toBe("stored");
    expect(f.remember).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "EXM",
        currency: "USD",
        timeZone: "America/New_York",
      }),
    );
    expect(f.remember).toHaveBeenCalledOnce();
  });
  it("coalesces concurrent selection of the same reference", async () => {
    const f = fixture();
    const result = await ready(f.service, { assetType: "STOCK" });
    expect(
      await Promise.all([
        f.service.resolve(result.items[0]!.id),
        f.service.resolve(result.items[0]!.id),
      ]),
    ).toEqual(["stored", "stored"]);
    expect(f.remember).toHaveBeenCalledOnce();
  });
  it("uses cached global-search instrument rows for supported funds", async () => {
    const f = fixture();
    f.list.mockResolvedValue([
      {
        id: "fund",
        symbol: "FXAIX",
        name: "Fund",
        assetType: "FUND",
        exchange: "United States",
        mic: "",
        currency: "USD",
        timeZone: "America/New_York",
        isin: null,
      },
    ]);
    const result = await ready(f.service, {
      assetType: "FUND",
      search: "Fund",
    });
    expect(result.items[0]!.id).toBe("fund");
    expect(f.references).not.toHaveBeenCalled();
  });
  it("rejects forged or retired reference keys", async () => {
    const f = fixture();
    await ready(f.service);
    for (const prefix of ["av", "td"])
      await expect(
        f.service.resolve(prefix + ":STOCK:USD:" + "a".repeat(48)),
      ).rejects.toThrow("NOT_FOUND");
    expect(f.remember).not.toHaveBeenCalled();
  });
  it("an exact Bitcoin lookup does not substitute a Bitcoin fund", async () => {
    const f = fixture();
    f.references.mockImplementation(async (type) =>
      type === "CRYPTO"
        ? [crypto]
        : [{ ...etf, name: "Bitcoin ETF", symbol: "BTC" }],
    );
    const result = await ready(f.service, { search: "Bitcoin" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.assetType).toBe("CRYPTO");
  });
});
