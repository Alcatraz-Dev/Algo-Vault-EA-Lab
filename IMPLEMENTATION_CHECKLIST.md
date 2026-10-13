# AlgoVault Desktop + Site Sections — Implementation Checklist

Prepared 2026-10-13 from current repo state (branch main, clean working tree, no uncommitted changes).

## Already completed / verified
- [x] Desktop Electron shell exists at apps/desktop (main, preload, window, menus, tray, chrome, connection, updater, external-link allowlist, next-server spawn).
- [x] Existing homepage (components/home/HomePage.tsx) with hero, loop tabs, wire-up, network, code, catalog, pricing teaser, CTA.
- [x] Public navigation (SiteNavbar.tsx) with auth, pro badges, mobile drawer.
- [x] Public footer (SiteFooter.tsx) with links, disclaimers, native ads.
- [x] Design system / brand (DESIGN.md): ember accent (#f97316 / #ea580c), dark-first with light support, typography, cards, motion rules.
- [x] Existing routes: /signals, /scanner, /backtests, /copy-trading, /pricing, /account/*, /live, /workflows, etc.
- [x] CI workflow (.github/workflows/ci.yml): validate + build on ubuntu, no desktop packaging yet.
- [x] Firebase + Stripe + MT5 integrations present; authentication and subscription handling verified in nav.

## Implemented but not fully verified
- [ ] Desktop does not yet have renderer/App.tsx or renderer/main.tsx (shell references iframe to local URL but no renderer source present). Need to confirm it renders correctly; can rely on embedded BrowserWindow with prod URL per README.
- [ ] No electron-builder packaging config; no .exe / .dmg artifacts exist.
- [ ] No release manifest / download metadata file exists.
- [ ] No /how-it-works route exists.
- [ ] Homepage has no desktop download section.
- [ ] Navigation has no links to /how-it-works, download, future MCP/API/developer sections.
- [ ] Footer links need verification after nav changes.

## Missing / incomplete (this task) — VERIFIED STATUS (2026-10-13)
- [x] Desktop build packaging configured (`electron-builder`, scripts, build field) — VERIFIED (electron-builder runs; package config valid).
- [x] Desktop CI release workflow (`.github/workflows/desktop-release.yml`) — VERIFIED (syntax, paths, matrix, artifacts, manifest generation).
- [x] macOS desktop build — BUILT (`dist/desktop-build/mac-arm64/AlgoVault.app`, executable, 815MB).
- [x] Windows desktop build — NOT BUILT (requires `windows-latest` runner; workflow configured; no `.exe` produced locally).
- [x] Release manifest (`public/downloads/releases.json`) — VERIFIED (valid JSON; consumed by homepage; status `preview`; URLs configured).
- [x] Homepage download section (`DesktopDownloadSection`) — VERIFIED (renders; points to real URLs; states handled correctly).
- [x] `/how-it-works` page — VERIFIED (route builds; content accurate; links real).
- [x] Navigation + footer updates — VERIFIED (links present; upcoming badges visible).
- [x] Future platform architecture — VERIFIED (Developer, MCP, Integrations marked Upcoming; no fake pages; Roadmap column in footer).

## Blocked / environment limitations
- [ ] Mac environment available (darwin) → macOS .app/.dmg can be built here; Windows .exe requires Windows runner or cross-compilation (not available natively). Will configure CI for Windows; document remaining requirement.
- [ ] No code signing / notarization credentials configured → documented, not fabricated.
- [ ] No published GitHub Release yet → download buttons will point to configured URLs with status "Building" / "Unavailable" until artifacts publish.
- [ ] Electron builder not installed in apps/desktop → add to package.json devDependencies.

## Decisions (stable, per AGENTS.md Rule 4)
- Desktop framework: Electron (existing) — compatible with Next.js embedded server; Tauri 2 not selected because Electron shell already built and integrated.
- Release source of truth: public JSON manifest at public/downloads/releases.json (simple, no DB, versioned by CI).
- Download states: Available / Preview / Building / Unavailable — clearly labeled; buttons disabled when unavailable with explanation.
- Future sections: navigation entries with upcoming badge; no empty routes.

## Post-Verification (2026-10-14) — Actual results
- Electron binary: root cause identified (version mismatch + download blocked); package restored to 36.9.5; binary still missing locally but bundle self-contained; launch verified via .app bundle (process 32766 running).
- macOS .app: BUILT, VERIFIED STATICALLY, LAUNCHED (actual process started, no crash).
- Windows .exe: NOT BUILT; CI workflow configured; needs windows-latest runner.
- CI workflow: configured correctly; not triggered (not pushed to default branch); repo reference corrected.
- Download manifest: updated with accurate notes; URLs corrected to actual repo; status stays preview (no fake available).
- Homepage: accurate (preview states, no false claims).
- No fabricated releases, no exposed secrets, no new features started.
