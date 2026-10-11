import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, chooseOption } from "./fixtures";

test("optional opening and balance-change history plus balances on every transaction", async ({
  page,
}, testInfo) => {
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
    lastName: "Balances",
    email: `balance-browser-${randomUUID()}@example.test`,
    password: "browser-test-password-123",
    locale: "en",
    timeZone: "Europe/Zagreb",
  });
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Recorded account");
  await dialog.getByLabel("Opening balance", { exact: true }).fill("100");
  const opening = dialog.getByRole("checkbox", {
    name: "Record opening balance in transaction history",
    exact: true,
  });
  await expect(opening).not.toBeChecked();
  await opening.check();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  let accounts = await (await page.request.get("/api/accounts")).json();
  const account = accounts.find(
    (row: { name: string }) => row.name === "Recorded account",
  );
  expect(account.currentBalance).toBe("100");
  expect(account.initialBalance).toBe("0");
  await page.goto("/transactions");
  await expect(page.locator(".transaction-row")).toHaveCount(1);
  await expect(page.locator(".transaction-balances")).toContainText("€100.00");
  await page.screenshot({
    path: `test-results/balance-snapshots-${testInfo.project.name}.png`,
    fullPage: true,
  });

  await page.goto(`/accounts/${account.id}`);
  await expect(
    page.getByText("Opening balance", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Update balance", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("New cash balance (EUR)").fill("150");
  const record = dialog.getByRole("checkbox", {
    name: "Record this balance change in transaction history",
    exact: true,
  });
  await expect(record).toBeChecked();
  await record.uncheck();
  await dialog
    .getByLabel("Description", { exact: true })
    .fill("Hidden reconciliation");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".account-current-balance")).toContainText(
    "€150.00",
  );
  await expect(
    page.getByText("Hidden reconciliation", { exact: true }),
  ).toHaveCount(0);
  await page.goto("/transactions");
  await expect(page.locator(".transaction-row")).toHaveCount(1);

  const expenseCategory = await post("categories", {
    name: "Spending",
    type: "EXPENSE",
  });
  await post("transactions", {
    type: "EXPENSE",
    categoryId: expenseCategory.id,
    sourceAccountId: account.id,
    amount: "10",
    currency: "EUR",
    description: "After hidden change",
    occurredAt: new Date().toISOString(),
    clientRequestId: randomUUID(),
  });
  await page.reload();
  await expect(
    page
      .locator(".transaction-row")
      .filter({ hasText: "After hidden change" })
      .locator(".transaction-balances"),
  ).toContainText("€140.00");
  await page.goto(`/accounts/${account.id}`);
  await page
    .getByRole("button", { name: "Update balance", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("New cash balance (EUR)").fill("200");
  await dialog
    .getByLabel("Description", { exact: true })
    .fill("Visible reconciliation");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText("Visible reconciliation", { exact: true }),
  ).toBeVisible();

  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Baseline account");
  await dialog.getByLabel("Opening balance", { exact: true }).fill("20");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  accounts = await (await page.request.get("/api/accounts")).json();
  const destination = accounts.find(
    (row: { name: string }) => row.name === "Baseline account",
  );
  await post("transactions", {
    type: "TRANSFER",
    sourceAccountId: account.id,
    destinationAccountId: destination.id,
    amount: "10",
    currency: "EUR",
    description: "Both balances",
    occurredAt: new Date().toISOString(),
    clientRequestId: randomUUID(),
  });
  await page.goto("/transactions");
  const transfer = page
    .locator(".transaction-row")
    .filter({ hasText: "Both balances" });
  await expect(transfer.locator(".transaction-balances")).toContainText(
    "Recorded account",
  );
  await expect(transfer.locator(".transaction-balances")).toContainText(
    "Baseline account",
  );
  await expect(transfer.locator(".transaction-balances")).toContainText(
    "€190.00",
  );
  await expect(transfer.locator(".transaction-balances")).toContainText(
    "€30.00",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/transfer-balances-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.goto("/settings");
  await chooseOption(
    page.getByRole("combobox", { name: "Display language", exact: true }),
    "hr",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.goto("/transactions");
  await expect(page.locator(".transaction-balances").first()).toContainText(
    "Stanje nakon transakcije",
  );
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Dodaj račun", exact: true }).click();
  await expect(
    page.getByRole("checkbox", {
      name: "Zabilježi početno stanje u povijesti transakcija",
      exact: true,
    }),
  ).toBeVisible();
});
