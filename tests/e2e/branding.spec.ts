import { test, expect } from "./fixtures";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";

test("logo and wordmark branding and browser icons render", async ({
  page,
}, testInfo) => {
  await page.goto("/login");
  const brand = page.getByRole("link", { name: "Opulya", exact: true });
  const logo = brand.locator("img");
  await expect(brand.locator("span")).toHaveText("Opulya");
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("src", /opulya-mark\.png/);
  await expect
    .poll(() =>
      logo.evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  for (const [selector, width] of [
    ['link[rel="icon"][type="image/png"]', 96],
    ['link[rel="apple-touch-icon"]', 180],
  ] as const) {
    const icon = page.locator(selector);
    await expect(icon).toHaveAttribute("sizes", `${width}x${width}`);
    const response = await page.request.get((await icon.getAttribute("href"))!);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/png");
    const png = await response.body();
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(width);
    expect(png.readUInt32BE(20)).toBe(width);
  }
  const favicon = page.locator('link[rel="icon"][href^="/favicon.ico"]');
  await expect(favicon).toHaveCount(1);
  const response = await page.request.get(
    (await favicon.getAttribute("href"))!,
  );
  expect(response.ok()).toBe(true);
  const ico = await response.body();
  expect(ico.readUInt16LE(2)).toBe(1);
  expect(ico.readUInt16LE(4)).toBe(3);
  expect([ico[6], ico[22], ico[38]]).toEqual([16, 32, 48]);
  await page.screenshot({
    path: `test-results/branding-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

for (const locale of ["en", "hr"] as const) {
  test(`shared branding is visible throughout the signed-in app in ${locale}`, async ({
    page,
    isMobile,
  }, testInfo) => {
    const headers = {
      Origin: "http://localhost:3001",
      "X-Opulya-Request": "1",
    };
    const registered = await page.request.post("/api/auth/signup", {
      headers,
      data: {
        firstName: "Alex",
        lastName: "Brand",
        email: `brand-${randomUUID()}@example.test`,
        password: "browser-test-password-123",
        locale,
        timeZone: "Europe/Zagreb",
      },
    });
    expect(registered.ok()).toBe(true);
    const created = await page.request.post("/api/accounts", {
      headers,
      data: {
        name: "Everyday",
        type: "BANK",
        currency: "EUR",
        initialBalance: "0",
      },
    });
    expect(created.ok()).toBe(true);
    const account = (await created.json()) as { id: string };
    const addLabel = locale === "en" ? "Add transaction" : "Dodaj transakciju";
    for (const route of [
      "dashboard",
      "accounts",
      "transactions",
      "analytics",
      "investments",
      "assets",
      "categories",
      "settings",
      `accounts/${account.id}`,
    ]) {
      await page.goto(`/${route}`);
      await expect(
        page.locator("#main-content").getByRole("heading", { level: 1 }),
      ).toBeVisible();
      const brand = page.locator(
        isMobile ? ".topbar .brand-link" : ".sidebar .brand-link",
      );
      await expect(brand).toBeVisible();
      await expect(brand).toHaveAttribute("href", "/dashboard");
      await expect(brand.locator("span")).toHaveText("Opulya");
      await expect
        .poll(() =>
          brand
            .locator("img")
            .evaluate(
              (node: HTMLImageElement) =>
                node.complete && node.naturalWidth > 0,
            ),
        )
        .toBe(true);
      const logo = await brand.locator("img").boundingBox();
      expect(logo!.width).toBe(isMobile ? 36 : 48);
      expect(logo!.height).toBe(isMobile ? 36 : 48);
      const add = page
        .locator(".topbar")
        .getByRole("button", { name: addLabel, exact: true });
      await expect(add).toBeVisible();
      if (isMobile) {
        const before = await brand.boundingBox();
        const after = await add.boundingBox();
        expect(before!.height).toBeGreaterThanOrEqual(44);
        expect(after!.height).toBeGreaterThanOrEqual(44);
        expect(before!.x + before!.width).toBeLessThanOrEqual(after!.x - 8);
      }
      if (route === "dashboard") {
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
              .analyze()
          ).violations,
        ).toEqual([]);
        await page.screenshot({
          path: `test-results/app-brand-${locale}-${testInfo.project.name}.png`,
          fullPage: true,
        });
      }
    }
    await page
      .locator(".topbar")
      .getByRole("button", { name: addLabel, exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: addLabel, exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page
      .locator(isMobile ? ".topbar .brand-link" : ".sidebar .brand-link")
      .click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
}
