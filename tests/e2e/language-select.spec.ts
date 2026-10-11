import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

test("flag language picker supports keyboard navigation and persists locale", async ({
  page,
}, testInfo) => {
  await page.goto("/login");
  let picker = page.getByRole("combobox", { name: "Language", exact: true });
  await expect(picker).toContainText("English");
  await expect(picker.locator("img")).toHaveAttribute("src", "/flags/gb.svg");
  await picker.click();
  await expect(
    page.getByRole("option", { name: "English", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("option", { name: "Hrvatski", exact: true }),
  ).toBeVisible();
  for (const image of await page.locator(".language-option img").all()) {
    await expect
      .poll(() =>
        image.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
      )
      .toBe(true);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/language-picker-${testInfo.project.name}.png`,
  });
  await page.keyboard.press("Escape");
  await expect(picker).toBeFocused();
  await expect(picker).toHaveAttribute("aria-expanded", "false");
  await picker.press("ArrowDown");
  await expect(
    page.getByRole("option", { name: "English", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("option", { name: "Hrvatski", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("lang", "hr");
  picker = page.getByRole("combobox", { name: "Jezik", exact: true });
  await expect(picker).toContainText("Hrvatski");
  await expect(picker.locator("img")).toHaveAttribute("src", "/flags/hr.svg");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "hr");
  await picker.click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
