# Financial calculations

## Ledger

Balances derive from `initialBalance` plus active ledger movements, not a duplicated current-balance column. Income credits its destination; expenses debit their source. Transfers move money between distinct owned accounts in the same currency and never count as income or expense.

Balance-after values are derived snapshots saved atomically with financial writes. Backdated insertion, correction and void rebuild subsequent snapshots. Ordering uses event time, ledger-order time and ID; corrections retain the original order. Direct SQL edits bypass maintenance; `npm run db:backfill-balances` repairs snapshots, not financial history.

Corrections retain the original record and create a linked replacement; voids retain original details. Serializable transactions, per-user write serialization and idempotency keys protect multi-record operations and retries.

## Opening amounts and adjustments

An account can use an unrecorded opening baseline or record one visible opening adjustment with a zero baseline, never both. Imported history must not already be included in the starting baseline.

Updating an account balance appends an adjustment for the difference. Unchecking history visibility hides it from transaction lists but keeps the internal ledger movement. Neither opening entries nor adjustments count as income/expense. Investment adjustments affect cash, not holdings or cost basis.

Balance updates reject stale displayed balances. An adjustment is a fixed movement, not a permanent override: later backdated activity still affects the resulting balance.

## Precision, categories and time

Money uses PostgreSQL decimals and Decimal.js at 48 significant digits, serialized as strings. Storage supports eight fractional digits for money and twelve for quantities. Trade gross equals quantity times unit price rounded to eight places with half-even rounding; currency display rounding does not alter stored values.

Income/expense requires an owned category of the matching type. Categories support arbitrary nesting with cycle prevention; custom names remain user text. Transfers and adjustments need no category.

Timestamps retain full precision. Reports use the user's timezone for day/month boundaries; the UI shows localized dates and minutes without seconds. Unchanged edit timestamps preserve their original precision.

Currencies are reported separately without automatic FX conversion. Negative cash is allowed for overdrafts/incomplete imports; short selling is rejected by replaying active investment history.

## Investment activity

Investment accounts are user-named, without predefined brokers or direct brokerage connections. Assets are private user references to shared catalogue instruments; pricing is independent of where the investment was purchased.

A new BUY requires an active owned bank/cash funding account in the same currency. One linked transfer funds gross purchase plus buy fee; the investment activity consumes that amount atomically, leaving investment cash unchanged. DEPOSIT uses a linked transfer as its sole cash credit. WITHDRAWAL represents money leaving the tracked system; use an ordinary transfer for movement between tracked accounts.

Editing or voiding linked activity changes both sides atomically. A funding transfer cannot be corrected independently. Changes that leave a later sale uncovered are rejected.

Weighted-average cost is calculated per account and asset:

- BUY adds gross purchase plus buy fee to cost basis.
- SELL removes proportional basis; realized profit is proceeds minus sell fee minus removed basis.
- Average cost is remaining basis divided by current quantity.
- Unrealized profit is quantity times current market price minus remaining basis.
- Return percentage is unrealized profit divided by remaining basis.
- Dividends are net of their fees; standalone fees are reported separately.

Total invested is cumulative gross purchases plus buy fees, not deposits or a time-weighted return. For example, buying for 800 plus a 50 fee and later valuing at 950 gives 100 unrealized profit.

See [market data](alpha-vantage.md) for identity, price caching and refresh behavior.

## Limitations

No automatic FX, tax-lot accounting, corporate-action/split processing, historical market-value reports or broker synchronization is implemented. Calculations are not jurisdiction-specific tax advice. Reports load user history and financial writes replay it; larger histories may require measured pagination or incremental calculation.
