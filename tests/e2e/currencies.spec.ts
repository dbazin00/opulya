import { randomUUID } from "node:crypto";
import { test, expect, chooseOption } from "./fixtures";

test("built-in currencies work across forms and filters despite browser runtime differences", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydration|server rendered|did not match/i.test(message.text())
    )
      errors.push(message.text());
  });
  await page.addInitScript(() => {
    const supportedValuesOf = Intl.supportedValuesOf;
    Intl.supportedValuesOf = (key) =>
      key === "currency" ? ["EUR", "USD"] : supportedValuesOf(key);
  });
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(`/api/${path}`, {
      headers: { Origin: "http://localhost:3001", "X-Opulya-Request": "1" },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  await post("auth/signup", {
    firstName: "Alex",
    lastName: "Currencies",
    email: `currencies-${randomUUID()}@example.test`,
    password: "browser-test-password-123",
    locale: "en",
    timeZone: "Europe/Zagreb",
  });
  await page.goto("/accounts");
  await page
    .locator(".page-actions")
    .getByRole("button", { name: "Add account", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const accountCurrency = dialog.getByRole("combobox", {
    name: "Currency",
    exact: true,
  });
  await expect(accountCurrency).toHaveText("EUR");
  expect(
    await dialog
      .locator('select[name="currency"] option')
      .evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value),
      ),
  ).toEqual(Intl.supportedValuesOf("currency"));
  await dialog.getByLabel("Name", { exact: true }).fill("Polish account");
  await chooseOption(accountCurrency, "PLN");
  await dialog.getByLabel("Opening balance", { exact: true }).fill("100.25");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const accountResponse = await page.request.get("/api/accounts");
  expect(accountResponse.ok()).toBe(true);
  const [account] = await accountResponse.json();
  expect(account).toMatchObject({
    name: "Polish account",
    currency: "PLN",
    currentBalance: "100.25",
  });
  const category = await post("categories", { name: "Salary", type: "INCOME" });
  await post("transactions", {
    type: "INCOME",
    destinationAccountId: account.id,
    categoryId: category.id,
    amount: "20",
    currency: "PLN",
    description: "Polish income",
    occurredAt: new Date().toISOString(),
    clientRequestId: randomUUID(),
  });
  await page.goto("/transactions");
  const reportCurrency = page.getByRole("combobox", {
    name: "Currency",
    exact: true,
  });
  await expect(reportCurrency).toHaveText("EUR");
  await chooseOption(reportCurrency, "PLN");
  await expect(page.locator(".transaction-row")).toContainText("Polish income");
  await expect(page.locator(".transaction-row")).toContainText("PLN");
  await page.goto("/assets");
  const assetCurrency = page.getByRole("combobox", {
    name: "Currency",
    exact: true,
  });
  await chooseOption(assetCurrency, "PLN");
  await page.getByRole("button", { name: "Add asset", exact: true }).click();
  const tradingCurrency = dialog.getByRole("combobox", {
    name: "Trading currency",
    exact: true,
  });
  await expect(tradingCurrency).toHaveText("PLN");
  await expect(tradingCurrency).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/currencies-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
