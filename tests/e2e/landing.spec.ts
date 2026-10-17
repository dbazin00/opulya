import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("public homepage is responsive, accessible and does not request private data", async ({
  page,
}, testInfo) => {
  const apiRequests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      apiRequests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Opulya | Your personal finances, together");
  await expect(
    page.getByRole("heading", { name: "Opulya", exact: true }),
  ).toBeVisible();
  const brand = page.locator("header .brand-link");
  await expect(brand.locator("span")).toHaveText("Opulya");
  await expect(brand.locator("img")).toBeVisible();
  await expect
    .poll(() =>
      brand
        .locator("img")
        .evaluate(
          (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
        ),
    )
    .toBe(true);
  await expect(page.getByRole("tabpanel")).toContainText("€24,580.40");
  await expect(
    page.getByText("Illustrative example", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('a[href="/signup"]')).toHaveCount(0);
  await expect(page.locator('a[href="/login"]')).toHaveCount(1);
  await expect(page.locator('a[href="/login"]')).toHaveText("Sign in");
  const language = await page
    .getByRole("combobox", { name: "Language", exact: true })
    .boundingBox();
  const signIn = await page
    .getByRole("link", { name: "Sign in", exact: true })
    .boundingBox();
  expect(language).not.toBeNull();
  expect(signIn).not.toBeNull();
  expect(signIn!.x).toBeGreaterThanOrEqual(language!.x + language!.width);
  expect(Math.abs(signIn!.y - language!.y)).toBeLessThan(4);
  const overview = page.getByRole("tab", { name: "Overview", exact: true });
  const transactions = page.getByRole("tab", {
    name: "Transactions",
    exact: true,
  });
  await overview.focus();
  await page.keyboard.press("ArrowRight");
  await expect(transactions).toBeFocused();
  await expect(transactions).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("Food / Groceries");
  const income = page.locator(".transaction-amount.income");
  const expense = page.locator(".transaction-amount.expense");
  const transfer = page.locator(".transaction-amount.transfer");
  expect(
    await income.evaluate((node) => getComputedStyle(node).color),
  ).not.toBe(await expense.evaluate((node) => getComputedStyle(node).color));
  expect(
    await transfer.evaluate((node) => getComputedStyle(node).color),
  ).not.toBe(await expense.evaluate((node) => getComputedStyle(node).color));
  await page.keyboard.press("End");
  await expect(
    page.getByRole("tab", { name: "Investments", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("tabpanel")).toContainText("Acquisition cost");
  await expect(page.getByRole("tabpanel")).toContainText("€350.00");
  await page.keyboard.press("Home");
  await expect(overview).toHaveAttribute("aria-selected", "true");
  const faq = page.getByText("Are investment prices live?", { exact: true });
  await faq.click();
  await expect(
    page.getByText(/No\. Available market prices are refreshed/),
  ).toBeVisible();
  await faq.click();
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
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: `test-results/landing-first-${testInfo.project.name}.png`,
  });
  await page.screenshot({
    path: `test-results/landing-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("language switching persists and localizes figures and metadata", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Language", exact: true }).click();
  await page.getByRole("option", { name: "Hrvatski", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "hr");
  await expect(page.locator('a[href="/signup"]')).toHaveCount(0);
  await expect(page.locator('a[href="/login"]')).toHaveCount(1);
  await expect(page.locator('a[href="/login"]')).toHaveText("Prijava");
  await expect(page).toHaveTitle(
    "Opulya | Vaše osobne financije na jednom mjestu",
  );
  await expect(page.getByRole("tabpanel")).toContainText("24.580,40");
  await expect(
    page.getByRole("tab", { name: "Transakcije", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "hr");
  await page.getByRole("tab", { name: "Ulaganja", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Trošak stjecanja");
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
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: `test-results/landing-hr-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("signup is reached through sign in and the dashboard remains protected", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  if (isMobile) {
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "A clearer picture", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Open navigation", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
  }
  await page
    .locator("header")
    .getByRole("link", { name: "Sign in", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("link", { name: "Get started", exact: true }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("tablet and wide desktop layouts fit without header overlap", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Additional desktop browser viewport checks");
  await page.goto("/");
  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.getByRole("heading", { name: "Opulya", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const headerLinks = await page.locator("header").getByRole("link").all();
    const bounds = (
      await Promise.all(headerLinks.map((link) => link.boundingBox()))
    ).filter((box) => box !== null);
    for (let i = 1; i < bounds.length; i++) {
      const before = bounds[i - 1]!;
      const after = bounds[i]!;
      expect(before.x + before.width).toBeLessThanOrEqual(after.x + 1);
    }
    const heading = await page
      .getByRole("heading", {
        name: "A little less scattered. A lot more clarity.",
        exact: true,
      })
      .boundingBox();
    expect(heading).not.toBeNull();
    expect(heading!.y).toBeLessThan(viewport.height);
    await page.screenshot({
      path: `test-results/landing-${viewport.width}.png`,
    });
  }
});
