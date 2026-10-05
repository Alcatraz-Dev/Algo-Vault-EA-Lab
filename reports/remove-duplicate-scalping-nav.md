# Account sidebar: collapse the two Free/Lite scalping entries into one

## What was wrong
The account sidebar carried **two** Free/Lite scalping-terminal entries:
- `Free Scalping Terminal` → `/account/scalping` (LITE)
- `Scalping Terminal (Lite)` → `/account/scalping-terminal-lite` (LITE)

They were the same free/lite terminal at two different paths, causing a
duplicate-free-sense and a navigational conflict.

## What was done
1. **Removed** `app/account/scalping/page.tsx` (the duplicate route).
2. **Removed** the `/account/scalping` nav entry from `components/account/AccountShell.tsx`.
3. **Updated** `components/live/ScalpingTerminal.tsx` (marketing card) which had
   stale `/account/scalping` links pointing at the deleted page.
4. **Kept** `/account/scalping-terminal-lite` as the **single** Free/Lite path,
   with badge `LITE`, in the account sidebar.

Current sidebar state:
- `Scalping Terminal (Lite)` → `/account/scalping-terminal-lite` (LITE)  ✅ only one
- `Pro Scalping Terminal` → `/account/scalping-terminal` (PRO)

## Verification
- Account sidebar now contains **exactly one** LITE scalping entry.
- `curl /account/scalping` → 404 (removed). `/account/scalping-terminal-lite`
  → 200 (live, "Free Scalping Terminal (Lite)" + LITE badge).
- `curl /account/scalping-terminal` → 200 (unchanged Pro path).
- `npx tsc --noEmit` → only the **pre-existing, unrelated** `Bias` type error
  in `app/api/advanced-analysis/intelligence/route.ts` remains
  (verified by git-stash: present on `main` with or without my change, and the
  old `Cannot find module account/scalping/page.js` stale-ref is gone).
- `tests/pro-scalping-terminal.test.ts` → 24 passed, 0 failed.

## Files changed
- `app/account/scalping/page.tsx` (deleted)
- `components/account/AccountShell.tsx`
- `components/live/ScalpingTerminal.tsx`
