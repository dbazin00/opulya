import type { Page } from "@playwright/test";
import { decimal, sum } from "@opulya/shared";
import type { Account, Asset, Portfolio } from "../../apps/web/src/lib/types";

type QuoteFixture = {
  price: string | null;
  error?: string | null;
  stale?: boolean;
  marketAt?: string;
  delayMinutes?: number | null;
  marketState?: string;
};

/** Offline public quotes only; ownership and financial calculations still use the isolated API. */
export async function mockMarketQuotes(
  page: Page,
  resolve: (asset: Asset) => QuoteFixture = () => ({ price: "123.45" }),
) {
  const requests: { path: string; background: boolean }[] = [];
  const quote = (asset: Asset): Portfolio["quotes"][number] => {
    const fixture = resolve(asset),
      now = new Date().toISOString();
    return {
      assetId: asset.id,
      quote:
        fixture.price === null
          ? null
          : {
              kind: "QUOTE",
              price: fixture.price,
              marketAt: fixture.marketAt ?? now,
              fetchedAt: now,
              stale: fixture.stale ?? false,
              delayed: fixture.delayMinutes !== 0,
              delayMinutes: fixture.delayMinutes ?? 15,
              marketState: fixture.marketState ?? "REGULAR",
              provider: "Yahoo Finance",
            },
      error: fixture.error ?? null,
    };
  };
  await page.route("**/api/assets/prices", async (route) => {
    requests.push({
      path: "assets",
      background: route.request().headers()["x-opulya-poll"] === "1",
    });
    const response = await page.request.get("/api/assets");
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    const assets: Asset[] = await response.json();
    await route.fulfill({ json: assets.map(quote) });
  });
  const valuePortfolio = (data: Portfolio) => {
    data.quotes = data.assets.map(quote);
    for (const position of data.positions) {
      const price =
        data.quotes.find((row) => row.assetId === position.assetId)?.quote
          ?.price ?? null;
      position.currentPrice = price;
      position.marketValue =
        price === null ? null : decimal(position.quantity).mul(price).toFixed();
      position.unrealizedGain =
        position.marketValue === null
          ? null
          : decimal(position.marketValue).sub(position.costBasis).toFixed();
      position.returnPercent =
        position.unrealizedGain === null || decimal(position.costBasis).isZero()
          ? null
          : decimal(position.unrealizedGain)
              .div(position.costBasis)
              .mul(100)
              .toFixed();
    }
    data.holdingsValue = data.positions.some(
      (row) => row.marketValue === null && row.quantity !== "0",
    )
      ? null
      : sum(data.positions.map((row) => row.marketValue ?? "0"));
    data.totalValue =
      data.holdingsValue === null
        ? null
        : decimal(data.cashBalance).add(data.holdingsValue).toFixed();
    return data;
  };
  await page.route("**/api/accounts/*/portfolio", async (route) => {
    requests.push({
      path: "portfolio",
      background: route.request().headers()["x-opulya-poll"] === "1",
    });
    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    await route.fulfill({ json: valuePortfolio(await response.json()) });
  });
  await page.route("**/api/overview?*", async (route) => {
    requests.push({
      path: "overview",
      background: route.request().headers()["x-opulya-poll"] === "1",
    });
    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    const data = await response.json();
    const accounts: Account[] = await (
      await page.request.get("/api/accounts")
    ).json();
    const values = await Promise.all(
      accounts
        .filter(
          (account) =>
            account.type === "INVESTMENT" && account.currency === data.currency,
        )
        .map(async (account) =>
          valuePortfolio(
            await (
              await page.request.get(`/api/accounts/${account.id}/portfolio`)
            ).json(),
          ),
        ),
    );
    data.investments = values.some((value) => value.holdingsValue === null)
      ? null
      : sum(values.map((value) => value.holdingsValue!));
    data.netWorth =
      data.investments === null
        ? null
        : decimal(data.cash).add(data.investments).toFixed();
    data.incomplete = data.investments === null;
    data.stale = values.some((value) =>
      value.quotes.some((entry) => entry.quote?.stale),
    );
    await route.fulfill({ json: data });
  });
  return { requests };
}
