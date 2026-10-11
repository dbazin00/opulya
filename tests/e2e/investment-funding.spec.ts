import { test, expect, chooseOption, catalogueFixture } from "./fixtures";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { decimal } from "@opulya/shared";

test("record activity funds investments from a tracked account with linked histories", async ({
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
    lastName: "Investor",
    email: `funding-${randomUUID()}@example.test`,
    password: "browser-test-password-123",
    locale: "en",
    timeZone: "Europe/Zagreb",
  });
  const bank = await post("accounts", {
    name: "Everyday banking",
    type: "BANK",
    currency: "EUR",
    initialBalance: "1000",
  });
  const investment = await post("accounts", {
    name: "Long-term portfolio",
    type: "INVESTMENT",
    currency: "EUR",
    initialBalance: "20",
  });
  await post("accounts", {
    name: "Dollar account",
    type: "BANK",
    currency: "USD",
    initialBalance: "1000",
  });
  const reference = await catalogueFixture({
    symbol: "BTC",
    name: "Bitcoin",
    assetType: "CRYPTO",
    currency: "EUR",
  });
  const asset = await post("assets", { instrumentId: reference.id });
  await page.goto("/investments");
  await page
    .getByRole("button", { name: "Record activity", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await chooseOption(
    dialog.getByRole("combobox", { name: "Asset", exact: true }),
    asset.id,
  );
  const funding = dialog.getByRole("combobox", {
    name: "Funding account",
    exact: true,
  });
  await funding.click();
  await expect(
    page.getByRole("option", { name: "Investment cash", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("option", { name: "Dollar account", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("option", { name: "Long-term portfolio", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("option", { name: "Everyday banking", exact: true })
    .click();
  await dialog.getByLabel("Quantity", { exact: true }).fill("10");
  await dialog.getByLabel("Price per unit", { exact: true }).fill("10");
  const gross = dialog.getByLabel("Gross amount (EUR)", { exact: true });
  await expect(gross).toHaveValue("€100.00");
  await expect(gross).toHaveAttribute("readonly", "");
  const preciseQuantity = "0.123456789012";
  const precisePrice = "123.45678901";
  const preciseGross = decimal(preciseQuantity)
    .mul(precisePrice)
    .toDecimalPlaces(8)
    .toFixed();
  await dialog.getByLabel("Quantity", { exact: true }).fill(preciseQuantity);
  await dialog.getByLabel("Price per unit", { exact: true }).fill(precisePrice);
  await expect(gross).toHaveValue("€15.24");
  await dialog.getByLabel("Quantity", { exact: true }).fill("10");
  await dialog.getByLabel("Price per unit", { exact: true }).fill("10");
  await dialog.getByLabel("Fee", { exact: true }).fill("2.25");
  await expect(dialog.locator(".account-current-balance")).toContainText(
    "€102.25",
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: `test-results/investment-funding-form-${testInfo.project.name}.png`,
  });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const buyRow = page
    .locator(".history-row")
    .filter({ has: page.getByText("Buy", { exact: true }) });
  await expect(buyRow).toContainText("Everyday banking");
  await expect(buyRow).toContainText("€102.25");
  await expect(buyRow).toContainText("€20.00");
  const portfolio = await (
    await page.request.get(`/api/accounts/${investment.id}/portfolio`)
  ).json();
  expect(portfolio.cashBalance).toBe("20");
  expect(portfolio.positions[0].quantity).toBe("10");
  const balances = await (await page.request.get("/api/accounts")).json();
  expect(
    balances.find((a: { id: string }) => a.id === bank.id).currentBalance,
  ).toBe("897.75");
  await page.goto(`/accounts/${bank.id}`);
  await expect(page.locator(".account-current-balance")).toContainText(
    "€897.75",
  );
  await expect(page.locator(".history-row")).toContainText(
    "Investment funding",
  );
  await expect(page.locator(".history-row")).toContainText(
    "Long-term portfolio",
  );
  await expect(page.locator(".history-row")).toContainText("-€102.25");
  await page.goto("/transactions");
  const linked = page
    .locator(".transaction-row")
    .filter({ hasText: "Investment funding" });
  await expect(linked).toHaveCount(1);
  await expect(
    linked.getByRole("button", { name: "Edit activity", exact: true }),
  ).toBeVisible();
  await expect(
    linked.getByRole("button", { name: "Correct transaction", exact: true }),
  ).toHaveCount(0);
  const report = await (
    await page.request.get(`/api/analytics?accountId=${bank.id}`)
  ).json();
  expect(report.income).toBe("0");
  expect(report.expenses).toBe("0");
  await page.goto("/investments");
  await page
    .getByRole("button", { name: "Record activity", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await chooseOption(
    dialog.getByRole("combobox", { name: "Type", exact: true }),
    "DEPOSIT",
  );
  await dialog.getByLabel("Gross amount (EUR)", { exact: true }).fill("50");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    dialog.getByRole("combobox", { name: "Funding account", exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await chooseOption(
    dialog.getByRole("combobox", { name: "Funding account", exact: true }),
    bank.id,
  );
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const depositRow = page
    .locator(".history-row")
    .filter({ has: page.getByText("Deposit", { exact: true }) });
  await expect(depositRow).toContainText("€70.00");
  expect(
    (
      await (
        await page.request.get(`/api/accounts/${investment.id}/portfolio`)
      ).json()
    ).cashBalance,
  ).toBe("70");
  await depositRow
    .getByRole("button", { name: "Void activity", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("linked funding transfer");
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(depositRow).toHaveCount(0);
  let quoteState: "priced" | "auth-error" = "priced";
  await page.route(
    `**/api/accounts/${investment.id}/portfolio`,
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      if (quoteState === "priced") {
        body.positions = body.positions.map(
          (position: {
            assetId: string;
            quantity: string;
            costBasis: string;
          }) => {
            const value = decimal(position.quantity).mul("123.45");
            const gain = value.sub(position.costBasis);
            return {
              ...position,
              currentPrice: "123.45",
              marketValue: value.toFixed(),
              unrealizedGain: gain.toFixed(),
              returnPercent: gain.div(position.costBasis).mul(100).toFixed(),
            };
          },
        );
        body.holdingsValue = body.positions[0].marketValue;
        body.totalValue = decimal(body.cashBalance)
          .add(body.holdingsValue)
          .toFixed();
        body.quotes = [
          {
            assetId: asset.id,
            error: null,
            quote: {
              price: "123.45",
              currency: "EUR",
              fetchedAt: new Date().toISOString(),
              marketAt: new Date().toISOString(),
              tradingDate: new Date().toISOString().slice(0, 10),
              kind: "QUOTE",
              provider: "Alpha Vantage",
              stale: false,
              delayed: true,
            },
          },
        ];
      } else {
        body.quotes = [
          { assetId: asset.id, quote: null, error: "MARKET_AUTH_FAILED" },
        ];
      }
      await route.fulfill({ response, json: body });
    },
  );
  await page.reload();
  const holding = page.locator(".holding").filter({ hasText: "Bitcoin" });
  await expect(holding.locator(".holding-title .money")).toContainText(
    "€1,234.50",
  );
  await expect(holding.locator(".price-status")).toContainText("Price date");
  await page.screenshot({
    path: `test-results/crypto-valuation-${testInfo.project.name}.png`,
    fullPage: true,
  });
  quoteState = "auth-error";
  await page.reload();
  await expect(holding).toContainText("The market-data API key was rejected.");
  await page.goto("/settings");
  await chooseOption(
    page.getByRole("combobox", { name: "Display language", exact: true }),
    "hr",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "hr");
  await page.goto("/investments");
  await expect(page.locator(".holding")).toContainText(
    "API ključ za tržišne podatke je odbijen.",
  );
  quoteState = "priced";
  await page.reload();
  await expect(page.locator(".holding-title .money")).toContainText("1.234,50");
  await page
    .getByRole("button", { name: "Zabilježi aktivnost", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("combobox", {
      name: "Račun za financiranje",
      exact: true,
    }),
  ).toBeVisible();
  await chooseOption(
    dialog.getByRole("combobox", {
      name: "Račun za financiranje",
      exact: true,
    }),
    bank.id,
  );
  await dialog.getByLabel("Količina", { exact: true }).fill("1");
  await dialog.getByLabel("Cijena po jedinici", { exact: true }).fill("10");
  await expect(
    dialog.getByLabel("Bruto iznos (EUR)", { exact: true }),
  ).toHaveValue(/10,00\s€$/);
  await expect(dialog.locator(".account-current-balance")).toContainText(
    "10,00",
  );
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
    path: `test-results/investment-funding-hr-${testInfo.project.name}.png`,
  });
  await chooseOption(
    dialog.getByRole("combobox", { name: "Instrument", exact: true }),
    asset.id,
  );
  await dialog.getByLabel("Količina", { exact: true }).fill(preciseQuantity);
  await dialog
    .getByLabel("Cijena po jedinici", { exact: true })
    .fill(precisePrice);
  await expect(
    dialog.getByLabel("Bruto iznos (EUR)", { exact: true }),
  ).toHaveValue(/15,24\s€$/);
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/investments",
  );
  await dialog.getByRole("button", { name: "Spremi", exact: true }).click();
  const payload = (await submitted).postDataJSON();
  expect(payload.totalAmount).toBe(preciseGross);
  expect(payload.quantity).toBe(preciseQuantity);
  expect(payload.pricePerUnit).toBe(precisePrice);
  await expect(dialog).not.toBeVisible();
  const updated = await (
    await page.request.get(`/api/accounts/${investment.id}/portfolio`, {
      maxRetries: 2,
    })
  ).json();
  expect(updated.positions[0].costBasis).toBe(
    decimal("102.25").add(preciseGross).toFixed(),
  );
  expect(errors).toEqual([]);
});
