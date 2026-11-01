# Market data

## Configuration

Yahoo Finance is the sole external source for catalogue metadata and market prices, through the server-only `yahoo-finance2` client. Catalogue discovery uses `search`; listing verification and prices use `chart` metadata. These operations do not use the session-dependent `quote` endpoint or create a Yahoo cookie/crumb session. No account or API key is required. There are no alternative-provider or brokerage fallbacks. Recorded purchases, quantities and fees remain the user's financial history, not values to overwrite with market quotes.

```dotenv
MARKET_DATA_ENABLED=true
MARKET_REQUESTS_PER_MINUTE=30
MARKET_REQUESTS_PER_DAY=1000
```

These are Opulya safety caps, not guaranteed Yahoo quotas. They count individual search/chart operations. Reservations and pacing are shared through PostgreSQL; throttling stops queued lookups. Searches and normalized public listing metadata are cached for 24 hours and coalesced across instances. The combined public metadata cache is bounded to 500 entries, not a downloaded global catalogue.

The limits cover all users and both searches and price refreshes. A cold search consumes one search operation and up to ten chart lookups to verify candidate metadata. Listings already cached by another query or currency filter need no new chart request. Chart requests are per listing, not a batch: refreshing ten distinct assets can cost ten operations per minute. Set production caps against the actual workload; continuously refreshing once per minute can exhaust the default daily allowance even with few users. Cached searches and warm quotes do not consume a new reservation. Changing these settings requires restarting or redeploying the API; restarting alone does not reset the PostgreSQL counters.

### Diagnosing a limit

- `MARKET_MINUTE_LIMIT`: Opulya's configured minute allowance is exhausted; the next UTC minute starts a new window.
- `MARKET_DAILY_LIMIT`: Opulya's configured daily allowance is exhausted; it resets at 00:00 UTC. This is not a Yahoo-imposed daily quota.
- `MARKET_RATE_LIMIT`: Yahoo throttled a request, or the shared provider cooldown is still active. HTTP 429 responses respect `Retry-After` (seconds or an HTTP date), with a minimum one-minute pause. Without a usable hint, the API pauses for five minutes. Requests during this pause do not contact Yahoo or extend the cooldown.
- `MARKET_BUSY`: the local request queue or pacing wait is full; it does not mean Yahoo returned HTTP 429.

API logs distinguish `Opulya market request limit reached` (including the configured limit and reset time) from `Yahoo Finance request throttled` (including the upstream status when available, search/quote/session stage, and retry time). These logs omit request URLs, cookies, search text and user holdings. The shared cooldown only moves later, so concurrent instances cannot shorten Yahoo's requested wait. For production, inspect these events and the API service's `MARKET_REQUESTS_PER_MINUTE` and `MARKET_REQUESTS_PER_DAY` settings before changing caps. Raising an Opulya cap does not remove upstream throttling.

The browser sees HTTP 503 when a catalogue request is unavailable because of a market limit. This is Opulya's response, not the original Yahoo HTTP status. Use the response's `code` and the API logs above for diagnosis. A cooldown reduces repeated rejected calls; it does not guarantee Yahoo will accept the next request.

## Catalogue and prices

There are no predefined assets. Search at least two characters, select a currency and optionally an asset type. New searches verify up to ten candidates; enter a more specific symbol/name to narrow a broad query. Results are Yahoo-covered stocks, ETFs, funds and crypto, not a promise of every instrument worldwide. Listings without chart data are omitted; throttling and transient failures remain errors rather than being cached as empty results. Only selection creates an `Instrument` and a private `Asset`; owned assets are filtered outside the shared cache.

Exact Yahoo symbols, asset types, exchanges and currencies are verified server-side. `IWDA.AS` (Amsterdam/EUR) differs from `IWDA.L` (London/USD). Crypto uses one coin/currency pair rather than one coin per broker. GBp/GBX quotes are converted precisely to GBP; other currency conversions are not implicit.

The asset picker has one catalogue search for names, symbols and ISINs, with currency and type filters. Search text is forwarded to Yahoo without broker matching or ISIN-format restrictions. Yahoo's ISIN coverage is incomplete: results can be empty or refer to a different listing. The selected listing's exchange, currency and provider metadata are shown before saving and verified server-side; searched identifiers are never copied onto an instrument as proof of identity.

Prices are fetched on demand when assets, investments or dashboard valuations are viewed. Concurrent requests for the same symbol share a bounded in-memory cache lasting about one minute per API process. Uncached symbols pass through one bounded queue per process and the existing shared pacing/budget controls. Listing metadata can be reused for 24 hours, while prices are refreshed independently. Relevant visible screens refresh about once per minute and stop polling when hidden, offline or unmounted. Automatic polls do not renew idle sessions. No Redis, scheduled price jobs or persisted price history is required.

The displayed price and price time come from `meta.regularMarketPrice` and `meta.regularMarketTime`, not a historical candle or the fetch time. If Yahoo supplies no explicit market state, the reported regular trading window determines whether the regular session is open or closed; absent a valid window, the state stays unknown. Delay minutes remain unknown unless Yahoo reports them. The seven-day chart request only obtains the metadata; no candles or price history are stored. The temporary startup diagnostic has been removed; remove `MARKET_DIAGNOSTIC` from Render after deploying.

The first request awaits the quote; subsequent refreshes retain the displayed data. Temporary failures may retain a clearly marked last-good quote for up to 24 hours, with a 60-second retry backoff. Identity mismatches and missing symbols never fall back to a different listing. Quote timestamps, reported delays and market-closed status remain visible. A fund's published NAV or a closed exchange's last trade is not a live exchange price.

The migration removes the disposable `LatestPrice` cache and obsolete scheduler status, preserving financial history. Metadata caches and shared PostgreSQL request budgets remain. Restarting the API clears quotes; multiple API replicas have independent quote caches and may duplicate requests. Redis would only become useful when sharing these quotes across replicas is necessary. A sleeping host fetches on its next request rather than running a background job.

Existing provider mappings are re-linked only after verification against Yahoo, when type, currency, ticker and exchange/MIC agree. Ambiguous listings remain unpriced; old-provider quotes are never reused. Market prices never overwrite recorded quantities, purchase prices or fees.

## Deployment limitation

This is an **unofficial**, unsupported integration, with no guaranteed availability or quota. Yahoo may change or block its endpoints. Do not bypass access restrictions. Coverage, quote delays and fund NAV publication times vary; prices are informational, not execution prices. Historical portfolio valuation is unsupported.

Yahoo states that its data must not be redistributed. **Do not treat this integration as permission to operate a public multi-user market-data service.** Attribution is not a license; obtain suitable rights or use a licensed provider before public redistribution.

- [Yahoo data guidance](https://uk.help.yahoo.com/kb/SLN2352.html)
- [Client documentation and unofficial status](https://github.com/gadicc/yahoo-finance2)
