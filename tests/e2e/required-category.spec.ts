import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, chooseOption } from "./fixtures";

test("requires a category for income and expenses and clears it when the type changes", async ({
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
    lastName: "Categories",
    email: `required-category-${randomUUID()}@example.test`,
    password: "browser-test-password-123",
    locale: "en",
  });
  const bank = await post("accounts", {
    name: "Bank",
    type: "BANK",
    currency: "EUR",
    initialBalance: "100",
  });
  const cash = await post("accounts", {
    name: "Cash",
    type: "CASH",
    currency: "EUR",
    initialBalance: "0",
  });
  await page.goto("/transactions");
  const open = () =>
    page
      .getByRole("main")
      .getByRole("button", { name: "Add transaction", exact: true })
      .click();
  await open();
  const dialog = page.getByRole("dialog");
  const category = dialog.getByRole("combobox", {
    name: "Category",
    exact: true,
  });
  await dialog.getByLabel("Amount (EUR)", { exact: true }).fill("10");
  await expect(
    dialog.getByText("Create a category for this transaction type first.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Add category", exact: true }),
  ).toHaveAttribute("href", "/categories");
  await expect(category).toHaveAttribute("aria-required", "true");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(category).toHaveAttribute("aria-invalid", "true");
  await expect(category).toBeFocused();
  expect(await (await page.request.get("/api/transactions")).json()).toEqual(
    [],
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const food = await post("categories", { name: "Food", type: "EXPENSE" });
  const groceries = await post("categories", {
    name: "Groceries",
    type: "EXPENSE",
    parentId: food.id,
  });
  const salary = await post("categories", { name: "Salary", type: "INCOME" });
  // API fixture writes bypass the UI mutation's query invalidation.
  await page.reload();
  await open();
  await dialog.getByLabel("Amount (EUR)", { exact: true }).fill("10");
  await chooseOption(
    dialog.getByRole("combobox", { name: "Account", exact: true }),
    bank.id,
  );
  await chooseOption(category, groceries.id);
  await expect(category).toContainText("Food / Groceries");
  await dialog.getByRole("button", { name: "Income", exact: true }).click();
  await expect(category).toContainText("Select category");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(category).toHaveAttribute("aria-invalid", "true");
  await chooseOption(category, salary.id);
  await dialog.getByRole("button", { name: "Expense", exact: true }).click();
  await expect(category).toContainText("Select category");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(category).toHaveAttribute("aria-invalid", "true");
  await chooseOption(category, groceries.id);
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
    path: `test-results/required-category-${testInfo.project.name}.png`,
  });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await open();
  await dialog.getByRole("button", { name: "Income", exact: true }).click();
  await dialog.getByLabel("Amount (EUR)", { exact: true }).fill("20");
  await chooseOption(
    dialog.getByRole("combobox", { name: "Account", exact: true }),
    bank.id,
  );
  await chooseOption(category, salary.id);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await open();
  await dialog.getByRole("button", { name: "Transfer", exact: true }).click();
  await expect(category).toHaveCount(0);
  await dialog.getByLabel("Amount (EUR)", { exact: true }).fill("5");
  await chooseOption(
    dialog.getByRole("combobox", { name: "Source account", exact: true }),
    bank.id,
  );
  await chooseOption(
    dialog.getByRole("combobox", { name: "Destination account", exact: true }),
    cash.id,
  );
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const entries = await (
    await page.request.get("/api/transactions", { maxRetries: 2 })
  ).json();
  expect(
    entries.find((entry: { type: string }) => entry.type === "INCOME")
      .categoryId,
  ).toBe(salary.id);
  expect(
    entries.find((entry: { type: string }) => entry.type === "EXPENSE")
      .categoryId,
  ).toBe(groceries.id);
  expect(
    entries.find((entry: { type: string }) => entry.type === "TRANSFER")
      .categoryId,
  ).toBeNull();
});
