import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../apps/api/src/generated/prisma/client";
import { testDatabaseUrl } from "../../packages/config/test-database.js";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, chooseOption } from "./fixtures";

test("one catalogue search accepts names, symbols and ISINs without broker matching", async ({
  page,
}, testInfo) => {
  const database = testDatabaseUrl();
  if (new URL(database).pathname !== "/opulya_test")
    throw new Error("Isolated test database required");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database }),
  });
  const prefix = `SEARCH${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const ids: string[] = [];
  let userId = "";
  const queries: string[] = [];
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
  try {
    for (const [exchange, mic, suffix, currency] of [
      ["AMS", "XAMS", "AS", "EUR"],
      ["CXE", "", "XC", "EUR"],
      ["LSE", "XLON", "L", "USD"],
    ] as const) {
      const symbol = `${prefix}.${suffix}`;
      const instrument = await db.instrument.create({
        data: {
          name: "Global equity fund USD (Acc)",
          symbol,
          assetType: "ETF",
          exchange,
          mic,
          currency,
          timeZone: "Europe/Amsterdam",
          identity: randomUUID(),
          mappings: {
            create: {
              provider: "Yahoo Finance",
              symbol,
              exchange,
              mic,
              currency,
            },
          },
        },
      });
      ids.push(instrument.id);
    }
    await page.route("**/api/instruments/directory?**", async (route) => {
      const query = new URL(route.request().url()).searchParams;
      const search = query.get("search") ?? "";
      queries.push(search);
      expect(query.has("exchange")).toBe(false);
      const items =
        search === "No results"
          ? []
          : await db.instrument.findMany({
              where: {
                id: { in: ids },
                currency: query.get("currency") ?? "EUR",
              },
              orderBy: { symbol: "asc" },
            });
      await route.fulfill({
        json: {
          items,
          total: items.length,
          ownedCount: 0,
          page: 0,
          hasMore: false,
        },
      });
    });
    userId = (
      await post("auth/signup", {
        firstName: "Alex",
        lastName: "Search",
        email: `search-${randomUUID()}@example.test`,
        password: "browser-test-password-123",
        locale: "en",
      })
    ).id;
    await page.goto("/assets");
    await page.getByRole("button", { name: "Add asset", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: "Find my holding", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Browse catalogue", exact: true }),
    ).toHaveCount(0);
    await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    const search = dialog.getByLabel("Search by name, symbol or ISIN", {
      exact: true,
    });
    const save = dialog.getByRole("button", {
      name: "Add asset",
      exact: true,
    });
    const results = dialog.getByRole("list", { name: "Matching instruments" });
    await expect(save).toBeDisabled();
    for (const query of [
      "Global equity",
      prefix,
      "IWDA.AS",
      "S&P 500",
      "IE00B4L5Y983",
      "IE00B4L5Y984",
      "BTC/EUR",
    ]) {
      await search.fill(query);
      await expect.poll(() => queries.at(-1)).toBe(query);
      await expect(results.getByRole("button")).toHaveCount(2);
      await expect(search).not.toHaveAttribute("aria-invalid", "true");
    }
    await search.fill("No results");
    await expect(
      dialog.getByText("No matching instruments in the catalogue", {
        exact: true,
      }),
    ).toBeVisible();
    await search.fill(prefix);
    await expect(results.getByRole("button")).toHaveCount(2);
    await expect(results).not.toContainText("Trades in USD");
    const amsterdam = results
      .getByRole("button")
      .filter({ hasText: "Euronext Amsterdam" });
    const cboe = results.getByRole("button").filter({ hasText: "Cboe Europe" });
    await expect(cboe).toBeEnabled();
    await cboe.click();
    await expect(save).toBeEnabled();
    await amsterdam.press("Enter");
    await expect(amsterdam).toHaveAttribute("aria-pressed", "true");
    await expect(cboe).toHaveAttribute("aria-pressed", "false");
    await expect(
      dialog.getByRole("region", { name: "Selected listing", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByText("Listing details", { exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByText("Global equity fund USD (Acc)", { exact: true }),
    ).toHaveCount(2);
    await expect(save).toBeInViewport();
    await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/asset-search-${testInfo.project.name}.png`,
    });
    let selectionBody: unknown;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/assets") && request.method() === "POST")
        selectionBody = request.postDataJSON();
    });
    await save.click();
    await expect(dialog).not.toBeVisible();
    expect(selectionBody).toEqual({ instrumentId: ids[0] });
    const asset = await db.asset.findFirstOrThrow({ where: { userId } });
    expect(asset.instrumentId).toBe(ids[0]);
    await page.goto("/settings");
    await chooseOption(
      page.getByRole("combobox", { name: "Display language", exact: true }),
      "hr",
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.goto("/assets");
    await page
      .getByRole("button", { name: "Dodaj instrument", exact: true })
      .click();
    await expect(
      dialog.getByLabel("Pretraži po nazivu, oznaci ili ISIN-u", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await dialog.getByRole("button", { name: "Zatvori", exact: true }).click();
    expect(errors).toEqual([]);
  } finally {
    if (userId) {
      await db.asset.deleteMany({ where: { userId } });
      await db.user.deleteMany({ where: { id: userId } });
    }
    await db.instrument.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
