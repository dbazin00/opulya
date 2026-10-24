import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, catalogueFixture } from "./fixtures";

for (const locale of ["en", "hr"] as const) {
  const hr = locale === "hr";
  const darkLabel = hr ? "Uključi tamnu temu" : "Switch to dark theme";
  const lightLabel = hr ? "Uključi svijetlu temu" : "Switch to light theme";

  test(`theme persists across public pages (${locale})`, async ({
    page,
    baseURL,
  }, testInfo) => {
    await page
      .context()
      .addCookies([{ name: "OPULYA_LOCALE", value: locale, url: baseURL! }]);
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: darkLabel, exact: true }).click();
    for (const path of [
      "/login",
      "/signup",
      "/check-email",
      "/privacy",
      "/security",
      "/terms",
      "/",
    ]) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
      await expect(page.locator("header .brand-link")).toHaveCSS(
        "color",
        "rgb(241, 241, 241)",
      );
      const mark = page.locator("header .brand-link img");
      await expect(mark).toHaveAttribute("src", /opulya-mark-dark\.png/);
      await expect
        .poll(() =>
          mark.evaluate(
            (image: HTMLImageElement) =>
              image.complete && image.naturalWidth > 0,
          ),
        )
        .toBe(true);
      if (path === "/login") {
        await expect(page.locator(".auth-story img")).toHaveAttribute(
          "src",
          /opulya-mark-dark\.png/,
        );
        await expect(page.locator(".auth-page")).toHaveCSS(
          "background-color",
          "rgb(30, 30, 30)",
        );
        await expect(page.locator(".auth-story")).toHaveCSS(
          "background-color",
          "rgb(36, 36, 36)",
        );
        await expect(page.locator(".auth-form h1")).toHaveCSS(
          "color",
          "rgb(237, 237, 237)",
        );
        await expect(page.locator(".auth-form input").first()).toHaveCSS(
          "border-top-color",
          "rgb(115, 115, 115)",
        );
        await expect(
          page.locator('.auth-form button[type="submit"]'),
        ).toHaveCSS("background-color", "rgb(217, 217, 217)");
      }
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
      if (["/login", "/signup", "/"].includes(path))
        await page.screenshot({
          path: `test-results/theme-public-${path.slice(1) || "landing"}-${locale}-${testInfo.project.name}.png`,
          fullPage: true,
        });
    }
    const html = await (await page.request.get("/login")).text();
    expect(html).toContain('data-theme="dark"');
    const viewport = page.viewportSize()!;
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: viewport.height });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const menu = page.locator("header button[aria-controls]");
      if (width <= 1100) await menu.click();
      const themeToggle = page.getByRole("button", {
        name: lightLabel,
        exact: true,
      });
      const language = page.locator("header .language-select");
      expect(
        await themeToggle.evaluate(
          (element, languageElement) =>
            element.nextElementSibling === languageElement,
          await language.elementHandle(),
        ),
      ).toBe(true);
      await page.getByRole("button", { name: lightLabel, exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await page.getByRole("button", { name: darkLabel, exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      if (width <= 1100) await menu.click();
    }
    await page.setViewportSize(viewport);
    await page.goto("/login");
    const width = page.viewportSize()!.width;
    if (width <= 480) {
      await page.setViewportSize({ width: 320, height: 800 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.getByRole("button", { name: lightLabel, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator(".auth-page")).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    await expect(page.locator("header .brand-link")).toHaveCSS(
      "color",
      "rgb(7, 92, 73)",
    );
    await expect(page.locator("header .brand-link img")).toHaveAttribute(
      "src",
      /opulya-mark\.png/,
    );
    await page
      .context()
      .addCookies([
        { name: "OPULYA_THEME", value: "unsupported", url: baseURL! },
      ]);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test(`dark theme covers populated app views, dialogs and menus (${locale})`, async ({
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
      lastName: "Theme",
      email: `theme-${randomUUID()}@example.test`,
      password: "browser-test-password-123",
      locale,
      timeZone: "Europe/Zagreb",
    });
    const bank = await post("accounts", {
      name: "Everyday",
      type: "BANK",
      currency: "EUR",
      initialBalance: "1000",
    });
    const portfolio = await post("accounts", {
      name: "Portfolio",
      type: "INVESTMENT",
      currency: "EUR",
      initialBalance: "1000",
    });
    const category = await post("categories", {
      name: "Groceries",
      type: "EXPENSE",
    });
    const income = await post("categories", { name: "Salary", type: "INCOME" });
    const now = new Date();
    for (const type of ["INCOME", "EXPENSE"] as const) {
      await post("transactions", {
        type,
        ...(type === "EXPENSE"
          ? { sourceAccountId: bank.id }
          : { destinationAccountId: bank.id }),
        categoryId: type === "EXPENSE" ? category.id : income.id,
        currency: "EUR",
        amount: type === "EXPENSE" ? "75" : "200",
        occurredAt: now.toISOString(),
        clientRequestId: randomUUID(),
      });
    }
    const month = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Zagreb",
      year: "numeric",
      month: "2-digit",
    }).format(now);
    await post("budgets", {
      categoryId: category.id,
      month,
      currency: "EUR",
      scope: "RECURRING",
      amount: "100",
    });
    const reference = await catalogueFixture({
      symbol: "IWDA.AS",
      name: "iShares Core MSCI World UCITS ETF USD (Acc)",
      assetType: "ETF",
      exchange: "AMS",
      mic: "XAMS",
      currency: "EUR",
    });
    const asset = await post("assets", { instrumentId: reference.id });
    await post("investments", {
      accountId: portfolio.id,
      sourceAccountId: bank.id,
      assetId: asset.id,
      type: "BUY",
      quantity: "2",
      pricePerUnit: "100",
      totalAmount: "200",
      fee: "1",
      currency: "EUR",
      executedAt: now.toISOString(),
      clientRequestId: randomUUID(),
    });
    await page.goto("/settings");
    await page
      .getByRole("button", { name: hr ? "Tamno" : "Dark", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: lightLabel, exact: true }),
    ).toBeVisible();
    for (const route of [
      "dashboard",
      "accounts",
      "transactions",
      "analytics",
      "budgets",
      "investments",
      "assets",
      "categories",
      "settings",
    ]) {
      await page.goto(`/${route}`);
      await expect(page.locator("#main-content h1")).toBeVisible();
      await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
      await expect(page.locator("body")).toHaveCSS(
        "background-color",
        "rgb(20, 20, 20)",
      );
      if (route === "analytics") {
        await page
          .locator(".legend")
          .getByRole("button", { name: /Groceries/ })
          .focus();
        const tooltip = page.getByRole("tooltip");
        await expect(tooltip).toContainText("Groceries");
        await expect(tooltip.locator(".recharts-default-tooltip")).toHaveCSS(
          "background-color",
          "rgb(30, 30, 30)",
        );
        await page.screenshot({
          path: `test-results/theme-chart-tooltip-${locale}-${testInfo.project.name}.png`,
        });
        await page.keyboard.press("Escape");
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.mouse.move(0, 0);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      if (["dashboard", "analytics", "budgets"].includes(route))
        await page.screenshot({
          path: `test-results/theme-${route}-${locale}-${testInfo.project.name}.png`,
          fullPage: true,
        });
    }
    await page.goto("/transactions");
    await page
      .locator(".topbar")
      .getByRole("button", {
        name: hr ? "Dodaj transakciju" : "Add transaction",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveCSS("background-color", "rgb(30, 30, 30)");
    await dialog.getByRole("combobox").first().click();
    await expect(page.getByRole("listbox")).toHaveCSS(
      "background-color",
      "rgb(30, 30, 30)",
    );
    await page.screenshot({
      path: `test-results/theme-dialog-${locale}-${testInfo.project.name}.png`,
    });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await page
      .locator(".topbar")
      .getByRole("button", { name: lightLabel, exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator(".transaction-amount.expense")).toHaveCSS(
      "color",
      "rgb(173, 52, 58)",
    );
    expect(errors).toEqual([]);
  });
}
