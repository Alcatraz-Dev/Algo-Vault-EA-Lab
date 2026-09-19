# Bot Integration Implementation Report

Custom & marketplace bot monitoring through the existing MT5 Gateway.

---

## 1. Files Created

| File | Purpose |
|------|---------|
| `lib/bots.ts` | Core bot registry, entitlement validation, position/trade attribution, stats computation |
| `app/api/bots/route.ts` | `GET /api/bots` — list all user bots with stats |
| `app/api/bots/custom/route.ts` | `POST /api/bots/custom` — register a custom EA |
| `app/api/bots/connect/route.ts` | `POST /api/bots/connect` — connect a marketplace product |
| `app/api/bots/disconnect/route.ts` | `POST /api/bots/disconnect` — remove a bot mapping |
| `app/api/bots/[botId]/route.ts` | `GET /api/bots/[botId]` — bot detail with stats, trades, positions |
| `app/api/bots/[botId]/mapping/route.ts` | `POST /api/bots/[botId]/mapping` — manual magic/account mapping |
| `app/api/bots/gateway/trades/route.ts` | `POST /api/bots/gateway/trades` — gateway-reported attributed trades |
| `app/api/bots/gateway/positions/route.ts` | `POST /api/bots/gateway/positions` — gateway-reported open positions |
| `app/account/bots/page.tsx` | My Bots dashboard — list, add, connect marketplace, map, upgrade |
| `app/account/bots/[botId]/page.tsx` | Bot detail — stats grid, equity curve, open positions, trade history |

## 2. Files Modified

| File | Changes |
|------|---------|
| `app/api/trading/gateway/register/route.ts` | Accepts `gatewayInstallationId`, `bots[]`, `magicNumber`; writes `gateway_installations/`; relaxed license check for `custom_bot` entitlements; calls `syncBotStatuses` |
| `app/api/trading/gateway/heartbeat/route.ts` | Accepts `gatewayInstallationId`, `bots[]`, `terminalStatus`, `gatewayVersion`; writes installation record; relaxed license check; calls `syncBotStatuses` |
| `app/api/trading/gateway/snapshot/route.ts` | Stores `comment` per position; bot-owned position attribution to `bot_positions/`; stale ticket cleanup; `indexBotTrade` on close with last floating profit; skip copy-trading mirroring for bot-owned magics |
| `app/api/performance/trade/route.ts` | After saving a trade, looks up matching user bot and indexes into `bot_trades/` for marketplace attribution |
| `components/account/AccountShell.tsx` | Added "My Bots" nav link to Trading section; removed unused `Radio` import |
| `MQL5/AlgoVaultTradeGateway/AlgoVaultTradeGateway.mq5` | Added `ReportAllMagic` input (default false); positions/orders JSON now include `magic` and `comment` fields; version bumped to 1.3.0 |

## 3. Systems Reused

| Existing System | How It's Reused |
|-----------------|-----------------|
| `lib/admin-auth.ts` (`authenticate`) | All browser-facing bot routes |
| `lib/gateway.ts` (`verifyGatewayToken`, `resolveGatewayToken`) | Both `/api/bots/gateway/*` routes |
| `lib/notifications.ts` (`notifyUser`) | `notifyBotEvent` in `lib/bots.ts` wraps it for trade/position/disconnect events |
| `lib/copy-trading.ts` (mirroring + ledger) | Extended to skip bot-owned magics; snapshot route calls `mirrorMasterOrder` / `mirrorMasterClose` only for non-bot positions |
| `users/{uid}/subscription` | `hasProSubscription` reads this to gate custom bot entitlement |
| Free/Pro plan enforcement | Custom bot registration requires active Pro/Enterprise; Marketplace connect requires valid marketplace license |
| `trading_accounts/{uid}/{accountNumber}` | `syncBotStatuses` writes `botList` and `lastGatewayHeartbeat` here |

## 4. RTDB Schema Additions

```
user_bots/{botId}                      # Bot registration + metadata
  ownerId, type, name, botId, magicNumber, accountId,
  productId, licenseId, status, lastHeartbeat,
  createdAt, connectedAt

user_bots_index/{ownerId}/{botId}      # Per-owner lookup (no RTDB index rule needed)
                                        (maintained by upsertBot; one-time backfill
                                        scan on first list if empty)

bot_trades/{botId}/{ticket}            # Attributed closed trades
  ...trade fields + magic, comment, openSource, closeSource,
  openedAt, closedAt

bot_positions/{botId}/{ticket}         # Attributed open positions
  ...position fields + magic, comment,
  updatedAt, currentPrice, profit

licenses/{uid}/{botId}-LIC            # Custom bot entitlement
  type: "custom_bot", status: "active"|"revoked",
  entitlementId, botId, userId,
  expiresAt: 0 (valid while Pro active),
  createdAt

gateway_installations/{gatewayInstallationId}
  accountId, userId, accountNumber,
  botsReported, magicNumber, terminalStatus, gatewayVersion,
  updatedAt

trading_accounts/{uid}/{accountNumber}
  + botList (string array of bot IDs)
  + lastGatewayHeartbeat
  + magicNumber (gateway EA magic)
```

## 5. API Changes

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/bots` | GET | Bearer (browser) | List all user bots with stats |
| `/api/bots/custom` | POST | Bearer (browser) | Register custom EA; creates entitlement |
| `/api/bots/connect` | POST | Bearer (browser) | Connect marketplace product; validates license |
| `/api/bots/disconnect` | POST | Bearer (browser) | Remove bot + revoke entitlement |
| `/api/bots/[botId]` | GET | Bearer (browser) | Bot detail + stats + trades + positions |
| `/api/bots/[botId]/mapping` | POST | Bearer (browser) | Manual magic/account mapping (409 on conflict) |
| `/api/bots/gateway/trades` | POST | Gateway token | Attribute a trade to a bot |
| `/api/bots/gateway/positions` | POST | Gateway token | Attribute positions to bots, clear stale |

## 6. Gateway Changes

**Register** (`/api/trading/gateway/register`):
- Accepts optional `gatewayInstallationId`, `bots[]` array, `magicNumber`
- Writes `gateway_installations/{id}` when provided
- License check: if no `trading_access` license, checks for any active `custom_bot` license
- Calls `syncBotStatuses` to mark all reported bots online

**Heartbeat** (`/api/trading/gateway/heartbeat`):
- Accepts optional `gatewayInstallationId`, `bots[]`, `terminalStatus`, `gatewayVersion`
- Writes full installation state including `terminalStatus` and `gatewayVersion`
- Calls `syncBotStatuses`

**Snapshot** (`/api/trading/gateway/snapshot`):
- `positionsData` now stores `comment` per position
- Bot-owned position detection via `getBotOwnedMagics(userId, accountNumber)`
- Each position: `findMatchingBots` → `indexBotPosition` into `bot_positions/{botId}/{ticket}`
- Closed positions: `indexBotTrade` with last floating profit (estimated; gateway snapshots don't have close prices)
- Stale tickets cleaned via `clearBotPositions`
- Copy-trading mirroring (`mirrorMasterOrder` / `mirrorMasterClose`) skipped entirely for bot-owned magics

## 7. License/Entitlement Changes

- Custom bot entitlement: `licenses/{uid}/{botId}-LIC` with `type: "custom_bot"`, `status: "active"`, `expiresAt: 0`
- Validation: `validateCustomEntitlement` checks (1) active Pro or Enterprise subscription via `hasProSubscription`, AND (2) active `custom_bot` license record
- No hard expiry — valid as long as subscription is active
- Gateway register/heartbeat license check extended: if no `trading_access` license found, falls back to checking any active `custom_bot` license
- Marketplace license validation unchanged (existing `licenseKey` → `productId` → `accounts/{productId}` pipeline)

## 8. UI Changes

**My Bots Dashboard** (`/account/bots`):
- Two sections: Custom / Marketplace bots
- BotCard: status dot, name, bot ID (copyable), account, magic, last heartbeat, stats summary (trades, P/L, win rate, profit factor)
- Add Custom Bot form: name, magic number, MT5 account
- Connect Marketplace Bot: product license dropdown, MT5 account, magic number; 409 conflict handling
- Manual mapping modal: account, magic, symbol, comment (required for manual); overlap detection with 409 + conflicts list
- Upgrade / Refresh buttons
- Free user explanation card
- Marketplace bot status updates via `licenses/{uid}` onValue listener

**Bot Detail** (`/account/bots/[botId]`):
- Stat cards grid: total trades, realized P/L, today P/L, profit factor, win rate, max drawdown
- Recharts equity curve from sorted realized trades
- Open positions table (when applicable)
- Trade history table with symbol, type, volumes, P/L, timestamps
- Equity/P-L calculation notes (documents limitations)

**Navigation**: AccountShell Trading section now includes "My Bots" link.

## 9. Security

- Browser routes: `authenticate` from `lib/admin-auth.ts` (Firebase ID token)
- Gateway routes: `verifyGatewayToken` + `resolveGatewayToken` from `lib/gateway.ts`
- All bot IDs are server-generated (crypto.randomUUID); clients cannot supply them
- License validation is server-side only: entitlement + subscription checked against RTDB, never trusted from client
- MT5 account numbers validated as numeric strings; magic numbers parsed with `parseInt` and re-validated
- Manual mapping overlap check returns 409 with explicit conflict list — never silently overwrites
- `gateway_installations` keyed by installation UUID, not user-supplied; writes require valid gateway token
- No MT5 passwords stored anywhere in the new code
- Custom bot entitlement (`type: "custom_bot"`) is a distinct type from marketplace entitlements, preventing cross-type confusion

## 10. Migration / Backward Compatibility

- Zero breaking changes: all existing bots, licenses, trades, and marketplace pipeline untouched
- New RTDB nodes (`user_bots/`, `bot_trades/`, `bot_positions/`, `gateway_installations/`) are purely additive
- `ReportAllMagic` EA input defaults to `false` — existing EAs behave identically without recompilation
- `gateway_installations` write is gated on optional `gatewayInstallationId` — old gateway versions (without this field) still work
- `bots[]` array in register/heartbeat is optional — old gateway versions without this field still work
- Copy-trading mirroring for non-bot magics is unchanged; only bot-owned magics are skipped
- Performance/trade route indexing is additive — existing `trading_history` writes unchanged

## 11. Testing Status

| What | Status |
|------|--------|
| TypeScript compilation | ✅ `npx tsc --noEmit` — zero errors |
| ESLint (all changed files) | ✅ Zero errors, zero warnings |
| MQL5 EA compilation | ❌ Cannot compile in this environment (no MetaEditor) |
| Manual EA testing | ❌ Cannot test EA runtime (no MT5 terminal) |
| API route unit tests | Not written (no test framework configured in project) |
| UI manual testing | Not performed (no dev server run) |

## 12. Limitations, Risks, and Missing Pieces

**Critical:**
1. **MQL5 EA untested**: `ReportAllMagic`, `comment`/`magic` JSON fields, and version bump have not been compiled or runtime-tested. Syntax errors or logic bugs in the EA will surface only when deployed to a live MT5 terminal. Recommend thorough testing on a demo account before pushing to production.
2. **Closed-trade profit is estimated**: When a bot-owned position disappears from the gateway snapshot, the last floating profit is recorded as the close profit. Realized close prices (SL/TP fill vs. market) are not available from snapshot data. When the EA eventually reports the close via `/api/performance/trade` or `/api/bots/gateway/trades`, the record will be overwritten with accurate data.
3. **Open-only without EA changes**: Without `ReportAllMagic=true`, the gateway EA only reports its own magic number (999888) positions. Custom bot trades require either (a) the EA to post to `/api/bots/gateway/trades` on close, or (b) `ReportAllMagic=true` for open-position monitoring.

**Moderate:**
4. **No deal-history scanning**: The gateway EA does not scan MT5 deal history on startup to backfill closed trades. `bot_trades` only populates for trades captured during the gateway's live session. Historical trades must be imported manually or via a future EA enhancement.
5. **Symbol-overlap false positives in fallback**: `findMatchingBots` fallback matching (account + symbol + comment) could incorrectly attribute a trade to the wrong bot if two bots trade the same symbol on the same account with similar comments. The primary match path (by magic number) is robust; fallback is best-effort.
6. **`computeBotStats` equity curve is from realized trades only**: Floating P/L is excluded from the equity curve by design (requires snapshots to estimate). The stats grid shows today's floating P/L separately.
7. **`maxDrawdown` is from cumulative realized P/L only**: Not a true peak-to-trough drawdown including floating losses. This is documented in `lib/bots.ts` comments.
8. **No real-time bot status via push**: Bot online/offline status is updated via `syncBotStatuses` (called on register/heartbeat). If the gateway crashes, the bot stays "online" until the next heartbeat timeout. The UI shows a green dot only if `lastHeartbeat > now - 10min`.

**Low:**
9. **Performance/trade bot indexing runs on every trade**: `findMatchingBots` performs per-owner RTDB lookups per trade. Acceptable at current scale but may need caching if trade volume grows.
10. **`getBotOwnedMagics` in snapshot route**: Calls `listUserBots` (owner-index lookup) on every snapshot. Acceptable for typical bot counts (<100); may need caching if counts grow.
11. **No AI integration for bot-specific insights**: Bot data feeds into `notifyBotEvent` (notifications), but the AI copilot does not yet parse bot-specific context. A future enhancement could provide "AI bot doctor" features using `computeBotStats` data.
12. **No marketplace bot discovery UI**: Marketplace bots appear in My Bots only after the user manually clicks "Connect Marketplace Bot" and assigns magic/account. An auto-connect flow (detect license + prompt connect from the Licenses page) would improve UX.
