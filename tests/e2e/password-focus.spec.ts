import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";

test("password fields skip visibility buttons in Tab order without losing keyboard access", async ({
  page,
}) => {
  for (const path of [
    "/login",
    `/verify-email#token=${"a".repeat(64)}`,
    `/reset-password#token=${"b".repeat(64)}`,
  ]) {
    await page.goto(path);
    const form = page.locator(".auth-form");
    const password = form.getByLabel("Password", { exact: true });
    await password.fill("my long unique password");
    await password.press("Alt+v");
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toBeFocused();
    const hide = form.getByRole("button", {
      name: "Hide password",
      exact: true,
    });
    await expect(hide).toHaveAttribute("tabindex", "-1");
    await password.press("Alt+v");
    await expect(password).toHaveAttribute("type", "password");
    if (path === "/login") {
      const email = form.getByLabel("Email address", { exact: true });
      await email.fill("owner@example.test");
      await email.press("Tab");
      await expect(password).toBeFocused();
      await password.press("Tab");
      await expect(
        form.getByRole("link", { name: "Forgot password?", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(password).toBeFocused();
    } else {
      const repeat = form.getByLabel("Repeat password", { exact: true });
      await repeat.fill("my long unique password");
      await password.focus();
      await password.press("Tab");
      await expect(repeat).toBeFocused();
      await repeat.press("Alt+v");
      await expect(repeat).toHaveAttribute("type", "text");
      await expect(password).toHaveAttribute("type", "password");
      await repeat.press("Tab");
      await expect(form.locator('button[type="submit"]')).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(repeat).toBeFocused();
      await repeat.press("Shift+Tab");
      await expect(password).toBeFocused();
      await expect(
        form.getByRole("button", {
          name: "Hide repeated password",
          exact: true,
        }),
      ).toHaveAttribute("tabindex", "-1");
    }
    const show = form.getByRole("button", {
      name: "Show password",
      exact: true,
    });
    await show.click();
    await expect(password).toHaveAttribute("type", "text");
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations.map((violation) => violation.id),
    ).toEqual([]);
  }
});
