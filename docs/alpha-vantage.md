# Market data

## Configuration

Set these private backend values in the root `.env` and restart the API:

```dotenv
ALPHA_VANTAGE_API_KEY=your_private_key
MARKET_REQUESTS_PER_MINUTE=5
MARKET_REQUESTS_PER_DAY=25
```

Requests use `https://www.alphavantage.co/query`. Never expose the key in frontend variables, responses or logs.

## Catalogue and identity

- US stocks/ETFs: `LISTING_STATUS`, cached for 24 hours.
- Global stocks, ETFs and funds: `SYMBOL_SEARCH`, cached for 24 hours per normalized keyword.
- Crypto: the official cryptocurrency-code CSV, cached for seven days; one coin/fiat pair per supported currency, not per trading platform.

There is no complete worldwide bulk catalogue. Unmatched searches of at least three characters trigger remote discovery after typing settles. Existing user-owned choices are excluded before pagination; new assets must select a server-resolved catalogue instrument.

Security identity includes the full provider symbol, region, type and quoted currency. Search metadata supplies region rather than MIC; Opulya does not invent exchange codes. `IWDA.AMS/EUR` and `IWDA.LON/USD` are different listings, just as `BTC/EUR` and `BTC/USD` are different valuation pairs. There is no implicit FX conversion.

## Prices

Securities use `TIME_SERIES_DAILY` and the latest completed daily bar in the provider's timezone. Crypto uses `CURRENCY_EXCHANGE_RATE` for the exact coin/fiat pair. These are daily-close security prices and periodic crypto quotes, not execution prices or streaming data.

Only saved assets are priced. A newly saved asset without a valid shared price queues an initial fetch; otherwise it reuses the existing price. Daily refresh starts at 12:00 UTC. One `LatestPrice` row per public instrument is overwritten, without accumulating price history.

Users sharing an instrument share its price cache, not holdings. Asset and investment screens poll the database only while visible. Reads never spend provider credits. A failed update retains the previous price and exposes stale/error status; missing prices are never treated as zero.

Provider symbols, currencies, timestamps and positive decimal prices are validated. Market prices do not change recorded quantities, fees or acquisition costs. Historical market valuation is unsupported.

## Limits and scheduling

Alpha Vantage's free allowance is 25 API requests per day; search/listing calls also use the shared local budget. See the [official free-tier limits](https://www.alphavantage.co/support/). Database-backed reservations and pacing protect concurrent instances; failed requests conservatively consume a reserved credit.

Calls from other applications using the same key are not visible to Opulya. Raising local settings does not raise provider limits. A library larger than the available daily credits cannot refresh completely each day. Rate-limit responses stop the batch; other failures back off before retrying.

Run `npm run market:sync` locally for a budget-respecting sync. For an external scheduler, set `MARKET_SCHEDULER_ENABLED=false` and, after building, run:

```powershell
npm run market:sync --workspace @opulya/api
```

Schedule from 12:00 UTC, with later retries within the allowance. A sleeping free host needs an external scheduler or an awake service for predictable updates.

Coverage and access are listing-specific, especially for global funds/ETFs. Before a public deployment, verify storage/display/redistribution permissions; attribution alone is not a license. See [API documentation](https://www.alphavantage.co/documentation/) and [provider terms](https://www.alphavantage.co/terms_of_service/).
