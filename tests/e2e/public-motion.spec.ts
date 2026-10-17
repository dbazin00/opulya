import { test, expect } from "@playwright/test";

test("password visibility controls preserve values without submitting the form", async ({
  page,
}) => {
  let submissions = 0;
  await page.route("**/api/auth/**", (route) => {
    submissions++;
    return route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ code: "VALIDATION_ERROR" }),
    });
  });
  await page.goto("/login");
  const password = page.getByLabel("Password", { exact: true });
  await password.fill("preview-only-password");
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("preview-only-password");
  await expect(
    page.getByRole("button", { name: "Hide password", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Hide password", exact: true })
    .click();
  await expect(password).toHaveAttribute("type", "password");
  await page.goto(`/verify-email#token=${"a".repeat(64)}`);
  const repeat = page.getByLabel("Repeat password", { exact: true });
  await repeat.fill("preview-only-password");
  await page
    .getByRole("button", { name: "Show repeated password", exact: true })
    .click();
  await expect(repeat).toHaveAttribute("type", "text");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await page
    .getByRole("button", { name: "Hide repeated password", exact: true })
    .click();
  await expect(repeat).toHaveAttribute("type", "password");
  expect(submissions).toBe(0);
});

test("landing transitions preserve panel size and native section links", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  expect(
    await page
      .locator("html")
      .evaluate((node) => getComputedStyle(node).scrollBehavior),
  ).toBe("smooth");
  const panel = page.getByRole("tabpanel");
  const initial = await panel.boundingBox();
  expect(initial).not.toBeNull();
  for (const name of ["Transactions", "Investments", "Overview"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(panel).toBeVisible();
    expect(
      await panel
        .locator(":scope > div")
        .evaluate((node) => getComputedStyle(node).animationName),
    ).toContain("preview-appear");
    const box = await panel.boundingBox();
    expect(Math.abs(box!.height - initial!.height)).toBeLessThanOrEqual(1);
  }
  if (isMobile)
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Questions", exact: true })
    .click();
  await expect(page).toHaveURL(/\/#questions$/);
  await expect(page.locator("#faq-title")).toBeInViewport();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
});

test("questions smoothly expand and collapse with keyboard support", async ({
  page,
}) => {
  await page.goto("/");
  const question = page.locator("#questions details").first();
  const summary = question.locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(question).toHaveAttribute("open", "");
  await expect(question.locator("p")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(question).not.toHaveAttribute("open");
  await expect(question.locator("p")).not.toBeVisible();

  const sizes = await question.evaluate(async (node) => {
    const summary = node.querySelector("summary")!;
    const closed = node.getBoundingClientRect().height;
    async function toggle() {
      summary.click();
      const frames: number[] = [];
      const start = performance.now();
      while (performance.now() - start < 400) {
        await new Promise(requestAnimationFrame);
        frames.push(node.getBoundingClientRect().height);
      }
      const end = node.getBoundingClientRect().height;
      return { frames, end };
    }
    const opening = await toggle();
    const closing = await toggle();
    return { closed, opening, closing };
  });
  for (const transition of [sizes.opening, sizes.closing])
    expect(
      transition.frames.some(
        (height) => height > sizes.closed + 1 && height < sizes.opening.end - 1,
      ),
    ).toBe(true);
  expect(sizes.closing.end).toBeCloseTo(sizes.closed, 0);
  await expect(question.locator("p")).not.toBeVisible();
});

test("reduced motion disables scrolling and public-page animations", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  expect(
    await page
      .locator("html")
      .evaluate((node) => getComputedStyle(node).scrollBehavior),
  ).toBe("auto");
  await page.getByRole("tab", { name: "Investments", exact: true }).click();
  const panel = page.getByRole("tabpanel");
  expect(
    await panel
      .locator(":scope > div")
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("none");
  const question = page.locator("#questions details").first();
  await question.locator("summary").click();
  await expect(question.locator("p")).toBeVisible();
  expect(
    await question.evaluate(
      (node) => getComputedStyle(node, "::details-content").transitionDuration,
    ),
  ).toBe("0s");
  expect(
    await question
      .locator("summary > svg")
      .evaluate((node) => getComputedStyle(node).transitionDuration),
  ).toBe("0s");
  await question.locator("summary").click();
  await expect(question.locator("p")).not.toBeVisible();
  await page.goto("/login");
  expect(
    await page
      .locator(".auth-form")
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("none");
  await page.getByRole("link", { name: "Get started", exact: true }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Make room for clarity",
  );
});
