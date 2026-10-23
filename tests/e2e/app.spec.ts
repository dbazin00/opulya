import {
  test,
  expect,
  chooseOption,
  catalogueFixture,
  verificationMail,
  removeVerificationMail,
  type Page,
} from "./fixtures";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
async function accessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      rule: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}
test("register, manage finances, drill down, localize and render responsively", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await accessible(page);
  await page.getByRole("link", { name: "Get started" }).click();
  await page.getByLabel("First name", { exact: true }).fill("Alex");
  await page.getByLabel("Last name", { exact: true }).fill("Test");
  const email = `browser-${randomUUID()}@example.test`;
  await page.getByLabel("Email address").fill(email);
  await expect(
    page.getByRole("button", { name: "Create account", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "I agree to the Terms of Use." })
    .check();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/check-email/);
  const mail = await verificationMail(email);
  await page.goto(mail.verificationUrl);
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-123");
  await page
    .getByLabel("Repeat password", { exact: true })
    .fill("browser-test-password-123");
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Email verified", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await removeVerificationMail(email);
  await expect(page.getByText("Start with your first account")).toBeVisible();
  await noOverflow(page);
  await page.goto("/categories");
  await expect(page.getByText("No categories", { exact: true })).toBeVisible();
  const createCategory = async (name: string, type: "INCOME" | "EXPENSE") => {
    await page
      .getByRole("button", { name: "Add category", exact: true })
      .click();
    const categoryDialog = page.getByRole("dialog");
    await categoryDialog.getByLabel("Name", { exact: true }).fill(name);
    await chooseOption(
      categoryDialog.getByLabel("Type", { exact: true }),
      type,
    );
    await categoryDialog
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(categoryDialog).not.toBeVisible();
  };
  await createCategory("Food", "EXPENSE");
  await createCategory("Salary", "INCOME");
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Everyday banking");
  await dialog.getByLabel("Opening balance", { exact: true }).fill("4250");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Cash wallet");
  await chooseOption(dialog.getByLabel("Type", { exact: true }), "CASH");
  await dialog.getByLabel("Opening balance", { exact: true }).fill("150");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount (EUR)").fill("42.50");
  await chooseOption(dialog.getByLabel("Category", { exact: true }), {
    label: "Food",
  });
  await dialog.getByLabel("Description").fill("Weekly groceries");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const headers = { Origin: "http://localhost:3001", "X-Opulya-Request": "1" };
  const get = async (path: string) =>
    (await page.request.get(`/api/${path}`)).json();
  const post = async (path: string, data: unknown) => {
    const res = await page.request.post(`/api/${path}`, { headers, data });
    expect(res.ok(), await res.text()).toBe(true);
    return res.json();
  };
  const accounts = (await get("accounts")) as { id: string; name: string }[];
  const bank = accounts.find((a) => a.name === "Everyday banking")!;
  const wallet = accounts.find((a) => a.name === "Cash wallet")!;
  const categories = (await get("categories")) as {
    id: string;
    name: string;
    type: string;
  }[];
  const food = categories.find((c) => c.name === "Food")!;
  const salary = categories.find((c) => c.name === "Salary")!;
  const restaurant = await post("categories", {
    name: "Restaurants",
    type: "EXPENSE",
    parentId: food.id,
  });
  const fast = await post("categories", {
    name: "Fast food",
    type: "EXPENSE",
    parentId: restaurant.id,
  });
  const burgers = await post("categories", {
    name: "Burgers",
    type: "EXPENSE",
    parentId: fast.id,
  });
  const now = new Date(Date.now() - 10_000).toISOString();
  await post("transactions", {
    type: "INCOME",
    destinationAccountId: bank.id,
    amount: "3200",
    currency: "EUR",
    categoryId: salary.id,
    description: "Monthly salary",
    occurredAt: now,
    clientRequestId: randomUUID(),
  });
  await post("transactions", {
    type: "EXPENSE",
    sourceAccountId: bank.id,
    amount: "18.90",
    currency: "EUR",
    categoryId: burgers.id,
    description: "Lunch",
    occurredAt: now,
    clientRequestId: randomUUID(),
  });
  await post("transactions", {
    type: "TRANSFER",
    sourceAccountId: bank.id,
    destinationAccountId: wallet.id,
    amount: "100",
    currency: "EUR",
    occurredAt: now,
    clientRequestId: randomUUID(),
  });
  await page.goto("/transactions");
  await expect(page.getByText("Weekly groceries")).toBeVisible();
  await expect(page.getByText("Monthly salary")).toBeVisible();
  await noOverflow(page);
  await chooseOption(page.getByLabel("Category", { exact: true }), food.id);
  await expect(page.getByText("Monthly salary")).not.toBeVisible();
  await expect(page.getByText("Weekly groceries")).toBeVisible();
  await expect(page.getByText("Lunch", { exact: true })).toBeVisible();
  await page.goto(`/accounts/${bank.id}`);
  await expect(page.locator(".history-balance > .money").first()).toBeVisible();
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByText("No activity this month")).toBeVisible();
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByText("Weekly groceries")).toBeVisible();
  await noOverflow(page);
  await page.goto("/analytics");
  await page.locator(".legend").getByRole("button", { name: /Food/ }).click();
  await page
    .locator(".legend")
    .getByRole("button", { name: /Restaurants/ })
    .click();
  await page
    .locator(".legend")
    .getByRole("button", { name: /Fast food/ })
    .click();
  await expect(page.locator(".legend").getByText("Burgers")).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: `test-results/analytics-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const broker = await post("accounts", {
    name: "Long-term portfolio",
    type: "INVESTMENT",
    currency: "EUR",
    initialBalance: "5000",
  });
  const reference = await catalogueFixture({
    name: "Vanguard FTSE All-World",
    symbol: "VWCE",
    assetType: "ETF",
    exchange: "XETRA",
    currency: "EUR",
  });
  const instrument = await post("assets", { instrumentId: reference.id });
  await post("investments", {
    accountId: broker.id,
    sourceAccountId: bank.id,
    assetId: instrument.id,
    type: "BUY",
    quantity: "20",
    pricePerUnit: "120",
    totalAmount: "2400",
    fee: "2",
    currency: "EUR",
    executedAt: now,
    clientRequestId: randomUUID(),
  });
  await page.goto("/investments");
  await expect(
    page
      .locator(".holding .listing-identity")
      .getByText("VWCE", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Market data is not configured.", { exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: `test-results/investments-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Everyday banking", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await expect(page.locator(".recharts-surface").first()).toBeVisible();
  await page.screenshot({
    path: `test-results/dashboard-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await accessible(page);
  await page.goto("/settings");
  await page
    .getByRole("combobox", { name: "Display language", exact: true })
    .click();
  await page.getByRole("option", { name: "Hrvatski", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Postavke", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "hr");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Postavke", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Vaš financijski pregled" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Everyday banking", exact: true }),
  ).toBeVisible();
  await page.goto("/categories");
  await expect(
    page.locator("strong").getByText("Food", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("strong").getByText("Salary", { exact: true }),
  ).toBeVisible();
  await page.goto("/dashboard");
  await page.screenshot({
    path: `test-results/croatian-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await noOverflow(page);
  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "Više", exact: true }).click();
  await page
    .getByRole("button", { name: "Odjava", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await accessible(page);
  expect(errors).toEqual([]);
});
