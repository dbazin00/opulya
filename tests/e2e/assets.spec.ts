import { testDatabaseUrl } from "../../packages/config/test-database.js";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../apps/api/src/generated/prisma/client";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, chooseOption } from "./fixtures";
import { mockMarketQuotes } from "./quotes";

test("asset library separates currencies and receives its first quote automatically", async ({
  page,
}, testInfo) => {
  const database = testDatabaseUrl();
  if (new URL(database).pathname !== "/opulya_test")
    throw new Error("Dedicated test database required");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: database }),
  });
  const ids: string[] = [];
  let userId = "";
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const name = `Bitcoin library fixture ${suffix}`;
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(`/api/${path}`, {
      headers: { Origin: "http://localhost:3001", "X-Opulya-Request": "1" },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  try {
    for (const currency of ["EUR", "USD"]) {
      const item = await db.instrument.create({
        data: {
          symbol: `AL${suffix}/${currency}`,
          name,
          assetType: "CRYPTO",
          exchange: "Binance",
          mic: "",
          currency,
          timeZone: "UTC",
          identity: randomUUID(),
          mappings: {
            create: {
              symbol: `AL${suffix}/${currency}`,
              provider: "Yahoo Finance",
              exchange: "Binance",
              mic: "",
              currency,
            },
          },
        },
      });
      ids.push(item.id);
    }
    userId = (
      await post("auth/signup", {
        firstName: "Alex",
        lastName: "Assets",
        email: `asset-ui-${randomUUID()}@example.test`,
        password: "browser-test-password-123",
        locale: "en",
        timeZone: "Europe/Zagreb",
      })
    ).id;
    await post("assets", { instrumentId: ids[1] });
    const providerTime = new Date(Date.now() - 1000);
    await mockMarketQuotes(page, (asset) => ({
      price: asset.currency === "EUR" ? "95000" : "105000",
      marketAt: providerTime.toISOString(),
    }));
    let releaseAssets!: () => void;
    const initialAssets = new Promise<void>((resolve) => {
      releaseAssets = resolve;
    });
    await page.route("**/api/assets", async (route) => {
      if (route.request().method() === "GET") await initialAssets;
      await route.continue();
    });
    try {
      await page.goto("/assets");
      const loading = page.locator(".loading[role='status']");
      await expect(loading).toBeVisible();
      await expect(loading).toHaveText("Loading");
      await expect(loading.locator(".spinner")).toHaveCount(0);
      await expect(loading.locator(".spinner-icon")).toHaveCount(0);
      await expect(loading.locator("svg image")).toHaveAttribute(
        "href",
        /\/opulya-spinner\.[^/]+\.webp$/,
      );
      await expect(
        page.locator('head link[rel="preload"][href*="/opulya-spinner."]'),
      ).toHaveAttribute("fetchpriority", "low");
      await expect(loading.locator("rect[data-bar]")).toHaveCount(3);
      await expect(loading.getByRole("status")).toHaveCount(0);
      const backdrop = () =>
        loading.evaluate((element) => {
          const style = getComputedStyle(element, "::before");
          return {
            x: parseFloat(style.left),
            y: parseFloat(style.top),
            width: parseFloat(style.width),
            height: parseFloat(style.height),
            pointerEvents: style.pointerEvents,
            backdropFilter: style.backdropFilter,
          };
        });
      const viewport = page.viewportSize()!;
      const widths =
        testInfo.project.name === "mobile"
          ? [320, 360, 768]
          : [1024, 1440, 1920];
      for (const width of widths) {
        await page.setViewportSize({ width, height: viewport.height });
        await expect(async () => {
          const header = (await page.locator(".topbar").boundingBox())!;
          const mobileNavigation = page.locator(".mobile-nav");
          const bottom = (await mobileNavigation.isVisible())
            ? (await mobileNavigation.boundingBox())!.y
            : viewport.height;
          const content = (await loading
            .locator(".loading-content")
            .boundingBox())!;
          expect(content.x).toBeCloseTo(header.x, 1);
          expect(content.y).toBeCloseTo(header.y + header.height, 1);
          expect(content.width).toBeCloseTo(header.width, 1);
          expect(content.y + content.height).toBeCloseTo(bottom, 1);
          expect(await backdrop()).toEqual({
            ...content,
            pointerEvents: "none",
            backdropFilter: "blur(2px)",
          });
          const logo = (await loading.locator("svg").boundingBox())!;
          const label = (await loading
            .locator(".loading-content > span:last-child")
            .boundingBox())!;
          expect(logo.x + logo.width / 2).toBeCloseTo(
            content.x + content.width / 2,
            1,
          );
          expect((logo.y + label.y + label.height) / 2).toBeCloseTo(
            content.y + content.height / 2,
            1,
          );
        }).toPass({ timeout: 5000 });
      }
      await page.setViewportSize(viewport);
      await expect(loading.locator("svg")).toHaveCSS("opacity", "1");
      await page.screenshot({
        path: `test-results/assets-loading-${testInfo.project.name}.png`,
      });
    } finally {
      releaseAssets();
    }
    await expect(page.locator(".workspace > .loading")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Assets", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("No assets match these filters")).toBeVisible();
    await expect(page.getByLabel("Currency", { exact: true })).toContainText(
      "EUR",
    );
    await page.getByRole("button", { name: "Add asset", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByLabel("Price per unit", { exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByLabel("Search by name, symbol or ISIN", { exact: true })
      .fill(name);
    const matches = dialog.getByRole("list", { name: "Matching instruments" });
    await expect(matches.getByRole("button")).toHaveCount(1);
    await expect(matches).toContainText("EUR");
    await expect(matches).not.toContainText("USD");
    await matches.getByRole("button").click();
    await dialog
      .getByRole("button", { name: "Add asset", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const row = page.locator(".asset-row");
    await expect(row).toHaveCount(1);
    await expect(row.locator(".asset-price > .money")).toHaveText("€95,000.00");
    await expect(row.locator("time")).toHaveText(
      new Intl.DateTimeFormat("en", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Zagreb",
      }).format(providerTime),
    );
    await expect(row.locator(".asset-price-date")).not.toContainText(
      "Price as of",
    );
    await expect(row.locator(".asset-price-date")).not.toContainText(
      "Provider time:",
    );
    await expect(row.locator("time").first()).toHaveAttribute(
      "dateTime",
      providerTime.toISOString(),
    );
    await expect(row.locator("time")).toHaveCount(1);
    await expect(row.locator(".asset-price-date")).not.toContainText(
      "Updated:",
    );
    await expect(
      row.getByRole("button", { name: `Delete ${name}`, exact: true }),
    ).toHaveCount(1);
    await expect(row.locator(".asset-price-date > .icon-button")).toHaveCount(
      1,
    );
    await expect(row.getByRole("button", { name: /refresh/i })).toHaveCount(0);
    await expect(row).not.toContainText("Yahoo Finance");
    const credit = page.locator(".market-data-credit");
    await expect(credit).toHaveCount(1);
    await expect(credit).toContainText("Data provided by Yahoo Finance");
    const source = credit.getByRole("link", {
      name: "Yahoo Finance",
      exact: true,
    });
    await expect(source).toHaveAttribute("href", "https://finance.yahoo.com");
    await expect(source).toHaveAttribute("target", "_blank");
    await expect(source).toHaveAttribute("rel", "noopener noreferrer");
    await expect(page.getByText(/12:00 UTC/)).toHaveCount(0);
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
      path: `test-results/assets-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await chooseOption(page.getByLabel("Currency", { exact: true }), "USD");
    await expect(row).toHaveCount(1);
    await expect(row.locator(".asset-price > .money")).toHaveText(
      "US$105,000.00",
    );
    await expect(row.locator(".asset-identity")).toContainText("USD");
    await expect(row.locator(".asset-identity")).not.toContainText("EUR");
    await page.getByRole("button", { name: "Add asset", exact: true }).click();
    await dialog
      .getByLabel("Search by name, symbol or ISIN", { exact: true })
      .fill(name);
    await expect(
      dialog.getByText("You already have all matching assets", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      row.getByRole("button", { name: "Match instrument", exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Search assets", { exact: true }).fill("No match");
    await expect(row).toHaveCount(0);
    await page.getByLabel("Search assets", { exact: true }).fill("");
    await chooseOption(page.getByLabel("Asset type", { exact: true }), "ETF");
    await expect(row).toHaveCount(0);
    await chooseOption(page.getByLabel("Asset type", { exact: true }), "");
    await expect(row).toHaveCount(1);
    await page.goto("/settings");
    await chooseOption(
      page.getByRole("combobox", { name: "Display language", exact: true }),
      "hr",
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.goto("/assets");
    await expect(
      page.getByRole("heading", { name: "Instrumenti", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".asset-price > .money")).toHaveText(
      "95.000,00 €",
    );
    await expect(row.locator("time")).toHaveText(
      new Intl.DateTimeFormat("hr", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Zagreb",
      }).format(providerTime),
    );
    await expect(row.locator(".asset-price-date")).not.toContainText(
      "Cijena na dan",
    );
    await expect(page.locator(".market-data-credit")).toHaveText(
      "Podatke pruža Yahoo Finance",
    );
    await row
      .getByRole("button", { name: `Obriši ${name}`, exact: true })
      .click();
    const deletion = page.getByRole("dialog", {
      name: "Obriši instrument",
      exact: true,
    });
    await expect(deletion).toContainText(name);
    await deletion
      .getByRole("button", { name: "Odustani", exact: true })
      .click();
    await expect(row).toHaveCount(1);
    await row
      .getByRole("button", { name: `Obriši ${name}`, exact: true })
      .click();
    await deletion.getByRole("button", { name: "Obriši", exact: true }).click();
    await expect(deletion).not.toBeVisible();
    await expect(row).toHaveCount(0);
    expect(await db.instrument.count({ where: { id: ids[0] } })).toBe(1);
  } finally {
    await db.asset.deleteMany({ where: { userId } });
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    await db.instrument.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
