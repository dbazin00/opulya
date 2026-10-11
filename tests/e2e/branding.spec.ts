import { test, expect } from "./fixtures";

test("symbol-only branding and browser icons render", async ({
  page,
}, testInfo) => {
  await page.goto("/login");
  const logo = page.getByRole("img", { name: "Opulya", exact: true });
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
