/**
 * Shared types for the v3 AI copilot upgrade.
 *
 * Everything the side panel, popup and overlay share: copilot threads with
 * per-symbol memory, AI personas + model selection, cached research notes,
 * price alerts and AI-authored chart drawings.
 */
import { BarChart3, Puzzle, Shield, Zap } from "lucide-react";

/* ── personas ────────────────────────────────────────────────────────── */

export interface CopilotPersona {
  id: PersonaId;
  name: string;
  /** Lucide icon component — no emoji, consistent with the rest of the UI. */
  Icon: React.ComponentType<{ size?: number | string; className?: string }>;
  description: string;
  systemPrompt: string;
}

export type PersonaId = "analyst" | "smc" | "scalper" | "risk";

export const PERSONAS: CopilotPersona[] = [
  {
    id: "analyst",
    name: "Analyst",
    Icon: BarChart3,
    description: "Balanced technical + fundamental view",
    systemPrompt:
      "You are AlgoVault AI in ANALYST mode. Give a balanced read of the chart context: trend, structure, momentum, key levels and the most probable scenario. Reference only levels that exist in the provided context — never fabricate prices. Structure answers as: read → key levels → scenario (bull/bear triggers) → what invalidates it.",
  },
  {
    id: "smc",
    name: "SMC",
    Icon: Puzzle,
    description: "Smart-money concepts: structure, liquidity, FVG",
    systemPrompt:
      "You are AlgoVault AI in SMART-MONEY mode. Analyse the chart context through market structure (BOS/CHOCH), liquidity (equal highs/lows, sweeps), fair value gaps, order blocks and premium/discount. Anchor every statement to the provided context data; never invent levels. Finish with a concrete plan: entry zone, invalidation, and targets implied by the context.",
  },
  {
    id: "scalper",
    name: "Scalper",
    Icon: Zap,
    description: "Fast tactical entries on low timeframes",
    systemPrompt:
      "You are AlgoVault AI in SCALPER mode. Be terse and tactical. From the chart context give: bias, the immediate trigger to watch, entry zone, stop distance (respect the volatility ATR from context), and first target. One scenario at a time. If the context timeframe is too high for scalping, say so and suggest dropping to M1–M5.",
  },
  {
    id: "risk",
    name: "Risk",
    Icon: Shield,
    description: "Position sizing and risk-first planning",
    systemPrompt:
      "You are AlgoVault AI in RISK mode. Always answer in terms of risk first: position size from the account size and stop distance, R-multiples for targets, and what must be true for the trade to be worth taking. Use the ATR/volatility data from the context for stop placement. Never fabricate prices; if account size is unknown, show the formula and ask for the number.",
  },
];

/* ── threads & memory ───────────────────────────────────────────────── */

export interface CopilotMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: number;
  model?: string | null;
  personaId?: PersonaId;
}

export interface CopilotThread {
  id: string;
  /** `${SYMBOL}|${TIMEFRAME}` — the thread's chart identity. */
  key: string;
  symbol: string;
  timeframe: string;
  title: string;
  messages: CopilotMessage[];
  createdAt: number;
  updatedAt: number;
}

/** Compact rolling memory injected into prompts so answers stay consistent. */
export interface CopilotMemory {
  bias?: string;
  keyLevels?: string[];
  plan?: string;
  notes?: string[];
  updatedAt?: number;
}

export interface CopilotPreferences {
  personaId: PersonaId;
  model: string | null;
  autoAnalyzeOnSwitch: boolean;
  streaming: boolean;
}

export const DEFAULT_COPILOT_PREFS: CopilotPreferences = {
  personaId: "analyst",
  model: null,
  autoAnalyzeOnSwitch: false,
  streaming: false,
};

/* ── research notes ─────────────────────────────────────────────────── */

export type ResearchKind = "quick" | "deep";

export interface ResearchNote {
  symbol: string;
  kind: ResearchKind;
  content: string;
  model?: string | null;
  generatedAt: number;
  personaId?: PersonaId;
}

/* ── alerts ─────────────────────────────────────────────────────────── */

export interface ExtensionAlert {
  id: string;
  symbol: string;
  type: string;
  targetPrice?: number;
  timeframe: string;
  message: string;
  triggered?: boolean;
  triggeredAt?: number;
  createdAt: number;
}

export type AlertType =
  | "price_above"
  | "price_below"
  | "structure_bos"
  | "structure_choch"
  | "zone_entry"
  | "volatility_high"
  | "session_start";

/* ── smart drawings (AI-authored, on-chart overlay) ─────────────────── */

export type SmartDrawingKind =
  | "hline"
  | "hzone"
  | "trendline"
  | "label";

export interface SmartDrawing {
  id: string;
  kind: SmartDrawingKind;
  /** Display label, e.g. "Resistance", "Long entry", "FVG". */
  label: string;
  /** Semantic color group; rendered from a fixed palette. */
  tone: "support" | "resistance" | "entry" | "stop" | "target" | "info";
  /** Horizontal line / zone: price anchor(s) in quote currency. */
  price?: number;
  price2?: number;
  /** Trendline anchors as fractions of the visible range (0=left, 1=right) and prices. */
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  /** Label-only drawings anchor to a price and a horizontal fraction. */
  x?: number;
}

export interface SmartDrawingSet {
  id: string;
  symbol: string;
  timeframe: string;
  /** Visible range used when the set was authored (for trendline anchoring). */
  from?: number | null;
  to?: number | null;
  drawings: SmartDrawing[];
  createdAt: number;
}

export const TONE_COLORS: Record<SmartDrawing["tone"], string> = {
  support: "#34d399",
  resistance: "#fb7185",
  entry: "#60a5fa",
  stop: "#f43f5e",
  target: "#34d399",
  info: "#c4b5fd",
};

/* ── chart commands (automation) ────────────────────────────────────── */

export type ChartCommandType =
  | "set_symbol"
  | "set_timeframe"
  | "toggle_watchlist";

export interface ChartCommandResult {
  ok: boolean;
  message?: string;
}
