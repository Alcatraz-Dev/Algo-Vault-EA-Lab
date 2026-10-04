# AlgoVault Performance Arena

**Status:** shipped (platform-rewards only) · **Database:** Firebase RTDB only · **Cash rewards:** disabled by design

The Performance Arena is a simulated trading challenge environment: users join
challenges that grant **virtual capital**, trade **simulated positions** at
server-resolved live quotes under **configurable rules**, and earn **non-cash
platform rewards** (AV Points, Pro days, AI/research/backtest credits, badges)
plus a verified in-product performance history.

> Simulated trading only. Virtual capital has no cash value. Past simulated
> performance does not guarantee future results. AI analysis is informational
> and may be wrong. Challenge results do not guarantee real-world trading
> success, employment, investment capital, or monetary income.

---

## 1. Architecture

```
lib/performance-arena/            domain (pure engines → store → service)
  types.ts                        all domain models + canonical disclaimers
  money.ts                        integer-cents / price-micros / centi-lots math
  flags.ts                        server env feature flags (cash = OFF default)
  policies.ts                     shipped challenge + reward policies, validation
  state-machine.ts                lifecycle transitions (invalid → throw)
  metrics.ts                      equity / drawdown / daily loss / consistency
  execution.ts                    fills, cost model, marks, SL/TP triggers
  rules.ts                        deterministic rule engine + pre-trade gate
  settlement.ts                   pass/fail/expiry verdicts + result building
  guardian.ts                     Challenge Guardian insights + AI prompt/parser
  rewards.ts                      idempotent reward ids, wallet, points spend
  eligibility.ts                  jurisdiction/eligibility layer (cash DISABLED)
  payout.ts                       future cash adapter interfaces (no provider)
  fraud.ts                        privacy-conscious abuse detectors
  leaderboard.ts                  composite scoring (never raw profit)
  profile.ts                      trader performance profile aggregation
  compatibility.ts                strategy ↔ challenge-rule compatibility
  billing.ts                      pure Stripe/order binding verifier
  store.ts                        RTDB persistence (Admin SDK, server-only)
  service.ts                      orchestration — the ONLY writer of arena state
  admin-reads.ts                  admin read helpers
  index.ts                        public surface

app/api/performance-arena/*       user routes (bearer auth, owner-scoped)
app/api/admin/performance-arena/* admin routes (requireAdmin)
app/performance-arena/*           landing, catalog, detail, dashboard, leaderboard, profile
app/admin/performance-arena       admin center (analytics/challenges/rewards/fraud)
components/performance-arena/*    UI components (render server numbers only)
```

**Layering rule:** pure engines are UI-free and Firebase-free; `store.ts` is the
only RTDB touchpoint; `service.ts` is the only writer. React components never
calculate rules, balances or rewards — they render server responses.

### Reused existing infrastructure

| Concern | Canonical module reused |
|---|---|
| Auth | `lib/admin-auth.ts` (`authenticate`, `requireAdmin`) |
| Pro entitlement | `lib/strategy-lab/license.ts` `checkAccess` (same gate as Strategy Lab/Research) |
| Live quotes | `lib/market-data/tradingview-live.ts` (`tradingViewLivePriceCache`, Biquote → TradingView scanner) |
| Symbol specs / cost conventions | `lib/ai-signals/symbol-specs.ts` + Strategy Lab cost model (spread, 2-leg slippage, commission/lot) |
| Sessions / market-open | `lib/analytics/sessions.ts` |
| Chart | native `components/tradingview/TradingChart` (no external chart) |
| AI | `lib/ai/router.ts` `defaultRouter` (never a second LLM client) |
| Scalping Terminal | additive `ChallengeContextBar` (read-only) |
| Strategy Research | additive `CompatibilityPanel` + `/api/performance-arena/compatibility` |
| Design system | `AppShell` / `AdminShell` / `components/ui/*`, DESIGN.md conventions |
| Test convention | jiti runner (`scripts/jiti-tsrun.mjs`), no vitest |

---

## 2. Domain model (strongly typed, integer money)

- **Money:** balances/PnL/fees are **integer cents**; prices are **integer
  price-micros** (×1e6); sizes are **integer centi-lots** (×100). Every
  transition rounds **once**, half-away-from-zero (`money.ts`). No accumulated
  floating-point balances anywhere.
- `ChallengeDefinition` → catalog entry (policy + access model + reward policy id).
- `ChallengePolicy` → fully configurable rules (see §3). Snapshotted onto the
  attempt at join — **rules never drift mid-run**.
- `ChallengeAttempt` → lifecycle state + trading-day/daily-trade accounting.
- `VirtualAccount` → starting/balance/equity/peak/realized/unrealized/day-start.
- `ChallengeTrade` → fill record with cost breakdown, stop/TP, risk, exit.
- `RuleEvent` / `ChallengeEvent` → structured, immutable audit records.
- `ChallengeMetrics` → computed snapshot (`dataQuality: fresh|stale`).
- `ChallengeResult` / `PerformanceReport` → settlement verdict + report.
- `RewardPolicy` / `RewardLedgerEntry` / `CreditWallet` → rewards.
- `RewardEligibility` / `Payout*` → future cash layer (architecture only).
- `LeaderboardSnapshot`, `TraderPerformanceProfile`, `FraudFlag`.

---

## 3. Challenge policies

Everything is configuration — no rule values in UI code:

```
startingBalanceCents, profitTargetPct,
maxDrawdownPct + maxDrawdownMode (static|trailing),
dailyLossLimitPct + dailyLossBase (starting_balance|day_start_equity),
minTradingDays, maxTradingDays, maxCalendarDays,
allowedMarkets, allowedSymbols, allowedSessions, tradingHours,
weekendTrading, newsTrading, leveragePolicy.maxLeverageRatio,
maxConcurrentPositions, maxDailyTrades, maxRiskPerTradePct,
maxPositionPctOfEquity, positionSizePolicy,
consistency { required, maxSingleDayPnlSharePct, minTradesForConsistency },
strategyRestrictions, costModel { commissionPerLotCents, slippagePips, useTypicalSpread },
warningUtilizationPct (default 80), dailyLossBreachAction (fail|pause),
autoSettleOnTarget
```

Shipped practice and Pro tiers are available from configuration. Paid tier
records are seeded as disabled `DRAFT` products with no price. Admins must set
an explicit positive integer `priceCents` before publishing; no example fee is
used as a real price. Paid checkout remains server-disabled by default until
the deployment owner verifies the existing Stripe configuration and webhook
setup.

Server-side validation (`validateChallengePolicy` / `validateDefinition`)
rejects invalid policies with structured errors (fail-closed).

---

## 4. Lifecycle

```
DRAFT → AVAILABLE → ACTIVE ⇄ PAUSED → PASSED | FAILED | EXPIRED | CANCELLED → ARCHIVED
```

- Explicit transition table (`state-machine.ts`); illegal moves throw
  `InvalidTransitionError` before anything persists.
- Settlement uses an RTDB **status CAS** — only one caller can settle, which is
  also what makes reward granting exactly-once.
- Status changes and settlements emit immutable `ChallengeEvent`s.

**Settlement verdict priority:** calendar expiry → EXPIRED; drawdown breach →
FAILED; daily-loss breach → FAILED (or pause per policy); target + min days +
flat positions → PASSED (consistency gate applied when required).

---

## 5. Rule engine

`rules.ts` emits structured events with `ruleId, severity, currentValue,
threshold, percentageUsed, unit, message, timestamp, blocking`:

- `DAILY_LOSS_WARNING/BREACH`, `DRAWDOWN_WARNING/BREACH`,
  `PROFIT_TARGET_REACHED`, `MIN_TRADING_DAYS_REACHED`, `CONSISTENCY_WARNING`,
  `TRADING_HOURS_VIOLATION`, `POSITION_SIZE_VIOLATION`,
  `MAX_POSITIONS_VIOLATION`, `RULE_BLOCKED` (pre-trade), `CHALLENGE_EXPIRY`.

**Fail-closed data policy:** BREACH events are only produced from `fresh`
snapshots. On stale quotes the engine downgrades to warnings, so a market-data
outage can never silently fail or pass a challenge. Settlement is likewise
withheld (`STALE_MARKET_DATA`) while open positions can't be marked, and the
attempt pauses instead of corrupting results.

**Pre-trade gate:** symbol/market/session/hours/weekend, position caps, daily
trade cap, max trading days, size, per-trade risk, notional and leverage are
validated server-side before any fill. Violations reject the order with the
engine's own messages (HTTP 422 `RULE_VIOLATION`).

---

## 6. Simulated execution

- Fills price at the **server-resolved live quote** (no future leakage — never
  a later price). Missing/stale quote ⇒ order rejected
  (`MARKET_DATA_UNAVAILABLE`), never a fabricated price.
- Cost model follows the Strategy Lab backtester: round-trip spread (typical
  spread from `SYMBOL_SPECS`, honest 0 when the platform has no spread data),
  2-leg slippage (`slippagePips × pipSize`), commission per lot. Costs are
  fixed at entry and recorded on the trade; net PnL = gross − costs.
- Unrealized PnL marks include costs, so equity reflects them immediately.
- Order placement is idempotent on `clientRequestId`; close is idempotent by
  trade state.
- Stop/take-profit triggers evaluated server-side against quotes.

---

## 7. Rewards & AV Points

- Configurable `RewardPolicy` grants on `CHALLENGE_PASSED` / `CHALLENGE_COMPLETED`
  / `CONSISTENCY_ACHIEVED` / `FIRST_CHALLENGE` / `POINTS_SPEND`.
  Shipped default (NOT hard-coded in engines): 5,000 AV Points, 14 Pro days,
  2,000 AI credits, 10 research runs, Verified Trader badge on pass; 500 points
  + 2 backtest runs on any completion.
- **Idempotent ledger:** deterministic `rewardId` per (source, type, index,
  user) written with set-if-absent transactions + the settlement CAS ⇒
  replaying a result can never double-grant. Wallet application happens only
  for entries this call created.
- **Wallet** (`performanceArena/wallets/{uid}`): avPoints, aiCredits,
  researchCredits, backtestCredits, proDays, badges, features, competitions.
- **Points spend catalog** (`POINTS_SPEND_CATALOG`): points → AI credits /
  research runs / backtest runs / Pro day — debits and credits are ledger
  entries with deterministic ids (retry-safe).
- **Real consumption:** Challenge Guardian AI charges 1 AI credit, only after a
  successful analysis (AI failure ⇒ 503, no charge).
- **Pro days:** applied as banked wallet days; wired to the canonical
  subscription node only through the documented extension point (see §12).
- Revocation flips status → REVOKED and reverses the wallet amount (never
  negative, idempotent).

---

## 8. Challenge Guardian & AI

- Deterministic insights from metrics (always available): daily-loss usage,
  drawdown proximity, distance to target, exposure, missing stops, consecutive
  losses, time/days remaining, stale data.
- Optional AI pass via the canonical AI Router with a structured prompt
  requiring **FACTS / INTERPRETATIONS / RISK WARNINGS / UNCERTAINTY /
  LIMITATIONS**. The prompt forbids guarantees and profit promises. AI output
  is commentary — **it never touches accounting, rules or settlement**.
- AI Trading Teams entry card can be surfaced alongside (reuse, no duplicate AI).

---

## 9. Feature flags (server env, deployment-controlled)

| Flag | Default |
|---|---|
| `PERFORMANCE_ARENA_ENABLED` | true |
| `ARENA_CATALOG_ENABLED` | true |
| `ARENA_PAID_CHALLENGES_ENABLED` | **false** |
| `ARENA_LEADERBOARDS_ENABLED` | true |
| `ARENA_PLATFORM_REWARDS_ENABLED` | true |
| `CASH_REWARDS_ENABLED` | **false** (never settable via UI/API/DB) |

Disabling the arena cascades to catalog/leaderboards/platform rewards.

---

## 10. Security model

- **Server-authoritative:** balance, equity, PnL, fills, rules, settlement,
  eligibility and reward amounts are computed only in `service.ts`. The client
  submits intent (symbol, side, size, stop).
- **RTDB rules:** `performanceArena` is `.read: false, .write: false` for
  clients — all access flows through authenticated API routes using the Admin
  SDK. No Firestore; no client DB SDK inside the arena (statically tested).
- **Auth:** every route uses `authenticate()` (bearer) with owner-scoped store
  paths, or `requireAdmin()`. One deliberate public endpoint: `/flags`
  (surface metadata only; entitlement re-checked on every mutation).
- **Pro gating:** `checkAccess` — the same server-side source of truth used by
  Strategy Lab / Strategy Research. It does not substitute for a paid product
  purchase.
- **Paid grants:** keyed per verified Stripe order (not per product), checked
  against Stripe session ID, signed session metadata, amount, currency and
  the current configured challenge product before an attempt is made.
- **Idempotency:** order `clientRequestId`, paid-grant claim transaction,
  settlement status CAS,
  set-if-absent ledger/events/flags writes.
- **Rate/abuse counters** (`apiActivity`) feed fraud flags, not blocking
  counters, to avoid invasive behavior.

Static security assertions live in `__tests__/security.test.ts`.

---

## 11. Database model (additive)

```
performanceArena/
  definitions/{definitionId}       rewardPolicies/{policyId}
  attempts/{uid}/{attemptId}       accounts/{uid}/{attemptId}
  trades/{uid}/{attemptId}/{tradeId}
  events/{uid}/{attemptId}/{eventId}      results/{uid}/{attemptId}
  equity/{uid}/{attemptId}/{ts}
  wallets/{uid}                    rewardLedger/{uid}/{rewardId}
  traderProfiles/{uid}
  leaderboardIndex/{attemptId}     leaderboardSnapshots/{periodKey}
  fraudFlags/{flagId}              fraudFlagsByUser/{uid}/{flagId}
  analytics/daily/{dayKey}         apiActivity/{uid}/{minuteKey}
  leaderboardPolicy (optional admin override)
```

No existing namespaces were modified; no user trading accounts, marketplace
orders, subscriptions or strategy data are touched.

---

## 12. Monetization & integration points

- Access models: `free` | `pro` (via `checkAccess`) | `paid` (per-challenge
  Stripe Checkout implementation exists, but both
  `ARENA_PAID_CHALLENGES_ENABLED` and `ARENA_STRIPE_BILLING_VERIFIED` default
  false; paid definitions are unpublished and require an explicit configured
  price; Pro entitlement never bypasses the paid fee) | `credits`
  (AV Points debit).
- Checkout returns create orders using the configured amount/currency; the
  return page calls a server verifier that retrieves the canonical Stripe
  session. The signed webhook independently validates the server-created
  order. Neither a success URL nor frontend callback can provision an account.
  Full live Stripe acceptance testing is not available in this local run, so
  paid challenges are intentionally not enabled by default. Only after a live
  end-to-end test may the deployment owner set both rollout flags; this still
  does not replace the per-product admin-configured price.
- **Pro days → subscription:** grant entries are banked in the wallet; the
  apply-to-subscription hook is intentionally not wired into Stripe state yet
  (decision flagged for human approval — see report).
- **Research/backtest credits → Strategy Research budgets:** balances are real
  and spendable on points; wiring them into mission budgets is a documented
  extension point (no silent fake consumption).

---

## 13. Admin center

`/admin/performance-arena` (AdminShell): analytics (starts, completions, pass
rate with denominators, failure reasons, durations, rewards issued, AI runs),
challenge definitions (enable/publish), reward policies + ledger inspection,
fraud flag review. Admins **cannot** configure or grant cash rewards — the API
strips/rejects `CASH` grants and the flag is env-only.

---

## 14. Feature surfaces (routes & pages)

**User API:** `GET /flags`, `GET /catalog`, `GET|POST /attempts`,
`GET /attempts/{id}`, `POST /attempts/{id}/orders`, `POST /attempts/{id}/cancel`,
`GET|POST /attempts/{id}/guardian`, `GET /attempts/{id}/report`,
`GET /leaderboard`, `GET /profile`, `GET|POST /rewards`, `POST /compatibility`,
`POST /payouts` (always rejected while cash is disabled).

**Admin API:** `/api/admin/performance-arena/{analytics,definitions,
definitions/[id],rewards,attempts,fraud}`.

**Pages:** `/performance-arena` (landing + catalog), `/performance-arena/
challenges/[id]`, `/performance-arena/attempts/[id]` (dashboard with native
chart, order ticket, positions, rules feed, Guardian, report),
`/performance-arena/leaderboard`, `/performance-arena/profile`.

**Integrations:** `ChallengeContextBar` inside both Scalping Terminal pages
(status, daily loss, drawdown, risk remaining, target progress — read-only);
`CompatibilityPanel` on Strategy Research and challenge detail pages.

---

## 15. Testing

`npm run test:arena` — domain suites include pure Stripe/order verification
(no RTDB/network/AI), cash-disabled invariants and static security assertions;

money/precision · lifecycle · rules (warn/breach/stale/pre-trade) · metrics
(equity, drawdown, daily loss %, consistency, trading days) · execution (fills,
costs, exits, marks, triggers, determinism) · settlement (verdicts, fail-closed,
report stats) · rewards (idempotent ids, wallet, points spend) ·
**cash-invariant** (flag defaults off; every payout rejected; no provider) ·
leaderboard (composite, visibility, ties) · fraud flags · flags/compatibility/
profile · **entitlement-pro-gating** (all four access models decided server-side,
fail-closed flag short-circuits, production wired to the canonical Strategy Lab
`checkAccess` gate; no client-supplied entitlement) · static security (RTDB
rules, route auth, no Firestore, admin-only writes).

---

## 16. Failure & operational procedures

- **Market data unavailable** → orders rejected; marks stale; breaches
  downgraded to warnings; settlement withheld/paused (`STALE_MARKET_DATA`).
- **Missing reward policy** → no rewards granted (never guessed).
- **Invalid policy updates** → 422 with structured errors; attempts keep their
  join-time snapshot.
- **Paused attempts** → daily-loss pause auto-resumes next UTC day; stale-data
  pause auto-resumes when fresh quotes return.
- **Rollback:** flags disable the whole surface without code changes; the RTDB
  tree is additive and can be ignored/deleted without affecting other modules.

---

## 17. Known limitations / decisions pending human approval

1. Paid challenges are implemented behind `ARENA_PAID_CHALLENGES_ENABLED=false`;
   enabling them requires wiring a per-challenge Stripe checkout (existing
   billing) — needs product/pricing sign-off.
2. Pro-day rewards are banked in the wallet; automatic extension of an active
   Stripe subscription (or license issuance) needs billing-owner approval.
3. Research/backtest credit consumption inside Strategy Research mission
   budgets is a documented extension point, not yet enforced there.
4. Pending limit/stop **entry** orders are intentionally rejected in v1 (honest
   400) — market entries with SL/TP are supported.
5. News-trading policy exists in the model but is informational until a
   canonical news-events feed is wired.
6. Trade journal persistence and modify-SL/TP actions are not implemented in
   this Arena version; the position table currently supports close only.
7. Limit/stop entry orders are rejected (HTTP 400) rather than treated as
   market orders.
8. Paid checkout is code-wired but rollout-disabled pending live Stripe/webhook
   acceptance testing; shipped paid products are drafts with no price.
9. Cash rewards are structurally disabled regardless of an accidental
   `CASH_REWARDS_ENABLED=true` value — see `docs/FUTURE_CASH_REWARDS.md`.
