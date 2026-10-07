# Unified Trading — Architecture & Operations

> **Status:** MT5 **DEMO only**. Live (real-money) execution is hard-disabled
> platform-wide. MT4, cTrader, TradingView execution and the future AlgoVault
> Brokerage provider are **architecture only — NOT IMPLEMENTED**.

This is the first production-grade foundation of AlgoVault's unified trading
infrastructure. It is **additive**: no existing module was replaced, no chart
was swapped, no Firestore was introduced, and the existing
`MQL5/AlgoVaultTradeGateway` EA protocol remains the single MT5 transport.

---

## 1. Target architecture

```
AlgoVault Pro Terminal  ·  AI Terminal  ·  Signals  ·  Bots  ·  Workflows
        ·  Strategy Lab / EA Lab  ·  Challenge Area  ·  (future) TradingView
                              │
                              ▼
                 Unified Trading Service            ← provider-neutral
     auth → ownership → provider status → demo-only → risk → idempotency
                              → provider execution → verification → audit
                              │
                              ▼
                 Provider / Connector Layer
        ┌────────────┬────────────┬─────────────┬────────────────────┐
        │  MT5 DEMO  │ MT4 (future)│cTrader(ft)  │ AlgoVault Broker   │
        │  OPERATIONAL│ NOT IMPL.  │ NOT IMPL.   │ NOT IMPL. (future) │
        └────────────┴────────────┴─────────────┴────────────────────┘
                              │
                              ▼
              AlgoVaultTradeGateway EA (MQL5)  ← the existing bridge
                              │
                              ▼
                    MetaTrader 5 DEMO terminal
                              │
                              ▼
                        Demo broker account
```

Nothing above the provider layer knows a broker exists. Adding cTrader later
means writing one adapter — not touching the terminal, the chart, the AI
surfaces, the risk engine or the UI.

**The Pro Terminal is now the primary professional trading interface.** Every
action it offers — place order, modify SL/TP, partial close, full close, cancel
— goes through `POST /api/trading/execute` → `UnifiedTradingService`. The
legacy `/api/trading/orders` queue is retained unchanged for the Chrome
extension and gateway compatibility; it is not used by the terminal.

---

## 2. What already existed (and was reused, not rewritten)

| Existing asset | How it is reused |
|---|---|
| `MQL5/AlgoVaultTradeGateway/AlgoVaultTradeGateway.mq5` (EA v1.3.0) | The primary MT5 integration point. Untouched. Its command schema (`BUY`, `SELL`, `*_LIMIT`, `*_STOP`, `MODIFY`, `CLOSE`, `PARTIAL_CLOSE`, `CANCEL`) is what the MT5 adapter emits. |
| `app/api/trading/gateway/{register,heartbeat,snapshot,commands,execution,status,token}` | The authenticated HTTPS transport. Read for state, written for commands. No second protocol introduced. |
| `trading_accounts`, `trading_positions`, `trading_orders`, `trading_order_requests` RTDB paths | Written by the gateway EA; read by the MT5 adapter. No schema changes. |
| `lib/gateway.ts` | Per-user gateway bearer tokens (`gateway_users/{token}`, `gateway_tokens_meta/{uid}`) and `hasActiveTradingLicense()`. Unchanged. |
| `lib/risk/risk-engine.ts` | **The** canonical risk engine. The unified service calls `evaluateOrder()` / `normalizeVolume()`; no competing engine was created. |
| `lib/terminal/account.ts` (`deriveAccountMode`) | Same conservative demo/live classification philosophy, mirrored in `classifyMt5Environment`. |
| `components/pro-scalping-terminal/chart-settings.ts` → `ChartPositionView` | Already provider-neutral (`ticket/symbol/side/volume/entry/sl/tp/profit`). Unified positions map onto it with no chart change. |
| `components/terminal/AccountPanel.tsx`, `components/trading/*` | Extended with the provider status panel rather than rebuilt. |
| `lib/trading/{contracts,providers,risk,challenges,feature-flags}.ts` | The existing provider-neutral layer. The new service composes it; it is not a parallel architecture. |
| `app/account/trading-access/page.tsx` | The existing "Trading Accounts" connection page; the provider catalog was added to it. |

---

## 3. Module map

| Path | Role |
|---|---|
| `lib/trading/unified/domain.ts` | Provider-neutral domain types. Pure, importable client- and server-side. |
| `lib/trading/unified/errors.ts` | Normalized `TradingError` model + MT5 retcode → neutral code mapping. |
| `lib/trading/unified/adapter.ts` | `TradingProviderAdapter` interface + `TradingProviderRegistry`. |
| `lib/trading/unified/volume.ts` | Partial-close planning and provider volume rounding. |
| `lib/trading/unified/mt5-demo-provider.ts` | MT5 DEMO adapter over the existing gateway protocol. |
| `lib/trading/unified/mock-provider.ts` | `MockTradingProvider` for tests (never production). |
| `lib/trading/unified/service.ts` | The fail-closed execution pipeline. |
| `lib/trading/unified/store.ts` | RTDB idempotency, execution results, unified account projection, audit trail. |
| `lib/trading/unified/client.ts` | Browser client for the Pro Terminal: `executeUnified`, fresh idempotency keys, phase labels/tones. Never polls, never fakes a fill. |
| `lib/trading/unified/ids.ts` | Crypto-strong random ids (`crypto.getRandomValues`) for `clientRequestId`. |
| `lib/trading/unified/server.ts` | Server-only composition root (`createUnifiedTradingService`, `providerCatalog`). |
| `app/api/trading/accounts/route.ts` | `GET` accounts + provider catalog, `PUT` connection state. |
| `app/api/trading/execute/route.ts` | The single execution endpoint for every channel. |
| `app/api/admin/trading/providers/route.ts` | Admin observability. |
| `components/trading/ProviderConnectionCard.tsx` | Provider catalog + real MT5 demo connection state. |
| `components/terminal/TradingProviderStatus.tsx` | Pro Terminal provider state panel. |
| `app/admin/trading-providers/page.tsx` | Admin page (registered in the existing admin sidebar). |

---

## 4. Connection lifecycle

```
DISCONNECTED → CONNECTING → CONNECTED → DEGRADED → STALE / ERROR → DISCONNECTED
```

Derived server-side from the gateway heartbeat (`lastHeartbeatAt`):

| Age of last heartbeat | State |
|---|---|
| `< 45s` (default) | `CONNECTED` |
| `45s – 90s` | `DEGRADED` |
| `> 90s` | `STALE` — **execution is blocked** |
| never seen | `DISCONNECTED` — execution is blocked |

Every account exposes `lastHeartbeatAt`, `lastSyncAt`, `providerStatus`,
`connection` and `connectionError`. The UI renders these verbatim; it never
optimistically upgrades a stale connection.

Thresholds: `UNIFIED_TRADING_HEARTBEAT_STALE_MS`, `UNIFIED_TRADING_HEARTBEAT_DEGRADED_MS`.

---

## 5. Execution lifecycle (fail-closed)

```
Trading Request
 → Authentication        caller must hold a verified Firebase token
 → Account Ownership     accountId is read server-side; the client cannot name an account it does not own
 → Provider Resolution   adapter is chosen by the account-id NAMESPACE (gateway_ ⇒ MT5), never by client input
 → Feature Flags         UNIFIED_TRADING_ENABLED / MT5_DEMO_ENABLED
 → License Gate          hasActiveTradingLicense(userId) — the same entitlement the
                         legacy route and gateway EA enforce; injectable for tests
 → Demo Enforcement      provider-reported environment must be DEMO
 → Connection State      STALE / DISCONNECTED ⇒ refuse
 → Target Resolution     position/order must exist on that account
 → Risk Engine           canonical lib/risk/risk-engine (protective actions always approved)
 → Idempotency           clientRequestId claimed via an RTDB transaction
 → Provider Execution    adapter maps to the gateway command schema
 → Verification          adapter waits for the EA report, then verifies the ticket exists in synced state
 → Audit                 normalized event appended to tradingAudit/{uid}/{eventId}
```

**Refusal conditions (never fall back to a fake fill):** disconnected account,
stale heartbeat, unknown provider, non-DEMO environment, unauthorized caller,
missing trading license, account not owned, unavailable symbol, trading
disabled, risk rejection, unverifiable provider response, conflicting
idempotency key, incomplete server configuration, or a deployment not
configured demo-only.

### Execution states (terminal vocabulary)

`TradingExecutionStatus` (server terminal states) and the phases the Pro
Terminal renders:

| Status | Meaning | HTTP | Audit action |
|---|---|---|---|
| `SUCCEEDED` | Provider-verified fill, position/order synced | 200 | `EXECUTION_SUCCEEDED` |
| `EXECUTED_PENDING_SYNC` | **The broker confirmed the fill** (ticket + price + volume captured) but the synced position mirror has not appeared yet | 200 | `EXECUTION_PENDING_SYNC` |
| `REJECTED` | Refused before or at the provider (validation, risk, demo-only, idempotency, provider rejection) | 4xx | `EXECUTION_REJECTED` |
| `FAILED` | Execution attempt failed with **no** provider confirmation (transport error, no ticket) | 5xx | `EXECUTION_FAILED` |
| `ACCEPTED` | Claimed, result pending | — | — |

The race this fixes: previously, a provider-confirmed fill whose snapshot had
not synced within the verification window was classified `FAILED`, inviting a
retry that could double a real position. The MT5 adapter now polls the synced
position/order state (`verifyInSyncedState`, up to
`UNIFIED_TRADING_VERIFICATION_TIMEOUT_MS`, first retry ≥ 2s) and returns
`EXECUTED_PENDING_SYNC` with `providerRef`/`filledVolume`/`filledPrice` when
the broker's report arrived but the mirror did not. A terminal state without a
provider confirmation is still `FAILED`.

Audit events carry `executionType`, `requestedPercentage` (for partial closes)
and `providerRef` (the broker ticket) in addition to the base fields.

---

## 6. Idempotency

Every request carries a `clientRequestId` (8–128 chars) and a `correlationId`.
The service stores a SHA-256 hash of the semantic payload.

- **First use** → `FRESH`: the request proceeds.
- **Same key, same payload** → `REPLAY`: the original `TradingExecutionResult`
  is returned with `duplicate: true` and HTTP 200. No second trade.
- **Same key, different payload** → `CONFLICT` → `DUPLICATE_REQUEST` (409).
- **Same key while still in flight** → `DUPLICATE_REQUEST` (409); the caller
  waits for the original rather than re-sending an unsafe execution.

Claiming uses an RTDB `transaction()` on
`tradingExecutionRequests/{uid}/{clientRequestId}`, so concurrent duplicates
cannot both execute.

---

## 7. Partial close semantics

Partial close is a **volume** operation. The percentage is always a share of
the position's **CURRENT VOLUME** — never of profit or balance. For a position
of 1.00 lot with +100 floating P/L, closing 30% means closing ~0.30 lot and
realizing the P/L that slice earned (+30). The remainder keeps 0.70 lot and
+70. 50% of a 0.20 lot position closes exactly 0.10 lot, whatever the P/L.

It is **never** `$100 − 30% = $70 booked as a −$30 loss`.

Implementation: `planPartialClose()` in `lib/trading/unified/volume.ts`
rounds the close volume **down** onto the provider's lot step, clamps to
`[minVolume, remaining]`, and settles into a full close when the remainder
would fall below the provider minimum (so no unclosable stub is left behind).
`proportionalProfit()` is a reporting helper only — it never books a trade.

---

## 8. Security model

- **No broker credentials anywhere.** AlgoVault never handles an MT5 login
  password. The EA runs inside the user's terminal; only a per-user opaque
  gateway bearer token (`gateway_users/{token}`, server-write-only) crosses the
  wire.
- **No secrets to the browser.** The provider token route returns the token to
  the authenticated owner only; admin observability never returns it.
- **Nothing trusted from the client**: not `userId`, not `provider`,
  not `environment`, not `accountId` ownership, not prices, not permissions.
- **Demo-only is server-derived.** A client sending `environment: "LIVE"` is
  rejected with `LIVE_EXECUTION_DISABLED` (403). The environment actually used
  comes from the provider's own account record.
- **New RTDB paths are server-write-only** (`tradingUnifiedAccounts`,
  `tradingExecutionRequests`, `tradingExecutionResults`, `tradingAudit`):
  clients get read access to their own namespace, admin has full access.
- **Audit** records user, account, provider, environment, request id,
  correlation id, action, symbol, volume, statuses and the normalized error
  code — and never passwords, tokens or keys.

---

## 9. RTDB layout (Firebase RTDB only)

```
trading_accounts/{uid}/{gateway_login}          # existing — EA register + heartbeat
trading_positions/{uid}/{accountId}/{ticket}    # existing — EA snapshot
trading_orders/{uid}/{accountId}/{ticket}       # existing — EA snapshot
trading_order_requests/{uid}/{clientRequestId}  # existing — command queue (written by the adapter)

tradingUnifiedAccounts/{uid}/{accountId}        # NEW — provider-neutral projection
tradingExecutionRequests/{uid}/{clientRequestId}# NEW — idempotency records
tradingExecutionResults/{uid}/{clientRequestId} # NEW — execution results
tradingAudit/{uid}/{eventId}                    # NEW — audit trail (500-event cap)
```

Write frequency is bounded: accounts update on heartbeat (15s), positions and
orders on the gateway snapshot cadence (30s), audit only on execution events.

---

## 10. Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `TRADING_EXECUTION_MODE` | `DEMO` | Only `DEMO`/`DEMO_ONLY`/absent execute. Any other value disables **all** execution. |
| `UNIFIED_TRADING_ENABLED` | `true` | Master switch for the unified layer. |
| `MT5_DEMO_ENABLED` | `true` | MT5 demo connector. |
| `MT5_GATEWAY_URL` | `https://algovault.com` | Platform base URL the EA posts to. |
| `MT5_GATEWAY_HEARTBEAT_INTERVAL_SECONDS` | `15` | EA heartbeat cadence. |
| `UNIFIED_TRADING_HEARTBEAT_DEGRADED_MS` | `45000` | CONNECTED → DEGRADED threshold. |
| `UNIFIED_TRADING_HEARTBEAT_STALE_MS` | `90000` | DEGRADED → STALE (execution blocked). |
| `UNIFIED_TRADING_EXECUTION_TIMEOUT_MS` | `20000` | Max wait for the EA execution report. |
| `UNIFIED_TRADING_EXECUTION_POLL_MS` | `750` | Poll interval while waiting for the report. |
| `UNIFIED_TRADING_VERIFICATION_TIMEOUT_MS` | `12000` | Max wait for the synced position mirror after a provider-confirmed fill; beyond it the outcome is `EXECUTED_PENDING_SYNC`, never `FAILED`. |

Hard-off, not configurable: `MT4_DEMO_ENABLED`, `CTRADER_DEMO_ENABLED`,
`TRADINGVIEW_EXECUTION_ENABLED`, `ALGOVAULT_BROKER_ENABLED`, and live trading.

---

## 11. MT5 demo setup (manual)

1. Activate Trading Access (`/account/trading-access`) so a gateway token can be minted.
2. Copy the gateway token from **Trading Access → Gateway Token**.
3. Install `AlgoVaultTradeGateway.mq5` in MetaEditor, compile to
   `MQL5/Experts/AlgoVaultTradeGateway.ex5`.
4. In MT5: **File → Open Data Folder** → paste into `MQL5/Experts`.
5. Open **Tools → Options → Expert Advisors** and enable *Allow automated trading*
   and *Allow WebRequest for listed URLs*, then add the AlgoVault origin.
6. Attach the EA to any chart, set `GatewayToken` (step 2), `PlatformURL`
   (`https://algovault.com`, no trailing slash), leave `MagicNumber` as-is, and
   press OK.
7. Confirm the chart panel shows `connected`. **/admin/trading-providers** should
   show the account with a live heartbeat.

### Manual end-to-end demo test (NOT VERIFIED in CI — no MT5 terminal here)

Use the smallest volume the symbol allows (0.01 lot on EURUSD).

| # | Step | Expected |
|---|---|---|
| 1 | Connect | Account appears as `CONNECTED`, heartbeat fresh |
| 2 | Authenticate | Gateway token accepted; register returns `authorized: true` |
| 3 | Account | balance / equity / margin / free margin / margin level populated |
| 4 | Symbols & quote | Gateway supplies symbols; **quotes come from the AlgoVault market-data service, not MT5** |
| 5 | Place order | `POST /api/trading/execute` (`PLACE_ORDER`, 0.01 BUY) → `SUCCEEDED` with `providerRef` |
| 6 | Verify | Ticket present in `trading_positions/{uid}/{accountId}` |
| 7 | Modify | `MODIFY_POSITION` with SL/TP reflected on the next snapshot |
| 8 | Partial close | `PARTIAL_CLOSE` `percentage: 30` on 0.10 lot → 0.03 closed, 0.07 open |
| 9 | Verify remainder | Same ticket, volume 0.07 |
| 10 | Close | `CLOSE_POSITION` → position gone, deal in history |
| 11 | History | `GET /api/trading/accounts` history reflects the fill |
| 12 | Idempotency | Replay the same `clientRequestId` → `duplicate: true`, no second trade |
| 13 | Slow snapshot (optional) | Stop the EA right after step 5 until `UNIFIED_TRADING_VERIFICATION_TIMEOUT_MS` elapses → result must be `EXECUTED_PENDING_SYNC` (HTTP 200, ticket in `providerRef`), **not** `FAILED`; after the EA restarts the position appears on the next snapshot |
| 14 | Disconnect | Stop the EA → state becomes `STALE`, then execution returns 409 |

**These steps have NOT been executed against a live MT5 terminal in this
phase.** The gateway protocol was previously verified end-to-end with a real
MT5 demo account, but the Pro-Terminal rewiring itself was verified in this
session only by automated tests (`npm run test:unified-trading`, 86 checks),
typecheck and lint — **no manual MT5 terminal test was performed here** (no MT5
installation or demo credentials in this environment). The table above is a
documented procedure, not a verified result.

---

## 12. Testing

```
npm run test:unified-trading   # 86 checks
npm run test:trading           # provider-neutral suite (32 checks)
```

`lib/trading/unified/__tests__/unified-trading.test.ts` covers the provider
interface, the service pipeline, account ownership, the trading-license gate
(allow and deny), demo-only enforcement (client-sent `environment: "LIVE"` and
an account classified LIVE), feature-flag blocking, idempotency (replay /
conflict / in-flight), risk rejection, position and order retrieval, BUY and
SELL market execution, partial close correctness (30% of 1.00 and 50% of 0.20
— percentage of current volume) and percentage/volume validation, full close,
order cancel, provider error normalization, disconnect, stale connections,
execution verification — including the **provider-confirmed-before-snapshot
race**: a stub adapter returning `EXECUTED_PENDING_SYNC` must map to HTTP 200,
audit `EXECUTION_PENDING_SYNC` and a replayable persisted result, while a
transport failure stays `FAILED` with a non-2xx status — and audit logging.

The partial-close test is explicit about the failure mode this phase is meant
to prevent:

```
seed: 1.00 lot, +100 floating
partial close 30%  →  0.30 lot closed, realized +30
remainder         →  0.70 lot, +70 still floating, position still open
assert: no deal with profit −70, no synthetic loss
```

The `MockTradingProvider` makes all of this testable with no MetaTrader
installation. It reports `operational: false` and is never registered in the
production composition root.

---

## 13. Future providers

### MT4 — contract ready, connector NOT IMPLEMENTED
The adapter contract, registry, error model, service and UI entries exist. An
`Mt4ProviderAdapter` would mirror `Mt5DemoProvider`: same gateway command
schema, same snapshot reads. The MQL5 EA uses `CTrade`, `PositionInfo`,
`OrderInfo`, `AccountInfo` — porting to MQL4 requires replacing those with
`OrderSend`/`OrderClose`/`OrderModify` and the `OrdersTotal`/`OrderSelect`
family. No service or UI change is required.

### cTrader — contract ready, connector NOT IMPLEMENTED
Required before implementation: an Open API account (client id / secret /
refresh token, stored server-side only), the Open API host per environment
(demo vs live), account-info + symbol-info + dealing endpoints for market data,
and a dealing/session model for execution and verification. No cTrader endpoint
has been called or invented here.

### TradingView — interaction channel, not the execution core
The Chrome extension and TradingView MCP will call
`POST /api/trading/execute` with the same `ExecuteInput` shape plus context
(detected symbol, timeframe, strategy/indicator context, user authorization).
Execution context stays server-side and requires the user's explicit consent
and a connected account. No TradingView trading is implemented or simulated.

### AlgoVault Brokerage — architecture only
A future `AlgoVaultBrokerProvider` would implement the same
`TradingProviderAdapter`. The terminal, chart and AI surfaces do not change
when the execution venue does — that is the point of the abstraction.

---

## 14. Chart

The AlgoVault native chart (`ProTerminalChart`) is untouched and remains the
primary chart. It already renders entry / SL / TP / pending-order lines from
`ChartPositionView` using the chart series' own coordinate system (price/time),
not screen coordinates. Because unified positions normalize to
`{ ticket, symbol, side, volume, entry, current, sl, tp, profit }`, the same
chart works unchanged for MT5, MT4, cTrader or a future AlgoVault broker.

MT5 does not currently stream quotes or candles through the gateway, so the
chart keeps its existing AlgoVault market-data feed. When an adapter gains
`getQuote`/`getCandles`, it plugs in behind `MarketDataProvider` without a chart
rewrite.

---

## 15. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Account not listed | EA never registered | Check the token and WebRequest allow-list in MT5 options |
| `STALE` state | EA or terminal stopped | Restart the EA; execution is blocked while stale |
| `ACCOUNT_NOT_CONNECTED` | No heartbeat | Confirm the platform URL is the correct origin |
| `LIVE_EXECUTION_DISABLED` | Non-demo account | Connect a MetaTrader **demo** account; live is hard-disabled |
| `PROVIDER_NOT_CONFIGURED` | Flag off or adapter missing | Check `MT5_DEMO_ENABLED` |
| `DUPLICATE_REQUEST` | Key reused or still in flight | Use a new `clientRequestId` per logical order |
| `EXECUTION_TIMEOUT` | EA did not confirm | Check terminal logs and that auto-trading is enabled |
| `EXECUTED_PENDING_SYNC` | Broker confirmed the fill; the synced mirror is late | Nothing to fix — the position appears on the next snapshot; never re-submit the same `clientRequestId` |
| `PERMISSION_DENIED` (403) on execute | No active trading access license | Activate Trading Access on `/account/trading-access` |
| Order reported but no position | Verification failed | Inspect the audit event; nothing was faked |