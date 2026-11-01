import { randomUUID, createHash } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, chooseOption } from "./fixtures";

test("recovers a password with a localized, single-use email link and signs out old sessions", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  const email = `password-reset-${randomUUID()}@example.test`;
  const originalPassword = "original-reset-password-123";
  const newPassword = "new-reset-password-for-owner-456";
  const hash = createHash("sha256").update(email).digest("hex");
  const resetFile = fileURLToPath(
    new URL(
      `../../.runtime/e2e-mail/password-reset-${hash}.json`,
      import.meta.url,
    ),
  );
  const changedFile = fileURLToPath(
    new URL(
      `../../.runtime/e2e-mail/password-changed-${hash}.json`,
      import.meta.url,
    ),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const post = (path: string, data: unknown) =>
    page.request.post(`/api/auth/${path}`, {
      headers: { Origin: "http://localhost:3001", "X-Opulya-Request": "1" },
      data,
    });
  try {
    const signup = await post("signup", {
      firstName: "Reset",
      lastName: "Owner",
      email,
      password: originalPassword,
      locale: "en",
    });
    expect(signup.ok(), await signup.text()).toBe(true);
    await page.goto("/login");
    await page
      .getByRole("link", { name: "Forgot password?", exact: true })
      .click();
    await expect(page).toHaveURL("/forgot-password");
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page
      .getByRole("button", { name: "Send reset link", exact: true })
      .click();
    await expect(page.locator(".notice")).toContainText(
      "If this address belongs to a verified account",
    );
    await expect(
      page.getByRole("button", { name: "Send reset link", exact: true }),
    ).toBeDisabled();
    await page.screenshot({
      path: `test-results/forgot-password-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await expect
      .poll(() =>
        readFile(resetFile, "utf8")
          .then(() => true)
          .catch(() => false),
      )
      .toBe(true);
    const { resetUrl } = JSON.parse(await readFile(resetFile, "utf8")) as {
      resetUrl: string;
    };
    const requests: Record<string, unknown>[] = [];
    page.on("request", (request) => {
      if (
        request.url().endsWith("/api/auth/reset-password") &&
        request.method() === "POST"
      )
        requests.push(request.postDataJSON());
    });
    await page.goto(resetUrl);
    await expect(page).toHaveURL("/reset-password");
    await expect(
      page.getByRole("button", { name: "Reset password", exact: true }),
    ).toBeDisabled();
    await page.getByLabel("Password", { exact: true }).fill(newPassword);
    await page
      .getByLabel("Repeat password", { exact: true })
      .fill("mismatching password");
    await expect(
      page.getByRole("button", { name: "Reset password", exact: true }),
    ).toBeDisabled();
    await chooseOption(
      page.getByRole("combobox", { name: "Language", exact: true }),
      { label: "Hrvatski" },
    );
    await expect(page.locator("html")).toHaveAttribute("lang", "hr");
    await expect(page).toHaveURL("/reset-password");
    await page.getByLabel("Lozinka", { exact: true }).fill(newPassword);
    await page
      .getByLabel("Ponovite lozinku", { exact: true })
      .fill(newPassword);
    await expect(
      page.getByRole("button", { name: "Postavi novu lozinku", exact: true }),
    ).toBeEnabled();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations.map((v) => v.id),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/reset-password-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Postavi novu lozinku", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Lozinka je promijenjena",
        exact: true,
      }),
    ).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      password: newPassword,
      token: new URLSearchParams(new URL(resetUrl).hash.slice(1)).get("token"),
    });
    expect((await page.request.get("/api/auth/me")).status()).toBe(401);
    expect(
      (await post("login", { email, password: originalPassword })).status(),
    ).toBe(401);
    expect(
      (await post("login", { email, password: newPassword })).status(),
    ).toBe(201);
    await expect
      .poll(() =>
        readFile(changedFile, "utf8")
          .then(() => true)
          .catch(() => false),
      )
      .toBe(true);
    const notification = JSON.parse(await readFile(changedFile, "utf8"));
    expect(notification).not.toHaveProperty("password");
    expect(notification).not.toHaveProperty("token");
    // Leave the route so reopening the fragment link starts a fresh recovery page.
    await page.goto("/login");
    await page.goto(resetUrl);
    await page.getByLabel("Lozinka", { exact: true }).fill(newPassword);
    await page
      .getByLabel("Ponovite lozinku", { exact: true })
      .fill(newPassword);
    await page
      .getByRole("button", { name: "Postavi novu lozinku", exact: true })
      .click();
    await expect(page.locator(".auth-form").getByRole("alert")).toContainText(
      "istekla je ili je već korištena",
    );
    await expect(
      page.getByRole("link", { name: "Zatražite novu poveznicu", exact: true }),
    ).toHaveAttribute("href", "/forgot-password");
    await page.goto("/forgot-password");
    await page.goto("/reset-password");
    await expect(page.locator(".auth-form").getByRole("alert")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Postavi novu lozinku", exact: true }),
    ).toBeDisabled();
    expect(errors).toEqual([]);
  } finally {
    await unlink(resetFile).catch(() => undefined);
    await unlink(changedFile).catch(() => undefined);
  }
});
