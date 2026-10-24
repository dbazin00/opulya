import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import {
  spinnerBars,
  spinnerSourceSha256,
} from "../../apps/web/src/components/opulya-spinner-masks";

test("logo spinner preview has stable sizes, playback controls and responsive layout", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/login");
  await expect(
    page.locator(
      'head link[rel="preload"][href="/opulya-mark.png"], head link[rel="preload"][href*="/opulya-spinner."]',
    ),
  ).toHaveCount(0);
  await expect(page.locator("rect[data-bar]")).toHaveCount(0);
  await page.goto("/spinner-preview");
  await expect(
    page.getByRole("heading", { name: "Logo spinner" }),
  ).toBeVisible();
  const backdropPreview = page.getByRole("region", {
    name: "Loading backdrop preview",
  });
  const backdropBounds = (await backdropPreview.boundingBox())!;
  const backdrop = await backdropPreview
    .locator(".loading")
    .evaluate((element) => {
      const style = getComputedStyle(element, "::before");
      return {
        width: parseFloat(style.width),
        height: parseFloat(style.height),
      };
    });
  expect(backdrop.width).toBeCloseTo(backdropBounds.width, 1);
  expect(backdrop.height).toBeCloseTo(backdropBounds.height, 1);
  const spinner = page.locator('[data-preview="animated"] [role="status"]');
  await expect(spinner).toHaveAttribute("aria-label", "Loading");
  await expect(spinner.locator("svg rect[data-bar]")).toHaveCount(3);
  await expect(
    page.getByRole("region", { name: "Light surface" }).getByRole("status"),
  ).toHaveCount(4);
  const sizes = await page
    .getByRole("region", { name: "Light surface" })
    .getByRole("status")
    .evaluateAll((items) =>
      items.map((item) => item.getBoundingClientRect().width),
    );
  expect(sizes).toEqual([32, 64, 112, 64]);
  const smallSource = await page
    .getByRole("region", { name: "Light surface" })
    .locator("svg image")
    .first()
    .getAttribute("href");
  expect(smallSource).toMatch(/\/opulya-spinner\.[^/]+\.webp$/);
  const optimized = await page.request.get(smallSource!);
  expect(optimized.ok()).toBe(true);
  expect((await optimized.body()).length).toBeLessThan(36_000);
  await expect(spinner.locator("svg image")).toHaveAttribute(
    "href",
    /\/opulya-spinner-large\.[^/]+\.webp$/,
  );
  const ids = await page
    .locator("svg [id]")
    .evaluateAll((items) => items.map((item) => item.id));
  expect(new Set(ids).size).toBe(ids.length);
  await page.getByRole("button", { name: "Pause animation" }).click();
  const slider = page.getByRole("slider", { name: "Cycle position" });
  await slider.focus();
  await slider.press("Home");
  await expect(slider).toHaveValue("0");
  const scales = () =>
    spinner
      .locator("rect[data-bar]")
      .evaluateAll((rectangles) =>
        rectangles.map(
          (rect) => new DOMMatrix(getComputedStyle(rect).transform).m22,
        ),
      );
  expect(await scales()).toEqual([1, 1, 1]);
  await slider.press("End");
  await expect(slider).toHaveValue("2400");
  expect(await scales()).toEqual([1, 1, 1]);
  await page.getByRole("button", { name: "Restart animation" }).click();
  await expect.poll(async () => (await scales())[0]!).toBeLessThan(0.95);
  await page.getByRole("button", { name: "Pause animation" }).click();
  for (const width of [320, 360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Play animation" }),
    ).toBeVisible();
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.setViewportSize(testInfo.project.use.viewport!);
  await page.screenshot({
    path: `test-results/opulya-spinner-preview-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("only original bar pixels change, gold hold reproduces the PNG and reduced motion stays static", async ({
  page,
}, testInfo) => {
  const source = await readFile(
    new URL("../../apps/web/public/opulya-mark.png", import.meta.url),
  );
  expect(createHash("sha256").update(source).digest("hex")).toBe(
    spinnerSourceSha256,
  );
  for (const [size, name, limit] of [
    [256, "opulya-spinner.webp", 36_000],
    [512, "opulya-spinner-large.webp", 110_000],
  ] as const) {
    const optimized = await readFile(
      new URL(`../../apps/web/public/${name}`, import.meta.url),
    );
    expect(optimized.length).toBeLessThan(limit);
    const expected = await sharp(source)
      .resize(size, size)
      .ensureAlpha()
      .raw()
      .toBuffer();
    const actual = await sharp(optimized).ensureAlpha().raw().toBuffer();
    // Lossless WebP discards unused RGB values of fully transparent pixels.
    for (let offset = 0; offset < expected.length; offset += 4) {
      if (expected[offset + 3] === 0) {
        expected.fill(0, offset, offset + 3);
        actual.fill(0, offset, offset + 3);
      }
    }
    expect(actual.equals(expected)).toBe(true);
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/spinner-preview");
  const spinner = page.locator('[data-preview="animated"] [role="status"]');
  const original = page.locator('[data-preview="original"] img');
  await expect
    .poll(() =>
      original.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth === 512,
      ),
    )
    .toBe(true);
  await spinner.locator("../..").evaluate((element: HTMLElement) => {
    element.style.width = "1048px";
    element.style.gridTemplateColumns = "512px 512px";
    // Keep the pixel comparison on whole pixels, independent of preceding content.
    element.style.position = "fixed";
    element.style.inset = "0 auto auto 0";
    element.style.padding = "0";
    element.style.zIndex = "10";
    element.style.background = "var(--bg)";
  });
  for (const locator of [spinner, original]) {
    await locator.evaluate((element: HTMLElement) => {
      element.style.setProperty("width", "512px", "important");
      element.style.setProperty("height", "512px", "important");
    });
  }
  const seek = async (time: number) => {
    await spinner.evaluate((element, position) => {
      for (const animation of element.getAnimations({ subtree: true })) {
        animation.pause();
        animation.currentTime = position;
      }
    }, time);
  };
  const pixels = async () =>
    sharp(await spinner.screenshot({ animations: "allow" }))
      .ensureAlpha()
      .raw()
      .toBuffer();
  const originalPixels = await sharp(await original.screenshot())
    .ensureAlpha()
    .raw()
    .toBuffer();
  const mask = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">${spinnerBars.map((bar) => `<path d="${bar.path}" fill="white"/>`).join("")}</svg>`,
    ),
  )
    .ensureAlpha()
    .raw()
    .toBuffer();
  await seek(1500);
  const reference = await pixels();
  expect(reference.length).toBe(originalPixels.length);
  // Chromium composites PNG and lossless WebP with up to one-channel rounding.
  // Exact decoded colours and alpha are verified above; motion stays exact below.
  let maximumDifference = 0;
  for (let offset = 0; offset < reference.length; offset++) {
    maximumDifference = Math.max(
      maximumDifference,
      Math.abs(reference[offset]! - originalPixels[offset]!),
    );
  }
  expect(maximumDifference).toBeLessThanOrEqual(1);
  await seek(1750);
  expect((await pixels()).equals(reference)).toBe(true);
  let initial: Buffer | undefined;
  for (const time of [0, 500, 900, 2100, 2400]) {
    await seek(time);
    const frame = await pixels();
    let changes = 0;
    let outside = 0;
    for (let i = 0; i < reference.length; i += 4) {
      if (frame.subarray(i, i + 4).equals(reference.subarray(i, i + 4)))
        continue;
      changes++;
      if (mask[i + 3] === 0) outside++;
    }
    expect(outside, `Static O/ribbon changed at ${time}ms`).toBe(0);
    expect(changes).toBeGreaterThan(100);
    if (time === 0) initial = frame;
    if (time === 2400) expect(frame.equals(initial!)).toBe(true);
    if (time === 500) {
      const top = (310 * 512 + 219) * 4;
      const bottom = (365 * 512 + 210) * 4;
      expect(frame[top + 1]!).toBeGreaterThan(frame[top]!);
      expect(
        frame
          .subarray(bottom, bottom + 4)
          .equals(reference.subarray(bottom, bottom + 4)),
      ).toBe(true);
      const scales = await spinner
        .locator("rect[data-bar]")
        .evaluateAll((rectangles) =>
          rectangles.map(
            (rect) => new DOMMatrix(getComputedStyle(rect).transform).m22,
          ),
        );
      expect(scales[0]!).toBeLessThan(scales[1]!);
      expect(scales[1]!).toBeLessThan(scales[2]!);
      expect(scales[2]).toBe(1);
    }
    await spinner.screenshot({
      path: `test-results/opulya-spinner-${time}-${testInfo.project.name}.png`,
      animations: "allow",
    });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      page
        .locator(".loading")
        .evaluate(
          (element) => getComputedStyle(element, "::before").animationName,
        ),
    )
    .toBe("none");
  await expect(spinner.locator("rect[data-bar]").first()).toHaveCSS(
    "animation-name",
    "none",
  );
  expect((await pixels()).equals(reference)).toBe(true);
  expect(
    await spinner.evaluate(
      (element) => element.getAnimations({ subtree: true }).length,
    ),
  ).toBe(0);
  await spinner.screenshot({
    path: `test-results/opulya-spinner-reduced-${testInfo.project.name}.png`,
  });
});
