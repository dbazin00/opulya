import { testDatabaseUrl } from "../../packages/config/test-database.js";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../apps/api/src/generated/prisma/client";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, chooseOption } from "./fixtures";
import { mockMarketQuotes } from "./quotes";

test("live search debounces provider requests and shows one coin across platforms", async ({
  page,
}, testInfo) => {
  const database = testDatabaseUrl();
  if (new URL(database).pathname !== "/opulya_test")
    throw new Error("Browser fixtures require opulya_test");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database }),
  });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  const symbol = `BC${suffix}/EUR`,
    name = `Bitcoin fixture ${suffix}`;
  const ids: string[] = [],
    searches: string[] = [],
    errors: string[] = [];
  let userId = "";
  page.on("pageerror", (error) => errors.push(error.message));
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(`/api/${path}`, {
      headers: { Origin: "http://localhost:3001", "X-Opulya-Request": "1" },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  try {
    for (const exchange of ["Binance", "Kraken"]) {
      const instrument = await db.instrument.create({
        data: {
          name,
          symbol,
          assetType: "CRYPTO",
          exchange,
          mic: "",
          currency: "EUR",
          timeZone: "UTC",
          identity: randomUUID(),
          mappings: {
            create: {
              provider: "Yahoo Finance",
              symbol,
              exchange,
              mic: "",
              currency: "EUR",
            },
          },
        },
      });
      ids.push(instrument.id);
    }
    const preferred = await db.instrument.findUniqueOrThrow({
      where: { id: ids[0] },
    });
    const fund = await db.instrument.create({
      data: {
        name: `CoinShares ${name}`,
        symbol: `EF${suffix}`,
        assetType: "ETF",
        exchange: "Euronext",
        mic: "XAMS",
        currency: "EUR",
        timeZone: "Europe/Amsterdam",
        identity: randomUUID(),
      },
    });
    ids.push(fund.id);
    // Controlled provider responses test automatic lookup without using the real key or quota.
    await page.route("**/api/instruments/directory?**", async (route) => {
      const params = new URL(route.request().url()).searchParams;
      const query = params.get("search") ?? "";
      searches.push(query);
      if (query.startsWith("obsolete-")) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await route.fulfill({
          json: {
            items: [],
            total: 0,
            ownedCount: 0,
            page: 0,
            hasMore: false,
            loading: [],
            errors: [],
          },
        });
      } else {
        const owned = await db.asset.findFirst({
          where: { userId, instrumentId: preferred.id },
        });
        const items =
          params.get("assetType") === "ETF" ? [fund] : owned ? [] : [preferred];
        await route.fulfill({
          json: {
            items,
            total: items.length,
            ownedCount: owned && !items.length ? 1 : 0,
            page: 0,
            hasMore: false,
            loading: [],
            errors: [],
          },
        });
      }
    });
    userId = (
      await post("auth/signup", {
        firstName: "Alex",
        lastName: "Search",
        email: `search-${randomUUID()}@example.test`,
        password: "browser-test-password-123",
        locale: "en",
        timeZone: "Europe/Zagreb",
      })
    ).id;
    await post("accounts", {
      name: "First platform",
      type: "INVESTMENT",
      currency: "EUR",
      initialBalance: "0",
    });
    const second = await post("accounts", {
      name: "Second platform",
      type: "INVESTMENT",
      currency: "EUR",
      initialBalance: "0",
    });
    await page.goto("/investments");
    await page.getByRole("button", { name: "Add asset", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: "Manually recorded", exact: true }),
    ).toHaveCount(0);
    const input = dialog.getByLabel("Search by name, symbol or ISIN", {
      exact: true,
    });
    const lookup = `lookup-${suffix}`;
    await input.pressSequentially(lookup, { delay: 25 });
    let list = dialog.getByRole("list", { name: "Matching instruments" });
    await expect(list.getByRole("button")).toHaveCount(1);
    await expect(list).toContainText(symbol.split("/")[0]!);
    expect(searches).toEqual([lookup]);
    await expect(
      dialog.getByRole("button", { name: "Search Yahoo Finance", exact: true }),
    ).toHaveCount(0);
    await expect(list).not.toContainText("Binance");
    await expect(list).not.toContainText("Kraken");
    await expect(list).toContainText("Crypto");
    await input.fill("");
    await expect(
      list.getByRole("button").filter({ hasText: symbol.split("/")[0]! }),
    ).toHaveCount(0);
    await input.fill(lookup);
    await expect(list).toContainText(symbol.split("/")[0]!);
    // A negative assertion after the debounce window checks that the fresh query cache prevents another POST.
    await page.waitForTimeout(1100);
    expect(searches).toEqual([lookup]);
    const obsolete = `obsolete-${suffix}`;
    const oldRequest = page.waitForRequest(
      (request) =>
        request.url().includes("/api/instruments/directory?") &&
        new URL(request.url()).searchParams.get("search") === obsolete,
    );
    await input.fill(obsolete);
    await oldRequest;
    const oldResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/instruments/directory?") &&
        new URL(response.url()).searchParams.get("search") === obsolete,
    );
    await input.fill(symbol);
    await expect(list).toContainText(symbol.split("/")[0]!);
    await oldResponse;
    await expect(list.getByRole("button")).toHaveCount(1);
    await list.getByRole("button").click();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: `test-results/live-search-${testInfo.project.name}.png`,
    });
    await dialog
      .getByRole("button", { name: "Add asset", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const firstAsset = (
      await (await page.request.get("/api/assets")).json()
    )[0];
    expect(firstAsset.instrumentId).toBe(preferred.id);
    await chooseOption(
      page.getByRole("combobox", {
        name: "Select an investment account",
        exact: true,
      }),
      second.id,
    );
    await page
      .getByRole("button", { name: "Record activity", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await chooseOption(
      dialog.getByRole("combobox", { name: "Asset", exact: true }),
      firstAsset.id,
    );
    await expect(
      dialog.getByRole("combobox", { name: "Asset", exact: true }),
    ).toContainText(symbol);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    const saved = await (await page.request.get("/api/assets")).json();
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe(firstAsset.id);
    await page.getByRole("button", { name: "Add asset", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Search by name, symbol or ISIN", { exact: true })
      .fill(name);
    await expect(
      dialog.getByText("You already have all matching assets", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("list", { name: "Matching instruments" }),
    ).toHaveCount(0);
    await page.waitForTimeout(1100);
    expect(searches.filter((query) => query === lookup)).toEqual([lookup]);
    expect(searches.at(-1)).toBe(name);
    await chooseOption(
      dialog.getByRole("combobox", { name: "Asset type", exact: true }),
      "ETF",
    );
    list = dialog.getByRole("list", { name: "Matching instruments" });
    await expect(list.getByRole("button")).toHaveCount(1);
    await expect(list).toContainText("CoinShares");
    await chooseOption(
      dialog.getByRole("combobox", { name: "Asset type", exact: true }),
      "CRYPTO",
    );
    await expect(
      dialog.getByText("You already have all matching assets", { exact: true }),
    ).toBeVisible();
    await expect(list).toHaveCount(0);
    await page.screenshot({
      path: `test-results/bitcoin-only-${testInfo.project.name}.png`,
    });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    expect(searches.filter((query) => query === name)).toHaveLength(3);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    if (userId) {
      await db.asset.deleteMany({ where: { userId } });
      await db.account.deleteMany({ where: { userId } });
      await db.user.deleteMany({ where: { id: userId } });
    }
    await db.instrument.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});

test("selects the exact instrument listing and values it using a current quote", async ({
  page,
}, testInfo) => {
  const database = testDatabaseUrl();
  if (new URL(database).pathname !== "/opulya_test")
    throw new Error("Browser fixtures require opulya_test");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database }),
  });
  const symbol = `QA${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  await mockMarketQuotes(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(`/api/${path}`, {
      headers: { Origin: "http://localhost:3001", "X-Opulya-Request": "1" },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  let userId = "";
  const ids: string[] = [];
  try {
    // Only public instrument metadata is inserted into the isolated test DB.
    for (const exchange of ["AMS", "CXE"]) {
      const instrument = await db.instrument.create({
        data: {
          name: "Example World UCITS ETF USD (Acc)",
          symbol,
          assetType: "ETF",
          exchange,
          mic: exchange === "AMS" ? "XAMS" : "",
          exchangeName: exchange === "AMS" ? "Amsterdam" : "Cboe Europe",
          currency: "EUR",
          timeZone: "Europe/Berlin",
          identity: randomUUID(),
          mappings: {
            create: {
              provider: "Yahoo Finance",
              symbol,
              exchange,
              mic: exchange === "AMS" ? "XAMS" : "",
              currency: "EUR",
            },
          },
        },
      });
      ids.push(instrument.id);
    }
    userId = (
      await post("auth/signup", {
        firstName: "Alex",
        lastName: "Picker",
        email: `picker-${randomUUID()}@example.test`,
        password: "browser-test-password-123",
        locale: "en",
        timeZone: "Europe/Zagreb",
      })
    ).id;
    const bank = await post("accounts", {
      name: "Everyday account",
      type: "BANK",
      currency: "EUR",
      initialBalance: "1000",
    });
    const account = await post("accounts", {
      name: "Investments",
      type: "INVESTMENT",
      currency: "EUR",
      initialBalance: "0",
    });
    await page.goto("/investments");
    await page.getByRole("button", { name: "Add asset", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await chooseOption(
      dialog.getByRole("combobox", { name: "Asset type", exact: true }),
      "ETF",
    );
    await dialog
      .getByLabel("Search by name, symbol or ISIN", { exact: true })
      .fill(symbol);
    const results = dialog.getByRole("list", { name: "Matching instruments" });
    await expect(results.getByRole("button")).toHaveCount(2);
    await expect(
      dialog.getByRole("button", {
        name: "Add asset",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      results.getByRole("button").first().locator("strong"),
    ).toHaveText("Example World UCITS ETF USD (Acc)");
    await expect(results).toContainText("Euronext Amsterdam");
    await expect(results).toContainText("Cboe Europe");
    await expect(
      results.getByText("Trades in EUR", { exact: true }),
    ).toHaveCount(2);
    await expect(results).not.toContainText("XAMS");
    const correct = results
      .getByRole("button")
      .filter({ hasText: "Euronext Amsterdam" });
    await correct.click();
    await expect(correct).toHaveAttribute("aria-pressed", "true");
    await expect(correct).toContainText("Trades in EUR");
    await expect(
      dialog.getByText("Selected listing", { exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByText("Listing details", { exact: true }),
    ).toHaveCount(0);
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: `test-results/instrument-picker-${testInfo.project.name}.png`,
    });
    await dialog
      .getByRole("button", { name: "Add asset", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await page
      .getByRole("button", { name: "Record activity", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Add asset", exact: true }),
    ).toHaveCount(0);
    await chooseOption(
      dialog.getByRole("combobox", { name: "Asset", exact: true }),
      {
        label: `Example World UCITS ETF USD (Acc) · Euronext Amsterdam · EUR · ${symbol}`,
      },
    );
    await expect(
      dialog.getByRole("combobox", { name: "Asset", exact: true }),
    ).toContainText("Euronext Amsterdam");
    await chooseOption(
      dialog.getByRole("combobox", { name: "Funding account", exact: true }),
      bank.id,
    );
    await dialog.getByLabel("Quantity", { exact: true }).fill("2");
    await dialog.getByLabel("Price per unit", { exact: true }).fill("100");
    await dialog.getByLabel("Fee", { exact: true }).fill("50");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator(".holding")).toContainText("€246.90");
    await expect(page.locator(".price-status")).toContainText("Price as of");
    await expect(
      page.getByRole("button", { name: "Refresh", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".price-status")).not.toContainText(
      "Yahoo Finance",
    );
    await expect(page.locator(".market-data-credit")).toHaveCount(1);
    await expect(
      page
        .locator(".market-data-credit")
        .getByRole("link", { name: "Yahoo Finance", exact: true }),
    ).toHaveAttribute("href", "https://finance.yahoo.com");
    const response = await page.request.get(
      `/api/accounts/${account.id}/portfolio`,
    );
    const value = await response.json();
    expect(value.assets[0].instrumentId).toBe(ids[0]);
    expect(value.assets[0].exchangeName).toBe("Amsterdam");
    expect(value.assets[0].mic).toBe("XAMS");
    expect(value.positions[0].costBasis).toBe("250");
    // The isolated API has market data disabled; browser quotes are mocked separately.
    expect(value.positions[0].unrealizedGain).toBeNull();
    await expect(page.locator(".holding-metrics")).toContainText("-€3.10");
    await expect(
      page.getByText("Historical valuation", { exact: true }),
    ).toHaveCount(0);
    await page.goto("/dashboard");
    await expect(page.locator(".market-data-credit")).toHaveCount(1);
    await expect(
      page
        .locator(".market-data-credit")
        .getByRole("link", { name: "Yahoo Finance", exact: true }),
    ).toHaveAttribute("href", "https://finance.yahoo.com");
    await page.goto("/investments");
    await expect(page.locator(".holding-metrics")).toContainText(
      "Remaining cost incl. fees",
    );
    await page.reload();
    await expect(page.locator(".holding")).toContainText("€246.90");
    await expect(
      page.getByRole("button", { name: "Match instrument", exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/current-quote-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await page.goto("/settings");
    await chooseOption(
      page.getByRole("combobox", { name: "Display language", exact: true }),
      "hr",
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.goto("/investments");
    await expect(page.locator(".price-status")).toContainText("Cijena na dan");
    await expect(page.locator(".holding")).toContainText("246,90");
    await expect(page.locator(".holding")).toContainText("Trguje se u EUR");
    await expect(
      page
        .locator(".holding")
        .getByText("Detalji instrumenta", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".market-data-credit")).toHaveText(
      "Podatke pruža Yahoo Finance",
    );
    expect(errors).toEqual([]);
  } finally {
    if (userId) {
      await db.investmentTransaction.deleteMany({ where: { userId } });
      await db.transaction.deleteMany({ where: { userId } });
      await db.asset.deleteMany({ where: { userId } });
      await db.account.deleteMany({ where: { userId } });
      await db.user.deleteMany({ where: { id: userId } });
    }
    await db.instrument.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
