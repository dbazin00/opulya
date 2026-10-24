import { randomUUID } from "node:crypto";
import { test, expect, chooseOption } from "./fixtures";

test.use({ locale: "hr-HR" });

const publicPages = ["/", "/login", "/signup", "/check-email", "/privacy"];

test("first visits use English regardless of the browser language", async ({
  page,
  baseURL,
}) => {
  for (const path of publicPages) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.getByRole("combobox", { name: "Language", exact: true }),
    ).toContainText("English");
    if (path === "/")
      await expect(page).toHaveTitle(
        "Opulya | Your personal finances, together",
      );
  }
  await page
    .context()
    .addCookies([
      { name: "OPULYA_LOCALE", value: "unsupported", url: baseURL! },
    ]);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("Opulya | Your personal finances, together");
});

test("an explicitly selected language persists across public pages", async ({
  page,
}) => {
  await page.goto("/");
  await chooseOption(
    page.getByRole("combobox", { name: "Language", exact: true }),
    "hr",
  );
  for (const path of publicPages) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("lang", "hr");
    await expect(
      page.getByRole("combobox", { name: "Jezik", exact: true }),
    ).toContainText("Hrvatski");
    if (path === "/")
      await expect(page).toHaveTitle(
        "Opulya | Vaše osobne financije na jednom mjestu",
      );
  }
  await chooseOption(
    page.getByRole("combobox", { name: "Jezik", exact: true }),
    "en",
  );
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("Opulya | Your personal finances, together");
});

test("a saved account language still takes priority in the signed-in app", async ({
  page,
}) => {
  const response = await page.request.post("/api/auth/signup", {
    headers: { Origin: "http://localhost:3001", "X-Opulya-Request": "1" },
    data: {
      firstName: "Alex",
      lastName: "Language",
      email: `language-${randomUUID()}@example.test`,
      password: "browser-test-password-123",
      locale: "hr",
      timeZone: "Europe/Zagreb",
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  await page.goto("/transactions");
  await expect(page.locator("html")).toHaveAttribute("lang", "hr");
  await expect(
    page.getByRole("heading", { name: "Transakcije", exact: true }),
  ).toBeVisible();
});
