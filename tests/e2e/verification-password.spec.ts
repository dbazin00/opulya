import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

test("verification checks password length and confirmation live in both languages", async ({
  page,
}, testInfo) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/auth/verify-email", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ code: "VALIDATION_ERROR" }),
    });
  });
  await page.goto(`/verify-email#token=${"a".repeat(64)}`);
  for (const locale of ["en", "hr"]) {
    if (locale === "hr") {
      await page
        .getByRole("combobox", { name: "Language", exact: true })
        .click();
      await page.getByRole("option", { name: "Hrvatski", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", "hr");
    }
    const password = page.getByLabel(locale === "en" ? "Password" : "Lozinka", {
      exact: true,
    });
    const repeat = page.getByLabel(
      locale === "en" ? "Repeat password" : "Ponovite lozinku",
      { exact: true },
    );
    const submit = page.getByRole("button", {
      name: locale === "en" ? "Verify email" : "Potvrdi e-mail",
      exact: true,
    });
    const met = page.locator(".password-requirements li.met");
    await expect(met).toHaveCount(0);
    await expect(submit).toBeDisabled();
    await password.fill("a".repeat(14));
    await expect(met).toHaveCount(0);
    await password.fill("a".repeat(15));
    await expect(met).toHaveCount(1);
    await expect(submit).toBeDisabled();
    await repeat.fill("different password");
    await expect(repeat).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByText(
        locale === "en" ? "Passwords do not match" : "Lozinke se ne podudaraju",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(submit).toBeDisabled();
    // Verify the submit handler also rejects mismatches, independently of the button.
    await page
      .locator("form")
      .evaluate((form) =>
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
      );
    expect(requests).toHaveLength(locale === "en" ? 0 : 1);
    await repeat.fill("a".repeat(15));
    await expect(met).toHaveCount(2);
    await expect(submit).toBeEnabled();
    await expect(repeat).toHaveAttribute("aria-invalid", "false");
    await password.fill("a".repeat(14));
    await expect(met).toHaveCount(0);
    await expect(submit).toBeDisabled();
    await password.fill("a".repeat(128));
    await repeat.fill("a".repeat(128));
    await expect(met).toHaveCount(2);
    await expect(password).toHaveAttribute("maxlength", "128");
    await expect(repeat).toHaveAttribute("maxlength", "128");
    await repeat.clear();
    await expect(met).toHaveCount(1);
    await expect(submit).toBeDisabled();
    const passphrase = "  my unique long passphrase  ";
    await password.fill(passphrase);
    await repeat.fill(passphrase);
    await expect(submit).toBeEnabled();
    await expect(page.getByRole("status")).toHaveText(
      locale === "en"
        ? "2 of 2 password requirements met"
        : "Ispunjeno 2 od 2 uvjeta za lozinku",
    );
    await expect(password).toHaveAttribute("autocomplete", "new-password");
    await expect(repeat).toHaveAttribute("autocomplete", "new-password");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= window.innerHeight,
      ),
    ).toBe(true);
    for (const input of [password, repeat]) {
      const bounds = await input.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations.map((v) => v.id)).toEqual([]);
    await page.screenshot({
      path: `test-results/verification-password-${locale}-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await submit.click();
    await expect(page.locator(".auth-form [role=alert]")).toBeVisible();
    expect(requests).toHaveLength(locale === "en" ? 1 : 2);
    expect(requests.at(-1)?.password).toBe(passphrase);
    expect(requests.at(-1)?.token).toBe("a".repeat(64));
    expect(requests.at(-1)).not.toHaveProperty("repeatPassword");
  }
  await page.goto("/login");
  await expect(page.locator('input[name="repeatPassword"]')).toHaveCount(0);
  await expect(page.locator(".password-requirements")).toHaveCount(0);
  await expect(page.locator('button[type="submit"]')).toBeEnabled();
});
