import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DateTime } from "luxon";
import {
  accountLedger,
  cashflow,
  decimal,
  descendants,
  portfolio,
  sum,
  type z,
  filterSchema,
} from "@opulya/shared";
import { Database } from "./db.js";
import { LedgerService, monthBounds } from "./ledger.js";
import { MarketDataService } from "./market.js";

@Injectable()
export class ReportsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(MarketDataService) private readonly market: MarketDataService,
  ) {}
  async assetPrices(userId: string) {
    const assets = await this.db.asset.findMany({ where: { userId } });
    return Promise.all(
      assets.map(async (asset) => ({
        assetId: asset.id,
        ...(await this.market.getCurrentPrice(asset)),
      })),
    );
  }
  async portfolio(userId: string, accountId: string) {
    const data = await this.ledger.all(userId);
    const account = data.accounts.find(
      (a) => a.id === accountId && a.type === "INVESTMENT",
    );
    if (!account) throw new NotFoundException("NOT_FOUND");
    const entries = data.investments.filter((t) => t.accountId === accountId);
    const assets = await this.db.asset.findMany({
      where: {
        userId,
        id: {
          in: [
            ...new Set(entries.flatMap((e) => (e.assetId ? [e.assetId] : []))),
          ],
        },
      },
    });
    const base = portfolio(entries);
    const quotes = await Promise.all(
      assets.map(async (asset) => ({
        assetId: asset.id,
        ...(base.positions.find((p) => p.assetId === asset.id)?.quantity === "0"
          ? { quote: null, error: null }
          : await this.market.getCurrentPrice(asset)),
      })),
    );
    const result = portfolio(
      entries,
      Object.fromEntries(
        quotes.map((q) => [q.assetId, q.quote?.price ?? null]),
      ),
    );
    const cash = account.currentBalance;
    return {
      ...result,
      account,
      assets,
      quotes,
      cashBalance: cash,
      totalValue:
        result.holdingsValue === null
          ? null
          : decimal(cash).add(result.holdingsValue).toFixed(),
      asOf: new Date().toISOString(),
    };
  }
  async analytics(
    userId: string,
    query: z.infer<typeof filterSchema>,
    timeZone: string,
  ) {
    const data = await this.ledger.all(userId);
    const bounds = monthBounds(query.month, timeZone);
    const transactions = this.ledger.filter(
      data.transactions,
      data.categories,
      { ...query, type: undefined },
      timeZone,
    );
    const type = query.type === "INCOME" ? "INCOME" : "EXPENSE";
    const parent = query.parentId
      ? data.categories.find((c) => c.id === query.parentId && c.type === type)
      : null;
    if (query.parentId && !parent) throw new NotFoundException("NOT_FOUND");
    const children = data.categories.filter(
      (c) => c.parentId === (query.parentId ?? null) && c.type === type,
    );
    const distribution = children.map((c) => {
      const ids = descendants(data.categories, c.id);
      return {
        id: c.id,
        name: c.name,
        defaultKey: c.defaultKey,
        hasChildren: data.categories.some((child) => child.parentId === c.id),
        amount: sum(
          transactions
            .filter(
              (t) => t.type === type && t.categoryId && ids.has(t.categoryId),
            )
            .map((t) => t.amount),
        ),
      };
    });
    const direct = sum(
      transactions
        .filter(
          (t) => t.type === type && t.categoryId === (query.parentId ?? null),
        )
        .map((t) => t.amount),
    );
    const start = DateTime.fromISO(bounds.from).setZone(timeZone);
    const days = Array.from({ length: start.daysInMonth! }, (_, i) => {
      const date = start.plus({ days: i }).toISODate()!;
      const dayTx = transactions.filter(
        (t) =>
          DateTime.fromISO(t.occurredAt).setZone(timeZone).toISODate() === date,
      );
      return { date, ...cashflow(dayTx), count: dayTx.length };
    });
    const trends = Array.from({ length: 6 }, (_, i) => {
      const month = start.minus({ months: 5 - i });
      const from = month.toUTC().toISO()!,
        to = month.plus({ months: 1 }).toUTC().toISO()!;
      const tx = data.transactions.filter(
        (t) =>
          t.currency === query.currency &&
          (!query.accountId ||
            t.sourceAccountId === query.accountId ||
            t.destinationAccountId === query.accountId),
      );
      const accounts = data.accounts.filter(
        (a) =>
          a.currency === query.currency &&
          (!query.accountId || a.id === query.accountId),
      );
      const balance = sum(
        accounts.map(
          (a) =>
            accountLedger(
              a.id,
              a.initialBalance,
              tx.filter((t) => t.occurredAt < to),
              data.investments.filter((t) => t.executedAt < to),
            ).at(-1)?.balanceAfter ?? a.initialBalance,
        ),
      );
      return {
        month: month.toFormat("yyyy-MM"),
        ...cashflow(
          tx.filter((t) => t.occurredAt >= from && t.occurredAt < to),
        ),
        balance,
      };
    });
    return {
      ...bounds,
      ...cashflow(transactions),
      days,
      trends,
      distribution,
      direct,
      parent,
      accounts: data.accounts
        .filter((a) => a.currency === query.currency)
        .map((a) => ({
          id: a.id,
          name: a.name,
          ...cashflow(
            transactions.filter(
              (t) =>
                t.sourceAccountId === a.id || t.destinationAccountId === a.id,
            ),
          ),
        })),
    };
  }
  async overview(userId: string, currency: string) {
    const data = await this.ledger.all(userId);
    const accounts = data.accounts.filter((a) => a.currency === currency);
    const values = await Promise.all(
      accounts
        .filter((a) => a.type === "INVESTMENT")
        .map((a) => this.portfolio(userId, a.id)),
    );
    const cash = sum(accounts.map((a) => a.currentBalance));
    const investments = values.every((p) => p.holdingsValue !== null)
      ? sum(values.map((p) => p.holdingsValue!))
      : null;
    return {
      accounts,
      cash,
      investments,
      netWorth:
        investments === null ? null : decimal(cash).add(investments).toFixed(),
      incomplete: investments === null,
      stale: values.some((p) => p.quotes.some((q) => q.quote?.stale)),
      currency,
    };
  }
}
