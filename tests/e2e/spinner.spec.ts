import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

test("busy buttons toggle a stable accessible spinner and respect reduced motion", async ({
  page,
}, testInfo) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/login", async (route) => {
    await gate;
    await route.fulfill({ status: 401, json: { code: "INVALID_CREDENTIALS" } });
  });
  await page.goto("/login");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("spinner@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("spinner-test-password-123");
  const button = page.getByRole("button", { name: "Sign in", exact: true });
  const before = await button.boundingBox();
  try {
    await button.click();
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(button).toBeDisabled();
    await expect(button.locator(".spinner-icon")).toBeVisible();
    await expect(
      button.locator(":scope > .button-busy-indicator.spinner"),
    ).toHaveCount(1);
    const during = await button.boundingBox();
    expect(during!.width).toBeCloseTo(before!.width, 1);
    expect(during!.height).toBeCloseTo(before!.height, 1);
    await expect(button.locator(".button-content")).toHaveCSS("opacity", "0");
    await expect(button.locator(".spinner-icon")).toHaveCSS(
      "animation-name",
      "spin",
    );
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: `test-results/spinner-button-${testInfo.project.name}.png`,
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(button.locator(".spinner-icon")).toHaveCSS(
      "animation-name",
      "none",
    );
  } finally {
    release();
  }
  await expect(button).toBeEnabled();
  await expect(button).not.toHaveAttribute("aria-busy");
  await expect(button.locator(".spinner-icon")).toHaveCount(0);
  await expect(button.locator(".button-content")).toHaveCSS("opacity", "1");
});
