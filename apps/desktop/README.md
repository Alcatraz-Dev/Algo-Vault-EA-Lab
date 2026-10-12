# AlgoVault Desktop shell

A thin Electron shell on top of the **existing** production Next.js web app. It adds
window chrome, native menus, a tray, an auto-updater, and feed-connection overlay — it
does not re-implement the trading UI. The web app is built by the root workspace
(`next build` -> `http://127.0.0.1:3000`) and served into a `BrowserWindow`.

## Files

| Path | Purpose |
| --- | --- |
| `src/main/main.ts` | Bootstraps the app, spawns the Next production server, creates the window, wires menus/tray/updates/connection |
| `src/main/window.ts` | `BrowserWindow` creation + restore/size bounds (min 1280x780) |
| `src/main/menus.ts` | Native application menu (File/Window/Edit/View/Help) + global shortcuts |
| `src/main/tray.ts` | Tray icon, tooltip (App name + version), context menu (Open/Hide/Quit) |
| `src/main/auto-updater.ts` | `autoUpdater` wrapper; `check()` + `onUpdate` event (inert until a release is published) |
| `src/main/connection.ts` | `online`/`offline` events wired from the OS `network-status` event |
| `src/preload/index.ts` | `contextBridge` IPC surface (`window`, `app`, `connection`, `updater`, `openExternal`) |
| `src/renderer/main.tsx` | Renderer entry; bootstraps `App` |
| `src/renderer/App.tsx` | Shell renders the production Next.js app inside an `<iframe>` |
| `src/components/DesktopChrome.tsx` | Custom title bar (min/max/close) over the native title bar |
| `src/components/ConnectionOverlay.tsx` | Disconnected/recovered overlay over the embedded web app |
| `src/components/ExternalLink.tsx` | Allowlist-gated `openExternal` button |
| `tsconfig.json` | Electron + renderer TypeScript config |
| `shared/electron-types.d.ts` | Ambient Electron declarations |
| `shared/links.ts` | External-link allowlist |

## Prerequisites

- Node **22** (`engines.node: 22.x`)
- Electron installed in this workspace (`npm install` at the root already hoists it into
  `apps/desktop/node_modules` via the workspace).

## Development

```bash
npm run dev        # start main process (tsx) -> window opens
```

The embedded web app must be built first (from the repo root):

```bash
npm run build      # next build
npm run dev        # in a separate terminal, next start
```

## Packaging

`apps/desktop/package.json` is a plain Electron app; `apps/desktop` is a workspace
member of the root npm workspaces so `electron` is shared. To build a release:

```bash
npm install
npm run build
./node_modules/.bin/electron-builder   # add electron-builder to devDeps when ready
```

Apps are branded **AlgoVault**; the icon comes from `public/logos/logo.png`
(DESIGN.md §21.3) and the version from this `package.json`.

## Acceptance checklist

- [ ] Window minimum 1280x780, resizable, native title bar (`hiddenInset`).
- [ ] Native menu bar (File/Window/Edit/View/Help) + global shortcuts (`Ctrl+W`,
      `Ctrl+R`, `Cmd+Shift+F`, `Cmd+,`).
- [ ] Tray with tooltip = App name + version; right-click menu Open/Hide/Quit.
- [ ] Real disconnected/recovered overlay over the embedded app (no invented chrome).
- [ ] `openExternal` allows only `tradingview.com`, `telegram.org`, `*.algovault.com`;
      blocked origins fail locally and harmlessly.
- [ ] `ConnectionOverlay` mirrors the app's real feed-state (never fabricates data).
- [ ] Auto-updater wired (`check` inert until a release channel ships).
- [ ] No secrets/`.env`/Firebase private keys/Stripe secrets in the bundle.
