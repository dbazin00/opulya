import { testDatabaseUrl } from "../../packages/config/test-database.js";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../apps/api/src/generated/prisma/client";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, chooseOption } from "./fixtures";
import { mockMarketQuotes } from "./quotes";

test("near-live quotes refresh only while the portfolio is visible", async ({
  page,
}, testInfo) => {
  const database = testDatabaseUrl();
  if (new URL(database).pathname !== "/opulya_test")
    throw new Error("Isolated test database required");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database }),
  });
  let userId = "",
    instrumentId = "";
  let price = "95000";
  let stale = false;
  const { requests } = await mockMarketQuotes(page, () => ({
    price,
    stale,
    error: stale ? "MARKET_RATE_LIMIT" : null,
    delayMinutes: 15,
  }));
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(`/api/${path}`, {
      headers: { Origin: "http://localhost:3001", "X-Opulya-Request": "1" },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  try {
    const instrument = await db.instrument.create({
      data: {
        name: "Bitcoin warmup fixture",
        symbol: `PW${randomUUID().replaceAll("-", "").slice(0, 10)}/EUR`,
        assetType: "CRYPTO",
        exchange: "Binance",
        currency: "EUR",
        timeZone: "UTC",
        identity: randomUUID(),
      },
    });
    instrumentId = instrument.id;
    await db.instrumentMapping.create({
      data: {
        instrumentId,
        provider: "Yahoo Finance",
        symbol: instrument.symbol,
        exchange: "Binance",
        currency: "EUR",
      },
    });
    userId = (
      await post("auth/signup", {
        firstName: "Alex",
        lastName: "Warmup",
        email: `warmup-${randomUUID()}@example.test`,
        password: "browser-test-password-123",
        locale: "en",
        timeZone: "Europe/Zagreb",
      })
    ).id;
    const bank = await post("accounts", {
      name: "Funding bank",
      type: "BANK",
      currency: "EUR",
      initialBalance: "1000",
    });
    await post("accounts", {
      name: "Portfolio",
      type: "INVESTMENT",
      currency: "EUR",
      initialBalance: "0",
    });
    const asset = await post("assets", { instrumentId });
    await page.clock.install();
    await page.goto("/investments");
    await page
      .getByRole("button", { name: "Record activity", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await chooseOption(
      dialog.getByRole("combobox", { name: "Asset", exact: true }),
      asset.id,
    );
    await chooseOption(
      dialog.getByRole("combobox", { name: "Funding account", exact: true }),
      bank.id,
    );
    await dialog.getByLabel("Quantity", { exact: true }).fill("0.01");
    await dialog.getByLabel("Price per unit", { exact: true }).fill("80000");
    await dialog.getByLabel("Fee", { exact: true }).fill("50");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator(".holding-title .money")).toHaveText("€950.00");
    await expect(page.locator(".holding-metrics")).toContainText("€850.00");
    await expect(page.locator(".holding-metrics")).toContainText("€100.00");
    await expect(page.locator(".price-status")).toContainText("Price as of");
    await expect(page.locator(".price-status")).toContainText(
      "Provider delay: 15 min",
    );
    price = "97000";
    await page.clock.fastForward(60_100);
    await expect(page.locator(".holding-title .money")).toHaveText("€970.00");
    await expect(page.locator(".holding-metrics")).toContainText("€120.00");
    expect(requests.some((request) => request.background)).toBe(true);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(100);
    const hiddenCount = requests.length;
    await page.clock.fastForward(120_000);
    expect(requests.length).toBe(hiddenCount);
    stale = true;
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.locator(".price-status")).toContainText("Stale price");
    await expect(page.locator(".holding-title .money")).toHaveText("€970.00");
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/price-ready-${testInfo.project.name}.png`,
      fullPage: true,
    });
    const seen = requests.length;
    await page.goto("/categories");
    await page.clock.fastForward(120_000);
    expect(requests.length).toBe(seen);
  } finally {
    if (userId) {
      await db.investmentTransaction.deleteMany({ where: { userId } });
      await db.transaction.deleteMany({ where: { userId } });
      await db.asset.deleteMany({ where: { userId } });
      await db.account.deleteMany({ where: { userId } });
      await db.user.deleteMany({ where: { id: userId } });
    }
    if (instrumentId)
      await db.instrument.deleteMany({ where: { id: instrumentId } });
    await db.$disconnect();
  }
});
