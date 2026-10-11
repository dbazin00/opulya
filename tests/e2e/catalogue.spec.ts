import { testDatabaseUrl } from "../../packages/config/test-database.js";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, chooseOption } from "./fixtures";

test("add asset defaults to all types and browses grouped, paged currency-specific references", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const signup = await page.request.post("/api/auth/signup", {
    headers: { Origin: "http://localhost:3001", "X-Opulya-Request": "1" },
    data: {
      firstName: "Alex",
      lastName: "Catalogue",
      email: `catalogue-${randomUUID()}@example.test`,
      password: "browser-test-password-123",
      locale: "en",
    },
  });
  expect(signup.ok(), await signup.text()).toBe(true);
  const user = await signup.json();
  const database = testDatabaseUrl();
  if (new URL(database).pathname !== "/opulya_test")
    throw new Error("Dedicated test database required");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } =
    await import("../../apps/api/src/generated/prisma/client");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database }),
  });
  let browseCount = 0;
  const queries: URLSearchParams[] = [];
  await page.route("**/api/instruments/directory?**", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    queries.push(query);
    browseCount++;
    const currency = query.get("currency")!,
      pageIndex = Number(query.get("page"));
    const items = ["STOCK", "ETF", "CRYPTO", "FUND"]
      .flatMap((type) =>
        Array.from({ length: 45 }, (_, i) => ({
          id: `fixture-${type}-${currency}-${i}`,
          name: `${type === "STOCK" ? "Company" : type === "ETF" ? "Vanguard ETF" : type === "CRYPTO" ? "Coin" : "Mutual fund"} ${String(i).padStart(2, "0")}`,
          symbol: `${type}${i}`,
          assetType: type,
          currency,
          exchange: "XETRA",
          mic: "XETR",
          timeZone: "Europe/Berlin",
          isin: null,
        })),
      )
      .filter(
        (row) =>
          (!query.get("assetType") ||
            row.assetType === query.get("assetType")) &&
          `${row.name} ${row.symbol}`
            .toLowerCase()
            .includes((query.get("search") ?? "").toLowerCase()),
      );
    const perType = query.get("assetType") ? 40 : 10;
    const groups = ["STOCK", "ETF", "CRYPTO", "FUND"].map((type) =>
      items.filter((row) => row.assetType === type),
    );
    await route.fulfill({
      json: {
        items: groups.flatMap((rows) =>
          rows.slice(pageIndex * perType, (pageIndex + 1) * perType),
        ),
        total: items.length,
        page: pageIndex,
        hasMore: groups.some((rows) => rows.length > (pageIndex + 1) * perType),
        loading: browseCount === 1 ? ["STOCK", "ETF", "FUND"] : [],
        errors: [],
      },
    });
  });
  try {
    await page.goto("/assets");
    await page.getByRole("button", { name: "Add asset", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: "Manually recorded", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByLabel("Market data symbol", { exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("combobox", { name: "Asset type", exact: true }),
    ).toContainText("All");
    const list = dialog.getByRole("list", { name: "Matching instruments" });
    await expect(list.getByRole("button")).toHaveCount(40);
    for (const type of ["Stock", "ETF", "Crypto", "Fund"])
      await expect(
        list.getByRole("heading", { name: type, exact: true }),
      ).toBeVisible();
    await expect(dialog.getByText("Loading market catalogue")).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Next results", exact: true })
      .click();
    await expect(list).toContainText("Vanguard ETF 10");
    await expect(list).not.toContainText("Vanguard ETF 00");
    await chooseOption(
      dialog.getByRole("combobox", { name: "Asset type", exact: true }),
      "ETF",
    );
    await expect(list.getByRole("button")).toHaveCount(40);
    await dialog
      .getByRole("button", { name: "Next results", exact: true })
      .click();
    await expect(list.getByRole("button")).toHaveCount(5);
    await dialog
      .getByLabel("Search by name or symbol", { exact: true })
      .fill("Vanguard ETF 44");
    await expect(list.getByRole("button")).toHaveCount(1);
    await expect(list).toContainText("EUR");
    await expect(list).not.toContainText("USD");
    await expect(dialog.locator(".market-data-credit")).toHaveCount(1);
    await expect(
      dialog
        .locator(".market-data-credit")
        .getByRole("link", { name: "Alpha Vantage", exact: true }),
    ).toHaveAttribute("href", "https://www.alphavantage.co");
    await expect(
      dialog.getByText("1 instrument", { exact: true }),
    ).toBeVisible();
    await list.getByRole("button").click();
    await expect(
      dialog.getByRole("button", {
        name: "Use selected instrument",
        exact: true,
      }),
    ).toBeEnabled();
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
      path: `test-results/catalogue-${testInfo.project.name}.png`,
    });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await chooseOption(page.getByLabel("Currency", { exact: true }), "USD");
    await page.getByRole("button", { name: "Add asset", exact: true }).click();
    await expect(list).toContainText("USD");
    await expect(list).not.toContainText("EUR");
    expect(
      queries.some(
        (query) =>
          query.get("page") === "1" && query.get("assetType") === "ETF",
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
