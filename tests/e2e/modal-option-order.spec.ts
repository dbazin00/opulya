import { randomUUID } from "node:crypto";
import type { APIRequestContext, Locator } from "@playwright/test";
import { test, expect, chooseOption, catalogueFixture } from "./fixtures";

function api(request: APIRequestContext) {
  return async (path: string, data: unknown) => {
    const response = await request.post(`/api/${path}`, {
      headers: { Origin: "http://localhost:3001", "X-Opulya-Request": "1" },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
}

test.beforeEach(async ({ page }) => {
  await api(page.request)("auth/signup", {
    firstName: "Alex",
    lastName: "Ordering",
    email: `ordering-${randomUUID()}@example.test`,
    password: "browser-test-password-123",
    locale: "en",
    timeZone: "Europe/Zagreb",
  });
});

async function optionValues(control: Locator) {
  await expect(control).toBeVisible();
  return control
    .locator("..")
    .locator("select.select-form-bridge option")
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
}

test("modal account, category and asset options sort by name without changing selections", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const post = api(page.request);
  const account = async (name: string, type = "BANK", currency = "EUR") =>
    post("accounts", { name, type, currency, initialBalance: "1000" });
  const zeta = await account("Zulu");
  const wallet10 = await account("wallet 10");
  const alpha = await account("Alpha");
  const wallet2 = await account("Wallet 2");
  const portfolio = await account("Portfolio", "INVESTMENT");
  const usd = await account("US dollar account", "BANK", "USD");
  const category = async (name: string, parentId: string | null = null) =>
    post("categories", { name, parentId, type: "EXPENSE" });
  const zoo = await category("Zoo");
  const otherFood = await category("Food & drinks");
  const food = await category("Food");
  const restaurants = await category("Restaurants", food.id);
  const restaurantZulu = await category("Zulu", restaurants.id);
  const groceries = await category("groceries", food.id);
  const restaurantAlpha = await category("alpha", restaurants.id);
  const archived = await category("Archived");
  await post(`categories/${archived.id}/archive`, {});
  const categoryIds = [
    food.id,
    groceries.id,
    restaurants.id,
    restaurantAlpha.id,
    restaurantZulu.id,
    otherFood.id,
    zoo.id,
  ];
  const assets = [];
  for (const name of ["Zulu fund", "Alpha 10", "alpha 2"]) {
    const reference = await catalogueFixture({
      symbol: `SORT${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`,
      name,
      assetType: "ETF",
      currency: "EUR",
    });
    assets.push(await post("assets", { instrumentId: reference.id }));
  }
  await page.goto("/transactions");
  await page
    .locator(".page-actions")
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const source = dialog.getByRole("combobox", { name: "Account", exact: true });
  expect(await optionValues(source)).toEqual([
    alpha.id,
    portfolio.id,
    usd.id,
    wallet2.id,
    wallet10.id,
    zeta.id,
  ]);
  await chooseOption(source, alpha.id);
  const categories = dialog.getByRole("combobox", {
    name: "Category",
    exact: true,
  });
  expect(await optionValues(categories)).toEqual(["", ...categoryIds]);
  await chooseOption(categories, restaurantZulu.id);
  await dialog.getByLabel("Amount (EUR)").fill("5");
  await dialog.getByLabel("Description").fill("Sorted options transaction");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .locator(".transaction-row")
    .getByRole("button", { name: "Correct transaction", exact: true })
    .click();
  await expect(source).toContainText("Alpha");
  await expect(categories).toContainText("Food / Restaurants / Zulu");
  expect(await optionValues(categories)).toEqual(["", ...categoryIds]);
  await dialog.getByRole("button", { name: "Transfer", exact: true }).click();
  const destination = dialog.getByRole("combobox", {
    name: "Destination account",
    exact: true,
  });
  expect(await optionValues(destination)).toEqual([
    "",
    portfolio.id,
    wallet2.id,
    wallet10.id,
    zeta.id,
  ]);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.goto("/categories");
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  expect(
    await optionValues(
      dialog.getByRole("combobox", { name: "Parent category", exact: true }),
    ),
  ).toEqual(["", ...categoryIds]);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.goto("/investments");
  await page
    .getByRole("button", { name: "Record activity", exact: true })
    .click();
  const asset = dialog.getByRole("combobox", { name: "Asset", exact: true });
  expect(await optionValues(asset)).toEqual([
    "",
    assets[2].id,
    assets[1].id,
    assets[0].id,
  ]);
  expect(
    await optionValues(
      dialog.getByRole("combobox", { name: "Funding account", exact: true }),
    ),
  ).toEqual(["", alpha.id, wallet2.id, wallet10.id, zeta.id]);
  expect(
    await optionValues(
      dialog.getByRole("combobox", { name: "Type", exact: true }),
    ),
  ).toEqual(["BUY", "SELL", "DIVIDEND", "FEE", "DEPOSIT", "WITHDRAWAL"]);
  await chooseOption(asset, assets[0].id);
  await expect(asset).toContainText("Zulu fund");
  await page.screenshot({
    path: `test-results/modal-option-order-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.goto("/budgets");
  await page.getByRole("button", { name: "Add budget", exact: true }).click();
  expect(
    await optionValues(
      dialog.getByRole("combobox", { name: "Category", exact: true }),
    ),
  ).toEqual(categoryIds);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Investments", exact: true }).click();
  await page
    .getByRole("button", { name: "Add investment goal", exact: true })
    .click();
  expect(
    await optionValues(
      dialog.getByRole("combobox", { name: "Asset", exact: true }),
    ),
  ).toEqual([assets[2].id, assets[1].id, assets[0].id]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("accounts group by type and sort names while filters remain alphabetical", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  const post = api(page.request);
  const account = async (name: string, type = "BANK", currency = "EUR") =>
    post("accounts", { name, type, currency, initialBalance: "1000" });
  const zulu = await account("Zulu");
  const wallet10 = await account("wallet 10");
  const zuluPortfolio = await account("Zulu portfolio", "INVESTMENT");
  const alpha = await account("Alpha");
  const wallet2 = await account("Wallet 2");
  const betaPortfolio = await account("Beta portfolio", "INVESTMENT");
  await account("USD wallet", "BANK", "USD");
  const archived = await account("Archived");
  const archivedResponse = await page.request.patch(
    `/api/accounts/${archived.id}`,
    {
      headers: { Origin: "http://localhost:3001", "X-Opulya-Request": "1" },
      data: { name: "Archived", archived: true },
    },
  );
  expect(archivedResponse.ok(), await archivedResponse.text()).toBe(true);
  const eurIds = [
    alpha.id,
    archived.id,
    betaPortfolio.id,
    wallet2.id,
    wallet10.id,
    zulu.id,
    zuluPortfolio.id,
  ];
  const eurNames = [
    "Alpha",
    "Archived",
    "Beta portfolio",
    "Wallet 2",
    "wallet 10",
    "Zulu",
    "Zulu portfolio",
  ];
  await page.goto("/accounts");
  const groups = page.locator("section[aria-labelledby^='account-group-']");
  await expect(groups.locator("h2")).toHaveText(["Bank", "Investment"]);
  await expect(
    page.getByRole("region", { name: "Cash", exact: true }),
  ).toHaveCount(0);
  await account("Pocket 10", "CASH", "USD");
  await account("Pocket 2", "CASH", "USD");
  await page.reload();
  await expect(groups.locator("h2")).toHaveText(["Cash", "Bank", "Investment"]);
  await expect(
    page
      .getByRole("region", { name: "Cash", exact: true })
      .locator(".account-tile h3"),
  ).toHaveText(["Pocket 2", "Pocket 10"]);
  const bank = page.getByRole("region", { name: "Bank", exact: true });
  await expect(bank.locator(".account-tile h3")).toHaveText([
    "Alpha",
    "USD wallet",
    "Wallet 2",
    "wallet 10",
    "Zulu",
  ]);
  await expect(
    page
      .getByRole("region", { name: "Investment", exact: true })
      .locator(".account-tile h3"),
  ).toHaveText(["Beta portfolio", "Zulu portfolio"]);
  await page
    .getByRole("checkbox", { name: "Include archived", exact: true })
    .check();
  await expect(bank.locator(".account-tile h3")).toHaveText([
    "Alpha",
    "Archived",
    "USD wallet",
    "Wallet 2",
    "wallet 10",
    "Zulu",
  ]);
  await page
    .getByRole("checkbox", { name: "Include archived", exact: true })
    .uncheck();
  await expect(bank.locator(".account-tile h3")).toHaveCount(5);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/account-name-order-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.goto("/dashboard");
  await expect(page.locator(".account-tile h3")).toHaveText([
    "Alpha",
    "Beta portfolio",
    "Wallet 2",
    "wallet 10",
  ]);
  await page.goto("/transactions");
  const filter = page.getByRole("combobox", { name: "Account", exact: true });
  await expect.poll(() => optionValues(filter)).toEqual(["", ...eurIds]);
  await chooseOption(filter, zulu.id);
  await expect(filter).toHaveText("Zulu");
  await page.goto("/analytics");
  await expect.poll(() => optionValues(filter)).toEqual(["", ...eurIds]);
  await expect(
    page
      .locator("section")
      .filter({
        has: page.getByRole("heading", {
          name: "Cashflow by account",
          exact: true,
        }),
      })
      .locator(".data-list strong"),
  ).toHaveText(eurNames);
  await page.goto("/investments");
  const portfolio = page.getByRole("combobox", {
    name: "Select an investment account",
    exact: true,
  });
  expect(await optionValues(portfolio)).toEqual([
    betaPortfolio.id,
    zuluPortfolio.id,
  ]);
  await chooseOption(portfolio, zuluPortfolio.id);
  await expect(portfolio).toContainText("Zulu portfolio");
  expect(await optionValues(portfolio)).toEqual([
    betaPortfolio.id,
    zuluPortfolio.id,
  ]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
