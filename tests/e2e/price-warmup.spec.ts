import { testDatabaseUrl } from "../../packages/config/test-database.js";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../apps/api/src/generated/prisma/client";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, chooseOption } from "./fixtures";

test("first portfolio price appears automatically without manual refresh", async ({
  page,
}, testInfo) => {
  const database = testDatabaseUrl();
  if (new URL(database).pathname !== "/opulya_test")
    throw new Error("Isolated test database required");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database }),
  });
  let userId = "",
    instrumentId = "",
    pendingRequests = 0;
  const pollHeaders: (string | undefined)[] = [];
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
        provider: "Alpha Vantage",
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
    const account = await post("accounts", {
      name: "Portfolio",
      type: "INVESTMENT",
      currency: "EUR",
      initialBalance: "0",
    });
    const asset = await post("assets", { instrumentId });
    // Simulate a delayed background job with a stored quote; never contact the real provider.
    await page.route(
      `**/api/accounts/${account.id}/portfolio`,
      async (route) => {
        pollHeaders.push(route.request().headers()["x-opulya-poll"]);
        if (pendingRequests >= 1) {
          const fetchedAt = new Date();
          const tradingDate = new Date(fetchedAt.getTime() - 86400000);
          tradingDate.setUTCHours(0, 0, 0, 0);
          await db.latestPrice.upsert({
            where: { instrumentId },
            create: {
              instrumentId,
              price: "95000",
              currency: "EUR",
              provider: "Alpha Vantage",
              tradingDate,
              availableAt: new Date(tradingDate.getTime() + 86400000),
              fetchedAt,
            },
            update: {},
          });
          await db.instrumentMapping.updateMany({
            where: { instrumentId },
            data: { lastSuccessAt: fetchedAt },
          });
        }
        const response = await route.fetch();
        const data = await response.json();
        if (
          data.positions.some(
            (row: { quantity: string }) => row.quantity !== "0",
          ) &&
          data.quotes.some((row: { quote: unknown }) => !row.quote)
        ) {
          pendingRequests++;
          for (const quote of data.quotes)
            if (!quote.quote) quote.error = "MARKET_PRICE_PENDING";
        }
        await route.fulfill({ json: data });
      },
    );
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
    await expect(page.locator(".pending-price")).toContainText(
      "Fetching price",
    );
    await expect(
      page.locator(".investment-stats .spinner[role=status]"),
    ).toHaveCount(2);
    await expect(
      page.locator(".investment-stats .spinner[role=status]").first(),
    ).toHaveAttribute("aria-label", "Fetching price");
    await expect(page.locator(".holding")).toContainText("€850.00");
    await page.screenshot({
      path: `test-results/price-pending-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await expect(page.locator(".holding-title .money")).toHaveText("€950.00");
    await expect(page.locator(".pending-price")).toHaveCount(0);
    await expect(page.locator(".holding-metrics")).toContainText("€100.00");
    expect(pollHeaders).toContain("1");
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
    const seen = pollHeaders.length;
    await page.goto("/categories");
    await page.waitForTimeout(2500);
    expect(pollHeaders.length).toBe(seen);
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
