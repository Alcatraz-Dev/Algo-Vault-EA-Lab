/**
 * AlgoVault extension design tokens.
 * Mirrors the main platform (app/globals.css): #0f0f0f background, #181818
 * cards, signature orange #ff4d00 as the single brand accent.
 * NOTE: this file extends (not replaces) Tailwind's default palettes, so
 * emerald/rose/amber scales remain available for bullish/bearish semantics.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── brand (aligned with platform globals.css) ──
        brand: {
          300: "#ff8a5c",
          400: "#ff6b26",
          500: "#ff4d00", // signature AlgoVault orange
          600: "#e64500",
          700: "#c23c00",
          100: "#ffe6db",
        },
        // ── surfaces ──
        base: "#0f0f0f",      // app background
        card: "#181818",      // card surface
        raised: "#232323",    // secondary surface / inputs
        edge: "#383838",      // borders
        ink: {
          DEFAULT: "#f9f9f9", // primary text
          mute: "#a3a3a3",    // secondary text
          faint: "#737373",   // tertiary text
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
