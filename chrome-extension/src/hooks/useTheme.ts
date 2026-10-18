import { useEffect, useState } from "react";

import { readStoredTheme, setTheme, type ThemeMode } from "@/theme";

/**
 * Reactive access to the app-wide theme. `resolvedTheme` collapses the
 * `system` mode to the concrete `light`/`dark` value the media query
 * currently reports, which is what components need to pick icons/labels.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [systemDark, setSystemDark] = useState(
    () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
  );

  useEffect(() => {
    let cancelled = false;
    void readStoredTheme().then((mode) => {
      if (!cancelled) setThemeState(mode);
    });
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    media.addEventListener("change", onChange);
    return () => {
      cancelled = true;
      media.removeEventListener("change", onChange);
    };
  }, []);

  const resolvedTheme: "light" | "dark" =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;

  const set = (mode: ThemeMode) => {
    setThemeState(mode);
    void setTheme(mode);
  };

  return {
    theme,
    setTheme: set,
    resolvedTheme,
    isDark: resolvedTheme === "dark",
  };
}
