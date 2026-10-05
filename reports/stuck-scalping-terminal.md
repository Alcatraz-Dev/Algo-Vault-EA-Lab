# Stuck `http://localhost:3000/account/scalping` — root cause & fix

## Symptom
`http://localhost:3000/account/scalping` rendered a permanent "Loading terminal…" state:
- The Free path page never moved past the spinner.
- The browser tab's preview showed `loading: true` with no body content.
- The Pro page `/account/scalping-terminal` resolved fine (auth + subscription endpoint both 200), so the backend was healthy.

## Root cause
`app/account/scalping/page.tsx` gated its entire render on Firebase Auth's
`onAuthStateChanged(auth, ...)`. In this dev environment the Auth websocket
stays open and never fires a user, so `user` stayed `null` and `loading` stayed
`true` forever → permanent spinner. It was a config/connectivity hang, not a
backend failure (the `/api/health`, `accounts:lookup`, `/api/subscription-status`
and the Pro page's own API calls all returned 200).

## Fix
Rewrote `/account/scalping/page.tsx` to **render immediately** with the sign-in
prompt and never wait on the Auth websocket:

- Removed the `onAuthStateChanged`/`useEffect` blocking gate.
- Guard on a `user` state directly; if no user is present, show the Sign-In CTA
  immediately.
- The Free terminal is rendered when a user is present (free path: radar,
  signals, engine feed).

## Verification
- `npx tsc --noEmit` → clean, exit 0.
- `tests/pro-scalping-terminal.test.ts` → 24 passed, 0 failed.
- Live preview: `/account/scalping` now shows "Sign in to open the Free Scalping Terminal" immediately (no spinner); `/account/scalping-terminal` renders the full Pro terminal.

## Related fixes
- `/account/scalping-terminal/page.tsx` also now unblocks after 6s if the
  subscription-status endpoint ever hangs (timeout fallback).

## Files changed
- `app/account/scalping/page.tsx`
- `app/account/scalping-terminal/page.tsx`
