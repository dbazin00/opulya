import {
  test,
  expect,
  chooseOption,
  catalogueFixture,
  type Page,
} from "./fixtures";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";

async function checkMenu(page: Page) {
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height,
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations.map((v) => ({
      rule: v.id,
      targets: v.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

test("styled dropdowns preserve forms, required choices, nested focus and long lists", async ({
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
    lastName: "Menus",
    email: `menus-${randomUUID()}@example.test`,
    password: "browser-test-password-123",
    locale: "en",
    timeZone: "Europe/Zagreb",
  });
  const bank = await post("accounts", {
    name: "A Bank",
    type: "BANK",
    currency: "EUR",
    initialBalance: "100",
  });
  const cash = await post("accounts", {
    name: "B Wallet",
    type: "CASH",
    currency: "EUR",
    initialBalance: "10",
  });
  const portfolio = await post("accounts", {
    name: "C Portfolio",
    type: "INVESTMENT",
    currency: "EUR",
    initialBalance: "100",
  });
  const reference = await catalogueFixture({
    symbol: "VWCE",
    name: "Vanguard FTSE All-World accumulation fund with a long instrument label",
    assetType: "ETF",
    exchange: "XETRA",
    currency: "EUR",
  });
  const asset = await post("assets", { instrumentId: reference.id });
  const categoryName =
    "A very long custom category name with details that should never push a dropdown beyond the screen";
  const category = await post("categories", {
    name: categoryName,
    type: "EXPENSE",
  });
  for (let i = 0; i < 12; i++)
    await post("categories", { name: `Category ${i}`, type: "EXPENSE" });

  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("D Crypto");
  await chooseOption(dialog.getByLabel("Type", { exact: true }), "INVESTMENT");
  await chooseOption(dialog.getByLabel("Currency", { exact: true }), "USD");
  await expect(dialog.getByLabel("Provider", { exact: true })).toHaveCount(0);
  const accountValues = await dialog
    .locator("form")
    .evaluate((form) =>
      Object.fromEntries(new FormData(form as HTMLFormElement)),
    );
  expect(accountValues.currency).toBe("USD");
  expect(accountValues.provider).toBeUndefined();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();

  await page.goto("/transactions");
  await page
    .getByRole("main")
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Transfer", exact: true }).click();
  await dialog.getByLabel("Amount (EUR)", { exact: true }).fill("1");
  await chooseOption(
    dialog.getByLabel("Source account", { exact: true }),
    bank.id,
  );
  const destination = dialog.getByRole("combobox", {
    name: "Destination account",
    exact: true,
  });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(destination).toHaveAttribute("aria-invalid", "true");
  await expect(destination).toBeFocused();
  await expect(dialog).toBeVisible();
  await destination.press("ArrowDown");
  await checkMenu(page);
  await page.keyboard.press("Escape");
  await expect(destination).toBeFocused();
  await expect(dialog).toBeVisible();
  await chooseOption(destination, cash.id);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const accounts = await (await page.request.get("/api/accounts")).json();
  expect(
    accounts.find((a: { id: string }) => a.id === bank.id).currentBalance,
  ).toBe("99");
  expect(
    accounts.find((a: { id: string }) => a.id === cash.id).currentBalance,
  ).toBe("11");
  await chooseOption(
    page.getByRole("combobox", { name: "Type", exact: true }),
    "TRANSFER",
  );
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toBeDisabled();
  await chooseOption(
    page.getByRole("combobox", { name: "Type", exact: true }),
    "",
  );
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toBeEnabled();
  const categoryPicker = page.getByRole("combobox", {
    name: "Category",
    exact: true,
  });
  await categoryPicker.click();
  await checkMenu(page);
  await page.screenshot({
    path: `test-results/category-dropdown-${testInfo.project.name}.png`,
  });
  await page
    .getByRole("option")
    .and(page.locator(`[data-value="${category.id}"]`))
    .click();
  await expect(categoryPicker).toHaveAttribute("title", categoryName);
  await chooseOption(categoryPicker, "");
  await expect(categoryPicker).toContainText("All");

  await page.goto("/investments");
  await chooseOption(
    page.getByRole("combobox", {
      name: "Select an investment account",
      exact: true,
    }),
    portfolio.id,
  );
  await page
    .getByRole("button", { name: "Record activity", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Quantity", { exact: true }).fill("1");
  await dialog.getByLabel("Price per unit", { exact: true }).fill("12");
  await chooseOption(
    dialog.getByRole("combobox", { name: "Funding account", exact: true }),
    bank.id,
  );
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const instrument = dialog.getByRole("combobox", {
    name: "Asset",
    exact: true,
  });
  await expect(instrument).toHaveAttribute("aria-invalid", "true");
  await instrument.click();
  await checkMenu(page);
  await page.screenshot({
    path: `test-results/asset-dropdown-${testInfo.project.name}.png`,
  });
  await page
    .getByRole("option")
    .and(page.locator(`[data-value="${asset.id}"]`))
    .click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.locator(".holding .listing-identity").getByText("VWCE", { exact: true }),
  ).toBeVisible();

  await page.goto("/settings");
  const timezone = page.getByRole("combobox", {
    name: "Time zone",
    exact: true,
  });
  await timezone.click();
  await checkMenu(page);
  expect(
    await page
      .locator(".select-viewport")
      .evaluate((node) => node.scrollHeight > node.clientHeight),
  ).toBe(true);
  await page.keyboard.press("End");
  await page.screenshot({
    path: `test-results/timezone-dropdown-${testInfo.project.name}.png`,
  });
  await page.keyboard.press("Escape");
  await expect(timezone).toBeFocused();
  await chooseOption(timezone, "America/New_York");
  const preferences = page.locator("form").filter({
    has: page.getByRole("combobox", {
      name: "Display language",
      exact: true,
    }),
  });
  expect(
    await preferences.evaluate((node) =>
      Object.fromEntries(new FormData(node as HTMLFormElement)),
    ),
  ).toMatchObject({ timeZone: "America/New_York", locale: "en" });
  await preferences.evaluate((node) => (node as HTMLFormElement).reset());
  await expect(timezone).toContainText("Europe/Zagreb");
  await chooseOption(
    page.getByRole("combobox", { name: "Display language", exact: true }),
    "hr",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "hr");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
