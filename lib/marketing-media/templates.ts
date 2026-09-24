/** Data-driven content templates — 10 type ids mapped to labels and guidance.
 *  Pure module: used by the workflow engine, composer and the admin UI.
 *  Every template defines a conceptual structure; the actual content is
 *  generated per‑scene by the pipeline agents (script → copy → template → …).
 */

import { MarketingTemplateId } from "./collections";

export const MARKETING_TEMPLATE_LABELS: Record<MarketingTemplateId, string> = {
  HOOK_EDU: "Hook + Education",
  FEATURE_SPOTLIGHT: "Feature Spotlight",
  HOW_IT_WORKS: "How It Works",
  USE_CASE: "Use Case",
  MYTH_VS_FACT: "Myth vs Fact",
  COMPARISON: "Comparison",
  LIFECYCLE: "Lifecycle",
  MARKET_CONTEXT: "Market Context",
  RISK_FIRST: "Risk First",
  CTA_DRIVE: "CTA Drive",
};

export interface TemplateSpec {
  id: MarketingTemplateId;
  label: string;
  sceneCount: number; // typical number of video scenes
  ctaStrategy: "direct" | "educational" | "risk-first" | "demo-only";
}

export const MARKETING_TEMPLATE_SPECS: TemplateSpec[] = [
  { id: "HOOK_EDU", label: "Hook + Education", sceneCount: 3, ctaStrategy: "educational" },
  { id: "FEATURE_SPOTLIGHT", label: "Feature Spotlight", sceneCount: 3, ctaStrategy: "direct" },
  { id: "HOW_IT_WORKS", label: "How It Works", sceneCount: 4, ctaStrategy: "educational" },
  { id: "USE_CASE", label: "Use Case", sceneCount: 4, ctaStrategy: "direct" },
  { id: "MYTH_VS_FACT", label: "Myth vs Fact", sceneCount: 3, ctaStrategy: "risk-first" },
  { id: "COMPARISON", label: "Comparison", sceneCount: 4, ctaStrategy: "direct" },
  { id: "LIFECYCLE", label: "Lifecycle", sceneCount: 5, ctaStrategy: "direct" },
  { id: "MARKET_CONTEXT", label: "Market Context", sceneCount: 3, ctaStrategy: "educational" },
  { id: "RISK_FIRST", label: "Risk First", sceneCount: 3, ctaStrategy: "risk-first" },
  { id: "CTA_DRIVE", label: "CTA Drive", sceneCount: 2, ctaStrategy: "direct" },
];

/** Return the template spec for the given id, or the first as fallback. */
export function getTemplateSpec(id?: MarketingTemplateId): TemplateSpec {
  if (!id) return MARKETING_TEMPLATE_SPECS[0];
  const found = MARKETING_TEMPLATE_SPECS.find((t) => t.id === id);
  return found || MARKETING_TEMPLATE_SPECS[0];
}