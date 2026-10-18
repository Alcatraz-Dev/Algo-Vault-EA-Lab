# Chrome Web Store assets — AlgoVault Trading Intelligence v3.0.0

Requirements source: https://developer.chrome.com/docs/webstore/images
(checked 2026-10-18; do not rely on remembered older sizes — the current
docs list only Small 440×280 and Marquee 1400×560 promo images, plus
1280×800 / 640×400 screenshots. The legacy 920×680 "large tile" is NOT
in the current documentation and was deliberately not created.)

Brand source: `../public/logos/logo.png` (96×96, inlined verbatim — no new
identity invented). Palette mirrors the extension (`#0f0f0f` base,
`#ff4d00` brand accent). No metrics, profit claims, or product-UI mockups.

## Final assets

| File | Size | Format | Purpose | Status |
|---|---|---|---|---|
| `tiles/small-440x280.png` | 440×280 | PNG | Small promo tile (**required** by the store) | FINAL — rendered from `src/tile-small.html` via headless Chrome |
| `tiles/marquee-1400x560.png` | 1400×560 | PNG | Marquee tile (optional, needed for featuring) | FINAL — rendered from `src/tile-marquee.html` via headless Chrome |
| `screenshots/03-tradingview-overlay.png` | 1280×800 | PNG | Live TradingView XAUUSD chart with AlgoVault overlay booted (symbol detection visible) | FINAL — genuine capture from the v3.0.0 build |
| `screenshots/options-1280x800.png` | 1280×800 | PNG | Real options page | FINAL — genuine capture from the v3.0.0 build |
| `screenshots/sidepanel-1280x800.png` | 1280×800 | PNG | Real side panel (signed-out state) | FINAL — genuine capture from the v3.0.0 build |

Reproduce: `node src/build-tiles.mjs`, screenshot each `src/tile-*.html`
at its exact size (see script header); screenshots via
`node src/capture-store-screenshots.mjs` (needs the `dist/` prod build).

Reference (NOT uploadable as-is): `../release/screenshots/01-popup-login.png`
is 400×600 — the popup's real fixed size — and does not meet the store's
1280×800 / 640×400 requirement. Kept for reference only.

## Still requires manual capture (authenticated session)

Signed-in surfaces cannot be captured without a real account — faking
authentication or inventing balances/trades is explicitly out of scope:

1. Popup Home with live chart context (verdict, price, sparkline).
2. Side-panel Copilot conversation on a TradingView chart.
3. AI Daily Signals view.
4. Alerts view with a real alert.
5. Demo ticket / execution outcome (paper only — never place a live trade
   for a screenshot).

Minimum manual action needed: sign in to the extension in an interactive
Chrome profile (prefer a dedicated demo account), open each surface above,
capture at 1280×800 with browser chrome cropped out, and drop the files
into `screenshots/`. The store requires ≥1 screenshot (have 3 compliant)
and allows up to 5 — 2 more genuine signed-in shots would complete the set.

## Remaining store checklist (visual only)

- [x] 128×128 icon in ZIP (`../dist` manifest icons)
- [x] Small promo tile 440×280 (required)
- [x] Marquee tile 1400×560 (recommended for featuring)
- [x] ≥1 compliant screenshot (3 available)
- [ ] 1–2 signed-in screenshots (blocked: needs your interactive session)
- [ ] Promo-tile review happens after upload (Pending → approved in dashboard)
