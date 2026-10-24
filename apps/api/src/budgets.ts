import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  budgetDeleteSchema,
  budgetKeySchema,
  budgetQuerySchema,
  budgetWriteSchema,
  monthlyBudgets,
  monthlyInvestmentBudgets,
} from "@opulya/shared";
import { Database } from "./db.js";
import type { Prisma } from "./generated/prisma/client.js";
import { monthBounds } from "./ledger.js";

@Injectable()
export class BudgetsService {
  constructor(@Inject(Database) private readonly db: Database) {}

  async list(userId: string, query: unknown, timeZone: string) {
    const { month, currency, type } = budgetQuerySchema.parse(query);
    const { from, to } = monthBounds(month, timeZone);
    return this.db.$transaction(
      async (tx) => {
        if (type === "INVESTMENT") {
          const assets = await tx.asset.findMany({
            where: { userId, currency },
            select: { id: true },
          });
          const rules = await tx.budget.findMany({
            where: {
              userId,
              currency,
              assetId: { not: null },
              month: { lte: month },
            },
          });
          const activity = await tx.investmentTransaction.findMany({
            where: {
              userId,
              currency,
              type: "BUY",
              voidedAt: null,
              executedAt: { gte: new Date(from), lt: new Date(to) },
            },
            select: { assetId: true, type: true, totalAmount: true, fee: true },
          });
          return {
            month,
            currency,
            type,
            ...monthlyInvestmentBudgets(
              assets,
              rules.map((r) => ({
                ...r,
                assetId: r.assetId!,
                amount: r.amount?.toFixed() ?? null,
              })),
              activity.map((a) => ({
                ...a,
                totalAmount: a.totalAmount.toFixed(),
                fee: a.fee.toFixed(),
              })),
              month,
            ),
          };
        }
        const categories = await tx.category.findMany({
          where: { userId, type },
        });
        const rules = await tx.budget.findMany({
          where: {
            userId,
            currency,
            categoryId: { not: null },
            month: { lte: month },
          },
        });
        const activity = await tx.transaction.findMany({
          where: {
            userId,
            currency,
            type,
            voidedAt: null,
            occurredAt: { gte: new Date(from), lt: new Date(to) },
          },
          select: { categoryId: true, type: true, amount: true },
        });
        return {
          month,
          currency,
          type,
          ...monthlyBudgets(
            categories,
            rules.map((r) => ({
              ...r,
              categoryId: r.categoryId!,
              amount: r.amount?.toFixed() ?? null,
            })),
            activity.map((a) => ({ ...a, amount: a.amount.toFixed() })),
            month,
            type,
          ),
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  async save(userId: string, body: unknown) {
    const input = budgetWriteSchema.parse(body);
    return this.db.atomic(userId, async (tx) => {
      await this.checkTarget(tx, userId, input, input.amount !== null);
      await tx.budget.upsert({
        where:
          "assetId" in input
            ? {
                userId_assetId_currency_month_scope: {
                  userId,
                  assetId: input.assetId,
                  currency: input.currency,
                  month: input.month,
                  scope: input.scope,
                },
              }
            : {
                userId_categoryId_currency_month_scope: {
                  userId,
                  categoryId: input.categoryId,
                  currency: input.currency,
                  month: input.month,
                  scope: input.scope,
                },
              },
        create: { ...input, userId },
        update: { amount: input.amount },
      });
      return { ok: true };
    });
  }

  async resetMonth(userId: string, body: unknown) {
    const input = budgetKeySchema.parse(body);
    return this.db.atomic(userId, async (tx) => {
      await this.checkTarget(tx, userId, input);
      await tx.budget.deleteMany({
        where: { ...input, userId, scope: "MONTH" },
      });
      return { ok: true };
    });
  }

  async delete(userId: string, body: unknown) {
    const input = budgetDeleteSchema.parse(body);
    return this.db.atomic(userId, async (tx) => {
      await this.checkTarget(tx, userId, input);
      await tx.budget.deleteMany({ where: { ...input, userId } });
      return { ok: true };
    });
  }

  private async checkTarget(
    tx: Prisma.TransactionClient,
    userId: string,
    input: { categoryId?: string; assetId?: string; currency: string },
    activating = false,
  ) {
    if (input.assetId) {
      const asset = await tx.asset.findFirst({
        where: { id: input.assetId, userId },
      });
      if (!asset) throw new NotFoundException("NOT_FOUND");
      if (asset.currency !== input.currency)
        throw new BadRequestException("CURRENCY_MISMATCH");
    } else {
      const category = await tx.category.findFirst({
        where: { id: input.categoryId!, userId },
      });
      if (!category) throw new NotFoundException("NOT_FOUND");
      if (category.archivedAt && activating)
        throw new BadRequestException("CATEGORY_ARCHIVED");
    }
  }
}
