/**
 * AlgoVault extension design system — Tailwind v3 config (shadcn/ui Zinc).
 *
 * Semantic tokens come from src/styles/tokens.css (`:root` light,
 * `.dark` dark) via `hsl(var(--token) / <alpha-value>)` so opacity
 * modifiers (`bg-accent/50`) work in both themes. Palette families
 * (emerald/rose/amber/neutral) stay available for data visualisation,
 * but UI surfaces/text must use the semantic tokens.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  // Class strategy: src/theme.ts toggles `light`/`dark` on <html>.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ── shadcn/ui semantic tokens (theme-aware) ──
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          fill: "hsl(var(--destructive-fill) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
        },
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
        },

        // ── brand: AlgoVault orange (brand actions/accents only) ──
        brand: {
          100: "#fbe3cf",
          300: "#f0995c",
          400: "#e67e2e",
          500: "#de661c", // signature AlgoVault orange
          600: "#bc5415",
          700: "#96410f",
          DEFAULT: "#de661c",
          foreground: "hsl(var(--brand-foreground) / <alpha-value>)",
          // AA-safe brand *fill* for solid CTAs with white text.
          fill: {
            DEFAULT: "hsl(var(--brand-fill) / <alpha-value>)",
            hover: "hsl(var(--brand-fill-hover) / <alpha-value>)",
          },
        },

        // ── single-meaning trading / status semantics (themed) ──
        positive: {
          DEFAULT: "hsl(var(--positive) / <alpha-value>)",
          fill: "hsl(var(--positive-fill) / <alpha-value>)",
        },
        negative: {
          DEFAULT: "hsl(var(--negative) / <alpha-value>)",
          fill: "hsl(var(--negative-fill) / <alpha-value>)",
        },
        warning: "hsl(var(--warning) / <alpha-value>)",
        // `destructive` is the AA text colour; `destructive-fill` backs white text.
        // (`destructive` is overridden below into an object form.)
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "SF Mono", "Fira Code", "monospace"],
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [
    /**
     * `font-numeric` — tabular figures for every number in the product
     * (prices, quantities, P/L, balances). Declared as a utility instead of a
     * font family so it composes with the inherited UI font.
     */
    function ({ addUtilities }) {
      addUtilities({
        ".font-numeric": { fontVariantNumeric: "tabular-nums" },
      });
    },
  ],
};
