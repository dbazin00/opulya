import { test, expect, chooseOption, catalogueFixture } from "./fixtures";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";

for (const locale of ["en", "hr"] as const) {
  test(`per-asset investment goals in ${locale}`, async ({
    page,
  }, testInfo) => {
    const hr = locale === "hr";
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        message.text().includes("MISSING_MESSAGE")
      )
        errors.push(message.text());
    });
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
      email: `investment-goals-${randomUUID()}@example.test`,
      password: "browser-test-password-123",
      locale,
      timeZone: "Europe/Zagreb",
    });
    await page.goto("/budgets");
    await page
      .getByRole("button", {
        name: hr ? "Ulaganja" : "Investments",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", {
        name: hr
          ? "Nema instrumenata u ovoj valuti"
          : "No assets in this currency",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: hr ? "Dodaj instrument" : "Add asset",
        exact: true,
      }),
    ).toHaveAttribute("href", "/assets");
    const bank = await post("accounts", {
      name: "Bank",
      type: "BANK",
      currency: "EUR",
      initialBalance: "1000",
    });
    const portfolios = [];
    for (const name of ["Portfolio", "Second portfolio"]) {
      portfolios.push(
        await post("accounts", {
          name,
          type: "INVESTMENT",
          currency: "EUR",
          initialBalance: "0",
        }),
      );
    }
    const etfReference = await catalogueFixture({
      symbol: "IWDA.AS",
      name: "iShares Core MSCI World UCITS ETF USD (Acc)",
      assetType: "ETF",
      exchange: "AMS",
      mic: "XAMS",
      currency: "EUR",
    });
    const coinReference = await catalogueFixture({
      symbol: "BTC",
      name: "Bitcoin",
      assetType: "CRYPTO",
      currency: "EUR",
    });
    const usdReference = await catalogueFixture({
      symbol: "AAPL",
      name: "Apple",
      assetType: "STOCK",
      exchange: "NMS",
      mic: "XNAS",
      currency: "USD",
    });
    const etf = await post("assets", { instrumentId: etfReference.id });
    const coin = await post("assets", { instrumentId: coinReference.id });
    await post("assets", { instrumentId: usdReference.id });
    for (let i = 0; i < portfolios.length; i++) {
      await post("investments", {
        accountId: portfolios[i].id,
        sourceAccountId: bank.id,
        assetId: etf.id,
        type: "BUY",
        quantity: i ? "5" : "10",
        pricePerUnit: "10",
        totalAmount: i ? "50" : "100",
        fee: i ? "1" : "2",
        currency: "EUR",
        executedAt: "2026-03-15T12:00:00Z",
        clientRequestId: randomUUID(),
      });
    }
    await post("investments", {
      accountId: portfolios[0].id,
      assetId: etf.id,
      type: "SELL",
      quantity: "1",
      pricePerUnit: "12",
      totalAmount: "12",
      fee: "1",
      currency: "EUR",
      executedAt: "2026-03-20T12:00:00Z",
      clientRequestId: randomUUID(),
    });
    await page.goto("/budgets");
    const investmentTab = page.getByRole("button", {
      name: hr ? "Ulaganja" : "Investments",
      exact: true,
    });
    await investmentTab.click();
    const month = page.locator('input[type="month"]');
    await month.fill("2026-03");
    const dialog = page.getByRole("dialog");
    const row = page.locator(`[data-asset-id="${etf.id}"]`);
    const add = page.getByRole("button", {
      name: hr ? "Dodaj cilj ulaganja" : "Add investment goal",
      exact: true,
    });
    const save = () =>
      dialog
        .getByRole("button", { name: hr ? "Spremi" : "Save", exact: true })
        .click();
    const amount = () =>
      dialog.getByLabel(hr ? "Mjesečni iznos (EUR)" : "Monthly amount (EUR)");
    const edit = () =>
      row
        .getByRole("button", {
          name: `${hr ? "Uredi budžet za" : "Edit budget for"} ${etf.name}`,
          exact: true,
        })
        .click();
    await expect(
      page.getByRole("heading", {
        name: hr
          ? "Nema ciljeva ulaganja za ovaj mjesec"
          : "No investment goals this month",
        exact: true,
      }),
    ).toBeVisible();
    await add.click();
    const picker = dialog.getByRole("combobox", {
      name: hr ? "Instrument" : "Asset",
      exact: true,
    });
    await picker.click();
    await expect(page.getByRole("option", { name: /Apple/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await chooseOption(picker, etf.id);
    await expect(picker).toHaveAttribute(
      "title",
      (await picker.textContent())!.trim(),
    );
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    const selection = picker.locator(":scope > span").first();
    await expect(selection).toHaveCSS("text-overflow", "ellipsis");
    expect(
      await selection.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const triggerBounds = await picker.boundingBox();
    await picker.click();
    const menu = page.getByRole("listbox");
    await expect(menu).toBeVisible();
    const menuBounds = await menu.boundingBox();
    expect(triggerBounds).not.toBeNull();
    expect(menuBounds).not.toBeNull();
    expect(Math.abs(menuBounds!.x - triggerBounds!.x)).toBeLessThan(1);
    expect(Math.abs(menuBounds!.width - triggerBounds!.width)).toBeLessThan(1);
    expect(
      await menu.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/investment-goal-menu-${locale}-${testInfo.project.name}.png`,
    });
    await page.keyboard.press("Escape");
    await expect(picker).toBeFocused();
    await page.screenshot({
      path: `test-results/investment-goal-form-${locale}-${testInfo.project.name}.png`,
    });
    await amount().fill("200");
    await save();
    await expect(dialog).not.toBeVisible();
    await expect(row).toContainText(hr ? "153,00" : "153.00");
    await expect(row).toContainText(hr ? "47,00" : "47.00");
    await expect(row.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "76.5",
    );
    await expect(page.locator(`[data-asset-id="${coin.id}"]`)).toHaveCount(0);
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
    if (testInfo.project.name === "mobile") {
      await row.evaluate((element) =>
        element.scrollIntoView({ block: "center", behavior: "instant" }),
      );
      const bounds = await row.boundingBox();
      const navigation = await page.locator(".mobile-nav").boundingBox();
      expect(bounds).not.toBeNull();
      expect(navigation).not.toBeNull();
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(navigation!.y);
      const amountPositions = await row
        .locator(".money")
        .evaluateAll((elements) =>
          elements.map((element) => element.getBoundingClientRect().y),
        );
      expect(new Set(amountPositions).size).toBe(1);
    }
    await page.screenshot({
      path: `test-results/investment-budgets-${locale}-${testInfo.project.name}.png`,
      fullPage: testInfo.project.name !== "mobile",
    });
    await add.click();
    await picker.click();
    await expect(page.getByRole("option", { name: /iShares/ })).toHaveCount(0);
    await expect(page.getByRole("option", { name: /Bitcoin/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await dialog
      .getByRole("button", { name: hr ? "Zatvori" : "Close", exact: true })
      .click();

    await month.fill("2026-04");
    await edit();
    await chooseOption(dialog.getByRole("combobox"), "MONTH");
    await amount().fill("300");
    await save();
    await expect(row).toContainText(hr ? "300,00" : "300.00");
    await month.fill("2026-05");
    await expect(row).toContainText(hr ? "200,00" : "200.00");
    await month.fill("2026-04");
    await edit();
    await dialog
      .getByRole("button", {
        name: hr ? "Koristi ponavljajući iznos" : "Use repeating amount",
        exact: true,
      })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(row).toContainText(hr ? "200,00" : "200.00");

    const currency = page.getByRole("combobox", {
      name: hr ? "Valuta" : "Currency",
      exact: true,
    });
    await chooseOption(currency, "USD");
    await expect(row).toHaveCount(0);
    await add.click();
    await expect(picker).toContainText("Apple");
    await dialog
      .getByRole("button", { name: hr ? "Zatvori" : "Close", exact: true })
      .click();
    await chooseOption(currency, "EUR");
    await month.fill("2026-03");
    await expect(row).toContainText(hr ? "153,00" : "153.00");
    await row
      .getByRole("button", {
        name: `${hr ? "Ukloni budžet za" : "Remove budget for"} ${etf.name}`,
        exact: true,
      })
      .click();
    await chooseOption(dialog.getByRole("combobox"), "ALL");
    await expect(dialog).toContainText(
      hr
        ? "povijest ulaganja neće biti izbrisani"
        : "investment activity will not be deleted",
    );
    await page.screenshot({
      path: `test-results/investment-goal-removal-${locale}-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await dialog
      .getByRole("button", {
        name: hr ? "Trajno izbriši" : "Delete permanently",
        exact: true,
      })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(row).toHaveCount(0);
    const remainingAssets = await page.request.get("/api/assets");
    expect(
      (await remainingAssets.json()).some(
        (asset: { id: string }) => asset.id === etf.id,
      ),
    ).toBe(true);
    await page.reload();
    await investmentTab.click();
    await month.fill("2026-03");
    await expect(row).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
