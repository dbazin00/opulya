import { test, expect, chooseOption } from "./fixtures";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";

test("update account balance and browse every category level", async ({
  page,
}, testInfo) => {
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
  await post("auth/signup", {
    firstName: "Alex",
    lastName: "Tools",
    email: `tools-${randomUUID()}@example.test`,
    password: "browser-test-password-123",
    locale: "en",
    timeZone: "Europe/Zagreb",
  });
  const account = await post("accounts", {
    name: "Everyday banking",
    type: "BANK",
    currency: "EUR",
    initialBalance: "100",
  });
  expect(await (await page.request.get("/api/categories")).json()).toEqual([]);
  const originalIncomeCategory = await post("categories", {
    name: "Salary",
    type: "INCOME",
  });
  await post("transactions", {
    type: "INCOME",
    categoryId: originalIncomeCategory.id,
    destinationAccountId: account.id,
    amount: "20",
    currency: "EUR",
    description: "Original income",
    occurredAt: new Date(Date.now() - 10_000).toISOString(),
    clientRequestId: randomUUID(),
  });
  await page.goto(`/accounts/${account.id}`);
  await page
    .getByRole("button", { name: "Update balance", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("New cash balance (EUR)").fill("150.75");
  await dialog.getByLabel("Description").fill("Statement reconciliation");
  await expect(dialog.getByText("€30.75", { exact: true })).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: `test-results/balance-form-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".account-current-balance")).toContainText(
    "€150.75",
  );
  await expect(
    page.getByText("Original income", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Statement reconciliation", { exact: true }),
  ).toBeVisible();
  const report = await (
    await page.request.get(`/api/analytics?accountId=${account.id}`)
  ).json();
  expect(report.income).toBe("20");
  expect(report.expenses).toBe("0");
  await page.reload();
  await expect(page.locator(".account-current-balance")).toContainText(
    "€150.75",
  );
  await page
    .getByRole("button", { name: "Update balance", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("New cash balance (EUR)").fill("0");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".account-current-balance")).toContainText("€0.00");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/adjusted-account-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.goto("/transactions");
  await chooseOption(page.getByLabel("Type", { exact: true }), "ADJUSTMENT");
  await expect(page.locator(".transaction-row")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Correct transaction" }),
  ).toHaveCount(0);
  await expect(page.locator(".transaction-value").first()).toContainText(
    "-€150.75",
  );
  await page
    .getByRole("button", { name: "Void transaction", exact: true })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto(`/accounts/${account.id}`);
  await expect(page.locator(".account-current-balance")).toContainText(
    "€150.75",
  );

  await page.goto("/categories");
  const toggleAll = page.locator(".category-controls .toolbar button");
  await expect(toggleAll).toBeDisabled();
  await expect(toggleAll).toHaveCSS("cursor", "not-allowed");
  const food = await post("categories", { name: "Food", type: "EXPENSE" });
  const salary = originalIncomeCategory;
  const books = await post("categories", { name: "Books", type: "EXPENSE" });
  await page.goto("/categories");
  await expect(page.locator(".category-tree-row")).toHaveCount(3);
  await expect(toggleAll).toBeDisabled();
  await expect(toggleAll).toHaveCSS("cursor", "not-allowed");
  let parentId = food.id;
  for (const name of [
    "Restaurants",
    "Fast food",
    "Burgers",
    "Specials",
    "Seasonal lunch",
  ]) {
    parentId = (await post("categories", { name, type: "EXPENSE", parentId }))
      .id;
  }
  await post("categories", {
    name: "Consulting",
    type: "INCOME",
    parentId: salary.id,
  });
  for (const name of ["Zucchini", "apples", "Bananas"])
    await post("categories", { name, type: "EXPENSE", parentId: food.id });
  await page.goto("/categories");
  const tree = page.getByRole("list", {
    name: "All categories and subcategories",
  });
  await expect(toggleAll).toHaveCount(1);
  await expect(toggleAll).toBeEnabled();
  await expect(toggleAll).toHaveAccessibleName("Collapse all");
  await expect(toggleAll.locator("svg")).toHaveClass(/lucide-fold-vertical/);
  await expect(
    tree.locator('.category-tree-row[data-parent-id=""] strong'),
  ).toHaveText(["Books", "Food", "Salary"]);
  await expect(
    tree.locator(`.category-tree-row[data-parent-id="${food.id}"] strong`),
  ).toHaveText(["apples", "Bananas", "Restaurants", "Zucchini"]);
  await expect(tree.locator("small")).toHaveCount(0);
  await expect(tree.locator(".category-guide.is-branch").first()).toBeVisible();
  await expect(tree.locator(`[data-category-id="${books.id}"]`)).toBeVisible();
  await expect(
    tree.locator("strong").getByText("Seasonal lunch", { exact: true }),
  ).toBeVisible();
  await expect(
    tree.locator("strong").getByText("Consulting", { exact: true }),
  ).toBeVisible();
  const foodRow = tree.locator(`[data-category-id="${food.id}"]`);
  await foodRow.getByText("Food", { exact: true }).click();
  await expect(toggleAll).toHaveAccessibleName("Expand all");
  await expect(toggleAll.locator("svg")).toHaveClass(/lucide-unfold-vertical/);
  await expect(
    foodRow.getByRole("button", { name: "Expand Food", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    tree.locator("strong").getByText("Burgers", { exact: true }),
  ).toHaveCount(0);
  const expandFood = foodRow.getByRole("button", {
    name: "Expand Food",
    exact: true,
  });
  const triggerWidth = await expandFood.evaluate(
    (el) => el.getBoundingClientRect().width,
  );
  await expandFood.click({ position: { x: triggerWidth - 8, y: 8 } });
  await expect(
    tree.locator("strong").getByText("Burgers", { exact: true }),
  ).toBeVisible();
  for (const action of ["Add subcategory to Food", "Edit Food"]) {
    await foodRow.getByRole("button", { name: action, exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(
      foodRow.getByRole("button", { name: "Collapse Food", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
  }
  const collapse = tree.getByRole("button", {
    name: "Collapse Food",
    exact: true,
  });
  await collapse.focus();
  await page.keyboard.press("Enter");
  await expect(
    tree.locator("strong").getByText("Burgers", { exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(
    tree.locator("strong").getByText("Burgers", { exact: true }),
  ).toBeVisible();
  await collapse.click();
  await page.getByRole("button", { name: "Expand all", exact: true }).click();
  await expect(toggleAll).toHaveAccessibleName("Collapse all");
  await expect(
    tree.locator("strong").getByText("Burgers", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Collapse all", exact: true }).click();
  await expect(toggleAll).toHaveAccessibleName("Expand all");
  await expect(tree.locator(".category-tree-row")).toHaveCount(3);
  await page
    .getByLabel("Search categories", { exact: true })
    .fill("Seasonal lunch");
  await expect(toggleAll).toHaveAccessibleName("Collapse all");
  await expect(toggleAll).toBeDisabled();
  await expect(
    tree.locator("strong").getByText("Seasonal lunch", { exact: true }),
  ).toBeVisible();
  await expect(tree.locator("strong")).toHaveText([
    "Food",
    "Restaurants",
    "Fast food",
    "Burgers",
    "Specials",
    "Seasonal lunch",
  ]);
  await expect(tree.getByText(/Food \/ Restaurants/)).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("Search categories", { exact: true }).fill("");
  await expect(toggleAll).toBeEnabled();
  await expect(toggleAll).toHaveAccessibleName("Expand all");
  await page.getByRole("button", { name: "Expand all", exact: true }).click();
  await tree
    .getByRole("button", { name: "Add subcategory to Burgers", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Vegetarian");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    tree.locator("strong").getByText("Vegetarian", { exact: true }),
  ).toBeVisible();
  await tree
    .getByRole("button", { name: "Edit Vegetarian", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("Plant-based");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    tree.locator("strong").getByText("Plant-based", { exact: true }),
  ).toBeVisible();
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
    path: `test-results/category-tree-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await chooseOption(page.getByLabel("Type", { exact: true }), "INCOME");
  await expect(
    tree.locator("strong").getByText("Consulting", { exact: true }),
  ).toBeVisible();
  await expect(
    tree.locator("strong").getByText("Food", { exact: true }),
  ).toHaveCount(0);
  await page.goto("/settings");
  await page
    .getByRole("combobox", { name: "Display language", exact: true })
    .click();
  await page.getByRole("option", { name: "Hrvatski", exact: true }).click();
  await page
    .locator("form")
    .filter({
      has: page.getByRole("combobox", {
        name: "Display language",
        exact: true,
      }),
    })
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Postavke", exact: true }),
  ).toBeVisible();
  await page.goto("/categories");
  await expect(
    page.getByRole("list", { name: "Sve kategorije i potkategorije" }),
  ).toBeVisible();
  await page.goto(`/accounts/${account.id}`);
  await page
    .getByRole("button", { name: "Ažuriraj stanje", exact: true })
    .click();
  await expect(page.getByLabel("Novo novčano stanje (EUR)")).toBeVisible();
  expect(errors).toEqual([]);
});
