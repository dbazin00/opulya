import { testDatabaseUrl } from "../../packages/config/test-database.js";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../apps/api/src/generated/prisma/client";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, chooseOption, type Page } from "./fixtures";

test("category paths lead transactions, descriptions stay separate and balances sit below amounts", async ({
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
    lastName: "Transactions",
    email: `presentation-${randomUUID()}@example.test`,
    password: "browser-test-password-123",
    locale: "en",
    timeZone: "Europe/Zagreb",
  });
  const bank = await post("accounts", {
    name: "Everyday bank account for household expenses",
    type: "BANK",
    currency: "EUR",
    initialBalance: "1000",
  });
  const savings = await post("accounts", {
    name: "Savings for future plans",
    type: "CASH",
    currency: "EUR",
    initialBalance: "0",
  });
  const names = [
    "Food",
    "Restaurants",
    "Fast food",
    "Burgers",
    "Seasonal specials",
  ];
  let parentId: string | null = null;
  for (const name of names) {
    const category = await post("categories", {
      name,
      type: "EXPENSE",
      parentId,
    });
    parentId = category.id;
  }
  const salary = await post("categories", { name: "Salary", type: "INCOME" });
  const path = names.join(" / ");
  const note =
    "Dinner with friends. Receipt reference: ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.";
  const base = Date.now() - 10_000;
  const entry = (data: Record<string, unknown>, offset: number) =>
    post("transactions", {
      currency: "EUR",
      occurredAt: new Date(base + offset).toISOString(),
      clientRequestId: randomUUID(),
      ...data,
    });
  await entry(
    {
      type: "INCOME",
      destinationAccountId: bank.id,
      categoryId: salary.id,
      amount: "200",
    },
    0,
  );
  const originalExpense = await entry(
    {
      type: "EXPENSE",
      sourceAccountId: bank.id,
      categoryId: parentId,
      amount: "42.50",
      description: note,
    },
    1000,
  );
  const legacy = await entry(
    {
      type: "EXPENSE",
      sourceAccountId: bank.id,
      categoryId: parentId,
      amount: "5",
    },
    2000,
  );
  const database = testDatabaseUrl();
  if (new URL(database).pathname !== "/opulya_test")
    throw new Error("Legacy fixtures require opulya_test");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database }),
  });
  try {
    // Represent an old uncategorized entry without permitting new ones through the API.
    await db.transaction.update({
      where: { id: legacy.id },
      data: { categoryId: null },
    });
  } finally {
    await db.$disconnect();
  }
  await entry(
    {
      type: "TRANSFER",
      sourceAccountId: bank.id,
      destinationAccountId: savings.id,
      amount: "50",
      description: "Saving for later",
    },
    3000,
  );
  await post(`accounts/${bank.id}/balance`, {
    balance: "1102.50",
    expectedBalance: "1102.50",
    recordTransaction: true,
    clientRequestId: randomUUID(),
  });

  const assertList = async (
    page: Page,
    balanceLabel = "Balance after transaction",
  ) => {
    await expect(page.locator(".transaction-row")).toHaveCount(5);
    const colors = {
      income: "rgb(17, 116, 84)",
      expense: "rgb(173, 52, 58)",
      transfer: "rgb(49, 95, 124)",
    };
    for (const [type, color] of Object.entries(colors)) {
      const amounts = page.locator(
        `.transaction-value > .transaction-amount.${type}`,
      );
      expect(await amounts.count()).toBeGreaterThan(0);
      for (const amount of await amounts.all())
        await expect(amount).toHaveCSS("color", color);
    }
    for (const balance of await page
      .locator(".transaction-balances .money")
      .all()) {
      await expect(balance).toHaveCSS("color", "rgb(37, 50, 56)");
    }
    const amounts = await page.locator(".transaction-value > .money").all();
    const amountBoxes = await Promise.all(
      amounts.map((amount) => amount.boundingBox()),
    );
    const reference = amountBoxes[0]!;
    for (const box of amountBoxes) {
      expect(box).not.toBeNull();
      const edge =
        testInfo.project.name === "mobile" ? box!.x : box!.x + box!.width;
      const expected =
        testInfo.project.name === "mobile"
          ? reference.x
          : reference.x + reference.width;
      expect(Math.abs(edge - expected)).toBeLessThan(1);
    }
    const actions = await page
      .getByRole("button", { name: "Void transaction", exact: true })
      .all();
    if (actions.length) {
      expect(actions).toHaveLength(5);
      const actionBoxes = await Promise.all(
        actions.map((action) => action.boundingBox()),
      );
      for (const box of actionBoxes)
        expect(Math.abs(box!.x - actionBoxes[0]!.x)).toBeLessThan(1);
      const adjustment = page
        .locator(".transaction-row")
        .filter({ has: page.locator(".transaction-icon.adjustment") });
      await expect(adjustment.locator(".row-actions button")).toHaveCount(1);
    }
    const row = page.locator(".transaction-row").filter({ hasText: note });
    await expect(row.locator(".transaction-description > strong")).toHaveText(
      path,
    );
    await expect(row.locator(".transaction-note")).toHaveText(note);
    await expect(
      row.locator(".transaction-description .transaction-balances"),
    ).toHaveCount(0);
    const value = row.locator(".transaction-value");
    await expect(value.locator(":scope > .money")).toHaveText(/42[.,]50/);
    await expect(value.locator(".transaction-balances")).toContainText(
      /1[,.]157[,.]50/,
    );
    const label = value.locator(".transaction-balances dt");
    await expect(label).toHaveClass("sr-only");
    await expect(label).toHaveCSS("position", "absolute");
    await expect(label).toHaveCSS("width", "1px");
    expect(
      await value.locator(".transaction-balances").ariaSnapshot(),
    ).toContain(balanceLabel);
    const amountBox = await value.locator(":scope > .money").boundingBox();
    const balanceBox = await value
      .locator(".transaction-balances")
      .boundingBox();
    expect(amountBox).not.toBeNull();
    expect(balanceBox).not.toBeNull();
    expect(balanceBox!.y).toBeGreaterThanOrEqual(
      amountBox!.y + amountBox!.height,
    );
    await expect(
      page
        .locator(".transaction-description > strong")
        .getByText("Salary", { exact: true }),
    ).toBeVisible();
    const transfer = page
      .locator(".transaction-row")
      .filter({ hasText: "Saving for later" });
    await expect(
      transfer.locator(".transaction-value .transaction-balances dt"),
    ).toHaveCount(2);
    await expect(transfer.locator(".transaction-balances")).toContainText(
      bank.name,
    );
    await expect(transfer.locator(".transaction-balances")).toContainText(
      savings.name,
    );
    for (const term of await transfer
      .locator(".transaction-balances dt")
      .all()) {
      await expect(term).not.toHaveClass("sr-only");
      await expect(term.locator(".sr-only")).toHaveCSS("position", "absolute");
      await expect(term.locator(".sr-only")).toHaveCSS("width", "1px");
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  };
  const assertFilters = async (locale: "en" | "hr") => {
    const labels =
      locale === "en"
        ? ["Account", "Type", "Category", "Start date", "End date"]
        : ["Račun", "Vrsta", "Kategorija", "Početni datum", "Završni datum"];
    const controls = labels.map((name) =>
      page.getByLabel(name, { exact: true }),
    );
    const originalViewport = page.viewportSize()!;
    const widths =
      testInfo.project.name === "mobile" ? [320, 360, 430, 768] : [1024, 1440];
    for (const width of widths) {
      await page.setViewportSize({ width, height: originalViewport.height });
      const boxes = await Promise.all(
        controls.map((control) => control.boundingBox()),
      );
      for (const box of boxes) {
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        expect(box!.height).toBe(44);
      }
      const [account, type, category, start, end] = boxes;
      expect(start!.y).toBe(end!.y);
      expect(start!.width).toBeCloseTo(end!.width, 0);
      if (width <= 800) {
        expect(account!.y).toBe(type!.y);
        expect(category!.y).toBeGreaterThan(account!.y);
        expect(category!.x).toBe(start!.x);
        expect(category!.width).toBeCloseTo(end!.x + end!.width - start!.x, 0);
        expect(start!.y).toBeGreaterThan(category!.y);
        const actions = page.locator(".workspace .page-actions");
        const month = await actions.locator(".month-picker").boundingBox();
        const currency = await actions.getByRole("combobox").boundingBox();
        const add = await actions
          .getByRole("button", {
            name: locale === "en" ? "Add transaction" : "Dodaj transakciju",
            exact: true,
          })
          .boundingBox();
        expect(month!.y).toBe(currency!.y);
        expect(month!.x + month!.width).toBeLessThan(currency!.x);
        expect(add!.x).toBe(month!.x);
        expect(add!.width).toBeCloseTo(
          currency!.x + currency!.width - month!.x,
          0,
        );
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/transaction-filters-${locale}-${width}.png`,
        fullPage: true,
      });
    }
    await page.setViewportSize(originalViewport);
    await chooseOption(controls[0]!, bank.id);
    await expect(controls[0]!).toHaveAttribute("title", bank.name);
    await expect(page.locator(".transaction-row")).toHaveCount(5);
    await chooseOption(controls[0]!, "");
  };
  await page.goto("/transactions");
  await assertList(page);
  await assertFilters("en");
  await expect(
    page
      .locator(".transaction-description > strong")
      .getByText("Uncategorized", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/transaction-presentation-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page
    .locator(".transaction-row")
    .filter({ hasText: note })
    .getByRole("button", { name: "Correct transaction", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Date and time", { exact: true })).toHaveValue(
    /T\d{2}:\d{2}$/,
  );
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/transactions",
  );
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const body = (await submitted).postDataJSON();
  expect(body.replacesId).toBe(originalExpense.id);
  expect(body.occurredAt).toBe(originalExpense.occurredAt);
  await expect(dialog).not.toBeVisible();
  await expect(
    page.locator(".transaction-row").filter({ hasText: note }).locator("time"),
  ).not.toContainText(/\d{1,2}:\d{2}:\d{2}/);

  await page.goto("/dashboard");
  await assertList(page);
  await page.goto(`/accounts/${bank.id}`);
  const history = page.locator(".history-row").filter({ hasText: note });
  await expect(history.locator(".transaction-amount")).toHaveCSS(
    "color",
    "rgb(173, 52, 58)",
  );
  await expect(
    page.locator(".history-row .transaction-amount.income"),
  ).toHaveCSS("color", "rgb(17, 116, 84)");
  await expect(
    page.locator(".history-row .transaction-amount.transfer"),
  ).toHaveCSS("color", "rgb(49, 95, 124)");
  await expect(history.locator("strong")).toHaveText(path);
  await expect(history.locator(".transaction-note")).toHaveText(note);
  await expect(history.locator(".history-balance .sr-only")).toHaveCSS(
    "width",
    "1px",
  );
  const historyAmount = await history
    .locator("div:nth-child(2) > .money")
    .boundingBox();
  const historyBalance = await history.locator("small").boundingBox();
  expect(historyBalance!.y).toBeGreaterThanOrEqual(
    historyAmount!.y + historyAmount!.height,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/transaction-history-${testInfo.project.name}.png`,
    fullPage: true,
  });

  await page.goto("/settings");
  await chooseOption(
    page.getByRole("combobox", { name: "Display language", exact: true }),
    "hr",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.goto("/transactions");
  await assertList(page, "Stanje nakon transakcije");
  await assertFilters("hr");
  await expect(
    page
      .locator(".transaction-description > strong")
      .getByText("Bez kategorije", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".transaction-balances").first()).toContainText(
    "Stanje nakon transakcije",
  );
});
