import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { formatMoney, resolveLocale } from "@opulya/shared";
import { test, expect } from "./fixtures";

for (const locale of ["en", "hr"] as const) {
  test(`category tooltips work on slices, legend hover and keyboard focus (${locale})`, async ({
    page,
  }, testInfo) => {
    const post = async (path: string, data: unknown) => {
      const response = await page.request.post(`/api/${path}`, {
        headers: { Origin: "http://localhost:3001", "X-Opulya-Request": "1" },
        data,
      });
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    };
    await post("auth/signup", {
      firstName: "Alex",
      lastName: "Charts",
      email: `charts-${randomUUID()}@example.test`,
      password: "browser-test-password-123",
      locale,
      timeZone: "Europe/Zagreb",
    });
    const account = await post("accounts", {
      name: "Everyday",
      type: "BANK",
      currency: "EUR",
      initialBalance: "1000",
    });
    const food = await post("categories", {
      name: "Food and household groceries with a longer category name",
      type: "EXPENSE",
    });
    const groceries = await post("categories", {
      name: "Groceries",
      type: "EXPENSE",
      parentId: food.id,
    });
    const travel = await post("categories", {
      name: "Travel",
      type: "EXPENSE",
    });
    const fees = await post("categories", {
      name: "Small fees",
      type: "EXPENSE",
    });
    for (const [categoryId, amount] of [
      [food.id, "200"],
      [groceries.id, "50"],
      [travel.id, "100"],
      [fees.id, "1"],
    ]) {
      await post("transactions", {
        type: "EXPENSE",
        sourceAccountId: account.id,
        categoryId,
        amount,
        currency: "EUR",
        occurredAt: new Date().toISOString(),
        clientRequestId: randomUUID(),
      });
    }
    await page.goto("/analytics");
    const distribution = page.locator("section").filter({
      has: page.getByRole("heading", {
        name:
          locale === "en"
            ? "Category distribution"
            : "Raspodjela po kategorijama",
        exact: true,
      }),
    });
    const legend = distribution.locator(".legend");
    const foodButton = legend.getByRole("button", {
      name: new RegExp(food.name),
    });
    await expect(foodButton).toBeVisible();
    await distribution
      .locator(".donut")
      .evaluate((element) =>
        element.scrollIntoView({ block: "center", behavior: "instant" }),
      );
    const money = (amount: string) =>
      formatMoney(amount, "EUR", resolveLocale(locale));
    const tooltip = distribution.getByRole("tooltip");
    await foodButton.hover();
    await expect(tooltip).toContainText(food.name);
    await expect(tooltip).toContainText(money("250"));
    await expect(
      distribution.locator(".donut").getByRole("tooltip"),
    ).toHaveCount(1);
    await expect(legend.getByRole("tooltip")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(
      distribution.locator(".recharts-pie-sector path[opacity='0.4']"),
    ).toHaveCount(2);
    const highlighted = distribution.locator(
      ".recharts-pie-sector path[data-active='true']",
    );
    await expect(highlighted).toHaveCount(1);
    await expect(highlighted).toHaveAttribute("stroke-width", "4");
    await expect(highlighted).toHaveCSS(
      "transition-duration",
      "0.18s, 0.18s, 0.18s",
    );
    await expect(highlighted).not.toHaveCSS("filter", "none");
    await page.screenshot({
      path: `test-results/category-legend-${locale}-${testInfo.project.name}.png`,
      fullPage: false,
    });
    await page
      .getByRole("heading", {
        name: locale === "en" ? "Analytics" : "Analitika",
        exact: true,
      })
      .hover();
    await expect(tooltip).toHaveCount(0);
    await expect(highlighted).toHaveCount(0);
    for (const path of await distribution
      .locator(".recharts-pie-sector path")
      .all()) {
      await expect(path).toHaveCSS("opacity", "1");
    }
    await foodButton.focus();
    await expect(tooltip).toContainText(money("250"));
    await expect(foodButton).toHaveAttribute(
      "aria-describedby",
      (await tooltip.getAttribute("id"))!,
    );
    await foodButton.press("Escape");
    await expect(tooltip).toHaveCount(0);
    await foodButton.blur();
    const slice = distribution.locator(".recharts-pie-sector path").first();
    await slice.evaluate((element) =>
      element.scrollIntoView({ block: "center", behavior: "instant" }),
    );
    const points = await slice.evaluate((element) => {
      const path = element as SVGPathElement;
      const bounds = path.getBBox();
      const points: { x: number; y: number }[] = [];
      for (let x = bounds.x + 3; x < bounds.x + bounds.width; x += 5) {
        for (let y = bounds.y + 3; y < bounds.y + bounds.height; y += 5) {
          if (path.isPointInFill(new DOMPoint(x, y))) {
            const point = new DOMPoint(x, y).matrixTransform(
              path.getScreenCTM()!,
            );
            points.push({ x: point.x, y: point.y });
          }
        }
      }
      const first = points[0];
      const second = points.find(
        (point) =>
          first && Math.hypot(point.x - first.x, point.y - first.y) > 30,
      );
      if (!first || !second)
        throw new Error(
          "Two separated points are required inside the category slice",
        );
      return [first, second] as const;
    });
    await page.mouse.move(points[0].x, points[0].y);
    await expect(tooltip).toContainText(food.name);
    await expect(tooltip).toContainText(money("250"));
    await expect(tooltip).toHaveCSS("opacity", "1");
    const firstPosition = await tooltip.boundingBox();
    await tooltip.evaluate((element) => {
      element.dataset.continuity = "same-tooltip";
    });
    await expect(distribution.locator(".recharts-tooltip-wrapper")).toHaveCSS(
      "transition-duration",
      "0.18s",
    );
    await expect(slice).toHaveAttribute("data-active", "true");
    await expect(slice).toHaveAttribute("stroke-width", "4");
    for (const path of await distribution
      .locator(".recharts-pie-sector path[opacity='0.4']")
      .all()) {
      await expect(path).toHaveCSS("opacity", "0.4");
    }
    await page.mouse.move(points[1].x, points[1].y);
    await expect(tooltip).toHaveAttribute("data-continuity", "same-tooltip");
    await expect(tooltip).toHaveCSS("opacity", "1");
    await expect
      .poll(async () => {
        const position = await tooltip.boundingBox();
        return position && firstPosition
          ? Math.hypot(
              position.x - firstPosition.x,
              position.y - firstPosition.y,
            )
          : 0;
      })
      .toBeGreaterThan(10);
    const bounds = await tooltip.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/category-slice-${locale}-${testInfo.project.name}.png`,
      fullPage: false,
    });
    const travelSlice = distribution
      .locator(".recharts-pie-sector path")
      .nth(1);
    const travelPoint = await travelSlice.evaluate((element) => {
      const path = element as SVGPathElement;
      const bounds = path.getBBox();
      for (let x = bounds.x + 3; x < bounds.x + bounds.width; x += 3) {
        for (let y = bounds.y + 3; y < bounds.y + bounds.height; y += 3) {
          if (path.isPointInFill(new DOMPoint(x, y))) {
            const point = new DOMPoint(x, y).matrixTransform(
              path.getScreenCTM()!,
            );
            return { x: point.x, y: point.y };
          }
        }
      }
      throw new Error("No point inside the neighboring slice");
    });
    // Pointer interaction must take priority over a legend item that still has focus.
    await foodButton.focus();
    await page.mouse.move(travelPoint.x, travelPoint.y);
    await expect(travelSlice).toHaveAttribute("data-active", "true");
    await expect(tooltip).toContainText("Travel");
    for (let i = 0; i < 5; i++) {
      await page.mouse.move(points[0].x, points[0].y, { steps: 5 });
      await expect(slice).toHaveAttribute("data-active", "true");
      await expect(travelSlice).toHaveAttribute("data-active", "false");
      await expect(tooltip).toContainText(food.name);
      await page.mouse.move(travelPoint.x, travelPoint.y, { steps: 5 });
      await expect(travelSlice).toHaveAttribute("data-active", "true");
      await expect(slice).toHaveAttribute("data-active", "false");
      await expect(tooltip).toContainText("Travel");
    }
    const narrowSlice = distribution.locator(
      '.recharts-pie-sector path[name="Small fees"]',
    );
    const narrowPoint = await narrowSlice.evaluate((element) => {
      const path = element as SVGPathElement;
      const bounds = path.getBBox();
      for (let x = bounds.x + 0.25; x < bounds.x + bounds.width; x += 0.25) {
        for (let y = bounds.y + 0.25; y < bounds.y + bounds.height; y += 0.25) {
          if (path.isPointInFill(new DOMPoint(x, y))) {
            const point = new DOMPoint(x, y).matrixTransform(
              path.getScreenCTM()!,
            );
            return { x: point.x, y: point.y };
          }
        }
      }
      throw new Error("No point inside the narrow slice");
    });
    await expect(narrowSlice).toHaveCSS("pointer-events", "fill");
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(points[0].x, points[0].y, { steps: 5 });
      await expect(slice).toHaveAttribute("data-active", "true");
      await page.mouse.move(narrowPoint.x, narrowPoint.y, { steps: 5 });
      await expect(narrowSlice).toHaveAttribute("data-active", "true");
      await expect(slice).toHaveAttribute("data-active", "false");
      await expect(tooltip).toContainText("Small fees");
    }
    await legend.getByRole("button", { name: /Travel/ }).hover();
    await expect(tooltip).toContainText("Travel");
    await expect(tooltip).toContainText(money("100"));
    await expect(
      distribution.locator(".donut").getByRole("tooltip"),
    ).toHaveCount(1);
    await expect(legend.getByRole("tooltip")).toHaveCount(0);
    await foodButton.click();
    await expect(
      legend.getByRole("button", { name: /Groceries/ }),
    ).toBeVisible();
    await expect(tooltip).toHaveCount(0);
    const direct = legend.locator(":scope > li > div[tabindex='0']");
    await page.mouse.move(0, 0);
    await direct.focus();
    await expect(tooltip).toContainText(
      locale === "en"
        ? "Directly in this category"
        : "Izravno u ovoj kategoriji",
    );
    await expect(tooltip).toContainText(money("200"));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(highlighted).toHaveCSS("transition-duration", "0s");
    await expect(tooltip).toHaveCSS("animation-name", "none");
    await expect(distribution.locator(".recharts-tooltip-wrapper")).toHaveCSS(
      "transition-duration",
      "0s",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .include(".distribution")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  });
}
