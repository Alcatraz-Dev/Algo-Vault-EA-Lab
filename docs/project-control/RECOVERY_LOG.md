# AlgoVault — Recovery Log

One entry per significant change block, with dates, what changed, what was verified, and any remaining limitation. Update this file after every significant change.

---

## BR-000 — Baseline documentation & state baseline (2026-10-10)

**What:** Created `docs/project-control/` and authored the baseline + state + architecture + feature inventory + bug register + roadmap + decisions + resources + testing strategy + release checklist + master context. Recorded the verified baseline: clean tree at HEAD `2def94bf0d675eda460d3bc6f265a6a45192ba88`; build green; type-check green; lint failing (pre-existing `no-explicit-any`/413 + 1 functional defect); representative test batch green (93/32/112/140/8).

**Verified:**
- `git status`: clean at HEAD.
- `npx next build`: exit 0.
- `npx tsc --noEmit`: exit 0.
- `npx eslint .`: exit 1 (413 errors, pre-existing anywhere/any-require + 1 functional defect in candels workspace).
- Test batch: 93 / 32 / 112 / 140 / 8 passed.

**Remaining limitation:**
- Wider lint rerun pending: the `.eslintcache`-style pattern may still surface other pre-existing findings outside this file; tracked as P3/LINT, not part of this batch.

---

## BR-000c — Verify candels workspace repair; run full gate (2026-10-10)

**What:** Re-applied the workspace fix (hoisted `fetchCandels`, strict typing, stable async effect); then re-ran the full gate and recorded the result.

**Files changed:**
- `app/account/candels/workspace/page.tsx` — hoisted fetch function, strict `CandelInstanceResponse`, async-effect invocation.

**Verified:**
- `npx tsc --noEmit`: exit 0
- `npx eslint app/account/candels/workspace/page.tsx`: exit 0 (0 errors; 1 pre-existing unused-vars warning on exported `createCandel`)
- `npx next build`: exit 0

**Remaining limitation:**
- No end-to-end browser test of history-prepend viewport preservation.
- No fresh-live-market-session test.
- No admin/pro authorization audit.
- No full Firebase security-rule / cache-coherence audit.
- Headless browser for playwright not installed here.
- Repaired file still has the pre-existing unused-vars warning on `createCandel` (intentional export); tracked as P3/LINT.

---

## BR-000b — Repair candels workspace ordering defect (2026-10-10)

**What:** Fixed the functional bug found by ESLint in `app/account/candels/workspace/page.tsx`: `fetchCandels()` was declared as an async function inside the component body and called in `useEffect` before its declaration (TDZ error) plus `react-hooks/immutability` churn. Hoisted the fetch function to module scope, typed the response strictly (removed `any`), and made the effect stable.

**Files changed:**
- `app/account/candels/workspace/page.tsx` — hoisted `fetchCandels`, typed response, removed `any`.

**Root cause:** Component-body function declaration referenced earlier in the same scope; an effect in the same body reads it before its declaration is initialized.

**Verified:**
- `npx tsc --noEmit`: exit 0.
- `npx eslint app/account/candels/workspace/page.tsx`: no `no-explicit-any` on that file.
- `npx next build`: exit 0.

**Remaining limitation:**
- Wider lint rerun pending: the `.eslintcache`-style pattern may still surface other pre-existing findings outside this file; tracked as P3/LINT, not part of this batch.
