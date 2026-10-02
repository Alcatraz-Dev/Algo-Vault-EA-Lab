/**
 * AlgoVault extension design tokens.
 * Mirrors the main platform (app/globals.css): #0f0f0f background, #181818
 * cards, signature orange #ff4d00 as the single brand accent. Light mode
 * mirrors the platform's `.light` palette (#f9f9f9 / #ffffff / #262626).
 *
 * Surfaces and text resolve from CSS custom properties declared in
 * popup/styles.css, so switching the `light` class on <html> re-themes the
 * whole popup without re-rendering (same mechanism as the website).
 * NOTE: this file extends (not replaces) Tailwind's default palettes, so
 * emerald/rose/amber scales remain available for bullish/bearish semantics.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── brand (identical in both themes, like the platform) ──
        brand: {
          300: "#ff8a5c",
          400: "#ff6b26",
          500: "#ff4d00", // signature AlgoVault orange
          600: "#e64500",
          700: "#c23c00",
          100: "#ffe6db",
        },
        // ── surfaces (theme-aware via CSS vars) ──
        base: "var(--av-base)",
        card: "var(--av-card)",
        raised: "var(--av-raised)",
        edge: "var(--av-edge)",
        ink: {
          DEFAULT: "var(--av-ink)",
          mute: "var(--av-ink-mute)",
          faint: "var(--av-ink-faint)",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "SF Mono", "Fira Code", "monospace"],
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
};
