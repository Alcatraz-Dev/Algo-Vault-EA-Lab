# Store listing draft — AlgoVault Trading Intelligence v3.0.0

> DRAFT — do not submit as-is. Fields marked NEEDS OWNER are unverified.
> Copy reflects only implemented v3.0.0 behavior (verified from source).
> Policy references (mandatory vs recommendation noted inline):
> - Images: https://developer.chrome.com/docs/webstore/images (mandatory set)
> - Program policies: https://developer.chrome.com/docs/webstore/program-policies (mandatory)
> - User-data FAQ: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq (mandatory: privacy policy, HTTPS, prominent in-product disclosure + consent)
> - Limited Use: https://developer.chrome.com/docs/webstore/program-policies/limited-use (mandatory: data strictly necessary to single purpose)
> - 2026 updates: https://developer.chrome.com/blog/cws-policy-updates-2026 (mandatory since 2026-08-01: prominent disclosure of ALL collection; no data beyond single purpose)

## 1. Product name

AlgoVault Trading Intelligence

## 2. Concise description (≤132 chars)

AI chart copilot for TradingView: live analysis, signals, price alerts and trade journaling.

## 3. Detailed description

AlgoVault Trading Intelligence is the browser companion for AlgoVault traders
who work on TradingView charts.

- AI Copilot side panel that follows the active TradingView chart, with
  per-symbol conversation threads and trading personas (Analyst, SMC,
  Scalper, Risk), plus on-chart AI drawings of key levels.
- Chart research notes: quick snapshots and deeper dives grounded in the
  live chart context.
- AI Daily Signals: 3 free signals per day with entry, stop-loss and
  targets (quota enforced server-side, survives reinstalls).
- Price alerts created from the chart overlay, delivered through the same
  channels as the AlgoVault web dashboard.
- Market intelligence for the active symbol: trend verdict,
  multi-timeframe alignment, risk analysis and signal lists.
- Demo (paper) trading ticket for practice, and order management for
  traders who connected an MT5 demo account through the AlgoVault gateway.
  Real execution is performed server-side through AlgoVault's Unified
  Trading API — the extension never places trades on its own and never
  handles broker credentials.

An AlgoVault account is required to sign in. Analysis features work with
any account; execution features require a connected trading account.

## 4. Key implemented features (do not extend)

Copilot side panel · per-symbol threads · on-chart AI drawings · research
notes · 3/day AI signals · price alerts · market verdict + MTF alignment ·
risk/signal views · demo ticket · unified MT5-demo execution · journal sync.

## 5. Intended audience

Retail traders who use TradingView charts alongside an AlgoVault account.
Not for children (platform policy: 18+).

## 6. Sign-in requirement (show in listing)

Sign-in with an AlgoVault account (email + password) is required; without
it the extension shows only the login screen. A reviewer demo account must
be supplied at submission (NEEDS OWNER).

## 7. Support contact

- Support site (verified from git remote): https://github.com/Alcatraz-Dev/Algo-Vault-EA-Lab
- Support email: NONE FOUND in code or policy — NEEDS OWNER (add to listing
  + privacy policy Contact section before submitting).

## 8. Privacy policy URL

https://algo-vault-ea-lab.vercel.app/privacy — VERIFIED publicly accessible
(HTTP 200) and containing a "Browser Extension Data" section. Must be
re-verified after any redeploy (deployment itself is an owner action).

## 9. Screenshots (recommended order, max 5)

1. `screenshots/03-tradingview-overlay.png` (1280×800) — live chart + overlay.
2. `screenshots/options-1280x800.png` (1280×800) — options page.
3. `screenshots/sidepanel-1280x800.png` (1280×800) — side panel, signed-out.
4. _(pending manual capture)_ signed-in popup Home with live verdict.
5. _(pending manual capture)_ Copilot conversation on a chart.

## 10. Promotional tiles

- `tiles/small-440x280.png` (REQUIRED).
- `tiles/marquee-1400x560.png` (optional, needed for featuring).

## 11. Data & permission justifications (from source audit)

Single purpose: AI-assisted analysis of the user's active TradingView
chart. Every item below is strictly necessary to it (2026 Limited Use).

| Permission / data | Why (code evidence) |
|---|---|
| `storage` (+`sync` for one random install id) | Auth session, settings, copilot threads/memory, alerts, market cache (`storage.ts`); install id enforces the server-side daily-signal quota across reinstalls |
| `activeTab` | Read the active TradingView tab's chart context on user invocation |
| `tabs` | Locate the open TradingView tab; relay commands/drawings to content scripts (`service-worker.ts`). No history read or stored |
| `contextMenus` | Analyze / Strategy Lab / Risk entries on TradingView pages |
| `notifications` | Price-alert and action confirmations |
| `alarms` | API health badge; Pro-entitlement cache refresh |
| `sidePanel` | Dockable Copilot panel |
| Host `algo-vault-ea-lab.vercel.app` | Production backend: auth, analysis, signals, alerts, execution (all `src/api/*` go through the configured base URL over HTTPS) |
| Host `*.tradingview.com` | Content scripts read the chart legend DOM only (symbol, exchange, timeframe, price, indicator values — `content/tradingview.ts`); overlay + drawings |
| Email + password | Firebase Auth sign-in (`auth/auth.ts`); never stored (only the session ID token is kept in local storage) |
| Chart context + copilot messages | Transmitted to the backend to generate analysis/signals (documented in privacy policy) |
| MT5 account data (numbers, balances, positions) | Read from the connected gateway to render account state and route orders server-side; no broker passwords or API secrets handled |
| Third parties | Firebase/Google (auth + database) only. No analytics SDKs in the extension (verified by grep). Discord/Telegram delivery only if the user connects them on the backend |
| Local deletion | Setup view wipes copilot threads/memory/research cache; logout clears token + user; server-side deletion via support request |

## 12. Privacy-policy corrections (status)

1. PENDING OWNER — add a real support email/URL to policy §11 Contact Us (currently names no channel). Do NOT submit until resolved.
2. IMPLEMENTED (owner-approved 2026-10-18): "Browser Extension Data" now states that chart context, AI copilot messages, and the authentication token are transmitted to generate analysis, signals, and alerts (policy `lastUpdated` bumped to October 18, 2026).
3. IMPLEMENTED (owner-approved 2026-10-18, stronger than the original proposal): both sign-in entry paths (popup `LoginView`, side-panel login) now show a prominent disclosure — "AlgoVault reads the active TradingView chart (symbol, timeframe, price) and sends Copilot messages with that chart context to its backend, authenticated with the AlgoVault session, to provide AI analysis and related features" — with a working Privacy Policy link and an unchecked-by-default consent checkbox; sign-in stays disabled until consent is given. A link click never counts as consent.

## 13. Submission checklist

- [x] Icon 128×128 in ZIP · small tile · marquee tile · ≥1 compliant screenshot
- [x] Privacy policy live with extension section
- [x] No localhost/dev hosts, no unused permissions in packaged manifest
- [ ] Dashboard Privacy tab: data categories + purposes + Limited Use certification (uses §11 above)
- [ ] Reviewer demo account credentials (NEEDS OWNER)
- [ ] Support email decided + added to policy §11 and listing §7 (NEEDS OWNER — BLOCKS SUBMISSION)
- [x] Corrections §12.2 (copilot-message disclosure) and §12.3 (in-product disclosure + consent) implemented; §12.1 (support contact) still NEEDS OWNER
- [ ] Upload ZIP + assets + submit (NEEDS OWNER — DO NOT SUBMIT until support contact + reviewer account are resolved)
