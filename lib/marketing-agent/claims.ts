/**
 * Marketing Agent — claim validation (§51) and product-data classification
 * (§50).
 *
 * Builds on the existing growth compliance engine (`lib/growth/compliance`)
 * instead of re-implementing it. Adds the marketing-specific blocked-phrase
 * list, factual rewrites and the "only approved claims may enter a creative"
 * gate.
 *
 * Pure module: no I/O.
 */

import { checkCompliance, appendRiskDisclosure } from "../growth/compliance";
import { RISK_DISCLOSURE_TEXT } from "../growth/constants";
import type { ClaimCheckResult } from "./types";
import { classifyProductStatement, PRODUCT_FEATURES } from "./product-knowledge";

export { appendRiskDisclosure };
export { RISK_DISCLOSURE_TEXT };

type BlockedPhrase = {
  rule: string;
  label: string;
  pattern: RegExp;
  /** Factual phrasing the agent should offer instead. */
  suggestion: string;
};

/** Absolutely blocked unless a verified legal/marketing policy allows it. */
const BLOCKED_PHRASES: BlockedPhrase[] = [
  {
    rule: "guaranteed_profit",
    label: "Guaranteed profit claim",
    pattern: /\bguaranteed\s+(profit|return|income|earning)s?\b/i,
    suggestion: "Explore market analysis and test strategies.",
  },
  {
    rule: "risk_free",
    label: "Risk-free claim",
    pattern: /\brisk[-\s]?free\b/i,
    suggestion: "Trading carries risk — review the details yourself.",
  },
  {
    rule: "absolute_accuracy",
    label: "100% accuracy claim",
    pattern: /\b100%\s*(accurate|accurarcy|win\s*rate|success|correct)\b|\b100%\s*(of\s+signals|precise)\b/i,
    suggestion: "Review AI-generated analysis and its context.",
  },
  {
    rule: "no_losses",
    label: "No-loss claim",
    pattern: /\b(no|without|never)\s+(losses|losing|lose)\b|\bnever\s+loses\b/i,
    suggestion: "Explore historical examples and test before you decide.",
  },
  {
    rule: "guaranteed_returns",
    label: "Guaranteed returns claim",
    pattern: /\bguarantee(?:d)?\s+(results?|returns?|gains?)\b/i,
    suggestion: "Test strategies against historical data.",
  },
  {
    rule: "get_rich_quick",
    label: "Get-rich-quick claim",
    pattern: /\bget\s+rich\s+(quick(?:ly)?|fast)\b|\bmake\s+\$?\d[\d,]*\s+(a|per|each)\s+(day|week|month)\b/i,
    suggestion: "Build a repeatable process instead.",
  },
  {
    rule: "invented_statistic",
    label: "Unverified statistic",
    pattern: /\b\d{2,3}(\.\d+)?\s*(%|x)\b(?![^]{0,20}\b(demo|illustration|historical example|hypothetical)\b)/i,
    suggestion: "Describe the workflow instead of quoting a number.",
  },
  {
    rule: "fabricated_social_proof",
    label: "Fabricated users / revenue / testimonial",
    pattern:
      /\b(\d[\d,.]*\+?\s*(users|customers|traders|subscribers|downloads)|trusted by \d|loved by \d|(amazing|incredible)\s+testimonial)\b/i,
    suggestion: "Describe what the product does — never invent an audience.",
  },
  {
    rule: "unverifiable_partnership",
    label: "Unverified partnership claim",
    pattern: /\b(partnered|partnership|official partner|integrated with)\s+(with\s+)?[A-Z][A-Za-z]+/i,
    suggestion: "Only state partnerships that exist in approved product facts.",
  },
];

/** Suggestion lookup used by the Creative Director when a claim is blocked. */
function suggestionFor(rule: string): string {
  return BLOCKED_PHRASES.find((b) => b.rule === rule)?.suggestion ?? "Describe the product workflow factually.";
}

/**
 * Validate every claim in a creative's text surfaces (§51).
 *
 * @param texts  All claim-bearing surfaces: hook, CTA, scene voiceover,
 *               on-screen text, captions, platform copy.
 */
export function runClaimValidation(
  texts: Array<{ field: string; text: string }>,
  options?: { policy?: "STRICT" | "STANDARD"; requireApprovedClaims?: boolean }
): ClaimCheckResult {
  const now = Date.now();
  const flags: ClaimCheckResult["flags"] = [];
  const suggestions: string[] = [];
  const strict = (options?.policy ?? "STRICT") === "STRICT";

  for (const { field, text } of texts) {
    if (!text) continue;
    const normalized = text.replace(/\s+/g, " ").trim();

    for (const blocked of BLOCKED_PHRASES) {
      if (!blocked.pattern.test(normalized)) continue;
      // The DEMO/ILLUSTRATION label relaxes the invented-statistic rule only.
      const labelled = /\b(demo|illustration|historical example|hypothetical)\b/i.test(normalized);
      if (blocked.rule === "invented_statistic" && !strict && labelled) continue;
      flags.push({
        rule: blocked.rule,
        label: blocked.label,
        severity: "high",
        excerpt: excerptOf(normalized, blocked.pattern),
      });
      suggestions.push(blocked.suggestion);
    }

    // Growth compliance rules (guarantees, fabricated performance, testimonials…)
    const base = checkCompliance(normalized, { isAffiliateContent: false });
    for (const f of base.flags) {
      if (flags.some((x) => x.rule === f.rule)) continue;
      flags.push({
        rule: f.rule,
        label: f.label,
        severity: f.severity === "high" ? "high" : f.severity === "medium" ? "medium" : "low",
        excerpt: f.matches[0] ?? "",
      });
      if (f.severity === "high") suggestions.push("Rewrite as a factual description of the product workflow.");
    }

    // Only approved product statements may flow automatically (§50).
    if (options?.requireApprovedClaims) {
      const classification = classifyProductStatement(normalized);
      if (classification !== "MARKETING_SAFE") {
        flags.push({
          rule: `product_data_${classification.toLowerCase()}`,
          label: `Product statement classified ${classification}`,
          severity: classification === "SENSITIVE" || classification === "PRIVATE" ? "high" : "medium",
          excerpt: normalized.slice(0, 120),
        });
        suggestions.push("Use one of the approved product claims from the product knowledge base.");
      }
    }
  }

  const blocked = flags.some((f) => f.severity === "high");
  return {
    passed: !blocked,
    blocked,
    flags,
    suggestions: Array.from(new Set(suggestions)),
    checkedAt: now,
  };
}

function excerptOf(text: string, pattern: RegExp): string {
  const m = pattern.exec(text);
  if (!m) return text.slice(0, 80);
  const start = Math.max(0, m.index - 30);
  const end = Math.min(text.length, m.index + m[0].length + 30);
  return text.slice(start, end);
}

/**
 * Deterministic, factual rewrites for the most common blocked patterns.
 * Used by the agent to repair a script instead of failing the whole run.
 * When no safe rewrite exists the caller must surface the block to a human.
 */
export function repairBlockedClaims(result: ClaimCheckResult, script: string): { text: string; repaired: boolean; remaining: number } {
  let text = script;
  let repaired = false;

  for (const flag of result.flags) {
    const suggestion = suggestionFor(flag.rule);
    if (flag.rule === "invented_statistic") continue; // never auto-rewrite numbers
    if (!flag.excerpt) continue;
    const escaped = flag.excerpt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "i");
    if (re.test(text)) {
      text = text.replace(re, suggestion);
      repaired = true;
    }
  }

  const recheck = runClaimValidation([{ field: "repaired", text }]);
  return { text, repaired, remaining: recheck.flags.filter((f) => f.severity === "high").length };
}

/** Factual language bank the Script agent must prefer for trading content (§51). */
export const FACTUAL_LANGUAGE_BANK = [
  "Analyze signals.",
  "Explore market setups.",
  "Review AI-generated analysis.",
  "Test strategies.",
  "Explore historical data.",
  "Inspect the reasoning context.",
  "Compare listed strategies.",
  "Review your exposure.",
] as const;

/** Approved claim pool for a set of products (used in prompts + QA). */
export function approvedClaimsFor(productKeys: string[]): string[] {
  const set = new Set<string>();
  for (const key of productKeys) {
    const f = PRODUCT_FEATURES.find((x) => x.key === key);
    if (!f) continue;
    set.add(f.summary);
    f.approvedClaims.forEach((c) => set.add(c));
    f.benefits.forEach((b) => set.add(b));
  }
  return Array.from(set);
}

/** Standard disclaimer applied to trading-adjacent creatives (§17, §40). */
export function defaultDisclaimer(): string {
  return RISK_DISCLOSURE_TEXT;
}
