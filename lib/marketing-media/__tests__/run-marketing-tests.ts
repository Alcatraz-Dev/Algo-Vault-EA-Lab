/** Marketing Content Factory — tests.
 * Pure-function / module-level verification. No Firebase, no I/O.
 */
import { generateConceptForTemplate } from "../concepts";
import { generateVariants, deduplicateVariants } from "../variation";
import { generateCaptionsFromScript, captionsToSrt } from "../captions";
import { runMediaCompliance } from "../compliance";
import { MARKETING_PIPELINE_STAGES, MARKETING_TEMPLATE_IDS } from "../collections";

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error("FAILED: " + label);
  console.log("PASS: " + label);
}

export function runMarketingTests() {
  console.log("=== Marketing Tests ===");
  assert(typeof generateConceptForTemplate === "function", "concept generator exported");
  assert(MARKETING_PIPELINE_STAGES.includes("concept"), "pipeline includes concept");
  assert(MARKETING_TEMPLATE_IDS.includes("HOOK_EDU"), "template IDs include HOOK_EDU");

  const out = generateConceptForTemplate("HOOK_EDU", "AlgoVault", "traders");
  assert(out.hook.length > 0, "concept hook not empty");
  assert(out.cta.length > 0, "concept cta not empty");

  const variants = generateVariants("AlgoVault", "seed", "copy", "hook", 3);
  assert(variants.length === 3, "variant count matches");

  const deduped = deduplicateVariants(variants);
  assert(deduped.length === variants.length, "deduplicate preserves count");

  assert(typeof captionsToSrt === "function", "captionsToSrt exported");
  assert(typeof runMediaCompliance === "function", "compliance exported");

  console.log("=== All Marketing Tests PASS ===");
}

runMarketingTests();
