import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

function requests(page: Page) {
  return {
    post: async (path: string, data: unknown) => {
      const response = await page.request.post(`/api/${path}`, {
        headers: { Origin: "http://localhost:3001", "X-Opulya-Request": "1" },
        data,
      });
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    },
    get: async (path: string) => {
      const response = await page.request.get(`/api/${path}`);
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    },
  };
}

test("correct and void account history while keeping balances and exact timestamps", async ({
  page,
}, testInfo) => {
  const { post, get } = requests(page);
  await post("auth/signup", {
    firstName: "Alex",
    lastName: "History",
    email: `history-${randomUUID()}@example.test`,
    password: "browser-test-password-123",
    locale: "en",
    timeZone: "Europe/Zagreb",
  });
  const bank = await post("accounts", {
    name: "Everyday account",
    type: "BANK",
    currency: "EUR",
    initialBalance: "100",
  });
  const savings = await post("accounts", {
    name: "Savings",
    type: "BANK",
    currency: "EUR",
    initialBalance: "0",
  });
  const category = await post("categories", { name: "Salary", type: "INCOME" });
  const occurredAt = new Date(Date.now() - 60_000).toISOString();
  await post("transactions", {
    type: "INCOME",
    categoryId: category.id,
    destinationAccountId: bank.id,
    amount: "20",
    currency: "EUR",
    description: "Income to correct",
    occurredAt,
    clientRequestId: randomUUID(),
  });
  await post("transactions", {
    type: "TRANSFER",
    sourceAccountId: bank.id,
    destinationAccountId: savings.id,
    amount: "10",
    currency: "EUR",
    description: "Transfer to savings",
    occurredAt: new Date(Date.now() - 30_000).toISOString(),
    clientRequestId: randomUUID(),
  });
  await page.goto(`/accounts/${bank.id}`);
  const history = page.locator(".account-history");
  const balance = page.locator(".account-current-balance");
  const row = (description: string) =>
    history.locator(".history-row").filter({ hasText: description });
  const dialog = page.getByRole("dialog");
  await row("Income to correct")
    .getByRole("button", { name: "Correct transaction", exact: true })
    .click();
  await expect(dialog.getByLabel("Amount (EUR)")).toHaveValue("20");
  await dialog.getByLabel("Amount (EUR)").fill("30");
  await dialog.getByLabel("Description").fill("Corrected income");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(balance).toContainText("€120.00");
  await expect(row("Income to correct")).toHaveCount(0);
  await expect(row("Corrected income").locator("time")).toHaveAttribute(
    "datetime",
    occurredAt,
  );
  await row("Transfer to savings")
    .getByRole("button", { name: "Correct transaction", exact: true })
    .click();
  await dialog.getByLabel("Amount (EUR)").fill("15");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(balance).toContainText("€115.00");
  expect(
    (await get("accounts")).find((a: { id: string }) => a.id === savings.id)
      .currentBalance,
  ).toBe("15");
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
    path: `test-results/account-history-actions-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await row("Transfer to savings")
    .getByRole("button", { name: "Void transaction", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(row("Transfer to savings")).toHaveCount(1);
  await row("Transfer to savings")
    .getByRole("button", { name: "Void transaction", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(row("Transfer to savings")).toHaveCount(0);
  await expect(balance).toContainText("€130.00");
  expect(
    (await get("accounts")).find((a: { id: string }) => a.id === savings.id)
      .currentBalance,
  ).toBe("0");
  await page
    .getByRole("button", { name: "Update balance", exact: true })
    .click();
  await dialog.getByLabel("New cash balance (EUR)").fill("150");
  await dialog.getByLabel("Description").fill("Balance reconciliation");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(balance).toContainText("€150.00");
  await expect(
    row("Balance reconciliation").getByRole("button", {
      name: "Correct transaction",
      exact: true,
    }),
  ).toHaveCount(0);
  await row("Balance reconciliation")
    .getByRole("button", { name: "Void transaction", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(balance).toContainText("€130.00");
  await row("Corrected income")
    .getByRole("button", { name: "Void transaction", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(balance).toContainText("€100.00");
  await expect(history).toHaveCount(0);
});

test("account history edits and voids linked investment funding from either account", async ({
  page,
}) => {
  const { post, get } = requests(page);
  await post("auth/signup", {
    firstName: "Alex",
    lastName: "Funding",
    email: `history-funding-${randomUUID()}@example.test`,
    password: "browser-test-password-123",
    locale: "en",
    timeZone: "Europe/Zagreb",
  });
  const bank = await post("accounts", {
    name: "Funding account",
    type: "BANK",
    currency: "EUR",
    initialBalance: "500",
  });
  const portfolio = await post("accounts", {
    name: "Portfolio",
    type: "INVESTMENT",
    currency: "EUR",
    initialBalance: "20",
  });
  const deposit = async (amount: string) =>
    post("investments", {
      accountId: portfolio.id,
      sourceAccountId: bank.id,
      type: "DEPOSIT",
      totalAmount: amount,
      fee: "0",
      currency: "EUR",
      executedAt: new Date(Date.now() - 30_000).toISOString(),
      clientRequestId: randomUUID(),
    });
  await deposit("50");
  await page.goto(`/accounts/${bank.id}`);
  const history = page.locator(".account-history");
  const dialog = page.getByRole("dialog");
  await history
    .getByRole("button", { name: "Edit activity", exact: true })
    .click();
  await expect(dialog.getByLabel("Gross amount (EUR)")).toHaveValue("50");
  await expect(
    dialog.getByRole("combobox", { name: "Funding account" }),
  ).toContainText(bank.name);
  await dialog.getByLabel("Gross amount (EUR)").fill("60");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".account-current-balance")).toContainText(
    "€440.00",
  );
  expect((await get(`accounts/${portfolio.id}/portfolio`)).cashBalance).toBe(
    "80",
  );
  await history
    .getByRole("button", { name: "Void transaction", exact: true })
    .click();
  await expect(dialog).toContainText("linked funding transfer");
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".account-current-balance")).toContainText(
    "€500.00",
  );
  expect((await get(`accounts/${portfolio.id}/portfolio`)).cashBalance).toBe(
    "20",
  );
  await deposit("75");
  await page.goto(`/accounts/${portfolio.id}`);
  await expect(page.locator(".account-current-balance")).toContainText(
    "€95.00",
  );
  await history
    .getByRole("button", { name: "Void activity", exact: true })
    .click();
  await expect(dialog).toContainText("linked funding transfer");
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".account-current-balance")).toContainText(
    "€20.00",
  );
  expect(
    (await get("accounts")).find((a: { id: string }) => a.id === bank.id)
      .currentBalance,
  ).toBe("500");
});
