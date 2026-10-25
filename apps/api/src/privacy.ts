import {
  Body,
  Controller,
  Delete,
  Inject,
  Injectable,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import * as argon2 from "argon2";
import {
  confirmPasswordSchema,
  deleteUserSchema,
  profileSchema,
  restrictProcessingSchema,
} from "@opulya/shared";
import { Database, type DbTransaction } from "./db.js";
import {
  AuthGuard,
  type AuthRequest,
  cookieName,
  hashToken,
  publicUserSelect,
  sessionCookieOptions,
} from "./security.js";

@Injectable()
export class PrivacyService {
  constructor(@Inject(Database) private readonly db: Database) {}

  private async confirmPassword(
    tx: DbTransaction,
    userId: string,
    password: string,
  ) {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (
      !user?.passwordHash ||
      !(await argon2.verify(user.passwordHash, password))
    )
      throw new UnauthorizedException("INVALID_PASSWORD");
    return user;
  }

  async export(userId: string, body: unknown) {
    const { password } = confirmPasswordSchema.parse(body);
    return this.db.$transaction(
      async (tx) => {
        const user = await this.confirmPassword(tx, userId, password);
        const where = { userId };
        // Select profile fields explicitly: never put credential or token hashes in a download.
        const profile = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: {
            ...publicUserSelect,
            termsVersion: true,
            termsAcceptedAt: true,
            emailVerificationSentAt: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        const accounts = await tx.account.findMany({
          where,
          orderBy: { id: "asc" },
        });
        const categories = await tx.category.findMany({
          where,
          orderBy: { id: "asc" },
        });
        const budgets = await tx.budget.findMany({
          where,
          orderBy: { id: "asc" },
        });
        const transactions = await tx.transaction.findMany({
          where,
          orderBy: { id: "asc" },
        });
        const assets = await tx.asset.findMany({
          where,
          orderBy: { id: "asc" },
          include: { instrument: { include: { mappings: true } } },
        });
        const investments = await tx.investmentTransaction.findMany({
          where,
          orderBy: { id: "asc" },
        });
        const sessions = await tx.session.findMany({
          where,
          orderBy: { createdAt: "asc" },
          select: { createdAt: true, lastSeenAt: true, expiresAt: true },
        });
        const emailDeliveryCounters = await tx.emailQuota.findMany({
          where: {
            key: {
              startsWith: `verification:recipient:${hashToken(user.email)}:`,
            },
          },
          select: { key: true, count: true, expiresAt: true },
          orderBy: { key: "asc" },
        });
        return {
          formatVersion: 1,
          exportedAt: new Date().toISOString(),
          notice:
            "Application database export. Decimal amounts are strings; timestamps use ISO 8601 UTC. Includes archived, hidden, voided and corrected records. Provider-held logs, email and backups require a request to the operator named in the Privacy Notice.",
          profile,
          accounts,
          categories,
          budgets,
          transactions,
          assets,
          investments,
          sessions,
          emailDeliveryCounters: emailDeliveryCounters.map(
            ({ key, ...counter }) => ({
              ...counter,
              window: key.split(":").slice(-2).join(":"),
            }),
          ),
        };
      },
      { isolationLevel: "RepeatableRead", timeout: 30_000 },
    );
  }

  async profile(userId: string, body: unknown) {
    const data = profileSchema.parse(body);
    return this.db.atomic(
      userId,
      (tx) =>
        tx.user.update({
          where: { id: userId },
          data,
          select: publicUserSelect,
        }),
      { allowRestricted: true },
    );
  }

  async restrict(userId: string, body: unknown, currentToken: string) {
    const { password, restricted } = restrictProcessingSchema.parse(body);
    return this.db.atomic(
      userId,
      async (tx) => {
        await this.confirmPassword(tx, userId, password);
        const user = await tx.user.update({
          where: { id: userId },
          data: { processingRestrictedAt: restricted ? new Date() : null },
          select: publicUserSelect,
        });
        await tx.session.deleteMany({
          where: { userId, tokenHash: { not: hashToken(currentToken) } },
        });
        return user;
      },
      { allowRestricted: true },
    );
  }

  async delete(userId: string, body: unknown) {
    const { password } = deleteUserSchema.parse(body);
    return this.db.atomic(
      userId,
      async (tx) => {
        const user = await this.confirmPassword(tx, userId, password);
        const where = { userId };
        // Detach correction chains before deleting; normal ledger deletion remains restricted.
        await tx.budget.deleteMany({ where });
        await tx.investmentTransaction.updateMany({
          where,
          data: { replacesId: null },
        });
        await tx.investmentTransaction.deleteMany({ where });
        await tx.transaction.updateMany({ where, data: { replacesId: null } });
        await tx.transaction.deleteMany({ where });
        await tx.category.updateMany({ where, data: { parentId: null } });
        await tx.category.deleteMany({ where });
        await tx.asset.deleteMany({ where });
        await tx.account.deleteMany({ where });
        await tx.session.deleteMany({ where });
        await tx.emailQuota.deleteMany({
          where: {
            key: {
              startsWith: `verification:recipient:${hashToken(user.email)}:`,
            },
          },
        });
        await tx.user.delete({ where: { id: userId } });
        return { ok: true };
      },
      { allowRestricted: true },
    );
  }
}

@Controller("auth")
@UseGuards(AuthGuard)
export class PrivacyController {
  constructor(
    @Inject(PrivacyService) private readonly privacy: PrivacyService,
  ) {}

  @Patch("profile") profile(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.privacy.profile(req.user.id, body);
  }

  @Post("export") async export(
    @Req() req: AuthRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.privacy.export(req.user.id, body);
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="opulya-data.json"',
    );
    return result;
  }

  @Patch("processing") restrict(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.privacy.restrict(
      req.user.id,
      body,
      req.cookies[cookieName()] as string,
    );
  }

  @Delete("account") async delete(
    @Req() req: AuthRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.privacy.delete(req.user.id, body);
    res.clearCookie(cookieName(), sessionCookieOptions());
    return result;
  }
}
