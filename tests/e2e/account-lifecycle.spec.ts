import { test, expect, chooseOption } from "./fixtures";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";

test("edit account type, confirm empty-account deletion and preserve accounts with history", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
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
    lastName: "Accounts",
    email: `account-ui-${randomUUID()}@example.test`,
    password: "browser-test-password-123",
    locale: "en",
    timeZone: "Europe/Zagreb",
  });
  const account = await post("accounts", {
    name: "Wrong account type",
    type: "BANK",
    currency: "EUR",
    initialBalance: "100",
  });
  const preserved = await post("accounts", {
    name: "Account with history",
    type: "BANK",
    currency: "EUR",
    initialBalance: "100",
    recordInitialBalance: true,
  });
  const investment = await post("accounts", {
    name: "Investment history",
    type: "INVESTMENT",
    currency: "EUR",
    initialBalance: "100",
  });
  await post("investments", {
    accountId: investment.id,
    type: "FEE",
    totalAmount: "2",
    currency: "EUR",
    executedAt: new Date().toISOString(),
    clientRequestId: randomUUID(),
  });
  await page.goto(`/accounts/${account.id}`);
  await page.getByRole("button", { name: "Edit account", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Type", { exact: true })).toHaveText("Bank");
  await chooseOption(dialog.getByLabel("Type", { exact: true }), "CASH");
  await dialog.getByLabel("Name", { exact: true }).fill("Corrected account");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Corrected account", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".account-current-balance")).toContainText(
    "€100.00",
  );
  await page.getByRole("button", { name: "Edit account", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Type", { exact: true })).toHaveText("Cash");
  await chooseOption(dialog.getByLabel("Type", { exact: true }), "INVESTMENT");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Edit account", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByLabel("Type", { exact: true }),
  ).toHaveText("Investment");
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
    path: `test-results/account-type-edit-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Delete account", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Corrected account");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Edit account", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(
    page.getByRole("heading", { name: "Corrected account", exact: true }),
  ).toHaveCount(0);
  expect(
    (await (await page.request.get("/api/accounts")).json()).some(
      (a: { id: string }) => a.id === account.id,
    ),
  ).toBe(false);

  await page.goto(`/accounts/${preserved.id}`);
  await page.getByRole("button", { name: "Edit account", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Delete", exact: true }),
  ).toHaveCount(0);
  await expect(dialog).toContainText("can only be archived");
  await chooseOption(dialog.getByLabel("Type", { exact: true }), "CASH");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".account-current-balance")).toContainText(
    "€100.00",
  );
  await page.goto(`/accounts/${investment.id}`);
  await page.getByRole("button", { name: "Edit account", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Type", { exact: true })).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Delete", exact: true }),
  ).toHaveCount(0);
  await expect(dialog).toContainText("linked investment activity");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  await page.goto("/settings");
  await chooseOption(
    page.getByRole("combobox", { name: "Display language", exact: true }),
    "hr",
  );
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
  const empty = await post("accounts", {
    name: `Prazan račun ${"a".repeat(80)}`,
    type: "CASH",
    currency: "EUR",
    initialBalance: "0",
  });
  await page.goto(`/accounts/${empty.id}`);
  await page.getByRole("button", { name: "Uredi račun", exact: true }).click();
  dialog = page.getByRole("dialog");
  await chooseOption(dialog.getByLabel("Vrsta", { exact: true }), "BANK");
  await dialog.getByRole("button", { name: "Spremi", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Uredi račun", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Obriši", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Obriši račun", exact: true });
  await expect(dialog).toContainText("Prazan račun");
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
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
    path: `test-results/account-delete-hr-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Obriši", exact: true }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  expect(errors).toEqual([]);
});
