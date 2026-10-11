import { testDatabaseUrl } from "../../packages/config/test-database.js";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../apps/api/src/generated/prisma/client";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, chooseOption } from "./fixtures";

test("asset prices distinguish plan restrictions, missing listings and supported stocks in both languages", async ({
  page,
}, testInfo) => {
  const database = testDatabaseUrl();
  if (new URL(database).pathname !== "/opulya_test")
    throw new Error("Dedicated test database required");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database }),
  });
  const ids: string[] = [];
  let userId = "";
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post(`/api/${path}`, {
      headers: { Origin: "http://localhost:3001", "X-Opulya-Request": "1" },
      data,
    });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  try {
    userId = (
      await post("auth/signup", {
        firstName: "Market",
        lastName: "Access",
        email: `market-access-${randomUUID()}@example.test`,
        password: "browser-test-password-123",
        locale: "en",
        timeZone: "Europe/Zagreb",
      })
    ).id;
    const listings = [
      {
        symbol: `ETF${suffix}`,
        name: "Restricted ETF",
        assetType: "ETF" as const,
        exchange: "Euronext",
        mic: "XAMS",
        currency: "EUR",
        error: "MARKET_PLAN_REQUIRED",
      },
      {
        symbol: `FUND${suffix}`,
        name: "Restricted fund",
        assetType: "FUND" as const,
        exchange: "FSX",
        mic: "XFRA",
        currency: "EUR",
        error: "MARKET_PLAN_REQUIRED",
      },
      {
        symbol: `STOCK${suffix}`,
        name: "Missing stock listing",
        assetType: "STOCK" as const,
        exchange: "XHAN",
        mic: "XHAN",
        currency: "EUR",
        error: "MARKET_SYMBOL_NOT_FOUND",
      },
      {
        symbol: `US${suffix}`,
        name: "Supported stock",
        assetType: "STOCK" as const,
        exchange: "NASDAQ",
        mic: "XNGS",
        currency: "USD",
        error: null,
      },
    ];
    for (const { error, ...listing } of listings) {
      const i = await db.instrument.create({
        data: {
          ...listing,
          identity: randomUUID(),
          timeZone: "UTC",
          mappings: {
            create: {
              provider: "Alpha Vantage",
              symbol: listing.symbol,
              exchange: listing.exchange,
              mic: listing.mic,
              currency: listing.currency,
            },
          },
        },
      });
      ids.push(i.id);
      await post("assets", { instrumentId: i.id });
      await db.instrumentMapping.updateMany({
        where: { instrumentId: i.id },
        data: {
          error,
          currentRequestedAt: null,
          lastAttemptAt: new Date(),
          ...(error ? {} : { lastSuccessAt: new Date() }),
        },
      });
      if (!error)
        await db.latestPrice.create({
          data: {
            instrumentId: i.id,
            provider: "Alpha Vantage",
            currency: listing.currency,
            price: "123.45",
            kind: "QUOTE",
            marketAt: new Date(),
            fetchedAt: new Date(),
            availableAt: new Date(),
            tradingDate: new Date(new Date().toISOString().slice(0, 10)),
          },
        });
    }
    await page.goto("/assets");
    await expect(
      page.getByText(
        "Your market-data plan does not include prices for this listing.",
        { exact: true },
      ),
    ).toHaveCount(2);
    await expect(
      page.getByText(
        "The market-data provider could not find this exact listing.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.locator(".asset-price .spinner")).toHaveCount(0);
    await expect(
      page.getByText("Market data is temporarily unavailable.", {
        exact: true,
      }),
    ).toHaveCount(0);
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
      path: `test-results/market-plan-en-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await chooseOption(page.getByLabel("Currency", { exact: true }), "USD");
    await expect(
      page.getByText("Supported stock", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".asset-price > .money")).toHaveText("US$123.45");
    await page.goto("/settings");
    await chooseOption(
      page.getByRole("combobox", { name: "Display language", exact: true }),
      "hr",
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Postavke", exact: true }),
    ).toBeVisible();
    await page.goto("/assets");
    await expect(
      page.getByText(
        "Vaš plan tržišnih podataka ne uključuje cijene za ovu kotaciju.",
        { exact: true },
      ),
    ).toHaveCount(2);
    await expect(
      page.getByText(
        "Pružatelj tržišnih podataka nije pronašao ovu točnu kotaciju.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/market-plan-hr-${testInfo.project.name}.png`,
      fullPage: true,
    });
  } finally {
    await db.asset.deleteMany({ where: { userId, instrumentId: { in: ids } } });
    await db.instrument.deleteMany({ where: { id: { in: ids } } });
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
});
