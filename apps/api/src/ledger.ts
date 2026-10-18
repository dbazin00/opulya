import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import {
  accountLedger,
  accountSchema,
  accountUpdateSchema,
  balanceAdjustmentSchema,
  cashflow,
  categorySchema,
  categoryUpdateSchema,
  descendants,
  decimal,
  filterSchema,
  investmentSchema,
  portfolio,
  transactionSchema,
  validateParent,
  type InvestmentEntry,
  type LedgerTransaction,
  z,
} from "@opulya/shared";
import { Database, type DbTransaction } from "./db.js";
import type {
  InvestmentTransaction,
  Transaction,
} from "./generated/prisma/client.js";

export const serializeTransaction = (t: Transaction) => ({
  ...t,
  amount: t.amount.toFixed(),
  sourceBalanceAfter: t.sourceBalanceAfter?.toFixed() ?? null,
  destinationBalanceAfter: t.destinationBalanceAfter?.toFixed() ?? null,
  occurredAt: t.occurredAt.toISOString(),
  ledgerOrderAt: t.ledgerOrderAt?.toISOString() ?? null,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
  voidedAt: t.voidedAt?.toISOString() ?? null,
});
export const serializeInvestment = (t: InvestmentTransaction) => ({
  ...t,
  totalAmount: t.totalAmount.toFixed(),
  quantity: t.quantity?.toFixed() ?? null,
  pricePerUnit: t.pricePerUnit?.toFixed() ?? null,
  fee: t.fee.toFixed(),
  balanceAfter: t.balanceAfter?.toFixed() ?? null,
  executedAt: t.executedAt.toISOString(),
  ledgerOrderAt: t.ledgerOrderAt?.toISOString() ?? null,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
  voidedAt: t.voidedAt?.toISOString() ?? null,
});
export function monthBounds(month: string | undefined, timeZone: string) {
  const start = month
    ? DateTime.fromISO(`${month}-01`, { zone: timeZone })
    : DateTime.now().setZone(timeZone).startOf("month");
  if (!start.isValid) throw new BadRequestException("INVALID_DATE");
  return {
    from: start.toUTC().toISO()!,
    to: start.plus({ months: 1 }).toUTC().toISO()!,
    month: start.toFormat("yyyy-MM"),
  };
}
export async function ownedAccount(
  tx: DbTransaction,
  userId: string,
  id: string,
  active = true,
) {
  const account = await tx.account.findFirst({
    where: { id, userId, ...(active ? { archivedAt: null } : {}) },
  });
  if (!account) throw new NotFoundException("NOT_FOUND");
  return account;
}
@Injectable()
export class LedgerService {
  constructor(@Inject(Database) private readonly db: Database) {}
  private transactionWrite(
    userId: string,
    action: (
      tx: DbTransaction,
    ) => Promise<ReturnType<typeof serializeTransaction>>,
  ) {
    return this.db.financial(userId, action, async (tx, result) =>
      serializeTransaction(
        await tx.transaction.findUniqueOrThrow({
          where: { id: result.id, userId },
        }),
      ),
    );
  }
  async createAccount(userId: string, body: unknown) {
    const { recordInitialBalance, ...input } = accountSchema.parse(body);
    return this.db.financial(userId, async (tx) => {
      const account = await tx.account.create({
        data: {
          ...input,
          userId,
          initialBalance: recordInitialBalance ? "0" : input.initialBalance,
        },
      });
      if (recordInitialBalance) {
        const opening = decimal(input.initialBalance);
        await tx.transaction.create({
          data: {
            userId,
            type: "ADJUSTMENT",
            isOpeningBalance: true,
            sourceAccountId: opening.isNegative() ? account.id : null,
            destinationAccountId: opening.isNegative() ? null : account.id,
            amount: opening.abs().toFixed(),
            currency: account.currency,
            occurredAt: account.createdAt,
            clientRequestId: randomUUID(),
          },
        });
      }
      return {
        ...account,
        initialBalance: account.initialBalance.toFixed(),
        currentBalance: decimal(input.initialBalance).toFixed(),
        canDelete: !recordInitialBalance,
        canChangeInvestmentType: true,
      };
    });
  }
  async updateAccount(userId: string, id: string, body: unknown) {
    const input = accountUpdateSchema.parse(body);
    return this.db.atomic(userId, async (tx) => {
      const account = await ownedAccount(tx, userId, id, false);
      if (
        input.type &&
        input.type !== account.type &&
        (input.type === "INVESTMENT" || account.type === "INVESTMENT")
      ) {
        const activity = await tx.investmentTransaction.findFirst({
          where: {
            userId,
            OR: [
              { accountId: id },
              { fundingTransaction: { sourceAccountId: id } },
            ],
          },
          select: { id: true },
        });
        if (activity)
          throw new ConflictException("ACCOUNT_TYPE_HAS_INVESTMENTS");
      }
      return tx.account.update({
        where: { id, userId },
        data: {
          name: input.name,
          ...(input.type ? { type: input.type } : {}),
          ...(input.archived === undefined
            ? {}
            : { archivedAt: input.archived ? new Date() : null }),
        },
      });
    });
  }
  async removeAccount(userId: string, id: string) {
    return this.db.atomic(userId, async (tx) => {
      await ownedAccount(tx, userId, id, false);
      const transaction = await tx.transaction.findFirst({
        where: {
          userId,
          OR: [{ sourceAccountId: id }, { destinationAccountId: id }],
        },
        select: { id: true },
      });
      const investment = await tx.investmentTransaction.findFirst({
        where: { userId, accountId: id },
        select: { id: true },
      });
      if (transaction || investment)
        throw new ConflictException("ACCOUNT_HAS_TRANSACTIONS");
      await tx.account.delete({ where: { id, userId } });
      return { ok: true };
    });
  }
  async all(userId: string) {
    const [accounts, transactions, investments, categories] =
      await this.db.$transaction(
        [
          this.db.account.findMany({
            where: { userId },
            orderBy: { createdAt: "asc" },
            include: {
              _count: {
                select: { outgoing: true, incoming: true, investments: true },
              },
              outgoing: {
                where: { investmentActivity: { isNot: null } },
                select: { id: true },
                take: 1,
              },
            },
          }),
          this.db.transaction.findMany({ where: { userId, voidedAt: null } }),
          this.db.investmentTransaction.findMany({
            where: { userId, voidedAt: null },
          }),
          this.db.category.findMany({
            where: { userId },
            orderBy: { createdAt: "asc" },
          }),
        ],
        { isolationLevel: "RepeatableRead" },
      );
    const activityByFunding = new Map(
      investments
        .filter((entry) => entry.fundingTransactionId)
        .map((entry) => [entry.fundingTransactionId, entry.id]),
    );
    const standard = transactions.map((entry) => ({
      ...serializeTransaction(entry),
      investmentActivityId: activityByFunding.get(entry.id) ?? null,
    }));
    const investment = investments.map(serializeInvestment);
    return {
      accounts: accounts.map(({ _count, outgoing, ...a }) => {
        const ledger = accountLedger(
          a.id,
          a.initialBalance.toFixed(),
          standard,
          investment,
        );
        return {
          ...a,
          initialBalance: a.initialBalance.toFixed(),
          currentBalance:
            ledger.at(-1)?.balanceAfter ?? a.initialBalance.toFixed(),
          canDelete:
            _count.incoming + _count.outgoing + _count.investments === 0,
          canChangeInvestmentType:
            _count.investments === 0 && outgoing.length === 0,
        };
      }),
      transactions: standard,
      investments: investment,
      categories,
    };
  }
  async createTransaction(userId: string, body: unknown) {
    const input = transactionSchema.parse(body);
    return this.transactionWrite(userId, async (tx) => {
      const existing = await tx.transaction.findUnique({
        where: {
          userId_clientRequestId: {
            userId,
            clientRequestId: input.clientRequestId,
          },
        },
      });
      if (existing) {
        if (
          existing.type === "ADJUSTMENT" ||
          (await tx.investmentTransaction.findFirst({
            where: { userId, fundingTransactionId: existing.id },
          }))
        )
          throw new ConflictException("CONFLICT");
        return serializeTransaction(existing);
      }
      for (const id of [
        input.sourceAccountId,
        input.destinationAccountId,
      ].filter((v): v is string => !!v)) {
        const account = await ownedAccount(tx, userId, id);
        if (account.currency !== input.currency)
          throw new BadRequestException("CURRENCY_MISMATCH");
      }
      if (input.categoryId) {
        const category = await tx.category.findFirst({
          where: {
            id: input.categoryId,
            userId,
            type: input.type === "INCOME" ? "INCOME" : "EXPENSE",
          },
        });
        if (!category) throw new NotFoundException("NOT_FOUND");
        // Corrections may retain their original archived category, but new entries may not use it.
        if (
          category.archivedAt &&
          (!input.replacesId ||
            !(await tx.transaction.findFirst({
              where: {
                id: input.replacesId,
                userId,
                voidedAt: null,
                categoryId: category.id,
              },
            })))
        )
          throw new BadRequestException("CATEGORY_ARCHIVED");
      }
      if (input.replacesId) {
        const original = await tx.transaction.findFirst({
          where: { id: input.replacesId, userId, voidedAt: null },
        });
        if (!original) throw new NotFoundException("NOT_FOUND");
        if (
          original.type === "ADJUSTMENT" ||
          (await tx.investmentTransaction.findFirst({
            where: { userId, fundingTransactionId: original.id },
          }))
        )
          throw new BadRequestException("INVALID_TRANSACTION");
        await tx.transaction.update({
          where: { id: original.id },
          data: { voidedAt: new Date() },
        });
      }
      return serializeTransaction(
        await tx.transaction.create({ data: { ...input, userId } }),
      );
    });
  }
  async adjustBalance(userId: string, accountId: string, body: unknown) {
    const input = balanceAdjustmentSchema.parse(body);
    return this.transactionWrite(userId, async (tx) => {
      const account = await ownedAccount(tx, userId, accountId);
      const existing = await tx.transaction.findUnique({
        where: {
          userId_clientRequestId: {
            userId,
            clientRequestId: input.clientRequestId,
          },
        },
      });
      if (existing) {
        const requestedDelta = decimal(input.balance).sub(
          input.expectedBalance,
        );
        if (
          existing.type !== "ADJUSTMENT" ||
          (existing.sourceAccountId ?? existing.destinationAccountId) !==
            accountId ||
          !requestedDelta.abs().eq(existing.amount.toFixed()) ||
          requestedDelta.isNegative() !== !!existing.sourceAccountId ||
          input.description !== existing.description ||
          input.recordTransaction !== existing.visibleInHistory ||
          existing.isOpeningBalance
        )
          throw new ConflictException("CONFLICT");
        return serializeTransaction(existing);
      }
      const transactions = await tx.transaction.findMany({
        where: {
          userId,
          voidedAt: null,
          OR: [
            { sourceAccountId: accountId },
            { destinationAccountId: accountId },
          ],
        },
      });
      const investments = await tx.investmentTransaction.findMany({
        where: { userId, accountId, voidedAt: null },
      });
      const ledger = accountLedger(
        accountId,
        account.initialBalance.toFixed(),
        transactions.map(serializeTransaction),
        investments.map(serializeInvestment),
      );
      const current =
        ledger.at(-1)?.balanceAfter ?? account.initialBalance.toFixed();
      if (!decimal(current).eq(input.expectedBalance))
        throw new ConflictException("BALANCE_CHANGED");
      const delta = decimal(input.balance).sub(current);
      if (delta.abs().gte("10000000000000000"))
        throw new BadRequestException("VALIDATION_ERROR");
      // Append after all recorded activity, including the permitted clock-skew window.
      const timestamp = Math.max(
        Date.now(),
        Date.parse(ledger.at(-1)?.timestamp ?? "1970-01-01T00:00:00Z") + 1,
      );
      return serializeTransaction(
        await tx.transaction.create({
          data: {
            userId,
            type: "ADJUSTMENT",
            sourceAccountId: delta.isNegative() ? accountId : null,
            destinationAccountId: delta.isNegative() ? null : accountId,
            amount: delta.abs().toFixed(),
            currency: account.currency,
            description: input.description,
            occurredAt: new Date(timestamp),
            clientRequestId: input.clientRequestId,
            visibleInHistory: input.recordTransaction,
          },
        }),
      );
    });
  }
  async voidTransaction(userId: string, id: string) {
    return this.db.financial(userId, async (tx) => {
      const original = await tx.transaction.findFirst({
        where: { id, userId, voidedAt: null },
      });
      if (!original) throw new NotFoundException("NOT_FOUND");
      const voidedAt = new Date();
      await tx.transaction.update({
        where: { id },
        data: { voidedAt },
      });
      const investment = await tx.investmentTransaction.findFirst({
        where: { userId, fundingTransactionId: id, voidedAt: null },
      });
      if (investment) {
        await tx.investmentTransaction.update({
          where: { id: investment.id },
          data: { voidedAt },
        });
        await this.validatePortfolio(tx, userId, investment.accountId);
      }
      return { ok: true };
    });
  }
  async category(userId: string, body: unknown, id?: string) {
    const input = id
      ? categoryUpdateSchema.parse(body)
      : categorySchema.parse(body);
    return this.db.atomic(userId, async (tx) => {
      const categories = await tx.category.findMany({ where: { userId } });
      const current = id ? categories.find((c) => c.id === id) : undefined;
      if (id && !current) throw new NotFoundException("NOT_FOUND");
      if (current?.archivedAt)
        throw new BadRequestException("CATEGORY_ARCHIVED");
      if (categories.find((c) => c.id === input.parentId)?.archivedAt)
        throw new BadRequestException("CATEGORY_ARCHIVED");
      const type = current?.type ?? categorySchema.parse(body).type;
      try {
        validateParent(categories, id ?? "", input.parentId, type);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      return id
        ? tx.category.update({
            where: { id },
            data: {
              name: input.name,
              parentId: input.parentId,
              defaultKey: null,
            },
          })
        : tx.category.create({ data: { ...input, type, userId } });
    });
  }
  async removeCategory(userId: string, id: string) {
    return this.db.atomic(userId, async (tx) => {
      const category = await tx.category.findFirst({ where: { id, userId } });
      if (!category) throw new NotFoundException("NOT_FOUND");
      if (await tx.category.count({ where: { userId, parentId: id } }))
        throw new ConflictException("CATEGORY_HAS_CHILDREN");
      // Include voided and corrected entries so their historical associations survive.
      if (await tx.transaction.count({ where: { userId, categoryId: id } }))
        throw new ConflictException("CATEGORY_IN_USE");
      if (await tx.budget.count({ where: { userId, categoryId: id } }))
        throw new ConflictException("CATEGORY_IN_USE");
      await tx.category.delete({ where: { id, userId } });
      return { ok: true };
    });
  }
  async archiveCategory(userId: string, id: string, archived: boolean) {
    return this.db.atomic(userId, async (tx) => {
      const category = await tx.category.findFirst({ where: { id, userId } });
      if (!category) throw new NotFoundException("NOT_FOUND");
      if (
        archived &&
        (await tx.category.count({ where: { userId, parentId: id } }))
      )
        throw new ConflictException("CATEGORY_HAS_CHILDREN");
      if (
        !archived &&
        category.parentId &&
        (await tx.category.findFirst({
          where: { id: category.parentId, userId, archivedAt: { not: null } },
        }))
      )
        throw new BadRequestException("CATEGORY_ARCHIVED");
      return tx.category.update({
        where: { id, userId },
        data: {
          archivedAt: archived ? (category.archivedAt ?? new Date()) : null,
        },
      });
    });
  }
  async investmentDetails(userId: string, id: string) {
    return this.db.$transaction(
      async (tx) => {
        const record = await tx.investmentTransaction.findFirst({
          where: { id, userId, voidedAt: null },
          include: { fundingTransaction: true },
        });
        if (!record) throw new NotFoundException("NOT_FOUND");
        const { fundingTransaction, ...entry } = record;
        if (
          fundingTransaction &&
          (fundingTransaction.userId !== userId || fundingTransaction.voidedAt)
        )
          throw new NotFoundException("NOT_FOUND");
        return {
          ...serializeInvestment(entry),
          sourceAccountId: fundingTransaction?.sourceAccountId ?? null,
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
  async investment(userId: string, body: unknown) {
    const input = investmentSchema.parse(body);
    return this.db.financial(
      userId,
      async (tx) => {
        const existing = await tx.investmentTransaction.findUnique({
          where: {
            userId_clientRequestId: {
              userId,
              clientRequestId: input.clientRequestId,
            },
          },
        });
        if (existing) {
          const funding = existing.fundingTransactionId
            ? await tx.transaction.findFirst({
                where: { id: existing.fundingTransactionId, userId },
              })
            : null;
          if (
            existing.accountId !== input.accountId ||
            existing.replacesId !== (input.replacesId ?? null) ||
            existing.assetId !== input.assetId ||
            existing.type !== input.type ||
            existing.currency !== input.currency ||
            existing.executedAt.getTime() !== Date.parse(input.executedAt) ||
            existing.quantity?.toFixed() !==
              (input.quantity === null
                ? undefined
                : decimal(input.quantity).toFixed()) ||
            existing.pricePerUnit?.toFixed() !==
              (input.pricePerUnit === null
                ? undefined
                : decimal(input.pricePerUnit).toFixed()) ||
            !decimal(input.totalAmount).eq(existing.totalAmount.toFixed()) ||
            !decimal(input.fee).eq(existing.fee.toFixed()) ||
            (funding?.sourceAccountId ?? null) !== input.sourceAccountId
          )
            throw new ConflictException("CONFLICT");
          return serializeInvestment(existing);
        }
        const original = input.replacesId
          ? await tx.investmentTransaction.findFirst({
              where: { id: input.replacesId, userId, voidedAt: null },
            })
          : null;
        if (input.replacesId && !original)
          throw new NotFoundException("NOT_FOUND");
        if (original && original.accountId !== input.accountId)
          throw new BadRequestException("INVALID_ACCOUNT");
        const account = await ownedAccount(tx, userId, input.accountId);
        if (account.type !== "INVESTMENT")
          throw new BadRequestException("INVALID_ACCOUNT");
        if (account.currency !== input.currency)
          throw new BadRequestException("CURRENCY_MISMATCH");
        if (input.sourceAccountId) {
          const source = await ownedAccount(tx, userId, input.sourceAccountId);
          if (source.type === "INVESTMENT")
            throw new BadRequestException("INVALID_ACCOUNT");
          if (source.currency !== account.currency)
            throw new BadRequestException("CURRENCY_MISMATCH");
        }
        if (input.assetId) {
          const asset = await tx.asset.findFirst({
            where: { id: input.assetId, userId },
          });
          if (!asset) throw new NotFoundException("NOT_FOUND");
          if (asset.currency !== input.currency)
            throw new BadRequestException("CURRENCY_MISMATCH");
        }
        const originalFunding = original?.fundingTransactionId
          ? await tx.transaction.findFirstOrThrow({
              where: {
                id: original.fundingTransactionId,
                userId,
                voidedAt: null,
              },
            })
          : null;
        if (original) {
          const voidedAt = new Date();
          await tx.investmentTransaction.update({
            where: { id: original.id, userId },
            data: { voidedAt },
          });
          if (originalFunding)
            await tx.transaction.update({
              where: { id: originalFunding.id, userId },
              data: { voidedAt },
            });
        }
        const { sourceAccountId, ...activity } = input;
        const funding = sourceAccountId
          ? await tx.transaction.create({
              data: {
                userId,
                type: "TRANSFER",
                sourceAccountId,
                destinationAccountId: account.id,
                amount: decimal(input.totalAmount).add(input.fee).toFixed(),
                currency: account.currency,
                occurredAt: new Date(input.executedAt),
                clientRequestId: input.clientRequestId,
                replacesId: originalFunding?.id ?? null,
                ledgerOrderAt: originalFunding
                  ? (originalFunding.ledgerOrderAt ?? originalFunding.createdAt)
                  : original
                    ? (original.ledgerOrderAt ?? original.createdAt)
                    : null,
              },
            })
          : null;
        const entry = await tx.investmentTransaction.create({
          data: {
            ...activity,
            userId,
            fundingTransactionId: funding?.id ?? null,
            ledgerOrderAt: original
              ? (original.ledgerOrderAt ?? original.createdAt)
              : null,
          },
        });
        await this.validatePortfolio(tx, userId, input.accountId);
        return serializeInvestment(entry);
      },
      async (tx, result) =>
        serializeInvestment(
          await tx.investmentTransaction.findUniqueOrThrow({
            where: { id: result.id, userId },
          }),
        ),
    );
  }
  private async validatePortfolio(
    tx: DbTransaction,
    userId: string,
    accountId: string,
  ) {
    const entries = await tx.investmentTransaction.findMany({
      where: { userId, accountId, voidedAt: null },
    });
    try {
      portfolio(entries.map(serializeInvestment));
    } catch {
      throw new BadRequestException("INSUFFICIENT_HOLDINGS");
    }
  }
  async voidInvestment(userId: string, id: string) {
    return this.db.financial(userId, async (tx) => {
      const entry = await tx.investmentTransaction.findFirst({
        where: { id, userId, voidedAt: null },
      });
      if (!entry) throw new NotFoundException("NOT_FOUND");
      const voidedAt = new Date();
      await tx.investmentTransaction.update({
        where: { id },
        data: { voidedAt },
      });
      if (entry.fundingTransactionId)
        await tx.transaction.update({
          where: { id: entry.fundingTransactionId, userId },
          data: { voidedAt },
        });
      await this.validatePortfolio(tx, userId, entry.accountId);
      return { ok: true };
    });
  }
  filter<
    T extends LedgerTransaction & {
      currency: string;
      categoryId: string | null;
    },
  >(
    transactions: T[],
    categories: { id: string; parentId: string | null; type: string }[],
    query: z.infer<typeof filterSchema>,
    timeZone: string,
  ) {
    const bounds = monthBounds(query.month, timeZone);
    const from = query.startDate
      ? DateTime.fromISO(query.startDate, { zone: timeZone })
          .startOf("day")
          .toUTC()
          .toISO()!
      : query.from
        ? new Date(query.from).toISOString()
        : bounds.from;
    const to = query.endDate
      ? DateTime.fromISO(query.endDate, { zone: timeZone })
          .startOf("day")
          .plus({ days: 1 })
          .toUTC()
          .toISO()!
      : query.to
        ? new Date(query.to).toISOString()
        : bounds.to;
    const allowed = query.categoryId
      ? descendants(categories, query.categoryId)
      : null;
    return transactions
      .filter(
        (t) =>
          t.visibleInHistory !== false &&
          t.occurredAt >= from &&
          t.occurredAt < to &&
          (!query.accountId ||
            t.sourceAccountId === query.accountId ||
            t.destinationAccountId === query.accountId) &&
          (!query.type || t.type === query.type) &&
          (!allowed || (!!t.categoryId && allowed.has(t.categoryId))) &&
          t.currency === query.currency,
      )
      .sort(
        (a, b) =>
          b.occurredAt.localeCompare(a.occurredAt) ||
          (b.ledgerOrderAt ?? b.createdAt).localeCompare(
            a.ledgerOrderAt ?? a.createdAt,
          ) ||
          b.id.localeCompare(a.id),
      );
  }
  async history(
    userId: string,
    accountId: string,
    month: string | undefined,
    timeZone: string,
  ) {
    const data = await this.all(userId);
    const account = data.accounts.find((a) => a.id === accountId);
    if (!account) throw new NotFoundException("NOT_FOUND");
    const bounds = monthBounds(month, timeZone);
    const ledger = accountLedger(
      accountId,
      account.initialBalance,
      data.transactions,
      data.investments,
    );
    const entries = ledger.filter(
      (e) => e.timestamp >= bounds.from && e.timestamp < bounds.to,
    );
    const opening =
      ledger.filter((e) => e.timestamp < bounds.from).at(-1)?.balanceAfter ??
      account.initialBalance;
    const standard = data.transactions.filter(
      (t) =>
        (t.sourceAccountId === accountId ||
          t.destinationAccountId === accountId) &&
        t.occurredAt >= bounds.from &&
        t.occurredAt < bounds.to,
    );
    return {
      account,
      ...bounds,
      opening,
      closing: entries.at(-1)?.balanceAfter ?? opening,
      ...cashflow(standard),
      entries: entries
        .filter(
          (e) =>
            e.kind !== "STANDARD" ||
            data.transactions.find((t) => t.id === e.id)?.visibleInHistory !==
              false,
        )
        .reverse()
        .map((e) => {
          const transaction =
            e.kind === "STANDARD"
              ? data.transactions.find((t) => t.id === e.id)
              : data.investments.find((t) => t.id === e.id);
          const fundingId =
            transaction && "fundingTransactionId" in transaction
              ? transaction.fundingTransactionId
              : transaction &&
                  "investmentActivityId" in transaction &&
                  transaction.investmentActivityId
                ? transaction.id
                : null;
          const funding = data.transactions.find((t) => t.id === fundingId);
          return {
            ...e,
            transaction,
            funding: funding
              ? {
                  amount: funding.amount,
                  sourceAccountId: funding.sourceAccountId,
                  destinationAccountId: funding.destinationAccountId,
                  sourceAccountName: data.accounts.find(
                    (a) => a.id === funding.sourceAccountId,
                  )?.name,
                  destinationAccountName: data.accounts.find(
                    (a) => a.id === funding.destinationAccountId,
                  )?.name,
                }
              : null,
          };
        }),
    };
  }
}
export type SerializedInvestment = InvestmentEntry;
