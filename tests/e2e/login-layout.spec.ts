import { test, expect, type Page } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

async function fitsViewport(page: Page) {
  expect(
    await page.evaluate(() => ({
      horizontal: document.documentElement.scrollWidth <= window.innerWidth,
      vertical: document.documentElement.scrollHeight <= window.innerHeight,
    })),
  ).toEqual({ horizontal: true, vertical: true });
  for (const selector of [
    'input[name="email"]',
    'input[name="password"]',
    'button[type="submit"]',
  ]) {
    const bounds = await page.locator(selector).boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
  }
}

test("login fits short screens in both languages, including an error", async ({
  page,
}, testInfo) => {
  await page.goto("/login");
  const sizes =
    testInfo.project.name === "mobile"
      ? [
          { width: 360, height: 800 },
          { width: 360, height: 568 },
          { width: 667, height: 375 },
        ]
      : [
          { width: 1440, height: 900 },
          { width: 1280, height: 600 },
        ];
  for (const locale of ["en", "hr"]) {
    if (locale === "hr") {
      await page
        .getByRole("combobox", { name: "Language", exact: true })
        .click();
      await page.getByRole("option", { name: "Hrvatski", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
    }
    for (const size of sizes) {
      await page.setViewportSize(size);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await fitsViewport(page);
      await page.screenshot({
        path: `test-results/login-${locale}-${size.width}x${size.height}.png`,
      });
    }
  }
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ code: "INVALID_CREDENTIALS" }),
    }),
  );
  await page.locator('input[name="email"]').fill("layout@example.test");
  await page.locator('input[name="password"]').fill("layout-test-password");
  await page.locator('button[type="submit"]').click();
  await expect(page.locator(".auth-form").getByRole("alert")).toBeVisible();
  await fitsViewport(page);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
