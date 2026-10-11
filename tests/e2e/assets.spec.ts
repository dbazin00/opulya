import { testDatabaseUrl } from "../../packages/config/test-database.js";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../apps/api/src/generated/prisma/client";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, chooseOption } from "./fixtures";

test("asset library separates currencies and receives its first quote automatically", async ({
  page,
}, testInfo) => {
  const database = testDatabaseUrl();
  if (new URL(database).pathname !== "/opulya_test")
    throw new Error("Dedicated test database required");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database }),
  });
  const ids: string[] = [];
  let userId = "",
    pendingReads = 0;
  const headers: (string | undefined)[] = [];
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const name = `Bitcoin library fixture ${suffix}`;
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(`/api/${path}`, {
      headers: { Origin: "http://localhost:3001", "X-Opulya-Request": "1" },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  try {
    for (const currency of ["EUR", "USD"]) {
      const item = await db.instrument.create({
        data: {
          symbol: `AL${suffix}/${currency}`,
          name,
          assetType: "CRYPTO",
          exchange: "Binance",
          mic: "",
          currency,
          timeZone: "UTC",
          identity: randomUUID(),
          mappings: {
            create: {
              symbol: `AL${suffix}/${currency}`,
              provider: "Alpha Vantage",
              exchange: "Binance",
              mic: "",
              currency,
            },
          },
        },
      });
      ids.push(item.id);
    }
    userId = (
      await post("auth/signup", {
        firstName: "Alex",
        lastName: "Assets",
        email: `asset-ui-${randomUUID()}@example.test`,
        password: "browser-test-password-123",
        locale: "en",
        timeZone: "Europe/Zagreb",
      })
    ).id;
    await post("assets", { instrumentId: ids[1] });
    const providerTime = new Date(Date.now() - 1000),
      updated = new Date();
    await db.latestPrice.create({
      data: {
        instrumentId: ids[1]!,
        price: "105000",
        currency: "USD",
        provider: "Alpha Vantage",
        kind: "QUOTE",
        marketAt: providerTime,
        fetchedAt: updated,
        availableAt: providerTime,
        tradingDate: new Date(updated.toISOString().slice(0, 10)),
      },
    });
    // A stored response simulates the background provider completion without a live API/key.
    await page.route("**/api/assets/prices", async (route) => {
      headers.push(route.request().headers()["x-opulya-poll"]);
      const owned = await db.asset.findFirst({
        where: { userId, instrumentId: ids[0] },
      });
      if (owned && pendingReads >= 1) {
        await db.latestPrice.upsert({
          where: { instrumentId: ids[0]! },
          create: {
            instrumentId: ids[0]!,
            price: "95000",
            currency: "EUR",
            provider: "Alpha Vantage",
            kind: "QUOTE",
            marketAt: providerTime,
            fetchedAt: updated,
            availableAt: providerTime,
            tradingDate: new Date(updated.toISOString().slice(0, 10)),
          },
          update: {},
        });
        await db.instrumentMapping.updateMany({
          where: { instrumentId: ids[0] },
          data: {
            lastSuccessAt: updated,
            error: null,
            currentRequestedAt: null,
          },
        });
      }
      const response = await route.fetch();
      const data = await response.json();
      for (const row of data)
        if (!row.quote) {
          row.error = "MARKET_PRICE_PENDING";
          pendingReads++;
        }
      await route.fulfill({ json: data });
    });
    let releaseAssets!: () => void;
    const initialAssets = new Promise<void>((resolve) => {
      releaseAssets = resolve;
    });
    await page.route("**/api/assets", async (route) => {
      if (route.request().method() === "GET") await initialAssets;
      await route.continue();
    });
    try {
      await page.goto("/assets");
      const loading = page.locator(".loading[role='status']");
      await expect(loading).toBeVisible();
      await expect(loading).toHaveText("Loading");
      await expect(loading.locator(".spinner")).toHaveCount(0);
      await expect(loading.locator(":scope > .spinner-icon")).toHaveCount(1);
    } finally {
      releaseAssets();
    }
    await expect(
      page.getByRole("heading", { name: "Assets", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("No assets match these filters")).toBeVisible();
    await expect(page.getByLabel("Currency", { exact: true })).toContainText(
      "EUR",
    );
    await page.getByRole("button", { name: "Add asset", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByLabel("Price per unit", { exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByLabel("Search by name or symbol", { exact: true })
      .fill(name);
    const matches = dialog.getByRole("list", { name: "Matching instruments" });
    await expect(matches.getByRole("button")).toHaveCount(1);
    await expect(matches).toContainText("EUR");
    await expect(matches).not.toContainText("USD");
    await matches.getByRole("button").click();
    await dialog
      .getByRole("button", { name: "Use selected instrument", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const row = page.locator(".asset-row");
    await expect(row).toHaveCount(1);
    await expect(row.locator(".asset-price .spinner")).toBeVisible();
    await expect(row.locator(".asset-price > .money")).toHaveText("€95,000.00");
    await expect(row.locator(".asset-price-date")).toContainText("Price date:");
    await expect(row.locator(".asset-price-date")).not.toContainText(
      "Provider time:",
    );
    await expect(row.locator("time").first()).toHaveAttribute(
      "dateTime",
      updated.toISOString().slice(0, 10),
    );
    await expect(row.locator("time")).toHaveCount(1);
    await expect(row.locator(".asset-price-date")).not.toContainText(
      "Updated:",
    );
    await expect(
      row.getByRole("button", { name: `Delete ${name}`, exact: true }),
    ).toHaveCount(1);
    await expect(row.locator(".asset-price-date > .icon-button")).toHaveCount(
      1,
    );
    await expect(row.getByRole("button", { name: /refresh/i })).toHaveCount(0);
    await expect(row).not.toContainText("Alpha Vantage");
    const credit = page.locator(".market-data-credit");
    await expect(credit).toHaveCount(1);
    await expect(credit).toContainText("Data provided by Alpha Vantage");
    const source = credit.getByRole("link", {
      name: "Alpha Vantage",
      exact: true,
    });
    await expect(source).toHaveAttribute("href", "https://www.alphavantage.co");
    await expect(source).toHaveAttribute("target", "_blank");
    await expect(source).toHaveAttribute("rel", "noopener noreferrer");
    await expect(page.getByText(/12:00 UTC/)).toBeVisible();
    expect(headers).toContain("1");
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/assets-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await chooseOption(page.getByLabel("Currency", { exact: true }), "USD");
    await expect(row).toHaveCount(1);
    await expect(row.locator(".asset-price > .money")).toHaveText(
      "US$105,000.00",
    );
    await expect(row.locator(".asset-identity")).toContainText("USD");
    await expect(row.locator(".asset-identity")).not.toContainText("EUR");
    await page.getByRole("button", { name: "Add asset", exact: true }).click();
    await dialog
      .getByLabel("Search by name or symbol", { exact: true })
      .fill(name);
    await expect(
      dialog.getByText("You already have all matching assets", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      row.getByRole("button", { name: "Match instrument", exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Search assets", { exact: true }).fill("No match");
    await expect(row).toHaveCount(0);
    await page.getByLabel("Search assets", { exact: true }).fill("");
    await chooseOption(page.getByLabel("Asset type", { exact: true }), "ETF");
    await expect(row).toHaveCount(0);
    await chooseOption(page.getByLabel("Asset type", { exact: true }), "");
    await expect(row).toHaveCount(1);
    const reads = headers.length;
    await page.goto("/settings");
    await page.waitForTimeout(2200);
    expect(headers.length).toBe(reads);
    await chooseOption(
      page.getByRole("combobox", { name: "Display language", exact: true }),
      "hr",
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.goto("/assets");
    await expect(
      page.getByRole("heading", { name: "Instrumenti", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".asset-price > .money")).toHaveText(
      "95.000,00 €",
    );
    await expect(page.locator(".asset-price-date")).toContainText(
      "Datum cijene:",
    );
    await expect(page.locator(".market-data-credit")).toHaveText(
      "Podatke pruža Alpha Vantage",
    );
    await row
      .getByRole("button", { name: `Obriši ${name}`, exact: true })
      .click();
    const deletion = page.getByRole("dialog", {
      name: "Obriši instrument",
      exact: true,
    });
    await expect(deletion).toContainText(name);
    await deletion
      .getByRole("button", { name: "Odustani", exact: true })
      .click();
    await expect(row).toHaveCount(1);
    await row
      .getByRole("button", { name: `Obriši ${name}`, exact: true })
      .click();
    await deletion.getByRole("button", { name: "Obriši", exact: true }).click();
    await expect(deletion).not.toBeVisible();
    await expect(row).toHaveCount(0);
    expect(
      await db.latestPrice.count({ where: { instrumentId: ids[0] } }),
    ).toBe(1);
  } finally {
    await db.asset.deleteMany({ where: { userId } });
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    await db.instrument.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
