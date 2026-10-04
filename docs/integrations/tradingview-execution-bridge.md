# TradingView Account & Execution Bridge — capabilities and limitations

> Status: implemented in the AlgoVault Pro Chrome Extension (side panel →
> **Trade** tab) and the AlgoVault server routes listed below.
> Last verified against the installed integration: October 2026.

---

## 1. Architecture

```
TradingView (charting + user's own broker session)
   │  content-script probe (symbol, timeframe, price, TV account markers)
   ▼
TradingView MCP  ── read-only intelligence: quotes, OHLCV, technicals,
   │                screener, news, fundamentals, calendars, watchlists, alerts
   ▼
TradingView Account / Broker context  ── normalized by the account service
   ▼
AlgoVault Intelligence  ── Setup Radar, checklist, MTF, risk guard
   ▼
AI Analysis  ── informational only; NEVER executes
   ▼
Setup / Strategy → "Prepare Trade" (draft ticket)
   ▼
User confirmation  ── Review & Confirm Trade (+ live acknowledgement)
   ▼
TradingView Execution Bridge → AlgoVault MT5 Gateway (real order flow)
   ▼
Position monitoring / pending orders / execution history
   ▼
AlgoVault Trade Journal (RTDB `tradeJournal/{uid}`) + execution audit log
```

---

## 2. Verified TradingView MCP capabilities

Source of truth: `lib/market-intelligence/providers/tradingview/`
(`tradingview-mcp-provider.ts`, `tool-mapping.ts`, `mcp-client.ts`).

| Area | Supported | Notes |
| --- | --- | --- |
| Quotes / OHLCV | ✅ read | `get_symbol_data_batch`, `get_ohlcv` |
| Technical snapshot / screener | ✅ read | `get_technicals_rating`, `run_screener` |
| News / fundamentals / filings / calendars | ✅ read | |
| Watchlists | ✅ read | |
| Alerts (list/log) | ✅ read | write tools are deliberately not mapped |
| Symbol search | ✅ read | |
| **Account / broker detection** | ❌ **no tool exists** | no account tool in the mapped toolset |
| **Positions / pending orders** | ❌ **no tool exists** | |
| **Order submission / cancellation** | ❌ **no tool exists** | |
| **Paper-trading targeting** | ❌ **not possible** | |

The provider is compiled with `READ_TOOLS_ONLY = true` and
`CAPABILITY_TOOLS` contains only read capabilities. `describeCapabilities()`
reconciles the mapping against a live `tools/list`, so a tool that disappears
from the beta toolset is reported as unsupported rather than assumed.

**Consequences (by design):**

* `tradingViewMcpExecutionSupported` and `tradingViewMcpAccountSupported`
  are hard `false` and the UI renders the limitation instead of an action.
* Account mode (paper/live) can never come from the MCP. It is only shown
  when the **TradingView page itself** positively shows it (content-script
  probe) or when a future gateway field reports it. Otherwise the mode is
  `UNKNOWN` and is **treated as live** for safety.
* The old behavior of defaulting an unknown account to "PAPER" was removed —
  it was an inference, not a detection.

## 3. Where execution actually comes from

Real execution is provided by the **AlgoVault MT5 Gateway** (an existing,
entitled integration — not created by this feature):

| Step | Endpoint | Notes |
| --- | --- | --- |
| Queue an order | `POST /api/trading/orders` | `authenticate` + `hasActiveTradingLicense` server-side; idempotent on `clientOrderId` |
| Gateway EA picks it up | `/api/trading/gateway/commands` (+ heartbeat) | writes `trading_order_requests/{uid}` |
| Execution report | `/api/trading/gateway/execution` | `filled`, `partially_filled`, `rejected`, `failed` + real MT5 ticket + execution price |
| Poll status | `GET /api/trading/orders?clientOrderId=` | used by the trade ticket lifecycle |
| Positions | `GET /api/trading/positions?accountId=` | real `trading_positions/{uid}/{accountId}` rows |
| Pending orders | `GET /api/trading/pending-orders?accountId=` | real `trading_orders/{uid}/{accountId}` rows (gateway snapshot) |
| Account / margin | `GET /api/trading/gateway/status` | broker, account number, balance, equity, margin, free margin, margin level |
| Order actions | `MODIFY` / `CLOSE` / `PARTIAL_CLOSE` / `CANCEL` | supported by the EA (`MQL5/AlgoVaultTradeGateway`) with `ticket` |

Normalized actions exposed by `TradingViewExecutionAdapter`:
**Market Buy/Sell, Limit Buy/Sell, Stop Buy/Sell, Cancel Order, Modify
Position, Close Position.** Anything else is rejected as unsupported.

## 4. Account states

`NOT_CONNECTED · CONNECTED · ACCOUNT_DETECTED · TRADING_ENABLED · READ_ONLY ·
LIMITED · EXECUTION_UNAVAILABLE · AUTHENTICATION_REQUIRED · ERROR`

Resolution order:

1. Gateway connected (real account + execution) → `TRADING_ENABLED`
2. TradingView MCP token expired / re-auth required → `AUTHENTICATION_REQUIRED`
3. MCP call failed → `ERROR`
4. TradingView page reachable but no execution source → `EXECUTION_UNAVAILABLE`
5. Nothing → `NOT_CONNECTED`

## 5. Execution safety rules (enforced in `execution-adapter.ts`)

1. **No execution without explicit user confirmation.** The AI can only
   *prepare* a ticket.
2. **Live safety.** `LIVE` *and* `UNKNOWN` account modes require an
   acknowledgement captured immediately before submission; the first live
   execution of a session shows the stronger warning.
3. **No invented fills.** A `FILLED` / `PARTIALLY_FILLED` result is only
   produced from a gateway execution report. No report before the deadline →
   `UNKNOWN` with the mandated message:
   > "Execution status could not be confirmed. Check TradingView before
   > attempting another order."
4. **No automatic retry.** `UNKNOWN` outcomes mark the request id *uncertain*
   in a persisted ledger (memory + `chrome.storage.local`), so a double-click,
   React re-render, duplicated event, MCP timeout or extension reload can never
   resubmit the same order. A *definitive* 4xx refusal is reported as
   `REJECTED` and may be deliberately re-prepared.
5. **Risk never invents numbers.** Without a real reference price the result is
   "Risk could not be calculated from available data." Missing balance,
   missing stop and above-threshold risk are surfaced, never smoothed over.
6. **Audit trail.** Every attempt (accepted, rejected, uncertain) writes a
   safe-metadata record to `executionAudit/{uid}` — no passwords, tokens,
   cookies or keys, enforced both client-side and server-side.

## 6. Journal synchronization

Confirmed fills are written to the **existing** RTDB journal
(`tradeJournal/{uid}`) through `POST /api/extension/journal-sync`, including
strategy / setup / AI-analysis ids, timeframe, stop/target, broker reference,
account mode and execution status. **No Firestore and no duplicate trade
store were introduced**; the web terminal, verified-performance and
report-generator surfaces read the same path.

## 7. Pro entitlement

* The side panel shows a **feature preview** to free users; the ticket,
  positions and actions are not rendered.
* Privileged calls additionally run `assertExecutionEntitlement()` in the
  extension (defense in depth).
* The real gate is server-side: `/api/trading/orders` requires an
  authenticated user **with an active trading license**, and every
  `/api/extension/*` route requires a valid Firebase ID token.
* Feature flags default to `false` (fail-closed) until the server reports
  them.

## 8. Account security

The extension never requests or stores TradingView/broker passwords, API
keys, cookies or auth secrets, and never scrapes credentials from the page.
The only page data read by the content script is the chart identity plus
positively identified TradingView account markers (active paper-trading panel,
broker label, live badge). Account numbers are masked (`••••1234`) for
display.

## 9. Known limitations (explicit)

1. **TradingView MCP cannot execute or detect accounts** — read-only toolset;
   execution goes through the AlgoVault MT5 Gateway instead.
2. **TradingView Paper Trading cannot be targeted programmatically** from
   this stack. Paper mode is reported only when TradingView's own UI shows it,
   and orders are still routed to the connected gateway account.
3. **Live vs demo of the execution account is not reported by the gateway**
   today, so the mode shows `MODE NOT REPORTED` and is treated as live.
   (The gateway `trading_accounts` record has no account-type field.)
4. **Broker min-lot / quantity step / price precision are unknown**, so the
   validator only enforces them when a venue spec is supplied — it never
   guesses them.
5. **Order modification of pending (limit/stop) orders is not supported** by
   the gateway EA (only position modify), so no "Modify" action is offered on
   pending orders.
6. Positions/pending/history depend on the gateway snapshot being recent;
   surfaces degrade to "unavailable" with an explanation rather than stale or
   fabricated values.

## 10. Test coverage

`chrome-extension/tests/tv-execution-bridge.spec.ts` and
`chrome-extension/tests/tv-account-bridge.spec.ts` (Playwright, no network,
no real account):

* account detection, broker detection, account states, paper vs live
* execution capability detection (MCP read-only + gateway gates)
* order validation (symbol/side/qty/type/price/SL/TP, venue specs, account
  state), trade ticket, confirmation gating, live acknowledgement
* execution adapter submission: accepted / rejected / partial / timeout /
  network failure / entitlement / risk rejection
* duplicate-order protection + idempotency across a simulated extension
  reload
* position, pending-order and execution-history synchronization
* journal payload + audit record contents (credential-free)
* Pro flag fail-closed, security boundaries, MCP/gateway failure handling

Run with:

```bash
cd chrome-extension
npm run typecheck
npm run test
```
