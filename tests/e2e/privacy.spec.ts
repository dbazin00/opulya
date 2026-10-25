import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";

test("correct profile, export, restrict, resume and permanently delete an account", async ({
  page,
}, testInfo) => {
  const headers = { Origin: "http://localhost:3001", "X-Opulya-Request": "1" };
  const password = "browser-privacy-password-123";
  const signup = await page.request.post("/api/auth/signup", {
    headers,
    data: {
      firstName: "Privacy",
      lastName: "Browser",
      email: `privacy-${randomUUID()}@example.test`,
      password,
    },
  });
  expect(signup.ok()).toBe(true);
  const account = await page.request.post("/api/accounts", {
    headers,
    data: {
      name: "Private savings",
      type: "BANK",
      currency: "EUR",
      initialBalance: "123.45",
    },
  });
  expect(account.ok()).toBe(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    if (testInfo.project.name === "mobile")
      await page
        .context()
        .addCookies([
          { name: "OPULYA_THEME", value: "dark", url: "http://localhost:3001" },
        ]);
    await page.goto("/settings");
    const profile = page
      .locator("form")
      .filter({ has: page.getByLabel("First name", { exact: true }) });
    await profile.getByLabel("First name", { exact: true }).fill("Corrected");
    await profile.getByRole("button", { name: "Save", exact: true }).click();
    await expect(profile.getByRole("status")).toHaveText("Profile saved");
    const privacy = page.getByRole("region", { name: "Privacy and your data" });
    await privacy.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/privacy-settings-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await privacy.getByRole("button", { name: "Download data" }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Password", { exact: true }).fill(password);
    const downloading = page.waitForEvent("download");
    await dialog
      .getByRole("button", { name: "Download data", exact: true })
      .click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("opulya-data.json");
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(data.profile.firstName).toBe("Corrected");
    expect(data.accounts[0].name).toBe("Private savings");
    expect(JSON.stringify(data)).not.toMatch(
      /passwordHash|tokenHash|emailVerificationTokenHash/,
    );
    await expect(dialog).not.toBeVisible();

    await privacy
      .getByRole("button", { name: "Restrict processing", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Password", { exact: true }).fill(password);
    await dialog
      .getByRole("button", { name: "Restrict processing", exact: true })
      .click();
    await expect(
      privacy.getByRole("button", { name: "Resume processing" }),
    ).toBeVisible();
    await expect(
      page.locator(".topbar").getByRole("button", { name: "Add transaction" }),
    ).toBeDisabled();
    expect((await page.request.get("/api/accounts")).status()).toBe(403);
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: "Processing is restricted" }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Settings", exact: true })
      .last()
      .click();
    await privacy.getByRole("button", { name: "Resume processing" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Password", { exact: true }).fill(password);
    await dialog
      .getByRole("button", { name: "Resume processing", exact: true })
      .click();
    await expect(
      privacy.getByRole("button", { name: "Restrict processing" }),
    ).toBeVisible();
    expect((await page.request.get("/api/accounts")).ok()).toBe(true);
    await privacy
      .getByRole("button", { name: "Delete account", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Password", { exact: true }).fill(password);
    await dialog.getByLabel("Type DELETE to confirm").fill("DELETE");
    if (testInfo.project.name === "mobile") {
      for (const width of [280, 320, 360]) {
        await page.setViewportSize({ width, height: 800 });
        expect(
          await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
        ).toBe(true);
      }
    }
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
      path: `test-results/privacy-delete-${testInfo.project.name}.png`,
    });
    await dialog
      .getByRole("button", { name: "Delete account", exact: true })
      .click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get("/api/auth/me")).status()).toBe(401);
    expect(errors).toEqual([]);
  } finally {
    // Best-effort removal of this fixture if a browser assertion failed before erasure.
    await page.request.delete("/api/auth/account", {
      headers,
      data: { password, confirm: "DELETE" },
    });
  }
});
