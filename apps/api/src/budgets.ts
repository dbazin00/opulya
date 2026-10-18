import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  budgetKeySchema,
  budgetQuerySchema,
  budgetWriteSchema,
  monthlyBudgets,
} from "@opulya/shared";
import { Database } from "./db.js";
import { monthBounds } from "./ledger.js";

@Injectable()
export class BudgetsService {
  constructor(@Inject(Database) private readonly db: Database) {}

  async list(userId: string, query: unknown, timeZone: string) {
    const { month, currency, type } = budgetQuerySchema.parse(query);
    const { from, to } = monthBounds(month, timeZone);
    return this.db.$transaction(
      async (tx) => {
        const categories = await tx.category.findMany({
          where: { userId, type },
        });
        const rules = await tx.budget.findMany({
          where: { userId, currency, month: { lte: month } },
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
            rules.map((r) => ({ ...r, amount: r.amount?.toFixed() ?? null })),
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
      const category = await tx.category.findFirst({
        where: { id: input.categoryId, userId },
      });
      if (!category) throw new NotFoundException("NOT_FOUND");
      if (category.archivedAt && input.amount !== null)
        throw new BadRequestException("CATEGORY_ARCHIVED");
      await tx.budget.upsert({
        where: {
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
      if (
        !(await tx.category.findFirst({
          where: { id: input.categoryId, userId },
        }))
      )
        throw new NotFoundException("NOT_FOUND");
      await tx.budget.deleteMany({
        where: { ...input, userId, scope: "MONTH" },
      });
      return { ok: true };
    });
  }
}
