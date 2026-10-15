# AlgoVault Desktop shell

A thin Electron shell on top of the **existing** production Next.js web app. It adds
a native window chrome, native menus, a tray, an auto-updater, and feed-connection
overlay — it does not re-implement the trading UI. The web app is built by the root
workspace (`next build` → `http://127.0.0.1:3000`) and loaded into a `BrowserWindow`
that uses the platform's native window controls.

## Files

| Path | Purpose |
| --- | --- |
| `src/main/main.ts` | Bootstraps the app, spawns the Next production server, creates the window, wires menus/tray/updates/connection |
| `src/main/window.ts` | `BrowserWindow` creation + restore/size bounds (min 1280x780), macOS vibrancy, Windows Mica, dark-mode aware title-bar overlay |
| `src/main/menus.ts` | Native application menu (File/Edit/View/Navigate/Window/Help) + macOS app menu + global menu accelerators |
| `src/main/tray.ts` | Tray icon, tooltip (App name + version), context menu (Open/Hide/Quit) |
| `src/main/auto-updater.ts` | `autoUpdater` wrapper; `check()` + event bridge (inert until a release is published) |
| `src/main/connection.ts` | OS-level connectivity probe (DNS + loopback HTTP) emitting `online`/`offline` events |
| `src/main/next-server.ts` | Spawns the Next.js standalone server, waits for it to respond, terminates cleanly on quit |
| `src/preload/index.cts` | `contextBridge` IPC surface (`window`, `app`, `dialog`, `clipboard`, `notification`, `connection`, `updater`, `navigation`, `openExternal`) |
| `src/shared/links.ts` | External-link allowlist (HTTPS-only, exact-origin + limited subdomain) |
| `src/shared/session.ts` | Pure-data session state predicates (no Electron / Firebase imports) |

## Window chrome per platform

| Platform | Chrome |
| --- | --- |
| macOS   | `hiddenInset` title bar + traffic-light position aligned to the 16-px grid + vibrancy (`under-window` on dark, `sidebar` on light) + Ember-tinted title-bar overlay that re-tints on `nativeTheme` updates |
| Windows | Standard OS frame + Mica background material on Win 11 for the native tinted surface |
| Linux   | Standard OS frame; system menu bar respected via `autoHideMenuBar` |

All platforms use the design-system background `#0b0c0e` and the Ember accent
`#f97316` so the window integrates with the in-app surface even before the
Next.js content paints (no white flash on launch — `show: false` until
`ready-to-show`).

## Prerequisites

- Node **22** (`engines.node: 22.x`)
- Electron installed in this workspace (`npm install` at the root already hoists it into
  `apps/desktop/node_modules` via the workspace).

## Development

```bash
npm run dev        # start main process (tsx) → window opens
```

The embedded web app must be built first (from the repo root):

```bash
NEXT_OUTPUT_STANDALONE=1 npm run build      # produce .next/standalone
npm run start                                # next start (or use the desktop launcher)
```

## Runtime configuration and credentials

The embedded Next.js server runs as a child of Electron with an OS-runtime allowlist.
Firebase Admin credentials are never forwarded by a packaged Electron application,
even if its launching environment sets `ALGOVAULT_SELF_HOSTED=1` or supplies every
Admin variable. The packaged boundary is based on Electron's `app.isPackaged` runtime
property, not an environment variable.

Privileged self-hosting is supported only for an unpackaged, operator-controlled
server process: explicitly set `ALGOVAULT_SELF_HOSTED=1` in that trusted launch
environment and provide `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and
`FIREBASE_PRIVATE_KEY`; `FIREBASE_DATABASE_URL` may be provided explicitly or derived
by the existing Admin initializer from the project ID. Development mode by itself does
not enable credential forwarding. Do not use this mode for normal end-user installs.
`NODE_OPTIONS` and arbitrary shell variables are not inherited by the child. The app
cannot distinguish a trusted operator launch from an untrusted local process when
unpackaged, so the operator must control that process environment and host.

The `NEXT_PUBLIC_FIREBASE_*` client configuration (`API_KEY`, `AUTH_DOMAIN`,
`DATABASE_URL`, `PROJECT_ID`, `STORAGE_BUCKET`, `MESSAGING_SENDER_ID`, `APP_ID`) is
public client configuration and is compiled into the client bundle at build time. It
must be supplied through GitHub repository/environment Variables (or equivalent
protected build configuration); it is public and is not an Admin credential. The
release workflow fails with the missing variable names only if any required setting
is absent.

The Electron-to-Next child environment uses an OS-runtime allowlist, strips unrelated
user credentials, and does not rely on runtime public Firebase variables: Next embeds
those values in browser bundles at build time. Child stdout/stderr contents are never
written to the desktop log; only generic readiness/error states are recorded.

A normal downloadable desktop app must use the authenticated hosted AlgoVault backend
for privileged operations. The current desktop shell embeds the Next.js API server and
has no supported remote-API origin/proxy mode; therefore it is not safe to ship a
normal installer that depends on a Firebase Admin service account on the end user's
machine. Until a remote backend boundary is implemented, Firebase Admin-backed desktop
routes are supported only in the explicit unpackaged operator-managed mode above.
Missing Admin configuration continues to produce an explicit server-side error; it is
not replaced by weaker client-side access. Firebase Admin errors are not hidden; if
required settings are missing, the server returns the existing explicit configuration
error.

Before any backend test, revoke the previously exposed service-account key in Google
Cloud IAM, create a replacement with only required Firebase permissions, update the
trusted server secret store, and verify the old key is disabled. Admin credentials are
not required by either downloadable desktop build workflow. Do not paste credentials
into chat or logs. This repository does not confirm whether rotation has occurred.

## Packaging

`apps/desktop/package.json` is an Electron-builder app; `electron-builder` lives in
`devDependencies` and is shared via the workspace.

```bash
npm install
npm run build:next                # standalone Next build
npm run build                     # tsc → compiled/
npm run dist                      # electron-builder --mac --dir → apps/desktop/dist/desktop-build
npm run package:mac               # full .dmg + .zip
```

Apps are branded **AlgoVault**; the icon comes from `public/icons/icon-512x512.png`
and the version from this `package.json`.

## macOS release signing and notarization

The mac build (`apps/desktop/package.json` → `build.mac`) enforces Hardened
Runtime with `entitlements/entitlements.mac.plist` (app),
`entitlements/entitlements.mac.inherit.plist` (helpers/frameworks), and
`entitlements/entitlements.mac.login-helper.plist`. The app id
(`com.algovault.desktop`) and product name are unchanged; the only supported
mac arch is `arm64` (no Intel `x64` target yet). electron-builder notarizes
automatically when Apple credentials are present — no extra dependency.

Release builds require these GitHub Actions **secrets** (never commit them;
never ship them in the bundle):

- `CSC_LINK` — base64-encoded Developer ID Application `.p12` certificate.
- `CSC_KEY_PASSWORD` — the `.p12` password.
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — notarization
  credentials (or `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER`).

The `desktop-release` workflow fails the mac job early if any are missing.
Local builds without these secrets skip signing/notarization gracefully.
Verify a distributable with:

```bash
codesign --verify --deep --strict "AlgoVault.app"
codesign -dvv "AlgoVault.app"            # check Authority=Developer ID Application + runtime flag
xcrun stapler validate "AlgoVault-*.dmg"
spctl --assess --type open --context context:primary-signature "AlgoVault.app"
```

## Acceptance checklist

- [ ] Window minimum 1280x780, resizable, native title bar per platform.
- [ ] Native menu bar (App/File/Edit/View/Navigate/Window/Help) + macOS app menu + global accelerators.
- [ ] Tray with tooltip = App name + version; right-click menu Open/Hide/Quit.
- [ ] Real feed-connection status from OS DNS + loopback HTTP probes (never fabricated).
- [ ] `openExternal` allows only allowlisted HTTPS origins; blocked origins fail locally and harmlessly.
- [ ] Auto-updater wired (`check` inert until a release channel ships; no `feedURL` → no network call).
- [ ] No secrets / `.env` / Firebase private keys / Stripe secrets in the bundle.