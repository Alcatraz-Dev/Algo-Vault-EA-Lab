/** Concept / copy-generation templates (data-driven, 10 types). Pure module. */
import { MarketingTemplateId } from "./collections";

export interface ConceptOutput {
  conceptId: string;
  hook: string;
  hookLength: number;
  cta: string;
  angle: string;
  demoLabel?: boolean;
}

export function generateConceptForTemplate(
  templateId: MarketingTemplateId,
  feature: string,
  audience: string
): ConceptOutput {
  const base = { conceptId: `cpt_${templateId.toLowerCase()}`, feature, audience, demoLabel: true };
  switch (templateId) {
    case "HOOK_EDU": return { ...base, hook: `Why traders misunderstand ${feature}: a quick clarification.`, hookLength: 58, cta: "See the breakdown — no hype, just mechanics.", angle: "Education / myth-busting" };
    case "FEATURE_SPOTLIGHT": return { ...base, hook: `The one feature that changes how you use AlgoVault: ${feature}.`, hookLength: 62, cta: "Try it in your workflow today.", angle: "Product spotlight" };
    case "HOW_IT_WORKS": return { ...base, hook: `How ${feature} works — in 60 seconds, no fluff.`, hookLength: 42, cta: "Walk through the steps.", angle: "Tutorial / process" };
    case "USE_CASE": return { ...base, hook: `Real-world use case: using ${feature} for ${audience}.`, hookLength: 55, cta: "Explore the scenario.", angle: "Use case" };
    case "MYTH_VS_FACT": return { ...base, hook: `Myth vs fact: does ${feature} really do that?`, hookLength: 47, cta: "Check the evidence.", angle: "Myth-busting" };
    case "COMPARISON": return { ...base, hook: `How ${feature} compares — honest, side-by-side.`, hookLength: 51, cta: "Compare for yourself.", angle: "Comparison" };
    case "LIFECYCLE": return { ...base, hook: `The lifecycle of a signal using ${feature} — from idea to action.`, hookLength: 66, cta: "Track the cycle.", angle: "Lifecycle" };
    case "MARKET_CONTEXT": return { ...base, hook: `What today's market context means for ${feature}.`, hookLength: 56, cta: "Interpret the context.", angle: "Market context" };
    case "RISK_FIRST": return { ...base, hook: `First, the risk: what ${feature} can and can't do.`, hookLength: 52, cta: "Review the risks.", angle: "Risk-first" };
    case "CTA_DRIVE": return { ...base, hook: `Ready for ${feature}? Here's the direct path.`, hookLength: 42, cta: "Start now — demo only, no guaranteed outcome.", angle: "CTA" };
    default: return { ...base, hook: `Learn about ${feature}.`, hookLength: 30, cta: "Explore.", angle: "General" };
  }
}
