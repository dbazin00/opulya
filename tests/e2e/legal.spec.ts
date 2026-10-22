import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const titles = {
  en: {
    privacy: "Privacy Notice",
    security: "Security Information",
    terms: "Terms of Use",
  },
  hr: {
    privacy: "Obavijest o privatnosti",
    security: "Informacije o sigurnosti",
    terms: "Uvjeti korištenja",
  },
};

for (const locale of ["en", "hr"] as const) {
  test(`signup links to public localized notices without losing form data in ${locale}`, async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    await context.addCookies([
      { name: "OPULYA_LOCALE", value: locale, url: baseURL! },
    ]);
    const apiRequests: string[] = [];
    const errors: string[] = [];
    context.on("page", (tab) =>
      tab.on("pageerror", (error) => errors.push(error.message)),
    );
    page.on("pageerror", (error) => errors.push(error.message));
    context.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        apiRequests.push(request.url());
    });
    await page.goto("/signup");
    await page.locator('input[name="firstName"]').fill("Alex");
    await page.locator('input[name="email"]').fill("legal-test@example.test");
    const signup = page.locator(".signup-legal");
    for (const policy of ["privacy", "security", "terms"] as const) {
      const link = signup.locator(`a[href="/${policy}"]`);
      await expect(link).toHaveAccessibleName(
        locale === "hr" && policy === "terms"
          ? "Uvjete korištenja"
          : titles[locale][policy],
      );
      await expect(link).toHaveAttribute("href", `/${policy}`);
      await expect(link).toHaveAttribute("target", "_blank");
      const popup = page.waitForEvent("popup");
      await link.click();
      const notice = await popup;
      await expect(notice.getByRole("heading", { level: 1 })).toHaveText(
        titles[locale][policy],
      );
      await expect(notice.locator("html")).toHaveAttribute("lang", locale);
      await expect(notice.locator(".legal-draft")).toBeVisible();
      await expect(notice.locator(".legal-content section")).not.toHaveCount(0);
      await expect(notice.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        /noindex/,
      );
      const widths =
        testInfo.project.name === "mobile" ? [280, 320, 360] : [1440];
      for (const width of widths) {
        await notice.setViewportSize({
          width,
          height: testInfo.project.name === "mobile" ? 800 : 1000,
        });
        expect(
          await notice.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
      expect(
        (
          await new AxeBuilder({ page: notice })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      if (policy === "privacy") {
        await expect(
          notice.locator('a[href="https://azop.hr/"]'),
        ).toBeVisible();
        await notice.screenshot({
          path: `test-results/privacy-${locale}-${testInfo.project.name}.png`,
          fullPage: true,
        });
      }
      await notice.close();
    }
    await expect(page.locator('input[name="firstName"]')).toHaveValue("Alex");
    await expect(page.locator('input[name="email"]')).toHaveValue(
      "legal-test@example.test",
    );
    await expect(page.getByRole("checkbox")).toHaveCount(1);
    await expect(page.getByRole("checkbox")).not.toBeChecked();
    await expect(page.locator(".signup-legal-draft")).toBeVisible();
    await page.screenshot({
      path: `test-results/signup-legal-${locale}-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await page.goto("/");
    for (const policy of ["privacy", "security", "terms"] as const)
      await expect(
        page
          .locator("footer")
          .getByRole("link", { name: titles[locale][policy], exact: true }),
      ).toHaveAttribute("href", `/${policy}`);
    expect(apiRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("notices are reachable without authentication and language changes persist", async ({
  page,
}) => {
  const response = await page.goto("/privacy");
  expect(response?.status()).toBe(200);
  await page.getByRole("combobox", { name: "Language", exact: true }).click();
  await page.getByRole("option", { name: "Hrvatski", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    titles.hr.privacy,
  );
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    titles.hr.privacy,
  );
  await page
    .locator("footer")
    .getByRole("link", { name: titles.hr.security, exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    titles.hr.security,
  );
});
