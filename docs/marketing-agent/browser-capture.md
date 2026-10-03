# Marketing Agent — Browser Capture

When a request is about an AlgoVault feature, the agent demonstrates the
**real product UI** instead of inventing a fake interface (§5). Capture is a
first-class, plan-driven production stage — not a manual afterthought.

---

## 1. Pipeline (§8)

```
intent (wantsBrowserDemo)
  → browser/plan.ts      buildCapturePlan()   — executable, reproducible plan
  → browser/sanitize.ts  validate + mask      — sensitive regions, forbidden content
  → browser/providers.ts selectCaptureProvider() — Hypit runtime or Playwright
  → browser/engine.ts    execute plan         — records frames + step results
  → RTDB marketingBrowserCaptures             — state, fingerprint, artifacts
```

`BrowserCapturePlan` fields: `targetPage`, `route`, `objective`, `steps[]`,
`requiredState`, `elementsToHighlight[]`, `sectionsToCapture[]`,
`sensitiveRegions[]`, `timing`, `fallback`. Plans are bounded
(`maxCaptureSteps = 24`), validated (`validateCapturePlan`) and reproducible —
the same plan yields the same capture unless the product UI changed.

Routes are restricted to the approved marketing capture surface (`/signals`,
`/scalping-terminal`, `/market-intelligence`, `/strategy-lab`, `/workflows`,
`/backtests`, `/marketplace`, `/live`, `/risk`, `/ai-copilot`);
`permissions.ts` `isAllowedProductRoute` rejects anything else.

## 2. Providers (§6)

`browser/providers.ts` exposes one `BrowserCaptureProvider` contract
(`health`, `runCapture`, artifacts with `screenshot | video_segment | region`)
with two implementations:

| Provider | When used |
| --- | --- |
| `HypitBrowserCaptureProvider` | `HYPIIIT_CLI_PATH` configured — delegates to Hypit's browser-capture runtime (preferred; no duplicated automation stack) |
| `PlaywrightBrowserCaptureProvider` | Playwright installed as a project dependency — local Chromium capture |

`selectCaptureProvider()` returns the first healthy provider plus a status
list for every candidate (`READY | NOT_CONFIGURED | DISABLED | ERROR`), so the
admin UI can show the truth (§84). If neither is available, capture reports
`NOT_CONFIGURED` — the job fails closed and no fake screenshot is ever
produced (§91).

Supported step operations: open page, navigate, click, scroll, select, search,
switch tab, wait-for-state, capture screenshot / video segment / DOM region,
record the interaction sequence, return to previous state, and retry on
transient UI failure.

## 3. Marketing browser profile (§7, §52)

Capture runs in a dedicated, controlled profile:

* **Never** exposes admin credentials, customer data, balances, API keys or
  secrets, and never visits unrelated internal pages.
* Uses a sanitized marketing/demo session — `sessionKindFor()` in
  `browser/sanitize.ts` classifies which session a route may use.
* Authenticated pages must use the controlled demo session; a real user's
  private account is never used.
* Recorded frames pass `sanitizeText` / `describeMasks` before they are
  stored: emails, balances, positions, notifications and other personal data
  are masked (sensitive regions come from the plan and from automatic
  detection). `containsForbiddenContent` is the final gate before any frame
  enters a creative.

## 4. Visual guidance (§9)

Highlights (cursor emphasis, zoom, spotlight, bounding box, animated arrow,
callout, click ripple, dimming, blur, text annotation) are **composition-time
effects** layered by `production/composition.ts` / the motion layer — the
product UI itself is never permanently modified.

## 5. Replay, reuse & staleness (§69, §70)

Each capture stores a `fingerprint` (route + DOM/asset signature). Reusable
captures feed any number of platform/language/campaign versions **without
opening the browser again**. When the product UI changes, the fingerprint no
longer matches, the capture is marked `STALE`, and the UI offers
*Refresh Capture* — obsolete footage is never used silently.

## 6. Security & prompt injection (§47, §49)

* Capture is only reachable by server-side agent jobs with
  `marketing.captureBrowser` — never exposed to ordinary client users.
* Captured page text is **untrusted data**. Instructions embedded in page
  content cannot change agent behavior, reach unrelated pages, publish,
  modify configuration, or execute commands
  (`containsInjectionAttempt` + sanitizer).
* Tool calls are allowlisted, authorized, audited (§62), and time-boxed.

## 7. Troubleshooting

| Symptom | Check |
| --- | --- |
| Capture `NOT_CONFIGURED` | `HYPIIIT_CLI_PATH` or Playwright installed? `MARKETING_BROWSER_CAPTURE_ENABLED=true`? |
| Plan rejected | `validateCapturePlan` — step budget, route allowlist, required state |
| Frames rejected | sanitize gate failed — inspect `sensitiveRegions` and forbidden-content report |
| Capture `STALE` | UI changed — run *Refresh Capture* |
| Wrong base URL | `MARKETING_CAPTURE_BASE_URL` (defaults to `NEXT_PUBLIC_APP_URL`) |
