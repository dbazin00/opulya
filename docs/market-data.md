# Market data

## Configuration

Yahoo Finance is the sole external source for catalogue metadata and market prices, through the server-only `yahoo-finance2` client. No account or API key is required. There are no alternative-provider or brokerage fallbacks. Recorded purchases, quantities and fees remain the user's financial history, not values to overwrite with market quotes.

```dotenv
MARKET_DATA_ENABLED=true
MARKET_REQUESTS_PER_MINUTE=30
MARKET_REQUESTS_PER_DAY=1000
```

These are Opulya safety caps, not guaranteed Yahoo quotas. They count client operations; the client may also make cookie/session requests. Reservations and pacing are shared through PostgreSQL; throttling stops the current batch. Searches are debounced, cached for 24 hours and coalesced across instances. Public search snapshots are bounded to 500 entries, not a downloaded global catalogue.

## Catalogue and prices

There are no predefined assets. Search at least two characters, select a currency and optionally an asset type. Results are Yahoo-covered stocks, ETFs, funds and crypto, not a promise of every instrument worldwide. Only selection creates an `Instrument` and a private `Asset`; owned assets are filtered outside the shared cache.

Exact Yahoo symbols, asset types, exchanges and currencies are verified server-side. `IWDA.AS` (Amsterdam/EUR) differs from `IWDA.L` (London/USD). Crypto uses one coin/currency pair rather than one coin per broker. GBp/GBX quotes are converted precisely to GBP; other currency conversions are not implicit.

The asset picker has one catalogue search for names, symbols and ISINs, with currency and type filters. Search text is forwarded to Yahoo without broker matching or ISIN-format restrictions. Yahoo's ISIN coverage is incomplete: results can be empty or refer to a different listing. The selected listing's exchange, currency and provider metadata are shown before saving and verified server-side; searched identifiers are never copied onto an instrument as proof of identity.

Prices are fetched on demand when assets, investments or dashboard valuations are viewed. Concurrent requests share a bounded, 60-second in-memory cache per API process; queued symbols are batched in groups of up to 30. Relevant visible screens refresh about once per minute and stop polling when hidden, offline or unmounted. Automatic polls do not renew idle sessions. No Redis, scheduled price jobs or persisted price history is required.

The first request awaits the quote; subsequent refreshes retain the displayed data. Temporary failures may retain a clearly marked last-good quote for up to 24 hours, with a 60-second retry backoff. Identity mismatches and missing symbols never fall back to a different listing. Quote timestamps, reported delays and market-closed status remain visible. A fund's published NAV or a closed exchange's last trade is not a live exchange price.

The migration removes the disposable `LatestPrice` cache and obsolete scheduler status, preserving financial history. Metadata caches and shared PostgreSQL request budgets remain. Restarting the API clears quotes; multiple API replicas have independent quote caches and may duplicate requests. Redis would only become useful when sharing these quotes across replicas is necessary. A sleeping host fetches on its next request rather than running a background job.

Existing provider mappings are re-linked only after verification against Yahoo, when type, currency, ticker and exchange/MIC agree. Ambiguous listings remain unpriced; old-provider quotes are never reused. Market prices never overwrite recorded quantities, purchase prices or fees.

## Deployment limitation

This is an **unofficial**, unsupported integration, with no guaranteed availability or quota. Yahoo may change or block its endpoints. Do not bypass access restrictions. Coverage, quote delays and fund NAV publication times vary; prices are informational, not execution prices. Historical portfolio valuation is unsupported.

Yahoo states that its data must not be redistributed. **Do not treat this integration as permission to operate a public multi-user market-data service.** Attribution is not a license; obtain suitable rights or use a licensed provider before public redistribution.

- [Yahoo data guidance](https://uk.help.yahoo.com/kb/SLN2352.html)
- [Client documentation and unofficial status](https://github.com/gadicc/yahoo-finance2)
