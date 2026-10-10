# AlgoVault — Design Decisions Record

Use this file when a non-trivial architectural or product decision is made. For each entry: decision, context, alternatives, rationale, consequences, date, status.

---

## D-001 — Firebase RTDB as the only database; no Firestore migration

- **Context:** Platform historically uses Firebase Auth + RTDB; `database.rules.json` is committed and consumed by `lib/candel/workspace/database.ts`.
- **Alternatives:** Firestore, PostgreSQL or other external DB.
- **Rationale:** RTDB is the existing production data path; a migration carries data-migration and rule-side risks. The product controls the full schema.
- **Consequences:** No Firestore migration during recovery. Firebase rules must be reviewed for cache coherence.
- **Date:** 2026-10-10
- **Status:** CONFIRMED (kept)

---

## D-002 — Free-model-first policy for AI

- **Context:** `AI_FREE_ONLY=true` by default; paid/HF models only on explicit authorization.
- **Alternatives:** Default to paid providers.
- **Rationale:** Reduces cost, matches the free tier, and keeps deterministic engines the primary path.
- **Consequences:** Paid provider only on explicit ask; AI budget/cost metering still enforced server-side.
- **Date:** 2026-10-10
- **Status:** CONFIRMED

---

## D-003 — Trading execution is DEMO-only; fail-closed

- **Context:** `TRADING_EXECUTION_MODE=DEMO` is the only supported mode; all other values disable execution.
- **Alternatives:** Enabling live trading.
- **Rationale:** Safety first. Live trading is a separate, gated capability with explicit safeguards.
- **Consequences:** No real-money execution during recovery/redesign. Demo/account environment + license + server-side auth always required.
- **Date:** 2026-10-10
- **Status:** CONFIRMED

---

## D-004 — Evidence-first intelligence; WAIT / NO_TRADE are first-class

- **Context:** Candel intelligence is an evidence/decision-support environment.
- **Alternatives:** Force BUY/SELL conclusions from the AI.
- **Rationale:** AI explains; it never invents trading data. Deterministic engines handle signals; conclusions are supported by actual evidence.
- **Consequences:** Every conclusion separates facts, measurements, interpretations, hypotheses, missing data, limitations, and risks. No fabricated market prices/performance/confidence scores.
- **Date:** 2026-10-10
- **Status:** CONFIRMED

---

## D-005 — Authorization is always server-side; client-only checks are UI

- **Context:** Security at the layer, not the UI.
- **Alternatives:** Hiding buttons/server-checks.
- **Rationale:** A hidden button is not authorization; server/API checks are authoritative.
- **Consequences:** No security fix depends on client-side only. Webhooks + cron endpoints are signature-verified/idempotent and fail-closed when secrets are unset.
- **Date:** 2026-10-10
- **Status:** CONFIRMED

---

## D-006 — Fix reliability before redesign

- **Context:** The Oct-04 audit identified terminal chart + smart-money label congestion as confirmed defects.
- **Alternatives:** Start with a visual overhaul.
- **Rationale:** Redesign must not become an excuse to break working functionality or replace integrations without evidence.
- **Consequences:** Reliability, chart, and safety gates are the prerequisite for the progressive redesign.
- **Date:** 2026-10-10
- **Status:** CONFIRMED

---

## D-007 — Design tokens from one source; dark + light both intentional

- **Context:** `DESIGN.md` (dark-first "Institutional Command") + `DESIGN.md` token spec.
- **Alternatives:** Separate themes, inheriting colors from CSS V4 scale.
- **Rationale:** One token source (`packages/design-tokens`) + CSS variable scale in `app/globals.css` serves both web and (planned) React Native.
- **Consequences:** `dark` and `light` are defined as intentional semantic overrides, not color-inverted. `--accent`/gold reserved for active brand uses; `--primary`/deep graphite is the neutral dark.
- **Date:** 2026-10-10
- **Status:** CONFIRMED

---

## D-008 — No chart drawing pixels; market coordinates for time/price objects

- **Context:** Drawing tools must follow the chart's time · price coordinate system when the chart moves, zooms, or changes symbol/timeframe.
- **Alternatives:** Fixed screen-position pixels.
- **Rationale:** A drawing that stays fixed in screen pixels will detach from the chart as the user navigates.
- **Consequences:** Persist logical coordinates; verify pan/zoom/symbol/timeframe/reload/delete; include a regression test proving objects keep their market anchor.
- **Date:** 2026-10-10
- **Status:** CONFIRMED

---

## D-009 — No fabricated data or interactions

- **Context:** Product truth in `PRODUCT.md` + `ALGOVAULT_AGENT_CONSTITUTION.md`.
- **Alternatives:** Mocking or presenting synthetic values as real.
- **Rationale:** Trading/financial UI must always show Loading / Unavailable / Stale / Not connected rather than invented numbers.
- **Consequences:** Chart data must never be fabricated; charts always reflect the upstream feed or an honest error state.
- **Date:** 2026-10-10
- **Status:** CONFIRMED

---

## D-010 — No admin exposure without explicit authorization

- **Context:** Admin + account/pro routes exist; entitlements are not fully audited.
- **Alternatives:** Expose admin features to all logged-in users.
- **Rationale:** Protect sensitive operations; server-side checks must exist for every privileged action.
- **Consequences:** Every admin route and API route has an explicit permission check; hidden-ui is not authorization.
- **Date:** 2026-10-10
- **Status:** CONFIRMED

---

## D-011 — Validation happens before rendering; errors are never injected

- **Context:** Modern components must validate all externally supplied inputs before any render.
- **Alternatives:** Handling invalid data after render.
- **Rationale:** Prevents visual corruption, layout thrashing, and security issues (XSS) from bad upstream data.
- **Consequences:** `validatePage()`, `validateUID()`, `validateAccount()`, `validateChartData()`, `validateTouchEvent()` are used whenever data is used in a component.
- **Date:** 2026-10-10
- **Status:** FROM DESIGN.md / PRODUCT.md

---

## D-012 — No chain syntax on explicit data (you can't chain a null value)

- **Context:** `globals.css` chain syntax and CSS `cp` functions are intentionally avoided.
- **Alternatives:** Using CSS custom properties in chains.
- **Rationale:** Chain syntax on explicit data creates readability and correctness issues; TypeScript already has stronger type safety.
- **Consequences:** All CSS variables and color compositions go through standard Tailwind v4 semantics.
- **Date:** 2026-10-10
- **Status:** FROM DESIGN.md

---

## D-013 — Production build first; local dev with emulator + env for real runs

- **Context:** Build passes locally without Firebase; Firebase runs via emulator + env.
- **Alternatives:** Running against production Firebase or skipping build.
- **Rationale:** `next build` is a hard gate; the product needs real Firebase only when a release touches the data path.
- **Consequences:** Any feature touching the database must be verified locally in an emulator or a staging Firebase project with the right env.
- **Date:** 2026-10-10
- **Status:** CONFIRMED

---

## D-014 — Documentation stays synchronized with implementation

- **Context:** Project memory + architecture doc.
- **Alternatives:** Multiple conflicting docs.
- **Rationale:** One authoritative source of truth reduces review friction.
- **Consequences:** When a significant change is made, documentation is updated in the same batch.
- **Date:** 2026-10-10
- **Status:** CONFIRMED
