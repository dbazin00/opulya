import { test, expect } from "./fixtures";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";

test("delete unused categories, archive used ones and restore them", async ({
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
    email: `category-ui-${randomUUID()}@example.test`,
    password: "browser-test-password-123",
    locale: "en",
    timeZone: "Europe/Zagreb",
  });
  const account = await post("accounts", {
    name: "Bank",
    type: "BANK",
    currency: "EUR",
    initialBalance: "100",
  });
  const unused = await post("categories", { name: "Mistake", type: "EXPENSE" });
  const food = await post("categories", { name: "Food", type: "EXPENSE" });
  const groceries = await post("categories", {
    name: "Groceries",
    type: "EXPENSE",
    parentId: food.id,
  });
  const entry = await post("transactions", {
    type: "EXPENSE",
    sourceAccountId: account.id,
    categoryId: groceries.id,
    amount: "15",
    currency: "EUR",
    occurredAt: new Date().toISOString(),
    clientRequestId: randomUUID(),
  });
  await page.goto("/categories");
  const edit = async (name: string) =>
    page.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await edit("Mistake");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "Delete category" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(`[data-category-id="${unused.id}"]`)).toBeVisible();
  await edit("Mistake");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(`[data-category-id="${unused.id}"]`)).toHaveCount(
    0,
  );

  await edit("Food");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Move or remove all subcategories first, including archived ones.",
  );
  await expect(
    dialog.getByRole("button", { name: "Delete", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  await edit("Groceries");
  await expect(
    dialog.getByRole("button", { name: "Delete", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "Archive category" }),
  ).toBeVisible();
  await expect(dialog).toContainText(
    "Past transactions and analytics will keep this category.",
  );
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
    path: `test-results/category-archive-${testInfo.project.name}.png`,
  });
  await dialog.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.locator(`[data-category-id="${groceries.id}"]`),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  await dialog.getByLabel("Category", { exact: true }).click();
  await expect(page.getByRole("option", { name: /Groceries/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const history = await (
    await page.request.get(`/api/transactions/${entry.id}`)
  ).json();
  expect(history.categoryId).toBe(groceries.id);
  const accounts = await (await page.request.get("/api/accounts")).json();
  expect(accounts[0].currentBalance).toBe("85");

  await page.getByLabel("Include archived", { exact: true }).check();
  const archived = page.locator(`[data-category-id="${groceries.id}"]`);
  await expect(archived).toContainText("Archived");
  await expect(
    archived.getByRole("button", {
      name: "Add subcategory to Groceries",
      exact: true,
    }),
  ).toBeDisabled();
  await archived
    .getByRole("button", { name: "Restore Groceries", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Restore category" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(archived).not.toContainText("Archived");
  await expect(
    archived.getByRole("button", { name: "Edit Groceries", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  await dialog.getByLabel("Category", { exact: true }).click();
  await expect(page.getByRole("option", { name: /Groceries/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
});
