/**
 * Shared theme boot for every extension page (popup / side panel / options).
 *
 * Single source of truth for the app-wide light/dark theme:
 *   - `light` / `dark` class on <html> (Tailwind `darkMode: "class"`),
 *     consumed by the shadcn/ui tokens in src/styles/tokens.css.
 *   - Three persisted modes: "system" (default), "light", "dark"
 *     (`chrome.storage.local` key `avTheme`).
 *
 * Flash-free initialization, two phases:
 *   1. PRE-PAINT — a blocking inline script in each page's <head> reads the
 *      sessionStorage mirror (sync, populated below) and sets the class
 *      before first paint; falls back to the OS preference.
 *   2. AUTHORITATIVE — the React tree loads the persisted mode from
 *      chrome.storage.local, applies it, refreshes the mirror, and (for
 *      "system") keeps tracking live OS preference changes.
 */

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "avTheme";
const MIRROR_KEY = "avThemeMirror";

const MEDIA_QUERY = "(prefers-color-scheme: light)";

function systemTheme(): ResolvedTheme {
  try {
    return window.matchMedia && window.matchMedia(MEDIA_QUERY).matches
      ? "light"
      : "dark";
  } catch {
    return "dark";
  }
}

/** Collapse a persisted mode to the concrete theme it renders right now. */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? systemTheme() : mode;
}

export function applyThemeClass(mode: ResolvedTheme): void {
  const el = document.documentElement;
  el.classList.toggle("light", mode === "light");
  el.classList.toggle("dark", mode !== "light");
}

function writeMirror(mode: ThemeMode): void {
  try {
    sessionStorage.setItem(MIRROR_KEY, mode);
  } catch {
    /* ignore */
  }
}

function normalize(raw: unknown): ThemeMode {
  return raw === "light" || raw === "dark" || raw === "system"
    ? raw
    : "system";
}

/** Phase 1 — paste into the <script> tag in each page's <head>. */
export const THEME_PREPAINT_SCRIPT = `(function(){try{var d=document.documentElement;d.classList.remove("light","dark");var m=sessionStorage.getItem("${MIRROR_KEY}");var l;if(m==="light"||m==="dark"){l=m==="light"}else{l=window.matchMedia&&window.matchMedia(${JSON.stringify(MEDIA_QUERY)}).matches}d.classList.add(l?"light":"dark")}catch(e){document.documentElement.classList.add("dark")}})();`;

export function readStoredTheme(): Promise<ThemeMode> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        resolve(normalize(result[STORAGE_KEY]));
      });
    } catch {
      resolve("system");
    }
  });
}

let mediaListener: (() => void) | null = null;

/** Keep the live OS-preference listener attached only while mode="system". */
function syncMediaListener(mode: ThemeMode): void {
  try {
    if (mediaListener && window.matchMedia) {
      window.matchMedia(MEDIA_QUERY).removeEventListener("change", mediaListener);
      mediaListener = null;
    }
    if (mode === "system" && window.matchMedia) {
      mediaListener = () => applyThemeClass(systemTheme());
      window.matchMedia(MEDIA_QUERY).addEventListener("change", mediaListener);
    }
  } catch {
    /* older Chromium — static theme is still correct */
  }
}

/** Phase 2 — call once the React tree mounts; also refreshes the mirror. */
export async function initTheme(): Promise<ThemeMode> {
  const mode = await readStoredTheme();
  applyThemeClass(resolveTheme(mode));
  writeMirror(mode);
  syncMediaListener(mode);
  return mode;
}

/** Persist + apply an explicit mode (called by the settings controls). */
export function setTheme(mode: ThemeMode): void {
  applyThemeClass(resolveTheme(mode));
  writeMirror(mode);
  syncMediaListener(mode);
  try {
    chrome.storage.local.set({ [STORAGE_KEY]: mode });
  } catch {
    /* ignore */
  }
}
