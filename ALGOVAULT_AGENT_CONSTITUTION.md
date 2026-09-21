# AlgoVault — Agent Project Constitution

> **Purpose:** This file is the permanent engineering reference for every AI coding agent working on the AlgoVault project.
>
> **Rule:** Every new request, feature, bug fix, refactor, UI change, integration, or optimization must be interpreted and implemented according to this document unless the user explicitly overrides a specific rule.

---

## 1. CORE MISSION

AlgoVault is a serious trading technology platform, not a UI prototype.

The platform connects:

```text
Market Data
    ↓
Charts / Analytics
    ↓
AI Intelligence
    ↓
Strategy Lab
    ↓
Backtesting
    ↓
Optimization / Robustness
    ↓
Risk Engine
    ↓
Signals / Orders
    ↓
AlgoVault Gateway
    ↓
MT5
    ↓
Live Performance
    ↓
Analytics / Improvement
```

The engineering goal is always:

**Real functionality + correct trading logic + reliable data + coherent architecture + professional UX.**

Never optimize for visual appearance at the expense of real functionality.

---

# 2. MANDATORY FIRST STEP FOR EVERY TASK

Before changing code:

1. Read this file completely.
2. Inspect the repository structure.
3. Read the relevant existing files.
4. Trace the feature end-to-end.
5. Find existing implementations before creating anything new.
6. Understand the current architecture and data flow.
7. Identify what is actually implemented versus UI-only.
8. Only then modify the project.

Do NOT immediately start coding from the user's short prompt.

A user may say:

> "Fix the Analyze button."

You must first determine:

```text
Button
→ component
→ hook/state
→ API
→ service
→ data source
→ analytics
→ AI
→ response
→ UI
```

Then fix the actual root cause.

---

# 3. READ THE PROJECT, NOT JUST THE OBVIOUS FILE

For any meaningful task, inspect all relevant:

- pages
- components
- hooks
- API routes
- server utilities
- client utilities
- Firebase code
- types
- services
- market-data code
- AI code
- database access
- configuration
- tests
- extension code
- MQL5 code
- styles
- shared UI components

If understanding the task requires more context, keep reading.

Do not make assumptions based on filenames alone.

When a change affects multiple systems, inspect all consumers and producers of the affected data.

---

# 4. NEVER REBUILD THE PLATFORM

Do not rebuild AlgoVault from scratch.

Do not replace working architecture because a different implementation looks cleaner.

Extend and repair the existing platform.

Before creating a new system, search for an existing implementation.

If an existing implementation is incomplete, improve it.

If two implementations duplicate the same responsibility:

1. determine the canonical implementation,
2. preserve required behavior,
3. migrate consumers,
4. remove or isolate the duplicate safely.

Never create a third implementation.

---

# 5. ARCHITECTURE PRINCIPLES

The platform should have one coherent source of truth for each responsibility.

Keep:

- ONE Firebase architecture
- Firebase Realtime Database (RTDB), NOT Firestore
- ONE AI Router
- ONE market-data architecture
- ONE Strategy representation
- ONE Backtesting engine
- ONE Optimization engine
- ONE Risk Engine
- ONE Signal lifecycle engine
- ONE MT5 Gateway
- ONE licensing architecture
- ONE notification architecture
- ONE Telegram/GramJS manager
- ONE canonical market/chart context where appropriate

Reuse existing systems instead of creating parallel abstractions.

---

# 6. TRADING DOMAIN IS THE PRIMARY CONTEXT

All engineering decisions must fit the trading domain.

Use correct concepts for:

- symbols
- exchanges
- timeframes
- candles
- OHLCV
- spread
- slippage
- commission
- leverage
- margin
- position sizing
- risk percentage
- stop loss
- take profit
- R-multiple
- drawdown
- equity
- balance
- MFE
- MAE
- market structure
- liquidity
- volatility
- sessions
- indicators
- multi-timeframe analysis
- execution
- broker constraints
- order states
- position states

Do not invent simplified trading logic when an established trading concept is appropriate.

When uncertain about a trading-domain behavior, inspect existing project conventions and authoritative technical documentation rather than guessing.

---

# 7. UI IS NOT FUNCTIONALITY

A screen existing does NOT mean the feature exists.

Audit every important UI action.

Examples:

```text
Analyze
Backtest
Optimize
Execute
Generate Signal
Create Alert
Generate EA
Deploy
Buy
Download
Connect
Save
Delete
Refresh
```

Each must have a real implementation.

If a button only changes React state but should perform real work, implement the real flow.

If a feature cannot currently work because backend logic is missing, implement the missing logic when reasonably possible.

Do not hide incomplete functionality behind attractive UI.

---

# 8. REAL DATA ONLY

Production trading flows must use real data.

Never fabricate:

- market prices
- candles
- signals
- performance
- account balances
- trades
- positions
- backtest results
- optimization results
- signal outcomes
- AI market context
- execution results

Avoid accidental demo/mock data in production paths.

If real data is unavailable, show:

```text
Loading
Unavailable
Stale
Insufficient data
Not connected
```

instead of fake numbers.

---

# 9. DATA FLOW INTEGRITY

Every important feature must have a traceable data flow:

```text
UI
↓
State / Hook
↓
API
↓
Service
↓
Provider / Database
↓
Response
↓
UI
```

Verify both directions where applicable.

Do not assume an API works because it exists.

Do not assume a database write works because a function exists.

Do not assume a UI update is real-time because it says "Live".

---

# 10. MARKET DATA

The market-data architecture is foundational.

It feeds:

- charts
- scanners
- AI
- Strategy Lab
- backtesting
- signals
- risk
- replay
- extension
- TradingView context

The system must preserve:

- provider
- raw symbol
- normalized symbol
- exchange
- timeframe
- timestamp
- freshness
- source

Never analyze one instrument using data belonging to another instrument.

Always validate symbol/timeframe compatibility before important analysis or trading actions.

---

# 11. CHART / TRADINGVIEW INTELLIGENCE

TradingView integration should represent actual chart context.

Where technically and legally supported, understand:

- symbol
- exchange
- ticker
- timeframe
- current price
- candles
- visible context
- indicators
- chart elements
- user-selected context

The system must remain generic.

Do not hardcode XAUUSD.

Examples:

```text
XAUUSD
EURUSD
GBPUSD
USDJPY
BTCUSD
ETHUSD
AAPL
TSLA
```

Use supported browser/page mechanisms.

Never:

- bypass TradingView authentication
- use private APIs improperly
- inject unauthorized code
- use `eval`
- use `new Function`
- capture arbitrary browsing data
- collect credentials

---

# 12. CANONICAL CHART CONTEXT

When chart-aware features need context, use a shared canonical structure rather than separate ad-hoc objects.

Conceptually:

```ts
ChartContext {
  symbol
  exchange
  provider
  rawSymbol
  normalizedSymbol
  timeframe
  currentPrice
  candles
  indicators
  drawings
  visibleRange
  timestamp
  dataAgeMs
  source
  contextStatus
}
```

Possible context status:

```text
READY
PARTIAL
STALE
UNAVAILABLE
```

Never show "Live Context" while critical fields are null.

---

# 13. DETERMINISTIC FIRST, AI SECOND

AI is an intelligence/explanation layer.

It must not replace deterministic trading calculations where deterministic logic is possible.

Correct architecture:

```text
Real Data
↓
Deterministic Analytics
↓
Structured Context
↓
AI Interpretation / Explanation
```

AI must never invent:

- current prices
- indicator values
- historical results
- trade outcomes
- account information
- execution status

If data is missing, AI must know it is missing.

---

# 14. AI ROUTER

Reuse the existing AI Router.

Do not create multiple competing AI abstractions.

All AI features should use the correct centralized routing architecture.

Audit:

- provider selection
- fallback behavior
- error handling
- timeouts
- response parsing
- streaming
- token limits
- context size
- retries

AI responses must render completely.

Never silently truncate responses.

Search for and eliminate accidental:

- `slice`
- `substring`
- `substr`
- `line-clamp`
- `truncate`
- `text-overflow`
- `overflow-hidden`
- restrictive `max-height`
- incomplete stream accumulation

when they incorrectly cut user-visible AI output.

---

# 15. STRATEGY LAB

Strategy Lab is a core system.

A strategy must have a structured representation.

Conceptually:

```text
Strategy
↓
Analysis
↓
Backtest
↓
Optimization
↓
Walk-Forward
↓
Robustness
↓
Validation
↓
EA Generation / Deployment
```

The same strategy definition must be used consistently.

Do not allow the UI to display one interpretation while the backtest executes another.

---

# 16. BACKTESTING

Backtesting must be deterministic and use historical data.

Account for, where supported:

- OHLC data
- timeframe
- spread
- slippage
- commission
- position sizing
- risk
- SL
- TP
- partial exits
- break-even
- trailing
- sessions
- max drawdown
- daily loss
- MTF rules

Avoid lookahead bias.

Metrics must come from actual simulated trades.

---

# 17. OPTIMIZATION

Optimization must actually execute parameter combinations.

Typical flow:

```text
Parameter Space
↓
Backtests
↓
Metrics
↓
Robustness
↓
Walk-Forward
↓
Overfitting Analysis
```

Do not call a parameter "optimal" merely because it produced the highest historical profit.

Prefer stable/robust parameter regions when the architecture supports it.

---

# 18. ROBUSTNESS / WALK-FORWARD / MONTE CARLO

Use these systems to test whether a strategy is stable.

Do not treat historical performance as proof of future performance.

Check:

- in-sample
- out-of-sample
- degradation
- fragility
- trade sequence variation
- drawdown variation
- loss streaks
- Monte Carlo
- parameter sensitivity

Explain uncertainty honestly.

---

# 19. SIGNAL ENGINE

Signals must be stateful.

Typical lifecycle:

```text
NEW
↓
PENDING_ENTRY
↓
ENTRY_TRIGGERED
↓
TP1_REACHED
↓
TP2_REACHED
↓
TP3_REACHED
↓
CLOSED
```

Terminal states may include:

```text
STOPPED_OUT
EXPIRED
CANCELLED
INVALIDATED
OUTCOME_AMBIGUOUS
```

Signal data should preserve:

- creation time
- update time
- symbol
- direction
- entry
- SL
- TPs
- current price
- status
- expiry
- source
- outcome
- relevant timestamps

Outcome detection should be deterministic.

Do not let AI decide whether a trade hit TP or SL.

---

# 20. SIGNAL EXPIRATION

If a signal has an entry window and expires before entry:

- mark it expired
- do not execute it later

If it already entered:

- do not close it merely because the entry window expired unless the strategy explicitly requires that behavior.

Respect existing strategy rules.

---

# 21. TELEGRAM SIGNAL INTELLIGENCE

Use the existing GramJS architecture.

Flow:

```text
Telegram
↓
Connector
↓
Message
↓
Parser
↓
AI Normalization when necessary
↓
Market Validation
↓
Signal Engine
↓
Monitoring
↓
Outcome
↓
Notifications
```

Preserve the original Telegram message.

AI normalization must not silently rewrite the original source.

Telegram account/channel administration is ADMIN-ONLY.

Credentials remain server-side.

---

# 22. RISK ENGINE

Risk Engine is a gate before execution.

Validate:

- account
- symbol
- direction
- position size
- risk %
- SL
- TP
- max positions
- daily loss
- drawdown
- broker constraints
- strategy constraints

Possible result:

```text
APPROVED
REJECTED
```

Never bypass risk checks just because a UI action was triggered.

---

# 23. QUICK ORDER / EXECUTION

Execution flow:

```text
Order Intent
↓
Risk Engine
↓
Gateway
↓
MT5
↓
Broker
↓
Execution Result
↓
Platform State
```

Do not show "Executed" before confirmation.

If the broker rejects the order, show the actual rejection.

---

# 24. MT5 GATEWAY

There is ONE existing AlgoVault Gateway.

Reuse it.

It handles, as applicable:

- account registration
- heartbeat
- command queue
- order execution
- positions
- trades
- performance
- synchronization

Do not create another gateway.

Browser clients must never receive MT5 credentials.

---

# 25. LIVE PERFORMANCE

Live account data may include:

- balance
- equity
- open positions
- closed trades
- P/L
- drawdown
- heartbeat
- performance

A stale heartbeat must not be presented as live.

Use truthful status:

```text
LIVE
STALE
OFFLINE
UNKNOWN
```

depending on actual state.

---

# 26. STRATEGY → MT5 EA

The strategy-to-EA pipeline should be:

```text
Strategy
↓
Backtest
↓
Optimization
↓
Robustness
↓
Validation
↓
MQL5 Generation
↓
Validation / Compilation
↓
License
↓
Download / Deploy
↓
MT5
↓
Gateway
↓
Monitoring
```

The EA must faithfully implement supported strategy rules.

AI may help translate/explain a strategy, but deterministic validation must remain authoritative.

Never claim compilation succeeded without actually verifying it.

---

# 27. LICENSING

Licensing must be enforced independently from UI.

Conceptual flow:

```text
EA
↓
License API
↓
License Valid?
↓
Allow / Block trading
```

Respect:

- expiry
- account limits
- product
- version
- license status

---

# 28. MARKETPLACE

Marketplace flow:

```text
Product
↓
Details
↓
Purchase
↓
Stripe Checkout
↓
Webhook
↓
Order
↓
License
↓
Download / Access
```

Do not mark payment successful only from frontend state.

Use verified payment/webhook state.

---

# 29. COPY TRADING

Copy Trading must use actual trade events.

Conceptually:

```text
Master
↓
Trade Event
↓
Copy Logic
↓
Risk / Position Sizing
↓
Follower
```

Respect follower risk limits.

Never copy trades blindly when risk rules reject them.

---

# 30. NOTIFICATIONS

Notifications should be event-driven.

Examples:

```text
NEW_SIGNAL
SIGNAL_UPDATED
ENTRY_TRIGGERED
TP1
TP2
TP3
SL_HIT
BREAKEVEN
PROFIT_LOCK
SIGNAL_EXPIRED
SIGNAL_CANCELLED
SIGNAL_CLOSED
ORDER_EXECUTED
ORDER_REJECTED
EA_OFFLINE
LICENSE_EXPIRING
```

Use deduplication/idempotency.

Do not notify success when the underlying event failed.

---

# 31. CHROME EXTENSION

The extension is a browser trading intelligence layer.

It should not be just:

```text
Popup + Chatbot
```

Desired architecture:

```text
TradingView
↓
Content Script
↓
Chart Context
↓
AlgoVault Market Data
↓
Deterministic Analytics
↓
AI
↓
Risk / Strategy / Backtest / Signals
↓
Gateway
```

The extension should minimize manual context entry.

It should detect the active chart when technically supported.

Do not hardcode one symbol.

---

# 32. REPLAY

Replay should simulate historical progression without future leakage.

Core principle:

```text
visible candles = candles available up to replay cursor
```

Never expose future bars to the strategy.

Replay should eventually integrate with analysis/strategy systems where supported.

---

# 33. PINE / INDICATORS

Use the existing Pine Runtime and TradingView integration.

Do not claim full Pine compatibility unless verified.

Never use:

```text
eval()
new Function()
```

for script execution.

Maintain safe parsing/runtime boundaries.

---

# 34. DATABASE

Firebase Realtime Database is the primary database.

Do NOT migrate to Firestore unless the user explicitly changes the architecture.

Keep data models coherent.

Existing important domains include:

```text
users
bots
backtests
live_accounts
live_performance
live_equity
live_positions
trades
orders
licenses
downloads
affiliate_offers
affiliate_clicks
copy_trading
reviews
notifications
settings
```

Other existing domains must be reused rather than duplicated.

Before changing database structure:

- inspect readers
- inspect writers
- inspect security rules
- preserve compatibility where practical

---

# 35. AUTHORIZATION

Security must be enforced server-side.

Important roles include:

- user
- admin
- developer
- other existing project roles

UI hiding is not authorization.

Admin-only features must have server/API checks.

---

# 36. ERROR HANDLING

Important flows must handle:

- network errors
- API failures
- authentication failures
- authorization failures
- provider failures
- stale data
- invalid data
- rate limits
- AI failures
- Stripe failures
- Telegram failures
- Gateway failures
- broker rejections

Never silently swallow meaningful errors.

Avoid empty catch blocks.

Log useful diagnostic information without exposing secrets.

---

# 37. UX / IMPECCABLE

Use **Impeccable** as the project's UI/UX quality and design-improvement reference/tooling when available.

The goal is not to redesign everything.

Use it to:

- inspect visual consistency
- improve spacing
- hierarchy
- typography
- responsive behavior
- states
- accessibility
- interaction quality
- tables
- charts
- forms
- navigation
- loading states
- empty states
- error states
- mobile behavior

Always preserve AlgoVault's existing identity.

Trading software should feel:

- professional
- information-dense but readable
- precise
- fast
- trustworthy
- consistent

Do not add decorative UI that harms usability.

Do not turn trading screens into generic marketing dashboards.

---

# 38. GRAPHIFY / CODEBASE UNDERSTANDING

Use **Graphify** when available in the agent environment to understand the repository and reduce unnecessary token consumption.

Use it to map:

- imports
- dependencies
- components
- API routes
- services
- data flows
- references
- feature relationships

Before reading huge amounts of unrelated code, use Graphify/codebase graph information to identify the relevant dependency path.

Preferred approach:

```text
Graphify
↓
Identify relevant graph
↓
Read targeted source files
↓
Trace data flow
↓
Implement
```

Do not use Graphify as a substitute for reading important source code.

The graph tells you where to look; the source code remains authoritative.

---

# 39. CODE QUALITY

Prefer:

- clear TypeScript
- strong types
- small focused functions
- reusable services
- existing abstractions
- explicit contracts
- predictable state
- defensive validation
- meaningful errors

Avoid:

- unnecessary abstractions
- duplicated logic
- giant components
- hidden side effects
- magic values
- silent failures
- fake fallbacks
- dead code

---

# 40. TESTING

For important changes, test the complete flow, not only compilation.

At minimum run as appropriate:

```bash
npx tsc --noEmit
npm run build
npm run lint
```

Also test relevant runtime behavior.

For trading features, test multiple instruments/timeframes where applicable.

Examples:

```text
XAUUSD M5
EURUSD M15
BTCUSD H1
AAPL
```

Never assume XAUUSD-specific behavior is acceptable unless the feature is explicitly XAUUSD-only.

---

# 41. NO HARD-CODED TRADING ASSUMPTIONS

Never assume:

- one symbol
- one timeframe
- one broker
- one market
- one currency
- one account
- one strategy
- one signal source

unless the feature explicitly requires it.

Use the platform's canonical abstractions.

---

# 42. WHEN THE USER GIVES A NEW PROMPT

Every new user request must be interpreted through this constitution.

Example:

User:

> "Add a better AI signal system."

Do not blindly build a new signal system.

Instead:

1. inspect existing Signals,
2. inspect AI,
3. inspect Market Data,
4. inspect Risk Engine,
5. inspect Notifications,
6. inspect database,
7. inspect Gateway,
8. determine what already exists,
9. extend the existing system,
10. preserve the architecture,
11. test end-to-end.

The user's request changes WHAT they want.

This document controls HOW it should be engineered unless explicitly overridden.

---

# 43. WHEN THE USER ASKS FOR A BUG FIX

Do not patch symptoms only.

Find the root cause.

Example:

If AI shows:

```text
Symbol: null
Price: null
Timeframe: null
```

do not simply add fallback text.

Trace:

```text
Browser
→ chart detection
→ normalization
→ market data
→ ChartContext
→ API
→ AI
→ UI
```

Fix the broken link.

---

# 44. WHEN THE USER ASKS FOR A NEW FEATURE

Before implementation:

1. Search existing architecture.
2. Identify reusable systems.
3. Identify database model.
4. Identify APIs.
5. Identify UI location.
6. Identify permissions.
7. Identify real-time requirements.
8. Identify error states.
9. Identify testing requirements.

Then implement the smallest coherent extension of the current architecture.

---

# 45. WHEN A FEATURE IS ONLY PARTIALLY IMPLEMENTED

Do not remove it automatically.

Determine:

- intended behavior
- current behavior
- missing logic
- dependencies
- consumers

Then complete it.

If the existing implementation is fundamentally incorrect, refactor it carefully while preserving external behavior.

---

# 46. UI STATES ARE PART OF FUNCTIONALITY

Every major interactive feature should consider:

```text
Loading
Ready
Empty
Partial
Stale
Error
Unauthorized
Disconnected
Success
Executing
Completed
```

Do not show misleading states.

---

# 47. PERFORMANCE

Watch for:

- duplicate API calls
- duplicate Firebase listeners
- duplicate AI requests
- duplicate market-data requests
- memory leaks
- uncleared intervals
- uncleared subscriptions
- infinite React effects
- unnecessary rerenders
- oversized client bundles

Use caching/debouncing where appropriate.

Correctness comes first.

---

# 48. SECURITY RULES

Never expose:

- API secrets
- Telegram API hash
- Telegram sessions
- Stripe secret keys
- AI provider secrets
- MT5 credentials
- Gateway secrets

Never put server secrets in `NEXT_PUBLIC_*`.

Never log sensitive credentials.

---

# 49. NO FAKE SUCCESS

Never tell the user or UI:

```text
Success
Executed
Connected
Backtested
Optimized
Compiled
Live
Synced
Paid
```

unless the underlying operation actually succeeded.

---

# 50. DOCUMENTATION

When implementing substantial architecture changes:

- update relevant types
- update relevant documentation
- update comments only where useful
- keep the architecture understandable

Do not generate massive documentation for trivial changes.

---

# 51. DEFINITION OF DONE

A feature is NOT done merely because:

- the page exists
- the button exists
- TypeScript passes
- the build passes
- a mock response appears

A feature is done when:

```text
UI
↓
Real Logic
↓
Real Data
↓
Correct State
↓
Persistence
↓
Error Handling
↓
Permissions
↓
Integration
↓
Verified Runtime Behavior
```

are correct for the feature's requirements.

---

# 52. FINAL AGENT BEHAVIOR

Always think like a senior engineer building a trading platform.

When a request is ambiguous:

- inspect the existing system
- infer the correct implementation from architecture and trading-domain best practices
- implement the most coherent solution
- avoid unnecessary questions when the repository provides enough information

Do not make the user design every missing technical detail.

Do not stop after identifying problems.

Do not return a checklist of work you could have implemented.

**Inspect → Understand → Trace → Implement → Integrate → Test → Verify.**

---

# 53. FINAL PRINCIPLE

The permanent objective of AlgoVault is:

> **A real, reliable, professional trading platform where every important feature is backed by real logic, real data, correct trading-domain behavior, and coherent integration with the existing architecture.**

Every future agent must treat this document as the project's engineering constitution.

---

# 54. UI DESIGN SYSTEM — VERIFIED TOKENS & RULES

## 54.1 Fixed semantic tokens (never per-page accents)

All color usage resolves to a fixed semantic token set. There is **one** mapping; it never varies by page, section, or mood.

| Legacy Tailwind family | Semantic token | Meaning |
| --- | --- | --- |
| `red` / `rose` | `negative` | loss / sell / short |
| `amber` / `yellow` / `orange` | `warning` | risk / caution |
| `emerald` / `green` / `teal` / `lime` | `positive` | profit / buy / long |
| `blue` / `sky` / `cyan` / `fuchsia` | `info` | neutral information |
| `violet` / `purple` / `indigo` / `pink` | `primary` | vault gold / brand accent |

- `--primary` is the vault-gold accent and intentionally shares its hue with `--warning` (defined in `app/globals.css`). `--primary` + `--primary-foreground` are reserved for **filled CTAs and active segmented tabs**.
- Tokens are always used with opacity modifiers (`bg-positive/10`, `border-negative/30`, …) for tinted surfaces.
- `--color-chart-1..5` are real `@theme` utilities (`bg-chart-1`, etc.) and may be used **only** for data-viz/chart series. Recharts/chart internals keep hardcoded data-viz hexes; those are deliberate exceptions, not to be re-spread through the UI.
- Native radio/checkbox styling uses `accent-[var(--primary)]`; focus rings use `--ring` (primary) via `focus:border-primary` or the global focus-visible outline.

## 54.2 Radius system

| Surface | Radius |
| --- | --- |
| Cards / panels / tables / stat boxes | `rounded-lg` (8px) |
| Controls (buttons, inputs, dropdowns, chips) | `rounded-md` (6px) |
| Badges / pills / status dots | `rounded-full` |
| Minor nested emphasis | `rounded-xl` (allow-listed, restrained use) |

`rounded-2xl` / `rounded-3xl` are banned.

## 54.3 Typography

- Trading numbers → `font-numeric` (Geist Mono + `tabular-nums`, defined in `app/globals.css`). Right-aligned numeric columns use `.num-right`.
- `font-mono` is **retained only** on:
  - code / Pine surfaces (`PineWorkspace`, Pine editor fields, `.set` file content)
  - terminal-mock and AI-chat mocks on marketing sections
  - diagnostics / log dumps, identifier surfaces (referral codes, product IDs, file names, symbol chips)
- Banned micro sizes: `text-[9px]` / `text-[10px]` → use `text-[11px]`.

## 54.4 Elevation and surfaces

- Cards default to hairline `border-border` + `shadow-sm`. No colored glow shadows, no `shadow-xl/2xl/3xl` on cards.
  - `shadow-lg` is allowed for: dropdown menus, popovers, modal/dialog panels (with `bg-popover` / `bg-card` / `bg-background`).
- Gradient fills (`bg-gradient-to-*` / `bg-linear-to-*`) and gradient text (`bg-clip-text text-transparent`) are banned; tinted token surfaces (`bg-primary/5`, `bg-muted/40`, …) replace them.
- Decorative orb divs (`blur-[…]`, `animate-ping`, gradient shells) are banned. `animate-ping` dots are allowed only as status pulse dots on live badges.
- `backdrop-blur-*` is allowed **only** for: modal scrims, the `dialog.tsx` scrim, and the sticky headers in `AppShell.tsx` / `SiteNavbar.tsx`. Glass cards (`bg-card/60 … backdrop-blur-xl`) are banned.

## 54.5 Interactive states

- Active segmented tab → `bg-primary text-primary-foreground` (never tinted).
- Active dropdown option → `bg-primary/10 text-primary`.
- Filled CTAs → `bg-primary text-primary-foreground` (flat; no gradients).
- BUY / SELL and other high-contrast action chips may use `text-white` on `bg-positive` / `bg-negative`; some `bg-warning` CTAs likewise keep light text for contrast.

## 54.6 Page header ownership

- The AppShell / AdminShell topbar owns `data-guide="page-header"` — never duplicate it in page content.
- `/trading` is a standalone terminal: it owns its own `AccountHeader` carrying `data-guide="page-header"` (no AppShell wrapper). Do not wrap it in AppShell.

## 54.7 Chrome extension

- The extension is a standalone Tailwind v3 app. Its `chrome-extension/tailwind.config.js` now defines the same semantic tokens (`primary`, `primary-foreground`, `positive`, `negative`, `warning`, `info`) so token utilities compile. Do not remove them.
- `chrome-extension/src/popup/styles.css` defines its own `.font-numeric` (extension has no access to `app/globals.css`).
- The extension's neutral palette hexes are tokenized in its config: `#0a0a0f`→`background`, `#f0f0f5`→`foreground`, `#8888aa`→`muted-foreground`, `#2a2a3e`→`border`, `#1a1a2e`→`muted`, `#55556a`→`foreground/40`. Same bans apply (no micro sizes below 11px, no glass, `font-numeric` for trading data).
- `font-mono` remains only in the Settings diagnostics dump inside the extension.

## 54.8 Verified gate status (last reserve sweep)

- `npx tsc --noEmit` — clean (0 errors).
- `next build` — clean (exit 0; all routes compile).
- `chrome-extension` `tsc --noEmit` + `npm run build` — clean.
- `npm run lint` — has **pre-existing** debt (~1327 errors) mostly in `app/api/*`, admin pages, and scripts (react-hooks setState-in-effect, `react/no-unescaped-entities`, unused imports). UI sweeps must never add new lint errors; className/font-class replacements are the only permitted mechanical changes when sweeping styles.
- Banned-pattern scans (`app components features tools chrome-extension`, excluding `.kilo`) must return only the documented exceptions (modal scrims, sticky-header blur, dialog scrim, chart-internal hexes) plus home/marketing mock-terminal `font-mono` surfaces.
