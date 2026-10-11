export type PriceState = {
  assetId: string;
  quote: unknown;
  error: string | null;
  refreshPending?: boolean;
};
export function priceRefreshInterval(
  quotes: readonly PriceState[],
  pendingSince: Map<string, number>,
  now = Date.now(),
) {
  const pending = quotes.filter(
    (item) =>
      item.refreshPending ||
      (!item.quote && item.error === "MARKET_PRICE_PENDING"),
  );
  const ids = new Set(pending.map((item) => item.assetId));
  for (const id of pendingSince.keys())
    if (!ids.has(id)) pendingSince.delete(id);
  for (const item of pending)
    if (!pendingSince.has(item.assetId)) pendingSince.set(item.assetId, now);
  return pending.some((item) => now - pendingSince.get(item.assetId)! < 60000)
    ? 2000
    : 60000;
}
