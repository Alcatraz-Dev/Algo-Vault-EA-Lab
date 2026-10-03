/**
 * Marketing Agent — Product Knowledge Agent (§10, §50, §59, §74).
 *
 * The single source of truth for what the agent is allowed to SAY about
 * AlgoVault and which product routes a browser demo may open.
 *
 * Everything here is deliberately static and reviewable:
 *  - `routes` are real app routes that exist in this repository. The agent
 *    never invents a URL at runtime (§35).
 *  - `approvedClaims` / `benefits` are the only statements allowed to reach a
 *    creative without a human review. Anything else is classified UNVERIFIED
 *    and must be blocked by `runClaimValidation` (§51).
 *  - `publicFacing: false` removes a feature from marketing consideration
 *    entirely — the agent may not reference private research or internal
 *    systems (§59).
 *
 * Pure module: no I/O.
 */

import type { ProductFact, ProductFeature } from "./types";
import type { MarketingPlatform, ProductDataClassification } from "./collections";

const DISCLAIMER_HINT = "trading";

export const PRODUCT_FEATURES: ProductFeature[] = [
  {
    key: "ai-signals",
    name: "AI Signals",
    summary:
      "AI Signals surfaces market analysis for selected instruments so traders can review a setup, its context and the reasoning behind it.",
    routes: ["/signals", "/signals/pro"],
    approvedClaims: [
      "Review AI-generated analysis for selected instruments.",
      "See the reasoning context alongside each signal.",
      "Open a signal to inspect its detail before deciding anything.",
    ],
    benefits: [
      "Saves the first pass of chart reading.",
      "Puts analysis and context in one place.",
      "Works alongside your own process instead of replacing it.",
    ],
    audience: ["discretionary traders", "signal followers", "new traders"],
    landingPath: "/signals",
    publicFacing: true,
    proGated: true,
    tradingSensitive: true,
    keywords: ["ai signals", "signal", "signals", "ai signal", "signal detail"],
  },
  {
    key: "scalping-terminal",
    name: "Scalping Terminal",
    summary:
      "A fast, focused terminal layout for traders who work on short timeframes and need dense market information at a glance.",
    routes: ["/scalping-terminal", "/market-intelligence/scalping"],
    approvedClaims: [
      "A dense, short-timeframe trading workspace.",
      "Keep quotes, depth and charts in a single view.",
    ],
    benefits: ["Fewer context switches on fast markets.", "Built for short-hold workflows."],
    audience: ["scalpers", "short-term traders"],
    landingPath: "/scalping-terminal",
    publicFacing: true,
    proGated: true,
    tradingSensitive: true,
    keywords: ["scalping terminal", "scalping", "scalper", "terminal"],
  },
  {
    key: "market-intelligence",
    name: "Market Intelligence",
    summary:
      "Market Intelligence combines deterministic market analysis with an AI interpretation layer over the same data.",
    routes: ["/market-intelligence", "/market-intelligence/advanced"],
    approvedClaims: [
      "Deterministic analysis with an AI interpretation layer.",
      "Explore market context and analysis in one workspace.",
    ],
    benefits: ["One surface for data and interpretation.", "Explainable, layered analysis."],
    audience: ["analytical traders", "research-driven traders"],
    landingPath: "/market-intelligence",
    publicFacing: true,
    proGated: false,
    tradingSensitive: true,
    keywords: ["market intelligence", "intelligence", "analysis", "advanced analysis"],
  },
  {
    key: "strategy-lab",
    name: "Strategy Lab",
    summary:
      "Strategy Lab is a workspace for designing, testing and refining trading strategies against historical data.",
    routes: ["/strategy-lab"],
    approvedClaims: [
      "Design and test strategies against historical data.",
      "Review results before risking anything.",
    ],
    benefits: ["Test ideas before committing.", "Iterate with structured feedback."],
    audience: ["systematic traders", "strategy designers"],
    landingPath: "/strategy-lab",
    publicFacing: true,
    proGated: false,
    tradingSensitive: true,
    keywords: ["strategy lab", "strategy", "strategies", "backtest strategy"],
  },
  {
    key: "workflow-automation",
    name: "Workflow Automation",
    summary:
      "Workflow Automation lets users build visual, event-driven flows that connect market data, analysis and notifications.",
    routes: ["/workflows"],
    approvedClaims: [
      "Build visual, event-driven automation without code.",
      "Connect market data, analysis and notifications.",
    ],
    benefits: ["Repetitive steps run themselves.", "Visible, editable logic instead of a black box."],
    audience: ["technical traders", "automation-minded users"],
    landingPath: "/workflows",
    publicFacing: true,
    proGated: true,
    tradingSensitive: false,
    keywords: ["workflow", "workflows", "automation", "workflow automation"],
  },
  {
    key: "backtesting",
    name: "Backtesting",
    summary:
      "Backtesting replays historical data through a strategy so users can inspect behaviour over past market conditions.",
    routes: ["/backtests", "/walk-forward", "/monte-carlo"],
    approvedClaims: [
      "Replay strategies against historical data.",
      "Inspect behaviour over past market conditions.",
    ],
    benefits: ["Evidence before allocation.", "Supports robustness checks."],
    audience: ["systematic traders"],
    landingPath: "/backtests",
    publicFacing: true,
    proGated: false,
    tradingSensitive: true,
    keywords: ["backtest", "backtesting", "walk forward", "monte carlo"],
  },
  {
    key: "marketplace",
    name: "Marketplace",
    summary:
      "The Marketplace lists trading strategies and tools with their reported metadata so users can compare before adopting.",
    routes: ["/marketplace"],
    approvedClaims: ["Compare listed strategies and tools with their reported metadata."],
    benefits: ["Discovery with visible metadata.", "Compare before you adopt."],
    audience: ["traders looking for ready-made tools"],
    landingPath: "/marketplace",
    publicFacing: true,
    proGated: false,
    tradingSensitive: true,
    keywords: ["marketplace", "strategies marketplace", "store"],
  },
  {
    key: "live-trading",
    name: "Live Trading & Gateway",
    summary:
      "Live Trading connects the platform to an execution gateway so users can monitor connection state and manage orders.",
    routes: ["/live", "/trading"],
    approvedClaims: ["Monitor gateway connection state and manage orders from one place."],
    benefits: ["Visible connection state.", "Execution and monitoring in one surface."],
    audience: ["active traders"],
    landingPath: "/live",
    publicFacing: true,
    proGated: true,
    tradingSensitive: true,
    keywords: ["live trading", "gateway", "execution", "trading terminal"],
  },
  {
    key: "copy-trading",
    name: "Copy Trading",
    summary:
      "Copy Trading lets users review strategies and decide whether to mirror them in their own account.",
    routes: ["/copy-trading"],
    approvedClaims: ["Review strategies and choose what to mirror."],
    benefits: ["Follow with control.", "Transparent review before you commit."],
    audience: ["time-poor traders"],
    landingPath: "/copy-trading",
    publicFacing: true,
    proGated: false,
    tradingSensitive: true,
    keywords: ["copy trading", "copy", "mirror"],
  },
  {
    key: "risk-tools",
    name: "Risk Tools",
    summary:
      "Risk tools give traders position sizing, exposure and drawdown guardrails before and during a trade.",
    routes: ["/risk"],
    approvedClaims: ["Size positions and check exposure before entering."],
    benefits: ["Guardrails before execution.", "Clear exposure picture."],
    audience: ["all traders"],
    landingPath: "/risk",
    publicFacing: true,
    proGated: false,
    tradingSensitive: true,
    keywords: ["risk", "risk management", "exposure", "position sizing"],
  },
  {
    key: "ai-copilot",
    name: "AI Copilot",
    summary:
      "AI Copilot is an assistant inside the platform that helps users interpret data and navigate their workflow.",
    routes: ["/ai-copilot"],
    approvedClaims: ["Ask questions about your data and workflow in context."],
    benefits: ["Less time hunting for context.", "Guided navigation of a dense product."],
    audience: ["all traders"],
    landingPath: "/ai-copilot",
    publicFacing: true,
    proGated: true,
    tradingSensitive: false,
    keywords: ["ai copilot", "copilot", "assistant", "ai assistant"],
  },
  {
    key: "platform-overview",
    name: "AlgoVault Platform",
    summary:
      "AlgoVault is a trading intelligence platform combining market analysis, strategy research, testing and execution tooling in one place.",
    routes: ["/", "/analysis", "/insights"],
    approvedClaims: [
      "Analysis, research, testing and execution tooling in one place.",
      "One workflow from idea to review.",
    ],
    benefits: ["Fewer disconnected tools.", "A single workflow across the process."],
    audience: ["traders", "strategy developers"],
    landingPath: "/",
    publicFacing: true,
    proGated: false,
    tradingSensitive: false,
    keywords: ["algovault", "platform", "trading platform", "everything"],
  },
];

/** Features the agent may never mention in marketing (§59). */
export const NON_MARKETABLE_FEATURE_KEYS = [
  "internal-research",
  "admin-console",
  "billing",
  "customer-accounts",
] as const;

const KEYWORD_INDEX: { keyword: string; key: string }[] = PRODUCT_FEATURES.flatMap((f) =>
  f.keywords.map((keyword) => ({ keyword: keyword.toLowerCase(), key: f.key }))
).sort((a, b) => b.keyword.length - a.keyword.length);

/**
 * Resolve which product(s) a natural-language instruction refers to (§4 Task 2).
 * Longest-keyword-first so "ai signals" beats "signal".
 */
export function resolveProducts(prompt: string): string[] {
  const text = prompt.toLowerCase();
  const hits = new Set<string>();
  for (const { keyword, key } of KEYWORD_INDEX) {
    if (text.includes(keyword)) hits.add(key);
  }
  // "promote X" / "make a video about X" with no keyword match falls back to
  // the platform overview rather than inventing a feature.
  if (hits.size === 0) hits.add("platform-overview");
  return Array.from(hits);
}

export function getFeature(key: string): ProductFeature | undefined {
  return PRODUCT_FEATURES.find((f) => f.key === key);
}

/** Public-facing, marketing-eligible features (§59, §74). */
export function listMarketableFeatures(proEligible = true): ProductFeature[] {
  return PRODUCT_FEATURES.filter((f) => f.publicFacing && (proEligible || !f.proGated));
}

/**
 * Choose the strongest features to demonstrate when the prompt is freeform
 * ("Explore the platform yourself"). Selection is deterministic and only ever
 * draws from the approved catalogue — it never invents capabilities (§74).
 */
export function selectFeaturesForFreeformPrompt(
  prompt: string,
  max = 3
): ProductFeature[] {
  const resolved = resolveProducts(prompt).filter((k) => k !== "platform-overview");
  const chosen = resolved.map((k) => getFeature(k)).filter((f): f is ProductFeature => !!f);
  if (chosen.length >= max) return chosen.slice(0, max);

  const lower = prompt.toLowerCase();
  const scored = listMarketableFeatures()
    .filter((f) => !chosen.some((c) => c.key === f.key))
    .map((f) => ({ f, score: f.keywords.reduce((s, k) => (lower.includes(k) ? s + 2 : s), 0) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.f);

  return [...chosen, ...scored].slice(0, max);
}

/**
 * Facts eligible to enter a creative (§50). Statements are pre-classified at
 * authoring time; runtime never reclassifies them upward.
 */
export function getProductFacts(now = Date.now()): ProductFact[] {
  return PRODUCT_FEATURES.flatMap((f) =>
    f.approvedClaims.map((statement, i) => ({
      id: `${f.key}_claim_${i}`,
      productId: f.key,
      statement,
      classification: "MARKETING_SAFE" as const,
      source: "product-knowledge",
      updatedAt: now,
    }))
  );
}

/**
 * Classify arbitrary text proposed for a creative (§50). Only MARKETING_SAFE
 * content may flow automatically; everything else must be human-reviewed.
 */
export function classifyProductStatement(statement: string): ProductDataClassification {
  const text = statement.trim();
  if (!text) return "UNVERIFIED";

  const sensitivePatterns = [
    /api[_ -]?key/i,
    /password/i,
    /secret/i,
    /\bbalance\b/i,
    /\bemail\b/i,
    /broker credentials/i,
    /\bphone\b/i,
    /private (position|message|notification)/i,
  ];
  if (sensitivePatterns.some((re) => re.test(text))) return "SENSITIVE";

  const privatePatterns = [
    /\buser\b.*\b(id|uid)\b/i,
    /\bcustomer\b/i,
    /\baccount holder\b/i,
    /\binternal only\b/i,
  ];
  if (privatePatterns.some((re) => re.test(text))) return "PRIVATE";

  // Only statements that match an approved claim verbatim are marketing-safe.
  const normalized = text.replace(/\s+/g, " ").toLowerCase();
  const matched = PRODUCT_FEATURES.some((f) =>
    [...f.approvedClaims, f.summary, ...f.benefits].some((c) =>
      c.replace(/\s+/g, " ").toLowerCase() === normalized
    )
  );
  if (matched) return "MARKETING_SAFE";

  // Unverified statistics/performance language is never marketing-safe.
  if (/\d+(\.\d+)?\s*%|\b\d+x\b|users|customers|revenue|testimonial/i.test(text)) {
    return "UNVERIFIED";
  }
  return "UNVERIFIED";
}

/** Approved CTA destinations — never invented (§35). */
export function resolveCtaDestination(productKeys: string[], explicitUrl?: string | null): string | null {
  if (explicitUrl) {
    // Only same-site absolute paths are accepted from the prompt.
    if (/^https?:\/\//i.test(explicitUrl)) return null;
    return explicitUrl.startsWith("/") ? explicitUrl : `/${explicitUrl}`;
  }
  const first = productKeys.map((k) => getFeature(k)).find((f) => f?.landingPath);
  return first?.landingPath ?? "/";
}

/**
 * Choose the product page a browser demo should open (§5 Task 1/2).
 */
export function resolveDemoRoute(productKeys: string[]): { product: string; route: string } | null {
  for (const key of productKeys) {
    const f = getFeature(key);
    if (f && f.routes.length > 0) return { product: key, route: f.routes[0] };
  }
  return null;
}

/** Whether trading-risk disclaimer/disclaimer language must be applied (§17, §51). */
export function requiresTradingDisclaimer(productKeys: string[]): boolean {
  return productKeys.some((k) => getFeature(k)?.tradingSensitive ?? false);
}

/** Rough language the feature is sensitive about — used by the Creative Director. */
export function featureDirection(key: string): {
  show: string[];
  avoid: string[];
} {
  const f = getFeature(key);
  if (!f) return { show: ["The product interface"], avoid: ["Performance claims"] };
  const avoid = ["profitability claims", "guarantees", "live account balances"];
  if (f.tradingSensitive) avoid.push("any implication of future returns");
  if (f.proGated) avoid.push("free-tier availability for this feature");
  return {
    show: [f.summary, ...f.benefits],
    avoid,
  };
}

export { DISCLAIMER_HINT };
