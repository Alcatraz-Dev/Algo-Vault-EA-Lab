# Spec: Split the duplicated Scalping Terminal into two distinct products

## Goal
The Free `/scalping-terminal` and the Pro `/account/scalping-terminal` (and the account shell `ProScalpingTerminal`) were reading the same logic and UI. Deliver two separate products:

- **Free /scalping-terminal** — a Lite AI Scalping Terminal (radar + signals + engine feed, no chart/overlays/replay).
- **Pro /account/scalping-terminal** — the Pro Scalping Terminal (full chart + Smart Money/order-flow overlays + replay + order flow + intelligence + trade journal), paywalled via subscription.

## Files changed
- `app/scalping-terminal/page.tsx` — new Lite page; thin wrapper over the shared Lite client; CTA now points to `/account/scalping-terminal`.
- `app/account/scalping-terminal/page.tsx` — Pro page with server-side auth + subscription gate; mounts the full Pro terminal (`components/pro-scalping-terminal/ProScalpingTerminal`).
- `app/account/scalping/page.tsx` — account path now leads to the Free terminal, not the Pro one.
- `components/account/AccountShell.tsx` — nav now reads "Free Scalping Terminal" (LITE) vs "Pro Scalping Terminal" (PRO), no competing same-logic links.
- `lib/tools-catalog.ts` — added `free-ai-scalping-terminal` with concrete `proFeatures`/`liteFeatures` so pricing and the `ToolUpgradeCTA` show the true value gap.
- `app/pricing/page.tsx` — AI Scalping Terminal row updated to "Free: radar, signals, engine feed" vs "Pro: chart + overlays + replay + order flow + intelligence + journal"; FAQ/pricing text updated.

## Architecture decisions
- The Pro page mounts the full, existing `ProScalpingTerminal` (chart + overlays + replay + order flow + MTF intelligence + journal + calendar + sessions). It does not import the Lite feed, so it is already distinct from the Lite page.
- The Free page mounts `ScalpingTerminalClient` (the shared deterministic radar + signal engine feed).
- No duplicate/shared render components between the two paths; same engine code may be reused, but the two product surfaces and nav entries are separate.

## Verification
- `npx tsc --noEmit` → clean (exit 0).
- `tests/pro-scalping-terminal.test.ts` → 24 passed, 0 failed.
- Live preview: `/scalping-terminal` renders "AI Scalping Terminal (Lite)" + LITE + FREE FOREVER + radar + signals + engine feed + "Open Pro Terminal" → `/account/scalping-terminal`; `/account/scalping-terminal` renders the Pro workspace (chart + overlays + replay + order flow + intelligence + journal).
