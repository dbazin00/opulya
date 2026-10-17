import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {
  test,
  expect,
  chooseOption,
  verificationMail,
  removeVerificationMail,
} from "./fixtures";
test.use({ autoVerifySignup: false });

test("signup requires explicit mailbox verification and supports localized resend and used links", async ({
  page,
}, testInfo) => {
  const email = `verify-ui-${randomUUID()}@example.test`,
    final = "confirmed-owner-password-456";
  await page.goto("/signup");
  await page.getByLabel("First name", { exact: true }).fill("Alex");
  await page.getByLabel("Last name", { exact: true }).fill("Owner");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.locator(".password-requirements")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/check-email$/);
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === "opulya_session",
    ),
  ).toBe(false);
  const blocked = await page.request.get("/api/accounts");
  expect(blocked.status()).toBe(401);
  const emailField = page.getByLabel("Email address", { exact: true });
  await expect(emailField).toHaveValue(email);
  await expect(emailField).toHaveAttribute("readonly", "");
  const resend = page.getByRole("button", {
    name: "Resend verification email",
    exact: true,
  });
  await expect(resend).toBeDisabled();
  await page.reload();
  await expect(emailField).toHaveValue(email);
  await expect(resend).toBeDisabled();
  await expect(
    page.getByRole("link", {
      name: "Use a different email address",
      exact: true,
    }),
  ).toBeVisible();
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
    path: `test-results/check-email-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.clock.install();
  await page.clock.fastForward(61_000);
  await expect(resend).toBeEnabled();
  await resend.click();
  await expect(page.getByRole("status")).toContainText("unverified account");
  await expect(resend).toBeDisabled();
  const mail = await verificationMail(email);
  await page.goto(mail.verificationUrl);
  await expect(page).toHaveURL(/\/verify-email$/);
  await chooseOption(
    page.getByRole("combobox", { name: "Language", exact: true }),
    "hr",
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "hr");
  await page.getByLabel("Lozinka", { exact: true }).fill(final);
  await page
    .getByLabel("Ponovite lozinku", { exact: true })
    .fill("different password");
  await expect(
    page.getByRole("button", { name: "Potvrdi e-mail", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Ponovite lozinku", { exact: true }).fill(final);
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
    path: `test-results/email-verification-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Potvrdi e-mail", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "E-mail je potvrđen", exact: true }),
  ).toBeVisible();
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === "opulya_session",
    ),
  ).toBe(false);
  await page.getByRole("link", { name: "Prijavite se", exact: true }).click();
  await page.getByLabel("Adresa e-pošte", { exact: true }).fill(email);
  await page.getByLabel("Lozinka", { exact: true }).fill(final);
  await page.getByRole("button", { name: "Prijava", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto(mail.verificationUrl);
  await page.getByLabel("Lozinka", { exact: true }).fill(final);
  await page.getByLabel("Ponovite lozinku", { exact: true }).fill(final);
  await page
    .getByRole("button", { name: "Potvrdi e-mail", exact: true })
    .click();
  await expect(page.locator(".error-notice[role=alert]")).toContainText(
    "već korištena",
  );
  await page.goto("/verify-email");
  await expect(page.locator(".error-notice[role=alert]")).toContainText(
    "nije valjana",
  );
  await expect(
    page.getByRole("button", { name: "Potvrdi e-mail", exact: true }),
  ).toBeDisabled();
  await removeVerificationMail(email);
});
