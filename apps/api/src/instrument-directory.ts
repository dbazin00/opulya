import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { z } from "@opulya/shared";
import { Database } from "./db.js";
import {
  catalogueChoices,
  exactCryptoChoices,
  instrumentIdentity,
  InstrumentProvider,
  InstrumentsService,
  marketError,
  searchInstrument,
  type InstrumentInput,
} from "./instruments.js";
import {
  ReferenceCache,
  directoryTypes,
  referenceFresh,
  type DirectoryType,
} from "./reference-cache.js";

export { directoryTypes };
type Entry = InstrumentInput;
type Candidate = Entry & { id: string };
export const directorySchema = z
  .object({
    search: z.string().trim().max(80).default(""),
    currency: z
      .enum(["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "JPY"])
      .default("EUR"),
    assetType: z.enum(directoryTypes).optional(),
    page: z.coerce.number().int().min(0).max(50000).default(0),
  })
  .strict();
const cryptoReference = z.object({
  symbol: z.string(),
  currency_base: z.string(),
  available_exchanges: z.array(z.string()).max(500),
});
const securityReference = z.object({
  symbol: z.string(),
  name: z.string(),
  currency: z.string(),
  exchange: z.string(),
  mic_code: z.string().default(""),
  type: z.string().optional(),
  isin: z.string().optional(),
  exchange_timezone: z.string().default("UTC"),
});
export function referenceEntries(
  type: DirectoryType,
  values: unknown[],
): Entry[] {
  const rows: Entry[] = [];
  for (const value of values) {
    if (type === "CRYPTO") {
      const row = cryptoReference.safeParse(value);
      if (!row.success) continue;
      const currency = row.data.symbol.split("/")[1];
      const variants = row.data.available_exchanges.flatMap((exchange) => {
        const parsed = searchInstrument({
          symbol: row.data.symbol,
          instrument_name: row.data.currency_base,
          instrument_type: "Digital Currency",
          exchange,
          currency,
          exchange_timezone: "UTC",
        });
        return parsed ? [parsed] : [];
      });
      rows.push(...catalogueChoices(variants));
    } else {
      const row = securityReference.safeParse(value);
      if (!row.success) continue;
      const parsed = searchInstrument({
        ...row.data,
        instrument_name: row.data.name,
        instrument_type:
          row.data.type ||
          (type === "ETF"
            ? "ETF"
            : type === "FUND"
              ? "Mutual Fund"
              : "Common Stock"),
      });
      if (parsed) rows.push(parsed);
    }
  }
  const unique = new Map(rows.map((row) => [instrumentIdentity(row), row]));
  return [...unique.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name, "en") ||
      a.symbol.localeCompare(b.symbol, "en") ||
      a.exchange.localeCompare(b.exchange, "en"),
  );
}
const entryId = (feed: DirectoryType, row: Entry) =>
  `av:${feed}:${row.currency}:${instrumentIdentity(row).slice(0, 48)}`;
const candidatePattern =
  /^av:(STOCK|ETF|CRYPTO|FUND):(EUR|USD|GBP|CHF|CAD|AUD|JPY):([a-f0-9]{48})$/;
const cacheKey = (type: DirectoryType, currency: string) =>
  `${type}:${currency}`;

@Injectable()
export class InstrumentDirectory implements OnModuleInit, OnModuleDestroy {
  private readonly cache = new Map<
    string,
    { at: number; rows: Candidate[]; byId: Map<string, Candidate> }
  >();
  private readonly queries = new Map<string, Candidate[]>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly resolving = new Map<string, Promise<string>>();
  private readonly failures = new Map<string, { at: number; code: string }>();
  private activeLoads = 0;
  private readonly waiting: (() => void)[] = [];
  private stopped = false;
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(InstrumentProvider) private readonly external: InstrumentProvider,
    @Inject(InstrumentsService)
    private readonly instruments: InstrumentsService,
    @Inject(ReferenceCache) private readonly snapshots: ReferenceCache,
  ) {}
  onModuleInit() {
    if (
      process.env.NODE_ENV === "test" ||
      !process.env.ALPHA_VANTAGE_API_KEY?.trim()
    )
      return;
    // Warm public metadata before the picker is opened; never retrieve catalogue-wide prices.
    for (const type of ["CRYPTO"] as const) this.start(type, "EUR");
  }
  private publish(
    type: DirectoryType,
    currency: string,
    values: InstrumentInput[],
    at: Date,
  ) {
    const key = cacheKey(type, currency);
    const rows = values
      .filter((row) => row.currency === currency)
      .map((row) => ({ ...row, id: entryId(type, row) }));
    if (!this.cache.has(key) && this.cache.size >= 8)
      this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, {
      at: at.getTime(),
      rows,
      byId: new Map(rows.map((row) => [row.id, row])),
    });
    this.queries.clear();
  }
  private async download(type: DirectoryType, currency: string) {
    if (type === "FUND" || (type !== "CRYPTO" && currency !== "USD")) {
      this.publish(type, currency, [], new Date());
      return;
    }
    const saved = await this.snapshots.read(type, currency);
    if (saved) {
      this.publish(type, currency, saved.rows, saved.fetchedAt);
      if (referenceFresh(saved.fetchedAt)) return;
    }
    if (this.activeLoads >= 2)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.activeLoads++;
    try {
      if (this.stopped) return;
      const snapshot = await this.snapshots.refresh(type, async () =>
        referenceEntries(type, await this.external.references(type)),
      );
      this.publish(type, currency, snapshot.rows, snapshot.fetchedAt);
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.activeLoads--;
    }
  }
  private start(type: DirectoryType, currency: string) {
    const key = cacheKey(type, currency);
    if (
      this.stopped ||
      this.pending.has(key) ||
      (this.cache.get(key)?.at ?? 0) > Date.now() - 86400000 ||
      (this.failures.get(key)?.at ?? 0) > Date.now() - 60000
    )
      return;
    const work = this.download(type, currency)
      .then(() => {
        this.failures.delete(key);
      })
      .catch((error) => {
        this.failures.set(key, { at: Date.now(), code: marketError(error) });
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, work);
  }
  async browse(query: z.infer<typeof directorySchema>, userId: string) {
    const feeds = query.assetType ? [query.assetType] : directoryTypes;
    for (const type of feeds) this.start(type, query.currency);
    const local = query.search
      ? await this.instruments.list({
          search: query.search,
          currency: query.currency,
          ...(query.assetType ? { assetType: query.assetType } : {}),
        })
      : [];
    const key = JSON.stringify([
      query.search.toUpperCase(),
      query.currency,
      query.assetType,
      feeds.map(
        (type) => this.cache.get(cacheKey(type, query.currency))?.at ?? 0,
      ),
      local.map((row) => row.id),
    ]);
    let rows = this.queries.get(key);
    if (!rows) {
      const entries = new Map<string, Candidate>();
      const queryText = query.search.toUpperCase();
      for (const row of local)
        entries.set(instrumentIdentity(row).slice(0, 48), row);
      for (const type of feeds) {
        for (const row of this.cache.get(cacheKey(type, query.currency))
          ?.rows ?? []) {
          if (
            row.currency !== query.currency ||
            (query.assetType && row.assetType !== query.assetType) ||
            ![row.name, row.symbol, row.isin ?? ""].some((value) =>
              value.toUpperCase().includes(queryText),
            )
          )
            continue;
          const identity = row.id.slice(row.id.lastIndexOf(":") + 1);
          if (!entries.has(identity)) entries.set(identity, row);
        }
      }
      rows = catalogueChoices([...entries.values()]).sort(
        (a, b) =>
          a.name.localeCompare(b.name, "en") ||
          a.exchange.localeCompare(b.exchange, "en"),
      );
      if (this.queries.size >= 20)
        this.queries.delete(this.queries.keys().next().value!);
      this.queries.set(key, rows);
    }
    const queryText = query.search.toUpperCase();
    const exactCoins = exactCryptoChoices(
      rows.filter((row) => row.assetType === "CRYPTO"),
      query.search,
    );
    const hasExactCoin =
      query.search &&
      exactCoins.some(
        (row) =>
          row.name.toUpperCase() === queryText ||
          row.symbol.split("/")[0]?.toUpperCase() === queryText,
      );
    if (hasExactCoin && (!query.assetType || query.assetType === "CRYPTO"))
      rows = exactCoins;
    // Tenant filtering stays outside the shared metadata cache and happens before pagination.
    const available = await this.instruments.available(userId, rows);
    rows = available.items;
    const perType = query.assetType || hasExactCoin ? 40 : 10;
    const groups = directoryTypes.map((type) => ({
      type,
      rows: rows.filter((row) => row.assetType === type),
    }));
    return {
      items: groups.flatMap((group) =>
        group.rows.slice(query.page * perType, (query.page + 1) * perType),
      ),
      total: rows.length,
      ownedCount: available.ownedCount,
      page: query.page,
      hasMore: groups.some(
        (group) => group.rows.length > (query.page + 1) * perType,
      ),
      loading: feeds.filter((type) =>
        this.pending.has(cacheKey(type, query.currency)),
      ),
      errors: feeds.flatMap((type) => {
        const failure = this.failures.get(cacheKey(type, query.currency));
        return failure ? [{ type, code: failure.code }] : [];
      }),
    };
  }
  async resolve(id: string) {
    if (!candidatePattern.test(id)) {
      if (id.startsWith("td:") || id.startsWith("av:"))
        throw new NotFoundException("NOT_FOUND");
      return id;
    }
    const active = this.resolving.get(id);
    if (active) return active;
    const work = this.resolveReference(id).finally(() =>
      this.resolving.delete(id),
    );
    this.resolving.set(id, work);
    return work;
  }
  private async resolveReference(id: string) {
    const match = candidatePattern.exec(id);
    if (!match) return id;
    const type = match[1] as DirectoryType;
    const currency = match[2]!;
    const key = cacheKey(type, currency);
    this.start(type, currency);
    await this.pending.get(key);
    const row = this.cache.get(key)?.byId.get(id);
    if (!row) throw new NotFoundException("NOT_FOUND");
    const existing = await this.db.instrument.findUnique({
      where: { identity: instrumentIdentity(row) },
    });
    if (existing) return (await this.instruments.remember(row)).id;
    if (!row.mic && row.assetType !== "CRYPTO") {
      const known = await this.db.instrument.findMany({
        where: {
          symbol: row.symbol,
          assetType: row.assetType,
          currency: row.currency,
          exchange: row.exchange,
        },
        take: 2,
      });
      if (known.length === 1) return known[0]!.id;
      if (known.length > 1)
        throw new ServiceUnavailableException("MARKET_IDENTITY_MISMATCH");
    }
    let verified: InstrumentInput | undefined;
    if (row.assetType === "CRYPTO" || row.currency === "USD")
      verified = { ...row };
    else {
      let candidates: InstrumentInput[];
      try {
        candidates = await this.external.search(
          row.symbol,
          row.assetType,
          row.currency,
        );
      } catch (error) {
        throw new ServiceUnavailableException(marketError(error));
      }
      const exact = candidates.filter(
        (item) =>
          item.symbol.toUpperCase() === row.symbol.toUpperCase() &&
          item.assetType === row.assetType &&
          item.currency === row.currency &&
          item.exchange.toUpperCase() === row.exchange.toUpperCase() &&
          (!row.mic || item.mic === row.mic),
      );
      const unique = new Map(
        exact.map((item) => [instrumentIdentity(item), item]),
      );
      if (unique.size === 1) verified = [...unique.values()][0];
    }
    if (!verified)
      throw new ServiceUnavailableException("MARKET_IDENTITY_MISMATCH");
    return (await this.instruments.remember(verified)).id;
  }
  async onModuleDestroy() {
    this.stopped = true;
    await Promise.allSettled(this.pending.values());
    await Promise.allSettled(this.resolving.values());
  }
}
