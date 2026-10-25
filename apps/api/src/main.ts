import "reflect-metadata";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import { Controller, Get, Module } from "@nestjs/common";
import { type NestExpressApplication } from "@nestjs/platform-express";
import { json } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z } from "@opulya/shared";
import { Database } from "./db.js";
import { AuthController, AuthService } from "./auth.js";
import { PrivacyController, PrivacyService } from "./privacy.js";
import { RetentionService } from "./retention.js";
import {
  AuthGuard,
  SafeErrors,
  csrfProtection,
  loginAccountKey,
  verificationEmailKey,
  sessionPolicySchema,
} from "./security.js";
import { LedgerService } from "./ledger.js";
import { FinanceController } from "./controller.js";
import { ReportsService } from "./reports.js";
import { BudgetsService } from "./budgets.js";
import { MarketDataService } from "./market.js";
import {
  InstrumentProvider,
  InstrumentsService,
  MarketBudget,
} from "./instruments.js";
import { InstrumentDirectory } from "./instrument-directory.js";
import { MailService, mailSettingsSchema } from "./mail.js";
loadEnv({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});

@Controller("health")
class HealthController {
  @Get() health() {
    return { status: "ok" };
  }
}
@Module({
  controllers: [
    HealthController,
    AuthController,
    PrivacyController,
    FinanceController,
  ],
  providers: [
    Database,
    AuthService,
    PrivacyService,
    RetentionService,
    MailService,
    AuthGuard,
    LedgerService,
    ReportsService,
    BudgetsService,
    MarketDataService,
    MarketBudget,
    InstrumentProvider,
    InstrumentsService,
    InstrumentDirectory,
  ],
})
export class AppModule {}
export async function bootstrap(port = Number(process.env.API_PORT ?? 4000)) {
  mailSettingsSchema.parse(process.env);
  sessionPolicySchema
    .extend({
      MARKET_DATA_ENABLED: z.enum(["true", "false"]).default("true"),
      MARKET_REQUESTS_PER_MINUTE: z.coerce
        .number()
        .int()
        .min(1)
        .max(10000)
        .default(30),
      MARKET_REQUESTS_PER_DAY: z.coerce
        .number()
        .int()
        .min(1)
        .max(100000)
        .default(1000),
      TRUST_PROXY: z.enum(["true", "false"]).default("false"),
    })
    .parse(process.env);
  if (!process.env.DATABASE_URL || !process.env.WEB_ORIGIN)
    throw new Error("DATABASE_URL and WEB_ORIGIN are required");
  const origin = new URL(process.env.WEB_ORIGIN);
  if (
    origin.origin !== process.env.WEB_ORIGIN ||
    (process.env.NODE_ENV === "production" && origin.protocol !== "https:")
  )
    throw new Error(
      "WEB_ORIGIN must be an exact origin; HTTPS is required in production",
    );
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: ["error", "warn"],
  });
  if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
  app.setGlobalPrefix("api");
  app.use(helmet());
  app.use(cookieParser());
  app.use(json({ limit: "32kb" }));
  app.enableCors({
    origin: process.env.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Opulya-Request", "X-Opulya-Poll"],
  });
  app.use(csrfProtection);
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { code: "RATE_LIMITED" },
    }),
  );
  app.use(
    "/api/auth/login",
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 20,
      skipSuccessfulRequests: true,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { code: "RATE_LIMITED" },
    }),
  );
  app.use(
    ["/api/auth/export", "/api/auth/account", "/api/auth/processing"],
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { code: "RATE_LIMITED" },
    }),
  );
  app.use(
    "/api/auth/signup",
    rateLimit({
      windowMs: 60 * 60_000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { code: "RATE_LIMITED" },
    }),
  );
  app.use(
    ["/api/auth/signup", "/api/auth/resend-verification"],
    rateLimit({
      windowMs: 3600000,
      limit: 20,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { code: "RATE_LIMITED" },
    }),
  );
  app.use(
    ["/api/auth/signup", "/api/auth/resend-verification"],
    rateLimit({
      windowMs: 3600000,
      limit: 6,
      keyGenerator: (req) => verificationEmailKey(req.body) ?? "invalid",
      skip: (req) => verificationEmailKey(req.body) === null,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { code: "RATE_LIMITED" },
    }),
  );
  app.use(
    "/api/auth/verify-email",
    rateLimit({
      windowMs: 900000,
      limit: 20,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { code: "RATE_LIMITED" },
    }),
  );
  app.use(
    "/api/auth/login",
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 20,
      skip: (req) => loginAccountKey(req.body) === null,
      keyGenerator: (req) => loginAccountKey(req.body) ?? "invalid",
      skipSuccessfulRequests: true,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { code: "RATE_LIMITED" },
    }),
  );
  app.useGlobalFilters(new SafeErrors());
  app.use(
    "/api/instruments/directory",
    rateLimit({
      windowMs: 60_000,
      limit: 30,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { code: "RATE_LIMITED" },
    }),
  );
  app.enableShutdownHooks();
  await app.listen(port, "0.0.0.0");
  return app;
}
if (process.env.OPULYA_TEST !== "1") void bootstrap();
