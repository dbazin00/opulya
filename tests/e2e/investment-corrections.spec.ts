import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, chooseOption, catalogueFixture } from "./fixtures";

test("edit investment activities with linked funding and localized exact times", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
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
  const get = async (path: string) => {
    const response = await page.request.get(`/api/${path}`, { maxRetries: 2 });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  await post("auth/signup", {
    firstName: "Alex",
    lastName: "Corrections",
    email: `edit-investment-${randomUUID()}@example.test`,
    password: "browser-test-password-123",
    locale: "en",
    timeZone: "Europe/Zagreb",
  });
  const bank = await post("accounts", {
    name: "Original funding",
    type: "BANK",
    currency: "EUR",
    initialBalance: "1000",
  });
  const second = await post("accounts", {
    name: "New funding",
    type: "BANK",
    currency: "EUR",
    initialBalance: "500",
  });
  const account = await post("accounts", {
    name: "Portfolio",
    type: "INVESTMENT",
    currency: "EUR",
    initialBalance: "20",
  });
  const reference = await catalogueFixture({
    symbol: "BTC",
    name: "Bitcoin",
    assetType: "CRYPTO",
    currency: "EUR",
  });
  const asset = await post("assets", { instrumentId: reference.id });
  const timestamp = new Date(Date.now() - 4 * 3600000);
  timestamp.setUTCMinutes(24, 56, 789);
  const executedAt = timestamp.toISOString();
  const saleAt = new Date(timestamp.getTime() + 600000).toISOString();
  const original = await post("investments", {
    accountId: account.id,
    sourceAccountId: bank.id,
    assetId: asset.id,
    type: "BUY",
    quantity: "10",
    pricePerUnit: "10",
    totalAmount: "100",
    fee: "2.25",
    currency: "EUR",
    executedAt,
    clientRequestId: randomUUID(),
  });
  const originalSale = await post("investments", {
    accountId: account.id,
    assetId: asset.id,
    type: "SELL",
    quantity: "5",
    pricePerUnit: "15",
    totalAmount: "75",
    fee: "1",
    currency: "EUR",
    executedAt: saleAt,
    clientRequestId: randomUUID(),
  });
  const time = (value: string, locale: string) =>
    new Intl.DateTimeFormat(locale, {
      timeStyle: "short",
      timeZone: "Europe/Zagreb",
    }).format(new Date(value));
  await page.goto("/investments");
  const buyRow = page
    .locator(".investment-history .history-row")
    .filter({ has: page.getByText("Buy", { exact: true }) });
  await expect(buyRow.locator("time")).toHaveAttribute("datetime", executedAt);
  await expect(buyRow.locator("time")).toContainText(time(executedAt, "en-US"));
  await buyRow
    .getByRole("button", { name: "Edit activity", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Quantity", { exact: true })).toHaveValue(
    "10",
  );
  await expect(
    dialog.getByLabel("Price per unit", { exact: true }),
  ).toHaveValue("10");
  await expect(dialog.getByLabel("Fee", { exact: true })).toHaveValue("2.25");
  await expect(
    dialog.getByRole("combobox", { name: "Asset", exact: true }),
  ).toContainText("Bitcoin");
  await expect(
    dialog.getByRole("combobox", { name: "Funding account", exact: true }),
  ).toContainText(bank.name);
  await expect(dialog.getByLabel("Date and time", { exact: true })).toHaveValue(
    /T\d{2}:\d{2}$/,
  );
  await expect(
    dialog.getByRole("button", { name: "Add asset", exact: true }),
  ).toHaveCount(0);
  await dialog.getByLabel("Quantity", { exact: true }).fill("12");
  await dialog.getByLabel("Fee", { exact: true }).fill("3");
  await chooseOption(
    dialog.getByRole("combobox", { name: "Funding account", exact: true }),
    second.id,
  );
  await expect(
    dialog.getByLabel("Gross amount (EUR)", { exact: true }),
  ).toHaveValue("€120.00");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: `test-results/investment-edit-${testInfo.project.name}.png`,
  });
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/investments",
  );
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const body = (await submitted).postDataJSON();
  expect(body.replacesId).toBe(original.id);
  expect(body.executedAt).toBe(executedAt);
  expect(body.sourceAccountId).toBe(second.id);
  await expect(dialog).not.toBeVisible();
  await expect(buyRow).toHaveCount(1);
  await expect(buyRow).toContainText(second.name);
  const current = await get(`accounts/${account.id}/portfolio`);
  expect(current.positions[0].quantity).toBe("7");
  expect(current.positions[0].costBasis).toBe("71.75");
  expect(current.cashBalance).toBe("94");
  const history = await get(`accounts/${account.id}/history`);
  const updatedBuy = history.entries.find(
    (entry: { type: string }) => entry.type === "BUY",
  ).transaction;
  expect(updatedBuy.replacesId).toBe(original.id);
  const balances = await get("accounts");
  expect(
    balances.find((row: { id: string }) => row.id === bank.id).currentBalance,
  ).toBe("1000");
  expect(
    balances.find((row: { id: string }) => row.id === second.id).currentBalance,
  ).toBe("377");

  await buyRow
    .getByRole("button", { name: "Edit activity", exact: true })
    .click();
  await dialog.getByLabel("Quantity", { exact: true }).fill("4");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("more units");
  await expect(dialog).toBeVisible();
  const unchanged = await get(`accounts/${account.id}/history`);
  expect(
    unchanged.entries.find((entry: { type: string }) => entry.type === "BUY")
      .transaction.id,
  ).toBe(updatedBuy.id);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  await page.goto(`/accounts/${account.id}`);
  const saleRow = page
    .locator(".investment-account-history .history-row")
    .filter({ has: page.getByText("Sell", { exact: true }) });
  await saleRow
    .getByRole("button", { name: "Edit activity", exact: true })
    .click();
  await expect(dialog.getByLabel("Quantity", { exact: true })).toHaveValue("5");
  await dialog.getByLabel("Quantity", { exact: true }).fill("6");
  await dialog.getByLabel("Fee", { exact: true }).fill("2");
  const newSaleTime = new Date(timestamp.getTime() + 900000);
  newSaleTime.setUTCSeconds(0, 0);
  const newSaleAt = newSaleTime.toISOString();
  const local = await page.evaluate((value) => {
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  }, newSaleAt);
  await dialog.getByLabel("Date and time", { exact: true }).fill(local);
  const saleSubmitted = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/investments",
  );
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const saleBody = (await saleSubmitted).postDataJSON();
  expect(saleBody.replacesId).toBe(originalSale.id);
  expect(saleBody.executedAt).toBe(newSaleAt);
  await expect(dialog).not.toBeVisible();
  const afterSale = await get(`accounts/${account.id}/portfolio`);
  expect(afterSale.positions[0].quantity).toBe("6");
  expect(afterSale.positions[0].costBasis).toBe("61.5");
  expect(afterSale.cashBalance).toBe("108");
  await expect(saleRow.locator("time")).toHaveAttribute("datetime", newSaleAt);

  await page.goto("/transactions");
  const funding = page
    .locator(".transaction-row")
    .filter({ hasText: "Investment funding" });
  await expect(funding).toHaveCount(1);
  await expect(funding.locator("time")).toContainText(
    time(executedAt, "en-US"),
  );
  await expect(funding.locator("time")).not.toContainText(
    /\d{1,2}:\d{2}:\d{2}/,
  );
  await funding
    .getByRole("button", { name: "Edit activity", exact: true })
    .click();
  await expect(dialog.getByLabel("Quantity", { exact: true })).toHaveValue(
    "12",
  );
  await expect(dialog.getByLabel("Fee", { exact: true })).toHaveValue("3");
  await expect(
    dialog.getByRole("combobox", { name: "Funding account", exact: true }),
  ).toContainText(second.name);
  await expect(dialog.getByLabel("Date and time", { exact: true })).toHaveValue(
    /T\d{2}:\d{2}$/,
  );
  await dialog.getByLabel("Fee", { exact: true }).fill("4");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: `test-results/transaction-investment-edit-${testInfo.project.name}.png`,
  });
  const fromTransactions = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/investments",
  );
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const transactionEdit = (await fromTransactions).postDataJSON();
  expect(transactionEdit.replacesId).toBe(updatedBuy.id);
  expect(transactionEdit.executedAt).toBe(executedAt);
  await expect(dialog).not.toBeVisible();
  await expect(funding).toHaveCount(1);
  await expect(funding.locator(".transaction-value > .money")).toContainText(
    "124.00",
  );
  const edited = await get(`accounts/${account.id}/portfolio`);
  expect(edited.positions[0].costBasis).toBe("62");
  expect(
    (await get("accounts")).find((row: { id: string }) => row.id === second.id)
      .currentBalance,
  ).toBe("376");
  await page.screenshot({
    path: `test-results/transaction-investment-pencil-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.goto("/settings");
  await chooseOption(
    page.getByRole("combobox", { name: "Display language", exact: true }),
    "hr",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "hr");
  await page.goto("/investments");
  const localizedBuy = page
    .locator(".investment-history .history-row")
    .filter({ has: page.getByText("Kupnja", { exact: true }) });
  await expect(localizedBuy.locator("time")).toContainText(
    time(executedAt, "hr-HR"),
  );
  await expect(localizedBuy.locator("time")).not.toContainText(
    /\d{1,2}:\d{2}:\d{2}/,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: `test-results/investment-times-hr-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await localizedBuy
    .getByRole("button", { name: "Uredi aktivnost", exact: true })
    .click();
  await expect(dialog.getByLabel("Količina", { exact: true })).toHaveValue(
    "12",
  );
  await expect(
    dialog.getByLabel("Datum i vrijeme", { exact: true }),
  ).toHaveValue(/T\d{2}:\d{2}$/);
  expect(errors).toEqual([]);
});
