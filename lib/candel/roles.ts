/**
 * AlgoVault Candel SDK — Role Catalog
 *
 * A Candel's *role* is its job description: what it is for, how risky its
 * default posture is, and which skill families it draws on. Roles are a closed
 * catalog — a Candel instance may only carry a role declared here, so the UI,
 * the agent contract and the permission engine all agree on one vocabulary.
 *
 * Presentation-only data lives here (label, tagline, icon key, accent). The
 * machine-readable capability and tool strings stay on the template
 * (`templates/defaults.ts`) so there is exactly one source of truth for what a
 * specialist is technically allowed to touch.
 */

import type { CandelRole } from "./types";

/**
 * How much damage a role can do by design.
 * Read-only roles can never be granted execution; approval-gated roles always
 * route live actions through the human approval card.
 */
export type CandelRiskPosture = "read_only" | "advisory" | "approval_gated";

export interface CandelRoleSpec {
  id: CandelRole;
  /** Human label shown in pickers, cards and headers. */
  label: string;
  /** One line: what this Candel is for. */
  tagline: string;
  /** Longer explanation shown in the create/customize dialog. */
  description: string;
  /** lucide-react icon name, resolved by `components/candel/role-visuals`. */
  icon: string;
  /** Accent token used for the avatar ring and role chip. */
  accent: "blue" | "violet" | "amber" | "rose" | "emerald" | "cyan" | "slate";
  /** Default posture — a role can never exceed this. */
  riskPosture: CandelRiskPosture;
  /** Human-readable skill list for the UI (not permission strings). */
  skills: string[];
  /** Pro-gated roles are hidden for free accounts. */
  proOnly?: boolean;
}

export const CANDEL_ROLES: CandelRoleSpec[] = [
  {
    id: "market-analyst",
    label: "Market Analyst",
    tagline: "Reads market structure across timeframes",
    description:
      "Trend, BOS/CHoCH, liquidity pools, fair value gaps and order blocks. Separates observed facts from interpretation and states data limitations.",
    icon: "LineChart",
    accent: "blue",
    riskPosture: "read_only",
    skills: ["Market structure", "Liquidity & FVG", "Order blocks", "Multi-timeframe"],
  },
  {
    id: "hunter",
    label: "Setup Hunter",
    tagline: "Scans symbols and ranks setups",
    description:
      "Scans the symbols and watchlists you name and returns ranked, concrete setups with entry, invalidation, targets and the evidence behind each.",
    icon: "Crosshair",
    accent: "emerald",
    riskPosture: "advisory",
    skills: ["Symbol scan", "Setup ranking", "Watchlists", "Alerts"],
  },
  {
    id: "quant",
    label: "Quant Researcher",
    tagline: "Backtests, walk-forward and Monte Carlo",
    description:
      "Runs and interprets backtests, out-of-sample and robustness analysis. Reports sample size and degradation honestly instead of selling an over-fit edge.",
    icon: "FlaskConical",
    accent: "violet",
    riskPosture: "read_only",
    skills: ["Backtests", "Walk-forward", "Monte Carlo", "Robustness"],
  },
  {
    id: "sentinel",
    label: "Risk Sentinel",
    tagline: "Watches exposure and challenge rules",
    description:
      "Monitors equity, margin usage, open exposure and challenge rules. Surfaces warnings early and recommends concrete de-risking. Fails closed when account context is missing.",
    icon: "ShieldAlert",
    accent: "amber",
    riskPosture: "read_only",
    skills: ["Account risk", "Margin & exposure", "Challenge rules", "Warnings"],
  },
  {
    id: "journal",
    label: "Trade Journal",
    tagline: "Reviews closed trades for patterns",
    description:
      "Turns trade history into a performance narrative: win rate, expectancy, drawdown drivers and the behavioural patterns that repeat.",
    icon: "NotebookPen",
    accent: "cyan",
    riskPosture: "advisory",
    skills: ["Performance review", "Mistake patterns", "Journal entries", "Reporting"],
  },
  {
    id: "executor",
    label: "Execution Planner",
    tagline: "Prepares approval-gated order proposals",
    description:
      "Turns an idea into a precise order proposal — instrument, direction, entry, stop, targets, size and reasoning. Every live action goes through your explicit approval against a named account.",
    icon: "Send",
    accent: "rose",
    riskPosture: "approval_gated",
    skills: ["Order proposals", "Position sizing", "Named accounts", "Human approval"],
  },
  {
    id: "tradingview",
    label: "TradingView Research",
    tagline: "Indicators, strategies and saved layouts",
    description:
      "Inspects TradingView indicators, strategies and alerts, summarizes the findings and prepares actions for your approval.",
    icon: "CandlestickChart",
    accent: "blue",
    riskPosture: "read_only",
    skills: ["Indicators", "Strategies", "Alerts", "Chart context"],
    proOnly: true,
  },
  {
    id: "ea",
    label: "EA Engineer",
    tagline: "MT5/MT4 Expert Advisor work",
    description:
      "Assists with Expert Advisor design, parameter optimisation, walk-forward validation and debugging, preferring robustness over curve fit.",
    icon: "Cpu",
    accent: "violet",
    riskPosture: "read_only",
    skills: ["EA design", "Optimisation", "Validation", "Debugging"],
    proOnly: true,
  },
  {
    id: "writer",
    label: "Research Writer",
    tagline: "Turns analysis into clear briefs",
    description:
      "Produces concise, well-structured briefs and reports from analysis you already have. Cites the evidence it was given and never fabricates data.",
    icon: "FileText",
    accent: "slate",
    riskPosture: "read_only",
    skills: ["Briefs", "Reports", "Documentation", "Summaries"],
  },
  {
    id: "general-assistant",
    label: "General Assistant",
    tagline: "Flexible research and drafting coworker",
    description:
      "A generalist for research, drafting, summarizing and reasoning about your trading workflow. Asks for missing context instead of guessing.",
    icon: "Sparkles",
    accent: "slate",
    riskPosture: "advisory",
    skills: ["Research", "Drafting", "Summaries", "Reasoning"],
  },
];

const ROLE_BY_ID: Record<string, CandelRoleSpec> = Object.fromEntries(
  CANDEL_ROLES.map((role) => [role.id, role])
);

/** The role a Candel falls back to when it carries an unknown/legacy role. */
export const DEFAULT_CANDEL_ROLE: CandelRole = "general-assistant";

export function isCandelRole(value: unknown): value is CandelRole {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ROLE_BY_ID, value);
}

/**
 * Resolve a role spec. Unknown or legacy role strings degrade to the general
 * assistant instead of throwing, so old rows keep rendering.
 */
export function getCandelRole(role: unknown): CandelRoleSpec {
  return (typeof role === "string" ? ROLE_BY_ID[role] : undefined) ?? ROLE_BY_ID[DEFAULT_CANDEL_ROLE];
}

export function candelRoleLabel(role: unknown): string {
  return getCandelRole(role).label;
}

/** Roles the UI should offer, optionally filtered for the account's plan. */
export function selectableCandelRoles(opts: { isPro?: boolean } = {}): CandelRoleSpec[] {
  return CANDEL_ROLES.filter((role) => (opts.isPro ? true : !role.proOnly));
}
