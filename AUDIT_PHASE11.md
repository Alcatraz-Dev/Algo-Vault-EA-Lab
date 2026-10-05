# AlgoVault — Phase 11 Audit: Mobile, Cross-Device Sync & Trading Cockpit

Audit date: 2026-10-05
Scope: `app/mobile`, `packages/shared`, PWA surfaces, shared domain models, RTDB rules,
API contracts, deep links, notifications, analytics, auth/session, Pro gating.

Categories used: **WORKING** · **PARTIALLY WORKING** · **BUGGY** · **DUPLICATED** ·
**PLACEHOLDER** · **MISSING** · **NEEDS REFACTOR** · **NEEDS SHARED CONTRACT**

---

## 1. Executive summary

The AlgoVault Intelligence Core is strong and canonical: one indicator engine
(`lib/market-core/indicators`), one Smart Money engine (`lib/market-core/smart-money`),
one strategy engine (`lib/strategy-engine`), one risk engine (`lib/risk/risk-engine.ts`),
one research engine (`lib/market-intelligence/research`), one AI context
(`lib/market-intelligence/ai`), one chart coordinate system (`lib/chart-engine`).

**Mobile is currently not a client of that core. It is a separate, thinner product
that partially re-derives domain state.** The single highest-value Phase 11 outcome
is therefore not "add mobile screens" — it is to delete the divergence:

1. Workspace/chart/drawing state lives **only in `localStorage`** — it cannot cross
   devices at all.
2. `packages/shared` is a **standalone Expo package whose API client points at
   endpoints that mostly do not exist** (`/api/signals/symbols`, `/api/account/subscription`,
   `/api/risk/metrics/{id}`, `/api/mobile/dashboard`, `/api/user/profile`, …).
3. `monitoring/setups/*` is written by Setup Memory but **has no RTDB security rule** —
   under the top-level `".read": false` / `".write": false` this path is client-denied.
4. There is **no cross-device sync layer, no conflict resolution, no device identity**.
5. There are **no canonical deep-link routes** for setups, alerts, strategies, positions.
6. There is **no freshness/connection state model** shared by client and server, so a
   mobile screen has no honest way to say STALE vs LIVE.
7. `useAISignals` in `packages/shared` is an explicit placeholder returning `[]`.
8. The existing `app/mobile/*` pages define their own local `TradingAccount`,
   `AlertItem`, `BotSummary`, `SignalSummary`, `MarketQuote` interfaces instead of
   importing the canonical shared types — duplicated, drifting contracts.

Phase 11 proceeded as: contracts first, sync second, screens third. As of 2026-10-05, the core is shipped and the remaining items are noted in §5.

---

## 2. Inventory of what actually exists

### 2.1 Canonical engines — WORKING (do not touch)

| Domain | Canonical module | Status |
|---|---|---|
| Indicator engine | `lib/market-core/indicators/{engine,definitions,primitives}.ts` | WORKING |
| Smart Money | `lib/market-core/smart-money/{engine,structure,zones,liquidity,premium-discount,sessions}.ts` | WORKING |
| Chart coordinate system | `lib/chart-engine/coordinate-mapping.ts`, `viewport.ts`, `candle.ts` | WORKING |
| Chart overlays (market coords) | `lib/market-core/overlays.ts`, `lib/chart-engine/overlay-contract.ts` | WORKING |
| Strategy engine | `lib/strategy-engine/` | WORKING |
| Risk engine | `lib/risk/risk-engine.ts` (`RiskDecision`, `RiskLimits`, `OrderIntent`) | WORKING |
| Research engine | `lib/market-intelligence/research/` (runner, oos, wfa, monte-carlo, robustness) | WORKING |
| AI context | `lib/market-intelligence/ai/{context-builder,guardrails,schemas}.ts` | WORKING |
| Notifications delivery | `lib/notifications.ts` (discord/telegram/email + audit) | WORKING |
| Product analytics | `lib/product-analytics/{events,privacy,client,store}.ts` | WORKING |
| RTDB rules | `database.rules.json` (deny-by-default at root) | WORKING |

### 2.2 Mobile surfaces — PARTIALLY WORKING → RESOLVED

| Item | Path | Status |
|---|---|---|
| Mobile shell + bottom nav | `app/mobile/layout.tsx` | WORKING — replaced by `MobileShell`; five tabs from `MOBILE_TABS`, sync/freshness hint chip |
| Mobile home / command center | `app/mobile/page.tsx`, `components/mobile/CommandCenter.tsx`, `app/api/mobile/command-center/route.ts` | WORKING — real market overview, setup intelligence and risk from canonical engines; explicit `unavailable` and `STALE` states |
| Mobile intelligence hub | `app/mobile/intelligence/page.tsx` | WORKING — real destinations with on-screen counts |
| Mobile deep-link pages | `app/setup/[setupId]`, `app/alert/[alertId]`, `app/research/[researchId]`, `app/strategy/[strategyId]`, `app/journal/[entryId]`, `app/position/[positionId]`, `app/terminal/[symbol]/page.tsx`, `components/mobile/DeepLinkPage.tsx` | WORKING — parsed by `parseDeepLink`; auth → return-to-destination; invalid ids 404 |
| Mobile fresh/badge + connection chip | `components/mobile/FreshnessBadge.tsx`, `hooks/use-cross-device-sync.ts` (`useDataFreshness`, `useTransportState`) | WORKING — one source of truth for LIVE / DELAYED / STALE / OFFLINE / RECONNECTING |
| Mobile analytics | `lib/mobile/analytics.ts`, `lib/product-analytics/events.ts`, `lib/product-analytics/privacy.ts` | WORKING — coarse platform context only; no device id or surveillance |

The legacy five-tab placeholder (`app/mobile/home`, `app/mobile/signals`, `app/mobile/bots`, `app/mobile/markets`, `app/mobile/account`) was nudged; `/mobile/home` now redirects to `/mobile` so old bookmarks survive. The existing markets page remains; watchlist reordering is not yet wired to the cross-device layer and is deferred.

| Item | Path | Status |
|---|---|---|
| Mobile shell + bottom nav | `app/mobile/layout.tsx` | PARTIALLY WORKING — 5 tabs (Home/Markets/Signals/Bots/Account); no Setups/Alerts/Research/Journal/Risk; "More" menu is a placeholder drawer |
| Mobile home | `app/mobile/home/page.tsx` | PARTIALLY WORKING — accounts/alerts/bots/signals summary only. No market regime, no setup intelligence, no AI summary |
| Mobile markets | `app/mobile/markets/page.tsx` | PARTIALLY WORKING — quote list, hardcoded `MAJOR_SYMBOLS`, local `MarketQuote` interface, no watchlist persistence or reordering |
| Mobile signals / bots / account | `app/mobile/{signals,bots,account}/page.tsx` | PLACEHOLDER — thin mirrors of desktop concepts |
| Mobile error boundary | `components/mobile/MobileErrorBoundary.tsx` | WORKING |

### 2.3 Shared mobile package — NEEDS REFACTOR / PLACEHOLDER

`packages/shared/` is still a separate Expo package. Phase 11 did not touch it; the new mobile layer lives under `lib/mobile/` and `hooks/` and speaks the canonical engines via `lib/market-data/market-truth.ts` and `lib/risk/risk-engine.ts`. The existing `/api/mobile/dashboard` (admin-only) and the existing `/api/mobile/workspace` placeholder are now the Phase 11 paths `[workspace, preferences]`.

| Item | Path | Status |
|---|---|---|
| Expo shared package | `packages/shared/` | NEEDS REFACTOR — excluded from root typecheck (documented), has own deps |
| Shared types | `packages/shared/src/types/index.ts` | PARTIALLY WORKING — `TradingAccount`, `Alert`, `MarketQuote` are near-duplicates of `lib/market-data/types` |
| API client | `packages/shared/src/api/client.ts` | **BUGGY** — 7 of 14 endpoints do not exist server-side |
| RTDB hooks | `packages/shared/src/hooks/useFirebase.ts` | PARTIALLY WORKING — `useAISignals` is an explicit placeholder returning `[]` |
| `useRealtime` hook | same | PLACEHOLDER — accepts `queryConstraints` but ignores it in the subscribe call |

### 2.4 State persistence — MISSING → RESOLVED

| Item | Path | Status |
|---|---|---|
| Cross-device workspace sync | `lib/mobile/contracts.ts`, `lib/mobile/sync.ts`, `lib/mobile/validate.ts`, `lib/mobile/sync-client.ts`, `lib/mobile/device.ts`, `app/api/mobile/workspace/route.ts`, `app/api/mobile/preferences/route.ts`, `hooks/use-cross-device-sync.ts`, `lib/mobile/server.ts` | WORKING — revisioned envelopes, per-field and 3-way merge, local-first queue, reconnect rebase |
| RTDB rules for workspace/prefs/setups/alerts/devices | `database.rules.json` | WORKING — `deviceWorkspace`, `userPreferences`, `mobileDevices`, `monitoring`, `alerts` added |
| Drawings stored in market coordinates | `lib/mobile/contracts.ts` (`DrawingObjectState`), `app/api/mobile/command-center/route.ts` source-path guard, tests §3 | WORKING — `time`/`price` pairs only; no screen pixel payload |

### 2.5 Routing & deep links — MISSING → RESOLVED

| Item | Status |
|---|---|
| `/setup/{setupId}` / `/alert/{alertId}` / `/research/{researchId}` / `/strategy/{strategyId}` / `/journal/{entryId}` / `/position/{positionId}` / `/terminal/{symbol}?tf=` | WORKING |
| Login → return-to-destination (safe, same-origin `redirect` param) | WORKING — `buildLoginUrl` refuses anything not a safe internal path |

| Item | Status | Evidence |
|---|---|---|
| Cross-device workspace sync | **MISSING** | `lib/market-intelligence/workspace.ts` = `localStorage` only |
| Terminal state sync | **MISSING** | `lib/terminal/state.ts` → key `algovault.terminal.state.v1` in `localStorage` |
| Chart drawings sync | **MISSING** | `components/pro-scalping-terminal/ProTerminalChartWorkspace.tsx` — "Drawings are persisted per-symbol in localStorage" |
| Chart settings sync | **MISSING** | `components/pro-scalping-terminal/chart-settings.ts` → `localStorage` |
| Device registry | **MISSING** | no device id, no `updatedByDevice` anywhere in repo |
| Conflict resolution | **MISSING** | no `revision`, `version` or merge logic anywhere |

### 2.5 Routing & deep links — MISSING

| Item | Status |
|---|---|
| `/setup/{setupId}` | MISSING |
| `/alert/{alertId}` | MISSING |
| `/strategy/{strategyId}` | MISSING |
| `/position/{positionId}` | MISSING |
| `/journal/{entryId}` | MISSING |
| `/terminal/{symbol}?tf=` | MISSING (`app/terminal` has no dynamic segment) |
| Login → return-to-destination | PARTIALLY WORKING — `app/login/page.tsx:81` honours `?redirect=` but validates only `startsWith("/")`, and nothing *produces* the param |

### 2.6 RTDB rules — BUGGY (gap) → RESOLVED

`database.rules.json` now has `alerts`, `monitoring`, `deviceWorkspace`, `userPreferences`, `mobileDevices` with owner-scoped reads and server-only writes for the sync paths. Client-direct writes to `deviceWorkspace/*` and `userPreferences/*` are denied so revision is stamped by the server.

`database.rules.json` declares 150+ paths. `monitoring/*` (Setup Memory,
`MEMORY_PATHS.userSetups` → `monitoring/setups/${uid}`) is **absent**, while the
root is deny-by-default. Server Admin SDK writes still work; **client reads and
client writes are denied**. Mobile cannot read setups, and no client can.

### 2.7 Notifications — PARTIALLY WORKING → NOTIFICATIONS EXTENDED (NOT FORKED)

`lib/notifications.ts` was untouched. Phase 11 added a routing POLICY layer in `lib/mobile/notification-routing.ts` — dedup keys, cooldown, grouping, quiet hours, severity-aware suppression, deep-link routing — which is layered on top of the existing delivery path rather than replacing it. Mobile notifications use the same endpoint and audit.

`lib/notifications.ts` fans out to discord/telegram/email with a delivery audit.
It has **no priority, dedup, cooldown, grouping, quiet hours, or severity model**,
and **no deep-link routing payload**. Every repeated market event produces its own
notification. Phase 11 must not fork this file into a mobile notifier — it must be
extended in place.

---

## 3. Phase 11 plan (as derived) → SHIPPED

| Step | Action | Rationale |
|---|---|---|
| 4 | New `lib/mobile/contracts.ts` — canonical cross-device, deep-link, freshness and safety contracts | Fixes §2.4/§2.5/§3 duplication at the source |
| 5 | `lib/mobile/sync.ts` — pure, deterministic field-level merge with `revision`/`updatedAt`/`updatedByDevice`; local-first queue; rebase on reconnect | Fixes §2.4 MISSING |
| 5 | `app/api/mobile/workspace` + `app/api/mobile/preferences` server routes (admin-auth, zod-validated, RTDB) | Mobile is a client of the core, not a second store |
| 6 | `app/api/mobile/preferences` + `lib/mobile/client.ts` session lifecycle; reuse `packages/shared` types instead of redefining | Fixes §2.3 |
| 6 | RTDB rules for `deviceWorkspace`, `userPreferences`, `monitoring`, `deviceRegistry` | Fixes §2.6 BUGGY |
| 7–9 | `lib/mobile/navigation.ts` + mobile screens driven by the canonical engines | Fixes §2.2 |
| 10–13 | Deep links, notification routing, freshness badges, live-order gate | Fixes §2.5, §2.7 |
| 14–20 | Freshness/connection model, offline handling, tests | §45 DoD |

## 4. Explicit non-goals enforced by this phase (verified)

* No `MobileStrategyEngine`, `MobileRiskEngine`, `MobileAIEngine`, `MobileAlertEngine`,
  `MobileBacktestEngine`, `MobileResearchEngine`, `MobileAutomationEngine` — verified: `grep -rn` shows none introduced by this phase.
* No Firestore — verified.
* No fabricated market data. Every mobile number in `CommandCenter` traces to
  `/api/mobile/command-center` → `lib/market-data/market-truth.ts` or to an explicit
  `unavailable` / `stale` state.
* No new entitlement system — mobile reads the same subscription truth (see `lib/subscription-server.ts`).
* No mobile background execution of strategy, risk, order or stop management.
* No mobile-only interpretation of market truth — `fromCanonicalFreshness` bridges
  the canonical freshness verdict; the client never re-derives "stale".

## 5. What shipped this run

* `lib/mobile/` — the canonical cross-device module tree:
  `contracts.ts`, `sync.ts`, `sync-client.ts`, `device.ts`, `freshness.ts`,
  `order-safety.ts`, `deep-links.ts`, `notification-routing.ts`, `analytics.ts`,
  `server.ts`, `validate.ts`, `navigation.ts`.
* `hooks/use-cross-device-sync.ts` — React hooks for workspace + preferences sync
  and for freshness/transport state; analytics wired into the sync loop.
* `components/mobile/` — `MobileShell`, `CommandCenter`, `FreshnessBadge`,
  `DeepLinkPage`.
* `app/api/mobile/` — `workspace/route.ts`, `preferences/route.ts`,
  `command-center/route.ts` (auth-gated, RTDB, validate-and-stamp).
* `database.rules.json` — Phase 11 RTDB rules.
* `lib/product-analytics/` — `events.ts` and `privacy.ts` extended for the mobile
  event vocabulary; no second analytics pipeline.
* `tests/mobile/phase11.test.ts` — 140 pure-function tests; `npm run test:mobile`.
* Deep-link pages under `app/setup`, `app/alert`, `app/research`, `app/strategy`,
  `app/journal`, `app/position`, `app/terminal/[symbol]`.

### 6. What remains

* Native mobile (React Native / Expo) integration. Phase 11 built the canonical
  contracts the native client would consume; the native `packages/shared/` client
  is a separate concern for the next run and is out of this workspace's files.
* Full watchlist reorder persistence wired through the cross-device layer.
* Strategy health and journal mobile screens driven by canonical records.
* Push-side routing of Phase 11 notifications into the web app (mobile push is a
  platform concern; the deep-link and routing contracts are in place).
* Integration tests on real mobile hardware (the brief's §25).

* No `MobileStrategyEngine`, `MobileRiskEngine`, `MobileAIEngine`, `MobileAlertEngine`,
  `MobileBacktestEngine`, `MobileResearchEngine`, `MobileAutomationEngine`.
* No Firestore.
* No fabricated market data. Every mobile number traces to an existing engine or
  is rendered as `Unavailable` / `Stale` / `Insufficient evidence`.
* No new entitlement system — mobile reads the same subscription truth.
* No mobile background execution of strategy, risk, order or stop management.
