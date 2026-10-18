import { test, expect, chooseOption } from "./fixtures";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";

for (const locale of ["en", "hr"] as const) {
  test(`monthly budgets, overrides and nested totals in ${locale}`, async ({
    page,
  }, testInfo) => {
    const hr = locale === "hr";
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
      lastName: "Budget",
      email: `budgets-ui-${randomUUID()}@example.test`,
      password: "browser-test-password-123",
      locale,
      timeZone: "Europe/Zagreb",
    });
    const account = await post("accounts", {
      name: "Bank",
      type: "BANK",
      currency: "EUR",
      initialBalance: "1000",
    });
    const food = await post("categories", { name: "Food", type: "EXPENSE" });
    const groceries = await post("categories", {
      name: "Groceries",
      type: "EXPENSE",
      parentId: food.id,
    });
    const produce = await post("categories", {
      name: "Produce",
      type: "EXPENSE",
      parentId: groceries.id,
    });
    await post("transactions", {
      type: "EXPENSE",
      sourceAccountId: account.id,
      categoryId: produce.id,
      currency: "EUR",
      amount: "42.50",
      occurredAt: "2026-03-15T12:00:00.000Z",
      clientRequestId: randomUUID(),
    });
    await post("budgets", {
      categoryId: groceries.id,
      month: "2026-03",
      currency: "EUR",
      scope: "RECURRING",
      amount: "60",
    });
    const salary = await post("categories", { name: "Salary", type: "INCOME" });
    await post("budgets", {
      categoryId: salary.id,
      month: "2026-03",
      currency: "EUR",
      scope: "RECURRING",
      amount: "2000",
    });
    await page.goto("/budgets");
    const row = (id: string) => page.locator(`[data-category-id="${id}"]`);
    await expect(row(food.id)).toBeVisible();
    // Month inputs have browser-dependent roles.
    const monthInput = page.locator('input[type="month"]');
    await monthInput.fill("2026-03");
    await expect(
      page.getByRole("heading", {
        name: hr ? "Budžeti" : "Budgets",
        exact: true,
      }),
    ).toBeVisible();
    await expect(row(food.id)).toContainText(hr ? "42,50" : "42.50");
    await page
      .getByRole("button", {
        name: hr ? "Uredi budžet za Food" : "Edit budget for Food",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel(hr ? "Mjesečni iznos (EUR)" : "Monthly amount (EUR)")
      .fill("100");
    await expect(dialog).toContainText(hr ? "ožujak" : "March");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/budget-form-${locale}-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: hr ? "Spremi" : "Save", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator(".stats-row .stat").first()).toContainText(
      hr ? "100,00" : "100.00",
    );
    await expect(row(food.id)).toContainText(hr ? "57,50" : "57.50");
    await page
      .getByRole("button", {
        name: hr ? "Sažmi: Food" : "Collapse Food",
        exact: true,
      })
      .click();
    await expect(row(groceries.id)).toHaveCount(0);
    await page
      .getByRole("button", {
        name: hr ? "Proširi: Food" : "Expand Food",
        exact: true,
      })
      .click();
    await expect(row(produce.id)).toBeVisible();

    await monthInput.fill("2026-04");
    await expect(row(food.id)).toContainText(hr ? "100,00" : "100.00");
    await page
      .getByRole("button", {
        name: hr ? "Uredi budžet za Food" : "Edit budget for Food",
        exact: true,
      })
      .click();
    await chooseOption(dialog.getByRole("combobox"), "MONTH");
    await dialog
      .getByLabel(hr ? "Mjesečni iznos (EUR)" : "Monthly amount (EUR)")
      .fill("150");
    await dialog
      .getByRole("button", { name: hr ? "Spremi" : "Save", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(row(food.id)).toContainText(hr ? "150,00" : "150.00");
    await expect(row(food.id)).toContainText(
      hr ? "Samo ovaj mjesec" : "Month only",
    );
    await monthInput.fill("2026-05");
    await expect(row(food.id)).toContainText(hr ? "100,00" : "100.00");
    await monthInput.fill("2026-04");
    await expect(row(food.id)).toContainText(hr ? "150,00" : "150.00");
    await page
      .getByRole("button", {
        name: hr ? "Uredi budžet za Food" : "Edit budget for Food",
        exact: true,
      })
      .click();
    await dialog
      .getByRole("button", {
        name: hr ? "Koristi ponavljajući iznos" : "Use repeating amount",
        exact: true,
      })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(row(food.id)).toContainText(hr ? "100,00" : "100.00");

    await monthInput.fill("2026-03");
    await expect(row(food.id)).toContainText(hr ? "57,50" : "57.50");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({
      path: `test-results/budgets-${locale}-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await monthInput.fill("2026-05");
    await expect(row(food.id)).toContainText(hr ? "100,00" : "100.00");
    await page
      .getByRole("button", {
        name: hr ? "Uredi budžet za Food" : "Edit budget for Food",
        exact: true,
      })
      .click();
    await dialog
      .getByRole("button", {
        name: hr
          ? "Zaustavi ponavljanje od ovog mjeseca"
          : "Stop repeating from this month",
        exact: true,
      })
      .click();
    await dialog
      .getByRole("button", { name: hr ? "Potvrdi" : "Confirm", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(row(food.id)).toContainText(
      hr ? "Nije postavljeno" : "Not set",
    );
    await expect(page.locator(".stats-row .stat").first()).toContainText(
      hr ? "60,00" : "60.00",
    );
    await monthInput.fill("2026-04");
    await expect(row(food.id)).toContainText(hr ? "100,00" : "100.00");
    const incomeTab = page.getByRole("button", {
      name: hr ? "Ciljevi prihoda" : "Income targets",
      exact: true,
    });
    await incomeTab.click();
    await expect(row(salary.id)).toBeVisible();
    await monthInput.fill("2026-06");
    await expect(incomeTab).toHaveAttribute("aria-pressed", "true");
    await expect(row(salary.id)).toContainText(hr ? "2.000,00" : "2,000.00");
  });
}
