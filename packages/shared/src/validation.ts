import { z } from "zod";
import { Decimal } from "decimal.js";

export const locales = ["en", "hr"] as const;
export const localeSchema = z.enum(locales);
export const currencies = Object.freeze(Intl.supportedValuesOf("currency"));
export const currencySchema = z.enum(currencies);
export const accountTypes = ["CASH", "BANK", "INVESTMENT"] as const;
export const transactionTypes = ["INCOME", "EXPENSE", "TRANSFER"] as const;
export const ledgerTypes = [...transactionTypes, "ADJUSTMENT"] as const;
export const investmentTypes = [
  "BUY",
  "SELL",
  "DIVIDEND",
  "FEE",
  "DEPOSIT",
  "WITHDRAWAL",
] as const;
export const assetTypes = ["STOCK", "ETF", "CRYPTO", "FUND", "OTHER"] as const;
const id = z.string().min(1).max(64);
const amount = z
  .string()
  .regex(/^\d{1,15}(\.\d{1,8})?$/)
  .refine((v) => /^\d+(\.\d+)?$/.test(v) && new Decimal(v).gt(0));
const nonnegative = z.string().regex(/^\d{1,15}(\.\d{1,8})?$/);
const timestamp = z.iso
  .datetime({ offset: true })
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v)) && Date.parse(v) <= Date.now() + 60_000,
    "INVALID_DATE",
  );
const name = z.string().trim().min(1).max(100);
export const timeZoneSchema = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  });
export const passwordMinLength = 15;
export const passwordMaxLength = 128;
export const signupPasswordSchema = z
  .string()
  .min(passwordMinLength)
  .max(passwordMaxLength);
export const termsVersion = "2026-10-22";
export const signupSchema = z
  .object({
    firstName: name,
    lastName: name,
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    locale: localeSchema.default("en"),
    timeZone: timeZoneSchema.default("Europe/Zagreb"),
    acceptTerms: z.literal(true),
    termsVersion: z.literal(termsVersion),
  })
  .strict();
export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    password: z.string().min(1).max(passwordMaxLength),
  })
  .strict();
export const resendVerificationSchema = loginSchema
  .pick({ email: true })
  .strict();
export const verifyEmailSchema = z
  .object({
    token: z.string().regex(/^[a-f0-9]{64}$/),
    password: signupPasswordSchema,
  })
  .strict();
export const settingsSchema = z
  .object({ locale: localeSchema, timeZone: timeZoneSchema })
  .strict();
export const accountSchema = z
  .object({
    name,
    type: z.enum(accountTypes),
    currency: currencySchema,
    initialBalance: z.string().regex(/^-?\d{1,15}(\.\d{1,8})?$/),
    recordInitialBalance: z.boolean().default(false),
  })
  .strict();
export const accountUpdateSchema = z
  .object({
    name,
    type: z.enum(accountTypes).optional(),
    archived: z.boolean().optional(),
  })
  .strict();
export const balanceAdjustmentSchema = z
  .object({
    balance: z.string().regex(/^-?\d{1,15}(\.\d{1,8})?$/),
    expectedBalance: z.string().regex(/^-?\d{1,40}(\.\d{1,8})?$/),
    description: z.string().trim().max(500).nullable().default(null),
    clientRequestId: z.uuid(),
    recordTransaction: z.boolean().default(true),
  })
  .strict();
export const categorySchema = z
  .object({
    name,
    type: z.enum(["INCOME", "EXPENSE"]),
    parentId: id.nullable().default(null),
  })
  .strict();
export const categoryUpdateSchema = z
  .object({ name, parentId: id.nullable() })
  .strict();
const budgetMonth = z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/);
export const budgetQuerySchema = z
  .object({
    month: budgetMonth,
    currency: currencySchema.default("EUR"),
    type: z.enum(["INCOME", "EXPENSE", "INVESTMENT"]).default("EXPENSE"),
  })
  .strict();
const categoryBudgetKey = z
  .object({ categoryId: id, currency: currencySchema, month: budgetMonth })
  .strict();
const assetBudgetKey = z
  .object({ assetId: id, currency: currencySchema, month: budgetMonth })
  .strict();
export const budgetKeySchema = z.union([categoryBudgetKey, assetBudgetKey]);
export const budgetDeleteSchema = z.union([
  categoryBudgetKey.omit({ month: true }),
  assetBudgetKey.omit({ month: true }),
]);
const budgetValue = {
  scope: z.enum(["RECURRING", "MONTH"]),
  amount: nonnegative.nullable(),
};
export const budgetWriteSchema = z.union([
  categoryBudgetKey.extend(budgetValue),
  assetBudgetKey.extend(budgetValue),
]);
export const transactionSchema = z
  .object({
    type: z.enum(transactionTypes),
    sourceAccountId: id.nullable().default(null),
    destinationAccountId: id.nullable().default(null),
    amount,
    currency: currencySchema,
    categoryId: id.nullable().default(null),
    description: z.string().trim().max(500).nullable().default(null),
    occurredAt: timestamp,
    clientRequestId: z.uuid(),
    replacesId: id.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.type !== "TRANSFER" && !v.categoryId?.trim())
      ctx.addIssue({
        code: "custom",
        path: ["categoryId"],
        message: "CATEGORY_REQUIRED",
      });
    const valid =
      v.type === "INCOME"
        ? !v.sourceAccountId && !!v.destinationAccountId
        : v.type === "EXPENSE"
          ? !!v.sourceAccountId && !v.destinationAccountId
          : !!v.sourceAccountId &&
            !!v.destinationAccountId &&
            v.sourceAccountId !== v.destinationAccountId &&
            !v.categoryId;
    if (!valid)
      ctx.addIssue({ code: "custom", message: "INVALID_TRANSACTION" });
  });
export const assetSchema = z
  .object({
    symbol: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .regex(/^[A-Za-z0-9./:_-]+$/)
      .transform((v) => v.toUpperCase()),
    name: z.string().trim().min(1).max(500),
    assetType: z.enum(assetTypes),
    exchange: z
      .string()
      .trim()
      .max(50)
      .regex(/^[A-Za-z0-9 _.-]*$/)
      .default(""),
    currency: currencySchema,
    marketDataIdentifier: z
      .string()
      .trim()
      .max(80)
      .regex(/^[A-Za-z0-9./:_-]*$/)
      .nullable()
      .default(null),
  })
  .strict()
  .refine(
    (v) =>
      !["STOCK", "ETF", "FUND"].includes(v.assetType) || v.exchange.length > 0,
    "EXCHANGE_REQUIRED",
  );
export const investmentSchema = z
  .object({
    accountId: id,
    sourceAccountId: id.nullable().default(null),
    assetId: id.nullable().default(null),
    type: z.enum(investmentTypes),
    quantity: z
      .string()
      .regex(/^\d{1,15}(\.\d{1,12})?$/)
      .refine((v) => /^\d+(\.\d+)?$/.test(v) && new Decimal(v).gt(0))
      .nullable()
      .default(null),
    pricePerUnit: amount.nullable().default(null),
    totalAmount: amount,
    fee: nonnegative.default("0"),
    currency: currencySchema,
    executedAt: timestamp,
    clientRequestId: z.uuid(),
    replacesId: id.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const trade = v.type === "BUY" || v.type === "SELL";
    if (
      (v.sourceAccountId &&
        (!["BUY", "DEPOSIT"].includes(v.type) ||
          v.sourceAccountId === v.accountId)) ||
      (["BUY", "DEPOSIT"].includes(v.type) && !v.sourceAccountId)
    )
      ctx.addIssue({ code: "custom", message: "INVALID_TRANSACTION" });
    if (
      [v.quantity, v.pricePerUnit, v.totalAmount, v.fee].some(
        (value) => value !== null && !/^\d+(\.\d+)?$/.test(value),
      )
    )
      return;
    if (
      trade &&
      (!v.assetId ||
        !v.quantity ||
        !v.pricePerUnit ||
        !new Decimal(v.quantity)
          .mul(v.pricePerUnit)
          .toDecimalPlaces(8)
          .eq(v.totalAmount))
    )
      ctx.addIssue({ code: "custom", message: "INVALID_TRADE" });
    if (!trade && (v.quantity || v.pricePerUnit))
      ctx.addIssue({ code: "custom", message: "INVALID_TRADE" });
    if (v.type === "DIVIDEND" && !v.assetId)
      ctx.addIssue({ code: "custom", message: "ASSET_REQUIRED" });
    if (
      ["DEPOSIT", "WITHDRAWAL", "FEE"].includes(v.type) &&
      (v.assetId || !new Decimal(v.fee).isZero())
    )
      ctx.addIssue({ code: "custom", message: "INVALID_TRADE" });
    if (
      ["SELL", "DIVIDEND"].includes(v.type) &&
      new Decimal(v.fee).gt(v.totalAmount)
    )
      ctx.addIssue({ code: "custom", message: "INVALID_FEE" });
  });
export const filterSchema = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    startDate: z.iso.date().optional(),
    endDate: z.iso.date().optional(),
    accountId: id.optional(),
    type: z.enum(ledgerTypes).optional(),
    categoryId: id.optional(),
    currency: currencySchema.default("EUR"),
    parentId: id.optional(),
  })
  .strict()
  .refine(
    (v) => !v.from || !v.to || Date.parse(v.from) < Date.parse(v.to),
    "INVALID_RANGE",
  )
  .refine(
    (v) => !v.startDate || !v.endDate || v.startDate <= v.endDate,
    "INVALID_RANGE",
  );
export type TransactionInput = z.infer<typeof transactionSchema>;
export type InvestmentInput = z.infer<typeof investmentSchema>;
export type Locale = z.infer<typeof localeSchema>;
