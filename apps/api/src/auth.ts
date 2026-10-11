import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Post,
  Patch,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  type OnModuleDestroy,
} from "@nestjs/common";
import type { Response } from "express";
import { randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import {
  loginSchema,
  resendVerificationSchema,
  settingsSchema,
  signupSchema,
  verifyEmailSchema,
} from "@opulya/shared";
import { Database } from "./db.js";
import { MailService } from "./mail.js";
import {
  AuthGuard,
  type AuthRequest,
  cookieName,
  hashToken,
  publicUserSelect,
  sessionCookieOptions,
  sessionPolicy,
} from "./security.js";

const hashing = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;
@Injectable()
export class AuthService implements OnModuleDestroy {
  private readonly dummyHash = argon2.hash(randomBytes(32), hashing);
  private readonly deliveries = new Set<Promise<void>>();
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(MailService) private readonly mail: MailService,
  ) {}
  async onModuleDestroy() {
    await Promise.allSettled(this.deliveries);
  }
  private async respondAfter(started: number) {
    const remaining = 200 - (Date.now() - started);
    if (remaining > 0)
      await new Promise((resolve) => setTimeout(resolve, remaining));
    return { ok: true };
  }
  private async issueVerification(user: {
    id: string;
    email: string;
    firstName: string;
    locale: string;
  }) {
    const token = randomBytes(32).toString("hex"),
      tokenHash = hashToken(token),
      now = new Date();
    const minutes = this.mail.settings.EMAIL_VERIFICATION_MINUTES;
    const issued = await this.db.user.updateMany({
      where: {
        id: user.id,
        emailVerifiedAt: null,
        OR: [
          { emailVerificationSentAt: null },
          { emailVerificationSentAt: { lte: new Date(now.getTime() - 60000) } },
        ],
      },
      data: {
        emailVerificationTokenHash: tokenHash,
        emailVerificationExpiresAt: new Date(now.getTime() + minutes * 60000),
        emailVerificationSentAt: now,
      },
    });
    if (issued.count !== 1) return;
    const url = new URL("/verify-email", process.env.WEB_ORIGIN);
    // Fragments are not sent to HTTP servers or included in referrer headers.
    url.hash = new URLSearchParams({ token }).toString();
    const delivery = this.mail
      .sendVerification({
        to: user.email,
        firstName: user.firstName,
        locale: user.locale,
        verificationUrl: url.toString(),
        minutes,
      })
      .catch(async () => {
        console.warn("Verification email delivery failed");
        await this.db.user
          .updateMany({
            where: {
              id: user.id,
              emailVerificationTokenHash: tokenHash,
              emailVerifiedAt: null,
            },
            data: {
              emailVerificationTokenHash: null,
              emailVerificationExpiresAt: null,
            },
          })
          .catch(() => undefined);
      });
    this.deliveries.add(delivery);
    void delivery.finally(() => this.deliveries.delete(delivery));
  }
  async signup(body: unknown) {
    const started = Date.now();
    const input = signupSchema.parse(body);
    this.mail.assertReady();
    const user = await this.db.user.upsert({
      where: { email: input.email },
      update: {},
      create: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        locale: input.locale,
        timeZone: input.timeZone,
      },
      select: { id: true, email: true, firstName: true, locale: true },
    });
    await this.issueVerification(user);
    return this.respondAfter(started);
  }
  async resendVerification(body: unknown) {
    const started = Date.now(),
      input = resendVerificationSchema.parse(body);
    this.mail.assertReady();
    const user = await this.db.user.findUnique({
      where: { email: input.email },
      select: { id: true, email: true, firstName: true, locale: true },
    });
    if (user) await this.issueVerification(user);
    return this.respondAfter(started);
  }
  async verifyEmail(body: unknown) {
    const input = verifyEmailSchema.parse(body);
    const tokenHash = hashToken(input.token);
    const passwordHash = await argon2.hash(input.password, hashing);
    return this.db.$transaction(async (tx) => {
      const now = new Date();
      const user = await tx.user.findFirst({
        where: {
          emailVerificationTokenHash: tokenHash,
          emailVerifiedAt: null,
          emailVerificationExpiresAt: { gt: now },
        },
        select: { id: true },
      });
      if (!user) throw new BadRequestException("INVALID_VERIFICATION");
      const activated = await tx.user.updateMany({
        where: {
          id: user.id,
          emailVerificationTokenHash: tokenHash,
          emailVerifiedAt: null,
          emailVerificationExpiresAt: { gt: now },
        },
        data: {
          emailVerifiedAt: now,
          passwordHash,
          emailVerificationTokenHash: null,
          emailVerificationExpiresAt: null,
        },
      });
      if (activated.count !== 1)
        throw new BadRequestException("INVALID_VERIFICATION");
      await tx.session.deleteMany({ where: { userId: user.id } });
      return { ok: true };
    });
  }
  async login(body: unknown) {
    const input = loginSchema.parse(body);
    const user = await this.db.user.findUnique({
      where: { email: input.email },
    });
    const valid = await argon2.verify(
      user?.passwordHash ?? (await this.dummyHash),
      input.password,
    );
    if (!user?.passwordHash || !valid)
      throw new UnauthorizedException("INVALID_CREDENTIALS");
    if (!user.emailVerifiedAt)
      throw new ForbiddenException("EMAIL_NOT_VERIFIED");
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      locale: user.locale,
      timeZone: user.timeZone,
      emailVerifiedAt: user.emailVerifiedAt.toISOString(),
    };
  }
  async startSession(userId: string, res: Response, previousToken?: unknown) {
    const token = randomBytes(32).toString("hex");
    const now = new Date();
    const { absoluteMs, idleMs } = sessionPolicy();
    await this.db.$transaction(async (tx) => {
      if (
        !(await tx.user.findFirst({
          where: { id: userId, emailVerifiedAt: { not: null } },
          select: { id: true },
        }))
      )
        throw new ForbiddenException("EMAIL_NOT_VERIFIED");
      await tx.session.deleteMany({
        where: {
          userId,
          OR: [
            { expiresAt: { lte: now } },
            { createdAt: { lte: new Date(now.getTime() - absoluteMs) } },
            { lastSeenAt: { lte: new Date(now.getTime() - idleMs) } },
            ...(typeof previousToken === "string" &&
            /^[a-f0-9]{64}$/.test(previousToken)
              ? [{ tokenHash: hashToken(previousToken) }]
              : []),
          ],
        },
      });
      await tx.session.create({
        data: {
          userId,
          tokenHash: hashToken(token),
          expiresAt: new Date(now.getTime() + absoluteMs),
          lastSeenAt: now,
        },
      });
    });
    res.cookie(cookieName(), token, {
      ...sessionCookieOptions(),
      maxAge: absoluteMs,
    });
  }
}
@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Database) private readonly db: Database,
  ) {}
  @Post("signup") signup(@Body() body: unknown) {
    return this.auth.signup(body);
  }
  @Post("resend-verification") resendVerification(@Body() body: unknown) {
    return this.auth.resendVerification(body);
  }
  @Post("verify-email") verifyEmail(@Body() body: unknown) {
    return this.auth.verifyEmail(body);
  }
  @Post("login") async login(
    @Body() body: unknown,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.login(body);
    await this.auth.startSession(user.id, res, req.cookies?.[cookieName()]);
    return user;
  }
  @UseGuards(AuthGuard) @Get("me") me(@Req() req: AuthRequest) {
    return req.user;
  }
  @UseGuards(AuthGuard) @Patch("settings") async settings(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.db.user.update({
      where: { id: req.user.id },
      data: settingsSchema.parse(body),
      select: publicUserSelect,
    });
  }
  @UseGuards(AuthGuard) @Post("logout") async logout(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.db.session.deleteMany({
      where: {
        userId: req.user.id,
        tokenHash: hashToken(req.cookies[cookieName()] as string),
      },
    });
    res.clearCookie(cookieName(), sessionCookieOptions());
    return { ok: true };
  }
}
