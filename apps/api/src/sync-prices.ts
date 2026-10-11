import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
// Reuse API configuration and DI without starting an HTTP listener or scheduler.
process.env.OPULYA_TEST = "1";
process.env.MARKET_SCHEDULER_ENABLED = "false";
const { AppModule } = await import("./main.js");
const { MarketPriceSync } = await import("./instruments.js");
const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ["warn", "error"],
});
try {
  console.log("Latest price sync", await app.get(MarketPriceSync).run());
} catch (error) {
  console.error(
    "Daily price sync failed",
    error instanceof Error ? error.constructor.name : "Unknown",
    error && typeof error === "object" && "code" in error
      ? error.code
      : "REQUEST_FAILED",
  );
  process.exitCode = 1;
} finally {
  await app.close();
}
