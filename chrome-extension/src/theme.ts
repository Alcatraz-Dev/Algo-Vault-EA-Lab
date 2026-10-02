/**
 * Shared theme boot for every extension page (popup / options / sidepanel).
 *
 * Mirrors the website's system (components/theme/theme-init.tsx): the
 * `light`/`dark` class is toggled on <html>, `dark` is the default, and the
 * choice is persisted.
 *
 * Chrome storage is async, which would flash the wrong theme for one frame,
 * so the theme is applied in two phases:
 *   1. PRE-PAINT — a blocking inline script in each page's <head> reads the
 *      sessionStorage mirror (sync, populated below right before the popup
 *      closes / navigates) and sets the class before first paint.
 *   2. AUTHORITATIVE — the React tree loads the persisted setting from
 *      chrome.storage.local and applies it (heals a cold session where the
 *      mirror is empty).
 */

export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "avTheme";
const MIRROR_KEY = "avThemeMirror";

export function applyThemeClass(mode: ThemeMode): void {
  const el = document.documentElement;
  el.classList.toggle("light", mode === "light");
  el.classList.toggle("dark", mode !== "light");
}

/** Phase 1 — paste into a <script> tag in each HTML page's <head>. */
export const THEME_PREPAINT_SCRIPT = `(function(){try{var m=sessionStorage.getItem("${MIRROR_KEY}");if(m==="light"){document.documentElement.classList.add("light");document.documentElement.classList.remove("dark")}}catch(e){}})();`;

export function readStoredTheme(): Promise<ThemeMode> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        resolve(result[STORAGE_KEY] === "light" ? "light" : "dark");
      });
    } catch {
      resolve("dark");
    }
  });
}

/** Phase 2 — call once the React tree mounts; also refreshes the mirror. */
export async function initTheme(): Promise<ThemeMode> {
  const mode = await readStoredTheme();
  applyThemeClass(mode);
  try { sessionStorage.setItem(MIRROR_KEY, mode); } catch { /* ignore */ }
  return mode;
}

export function setTheme(mode: ThemeMode): void {
  applyThemeClass(mode);
  try {
    chrome.storage.local.set({ [STORAGE_KEY]: mode });
    sessionStorage.setItem(MIRROR_KEY, mode);
  } catch { /* ignore */ }
}
