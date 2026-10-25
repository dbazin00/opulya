import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function laptopBounds(image: Locator) {
  await expect
    .poll(() =>
      image.evaluate(
        (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
      ),
    )
    .toBe(true);
  return image.evaluate((node: HTMLImageElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 342;
    const context = canvas.getContext("2d")!;
    context.drawImage(node, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width,
      top = canvas.height,
      right = 0,
      bottom = 0;
    // Measure the opaque device, excluding transparent padding and its soft shadow.
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3]! <= 240) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
    }
    if (right <= left || bottom <= top)
      throw new Error("Laptop image is blank");
    const box = node.getBoundingClientRect();
    const scale = Math.min(
      box.width / node.naturalWidth,
      box.height / node.naturalHeight,
    );
    const width = node.naturalWidth * scale;
    const height = node.naturalHeight * scale;
    return {
      x: box.x + (box.width - width) / 2 + (left / canvas.width) * width,
      y: box.y + (box.height - height) / 2 + (top / canvas.height) * height,
      width: ((right - left) / canvas.width) * width,
      height: ((bottom - top) / canvas.height) * height,
    };
  });
}

async function expectHeroLayout(page: Page) {
  const { width, height } = page.viewportSize()!;
  const hero = page.locator('section[aria-labelledby="landing-title"]');
  const image = hero.locator("img");
  await expect(image).toHaveCSS("object-fit", "contain");
  await expect
    .poll(() =>
      hero.evaluate((node) =>
        Math.round(node.getBoundingClientRect().bottom + scrollY),
      ),
    )
    .toBe(height);
  const copy = (await page
    .locator("#landing-title")
    .locator("..")
    .boundingBox())!;
  const box = await laptopBounds(image);
  const heroBox = (await hero.boundingBox())!;
  expect(Math.abs(heroBox.y + heroBox.height - height)).toBeLessThanOrEqual(1);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(box.y).toBeGreaterThanOrEqual(copy.y + copy.height - 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  expect(box.height).toBeGreaterThan(60);
  const availableCenter = (copy.y + copy.height + height) / 2;
  expect(Math.abs(box.y + box.height / 2 - availableCenter)).toBeLessThan(4);
  await expect(
    page.locator('section[aria-labelledby="product-title"]'),
  ).not.toBeInViewport();
}

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
  ).toHaveCount(0);
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
  await page.getByRole("tab", { name: "Budgets", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText("€567.50");
  await expect(
    page.getByRole("progressbar", { name: "Groceries", exact: true }),
  ).toHaveAttribute("value", "282.5");
  await overview.click();
  const heroImage = page.locator(
    'section[aria-labelledby="landing-title"] img',
  );
  await expect(heroImage).toHaveCSS("object-fit", "contain");
  await expect
    .poll(() =>
      heroImage.evaluate(
        (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
      ),
    )
    .toBe(true);
  expect(
    await heroImage.evaluate((node: HTMLImageElement) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 100;
      const context = canvas.getContext("2d")!;
      context.drawImage(node, 0, 0, 100, 100);
      const corner = context.getImageData(0, 0, 1, 1).data;
      const screen = context.getImageData(50, 40, 1, 1).data;
      return (
        corner[3]! < 10 &&
        screen[3]! > 240 &&
        screen[0]! + screen[1]! + screen[2]! > 500
      );
    }),
  ).toBe(true);
  const faq = page.getByText("Are investment prices live?", { exact: true });
  await faq.click();
  await expect(
    page.getByText(/No\. Available market prices refresh approximately/),
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

test("landing hero follows the selected theme and preserves it after reload", async ({
  page,
}) => {
  await page.goto("/");
  const hero = page.locator('section[aria-labelledby="landing-title"]');
  const image = hero.locator("img");
  for (const theme of ["light", "dark", "light"] as const) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await page
        .getByRole("button", {
          name: `Switch to ${theme} theme`,
          exact: true,
        })
        .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect
      .poll(() =>
        image.evaluate(
          (node: HTMLImageElement, source) =>
            node.complete &&
            node.naturalWidth > 0 &&
            decodeURIComponent(node.currentSrc).includes(source),
          "opulya-landing-laptop.png",
        ),
      )
      .toBe(true);
    await expect(hero).toHaveCSS(
      "background-color",
      theme === "light" ? "rgb(245, 246, 245)" : "rgb(17, 20, 19)",
    );
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect
      .poll(() =>
        image.evaluate((node: HTMLImageElement) =>
          decodeURIComponent(node.currentSrc),
        ),
      )
      .toContain("opulya-landing-laptop.png");
  }
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
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 3440, height: 1440 },
    { width: 3840, height: 2160 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
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
    await expectHeroLayout(page);
    await page.screenshot({
      path: `test-results/landing-${viewport.width}.png`,
    });
  }
});

test("compact header and complete laptop fit narrow, tall and landscape screens", async ({
  page,
  baseURL,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const locale of ["en", "hr"]) {
    await page
      .context()
      .addCookies([{ name: "OPULYA_LOCALE", value: locale, url: baseURL! }]);
    await page.goto("/");
    for (const viewport of [
      { width: 280, height: 800 },
      { width: 320, height: 568 },
      { width: 360, height: 800 },
      { width: 390, height: 844 },
      { width: 480, height: 800 },
      { width: 600, height: 900 },
      { width: 760, height: 900 },
      { width: 1024, height: 600 },
      { width: 3840, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() =>
        window.scrollTo({ top: 0, behavior: "instant" }),
      );
      const header = page.locator("header");
      await expectHeroLayout(page);
      if (viewport.width <= 600) {
        const headerBox = (await header.boundingBox())!;
        expect(headerBox.height).toBeLessThanOrEqual(72);
        await expect(header.locator(".brand-link > span")).toBeHidden();
        await expect(header.locator(".brand-link")).toHaveAccessibleName(
          "Opulya",
        );
        const controls = await header
          .locator("button:not([aria-hidden]), a")
          .all();
        for (const control of controls) {
          if (!(await control.isVisible())) continue;
          const bounds = (await control.boundingBox())!;
          expect(bounds.height).toBeGreaterThanOrEqual(44);
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
          expect(bounds.y).toBeLessThan(headerBox.y + 20);
        }
      }
      await page.evaluate(() =>
        window.scrollTo({ left: 10000, behavior: "instant" }),
      );
      expect(
        await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          left: scrollX,
        })),
      ).toEqual({ width: viewport.width, left: 0 });
    }
  }
});

test("content after the full-height hero is revealed by scrolling", async ({
  page,
}) => {
  await page.goto("/");
  const product = page.locator('section[aria-labelledby="product-title"]');
  await expect(product).not.toBeInViewport();
  await page
    .locator('section[aria-labelledby="landing-title"] a[href="#overview"]')
    .click();
  await expect(page.getByRole("tabpanel")).toBeInViewport();
});
