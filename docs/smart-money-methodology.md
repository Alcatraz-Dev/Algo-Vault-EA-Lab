# Smart Money Methodology — AlgoVault Phase 2

All definitions below explain exactly how AlgoVault calculates Smart Money events.
No universal standard exists; these are our documented rules.

## Swing Detection
- Reuses `lib/analytics/market-structure` `getSwingPoints` with `lookback = 3`.
- A swing at index `i` requires all candles `i-3…i+3` to have `high <= current.high` (high) or `low >= current.low` (low).
- HISTORICAL mode permits full confirmation.
- REPLAY / LIVE: unconfirmed swings are not labeled as HH/HL/LH/LL.

## Structure (BOS / CHoCH / MSS)
- Uses `detectStructure` from `lib/analytics/market-structure`.
- Bullish BOS = price breaks previous confirmed swing high.
- CHoCH = BOS in opposite direction to previous BOS.
- MSS = derived from structure event sequence.

## Liquidity
- Equal High / Low tolerance = 0.001 relative (0.1%). Documented.
- Previous Day / Week levels from `getPreviousDayLevels` / `getPreviousWeekLevels`.
- Swing highs / lows from `getSwingHighLows`.
- Sweeps require price interaction + confirmation candle (`close < open` for sell-side; `close > open` for buy-side).

## FVG
- 3-candle exact definition:
  - Bullish: `candles[i].high < candles[i+2].low` with gap.
  - Bearish: `candles[i].low > candles[i+2].high` with gap.
- States tracked: active → partially_filled → filled / invalidated.
- Consequent Encroachment (CE) = midpoint of FVG when applicable.
- No arbitrary strength score (correctness preferred over invented score).

## Order Blocks
- Bullish OB = last bearish candle before confirmed bullish displacement (BOS / HH / MSS).
- Bearish OB = last bullish candle before confirmed bearish displacement.
- Status: active / mitigated / invalidated / broken.
- Breaker = derived from broken OB (after invalidation / break).
- Mitigation = price retest with actual interaction.

## Sessions
- UTC explicit (`getTimeInUTC`).
- Asia / London / New York / Overlap from `lib/analytics/sessions`.
- Session open / high / low / range calculated from candles within session window.

## Live vs Historical
- `Mode` = `historical` | `replay` | `live`.
- Replay/live never peek ahead; caller passes only available candles.
- Historical analysis may use full confirmation (documented).
