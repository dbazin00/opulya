import { test, expect, chooseOption } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { termsVersion } from "@opulya/shared";

test("signup requires explicit terms acceptance in both languages", async ({
  page,
}, testInfo) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/auth/signup", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ code: "VALIDATION_ERROR" }),
    });
  });
  await page.goto("/signup");
  for (const locale of ["en", "hr"]) {
    if (locale === "hr") {
      await chooseOption(
        page.getByRole("combobox", { name: "Language", exact: true }),
        "hr",
      );
      await expect(page.locator("html")).toHaveAttribute("lang", "hr");
    }
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator(".password-requirements")).toHaveCount(0);
    await page
      .getByLabel(locale === "en" ? "First name" : "Ime", { exact: true })
      .fill("Alex");
    await page
      .getByLabel(locale === "en" ? "Last name" : "Prezime", { exact: true })
      .fill("Test");
    await page
      .getByLabel(locale === "en" ? "Email address" : "Adresa e-pošte", {
        exact: true,
      })
      .fill("signup@example.test");
    const submit = page.getByRole("button", {
      name: locale === "en" ? "Create account" : "Izradi račun",
      exact: true,
    });
    const acceptance = page.getByRole("checkbox", {
      name:
        locale === "en"
          ? "I agree to the Terms of Use."
          : "Prihvaćam Uvjete korištenja.",
      exact: true,
    });
    await expect(acceptance).not.toBeChecked();
    await expect(acceptance).toHaveAttribute("required", "");
    await expect(submit).toBeDisabled();
    const previousRequests = requests.length;
    await page
      .locator("form")
      .evaluate((form) =>
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
      );
    expect(requests).toHaveLength(previousRequests);
    await acceptance.focus();
    await page.keyboard.press("Space");
    await expect(submit).toBeEnabled();
    await acceptance.uncheck();
    await expect(submit).toBeDisabled();
    await acceptance.check();
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
      path: `test-results/signup-form-${locale}-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await submit.click();
    await expect(page.locator(".error-notice[role=alert]")).toBeVisible();
    expect(Object.keys(requests.at(-1)!).sort()).toEqual(
      [
        "email",
        "acceptTerms",
        "firstName",
        "lastName",
        "locale",
        "timeZone",
        "termsVersion",
      ].sort(),
    );
    expect(requests.at(-1)?.locale).toBe(locale);
    expect(requests.at(-1)?.acceptTerms).toBe(true);
    expect(requests.at(-1)?.termsVersion).toBe(termsVersion);
  }
});
