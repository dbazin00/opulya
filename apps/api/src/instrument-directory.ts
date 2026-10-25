import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { z, currencySchema } from "@opulya/shared";
import {
  catalogueChoices,
  exactCryptoChoices,
  InstrumentProvider,
  InstrumentsService,
  marketError,
  type InstrumentInput,
} from "./instruments.js";
import { yahooSymbol } from "./yahoo-finance.js";

export const directorySchema = z
  .object({
    search: z.string().trim().max(80).default(""),
    currency: currencySchema.default("EUR"),
    assetType: z.enum(["STOCK", "ETF", "CRYPTO", "FUND"]).optional(),
    page: z.coerce.number().int().min(0).max(50000).default(0),
  })
  .strict();
export const candidateId = (row: InstrumentInput) =>
  `yf:${row.assetType}:${row.currency}:${yahooSymbol(row)}`;
const candidatePattern =
  /^yf:(STOCK|ETF|CRYPTO|FUND):([A-Z]{3}):([A-Za-z0-9.=_-]{1,30})$/;

@Injectable()
export class InstrumentDirectory {
  constructor(
    @Inject(InstrumentProvider) private readonly external: InstrumentProvider,
    @Inject(InstrumentsService)
    private readonly instruments: InstrumentsService,
  ) {}
  async browse(query: z.infer<typeof directorySchema>, userId: string) {
    // No starter assets, bulk downloads or provider requests on an empty picker.
    let rows: (InstrumentInput & { id: string })[] = [];
    if (query.search.length >= 2) {
      try {
        rows = catalogueChoices(
          await this.external.search(
            query.search,
            query.assetType,
            query.currency,
          ),
        )
          .filter(
            (row) =>
              row.currency === query.currency &&
              (!query.assetType || row.assetType === query.assetType),
          )
          .map((row) => ({ ...row, id: candidateId(row) }));
      } catch (error) {
        throw new ServiceUnavailableException(marketError(error));
      }
    }
    const coins = rows.filter((row) => row.assetType === "CRYPTO");
    const exact = exactCryptoChoices(coins, query.search);
    if (
      exact.some(
        (row) =>
          row.name.toUpperCase() === query.search.toUpperCase() ||
          row.symbol.split("/")[0]?.toUpperCase() ===
            query.search.toUpperCase(),
      )
    )
      rows = exact;
    const available = await this.instruments.available(userId, rows);
    const pageSize = 30;
    return {
      items: available.items.slice(
        query.page * pageSize,
        (query.page + 1) * pageSize,
      ),
      total: available.items.length,
      ownedCount: available.ownedCount,
      page: query.page,
      hasMore: available.items.length > (query.page + 1) * pageSize,
    };
  }
  async resolve(id: string) {
    const match = candidatePattern.exec(id);
    if (!match || !currencySchema.safeParse(match[2]).success) {
      if (id.includes(":")) throw new NotFoundException("NOT_FOUND");
      return id;
    }
    // Revalidate provider metadata, even after a restart. Never trust client-supplied names or prices.
    try {
      const row = await this.external.resolve(match[3]!, match[2]!, match[1]!);
      return (await this.instruments.remember(row)).id;
    } catch (error) {
      throw new ServiceUnavailableException(marketError(error));
    }
  }
}
