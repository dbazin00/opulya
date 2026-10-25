import {
  Catch,
  HttpException,
  Injectable,
  Inject,
  UnauthorizedException,
  ForbiddenException,
  type ArgumentsHost,
  type CanActivate,
  type ExecutionContext,
  type ExceptionFilter,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Request, Response, NextFunction, CookieOptions } from "express";
import {
  ZodError,
  loginSchema,
  resendVerificationSchema,
  z,
} from "@opulya/shared";
import { Database } from "./db.js";
import { Prisma } from "./generated/prisma/client.js";

export const cookieName = () =>
  process.env.NODE_ENV === "production"
    ? "__Host-opulya_session"
    : "opulya_session";
export const hashToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const sessionPolicySchema = z.object({
  SESSION_HOURS: z.coerce.number().int().min(1).max(24).default(8),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(30).default(15),
});
export function sessionPolicy() {
  const settings = sessionPolicySchema.parse(process.env);
  return {
    absoluteMs: settings.SESSION_HOURS * 3_600_000,
    idleMs: settings.SESSION_IDLE_MINUTES * 60_000,
  };
}
export const sessionCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/",
  priority: "high",
});
export function loginAccountKey(body: unknown) {
  const input = loginSchema.safeParse(body);
  return input.success ? hashToken(input.data.email) : null;
}
export function verificationEmailKey(body: unknown) {
  const input = resendVerificationSchema.safeParse(
    typeof body === "object" && body !== null && "email" in body
      ? { email: body.email }
      : body,
  );
  return input.success ? hashToken(input.data.email) : null;
}
export const publicUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  locale: true,
  timeZone: true,
  emailVerifiedAt: true,
  processingRestrictedAt: true,
} as const;
export type SessionUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  locale: string;
  timeZone: string;
  emailVerifiedAt: Date | null;
  processingRestrictedAt?: Date | null;
};
export interface AuthRequest extends Request {
  user: SessionUser;
}
export function csrfProtection(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  res.setHeader("Cache-Control", "no-store");
  if (req.headers["sec-fetch-site"] === "cross-site") {
    res.status(403).json({ code: "FORBIDDEN" });
    return;
  }
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (
    req.headers.origin !== process.env.WEB_ORIGIN ||
    req.headers["x-opulya-request"] !== "1" ||
    !req.is("application/json")
  ) {
    res.status(403).json({ code: "FORBIDDEN" });
    return;
  }
  next();
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(Database) private readonly db: Database) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token: unknown = req.cookies?.[cookieName()];
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
      throw new UnauthorizedException("UNAUTHORIZED");
    const session = await this.db.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: publicUserSelect } },
    });
    if (!session) throw new UnauthorizedException("UNAUTHORIZED");
    if (!session.user.emailVerifiedAt && req.path !== "/api/auth/logout")
      throw new ForbiddenException("EMAIL_NOT_VERIFIED");
    // Keep privacy controls available while preventing normal use of restricted data.
    if (
      session.user.processingRestrictedAt &&
      !req.path.startsWith("/api/auth/")
    )
      throw new ForbiddenException("PROCESSING_RESTRICTED");
    const now = new Date();
    const policy = sessionPolicy();
    if (
      req.method === "GET" &&
      req.headers?.["x-opulya-poll"] === "1" &&
      (/^\/api\/accounts\/[^/]+\/portfolio$/.test(req.path) ||
        req.path === "/api/assets/prices")
    ) {
      if (
        session.expiresAt <= now ||
        session.createdAt.getTime() <= now.getTime() - policy.absoluteMs ||
        session.lastSeenAt.getTime() <= now.getTime() - policy.idleMs
      )
        throw new UnauthorizedException("UNAUTHORIZED");
      req.user = session.user;
      return true;
    }
    // Check expiry while touching the row so logout cannot resurrect a session.
    const active = await this.db.session.updateMany({
      where: {
        id: session.id,
        expiresAt: { gt: now },
        createdAt: { gt: new Date(now.getTime() - policy.absoluteMs) },
        lastSeenAt: { gt: new Date(now.getTime() - policy.idleMs) },
      },
      data: { lastSeenAt: now },
    });
    if (active.count !== 1) throw new UnauthorizedException("UNAUTHORIZED");
    req.user = session.user;
    return true;
  }
}
@Catch()
export class SafeErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (
      error &&
      typeof error === "object" &&
      "type" in error &&
      (error.type === "entity.parse.failed" ||
        error.type === "entity.too.large")
    ) {
      res
        .status(error.type === "entity.too.large" ? 413 : 400)
        .json({ code: "VALIDATION_ERROR" });
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json({ code: "VALIDATION_ERROR" });
      return;
    }
    if (error instanceof HttpException) {
      res.status(error.getStatus()).json({
        code: error.message.match(/^[A-Z_]+$/)
          ? error.message
          : [400, 413].includes(error.getStatus())
            ? "VALIDATION_ERROR"
            : "REQUEST_FAILED",
      });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const status =
        error.code === "P2002" ? 409 : error.code === "P2025" ? 404 : 400;
      res.status(status).json({
        code:
          status === 409
            ? "CONFLICT"
            : status === 404
              ? "NOT_FOUND"
              : "REQUEST_FAILED",
      });
      return;
    }
    console.error(
      "Unhandled API error",
      error instanceof Error ? error.constructor.name : "Unknown",
    );
    res.status(500).json({ code: "SERVER_ERROR" });
  }
}
