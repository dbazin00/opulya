import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const locale of ["en", "hr"] as const) {
  for (const route of ["login", "signup", "check-email"] as const) {
    test(`${route} reflows on narrow screens in ${locale}`, async ({
      page,
      context,
      baseURL,
    }, testInfo) => {
      await context.addCookies([
        { name: "OPULYA_LOCALE", value: locale, url: baseURL! },
      ]);
      await page.goto(`/${route}`);
      await expect(page.locator(".auth-page")).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const brand = page.getByRole("link", { name: "Opulya", exact: true });
      const logo = brand.locator("img");
      await expect(brand).toHaveAttribute("href", "/");
      await expect(brand.locator("span")).toHaveText("Opulya");
      await expect
        .poll(() =>
          logo.evaluate(
            (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
          ),
        )
        .toBe(true);
      await expect(page.locator(".auth-footer > span")).toHaveText(
        locale === "en"
          ? "Your finances, in perspective."
          : "Vaše financije, jasnija slika.",
      );

      for (const width of [280, 320, 360, 390]) {
        await page.setViewportSize({ width, height: width <= 320 ? 568 : 844 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await expect(logo).toBeVisible();
        await expect(brand.locator("span")).toBeVisible();
        const brandBounds = await brand.boundingBox();
        const logoBounds = await logo.boundingBox();
        const languageBounds = await page
          .locator(".auth-top button")
          .boundingBox();
        expect(brandBounds!.height).toBeGreaterThanOrEqual(44);
        expect(logoBounds!.width).toBe(36);
        expect(logoBounds!.height).toBe(36);
        expect(brandBounds!.x + brandBounds!.width).toBeLessThanOrEqual(
          languageBounds!.x - 8,
        );
        const controls = page.locator(
          ".auth-brand, .auth-top button, .auth-form h1, .auth-form input, .auth-form .button",
        );
        for (const control of await controls.all()) {
          const bounds = await control.boundingBox();
          expect(bounds).not.toBeNull();
          expect(bounds!.x).toBeGreaterThanOrEqual(0);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        }
        expect(
          await page.locator(".auth-form h1").evaluate((node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return Array.from(range.getClientRects()).every(
              (rect) => rect.left >= 0 && rect.right <= innerWidth,
            );
          }),
        ).toBe(true);
        const form = await page.locator(".auth-form").boundingBox();
        const header = await page.locator(".auth-top").boundingBox();
        const footer = await page.locator(".auth-footer").boundingBox();
        expect(form!.y - (header!.y + header!.height)).toBeLessThanOrEqual(24);
        expect(footer!.y).toBeGreaterThanOrEqual(form!.y + form!.height);
        if (route === "signup") {
          const first = await page
            .locator('input[name="firstName"]')
            .boundingBox();
          const last = await page
            .locator('input[name="lastName"]')
            .boundingBox();
          expect(last!.x).toBe(first!.x);
          expect(last!.width).toBe(first!.width);
          expect(last!.y).toBeGreaterThanOrEqual(first!.y + first!.height);
        }
      }
      const language = page.getByRole("combobox", {
        name: locale === "en" ? "Language" : "Jezik",
        exact: true,
      });
      await language.click();
      await expect(
        page.getByRole("option", {
          name: locale === "en" ? "English" : "Hrvatski",
          exact: true,
        }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({
        path: `test-results/auth-mobile-${route}-${locale}-${testInfo.project.name}.png`,
        fullPage: true,
      });
    });
  }
}
