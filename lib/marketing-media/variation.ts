/** Variation engine: cost-controlled, deduplicated, deterministic per seed.
 *  Pure module: never calls external service. Uses seed string + feature to
 *  produce consistent text/variations (hook, cta, caption, copy, script variants).
 */

import { MARKETING_DEFAULTS } from "./collections";

export type VariantKind = "hook" | "cta" | "caption" | "copy" | "script";

export interface VariantRecord {
  id: string;
  creativeId?: string;
  stage: string;
  kind: VariantKind;
  index: number;
  text: string;
  seed: string;
  aiEnhanced?: boolean;
  provider?: string;
}

function deterministicVariant(seed: string, kind: VariantKind, index: number, feature: string): string {
  const prefixes: Record<VariantKind, string[]> = {
    hook: ["Learn how", "Discover why", "See how", "Understand", "Explore"],
    cta: ["Start now", "Try today", "Explore the demo", "See the steps", "Begin"],
    caption: ["Short form:", "Quick note:", "In brief:", "Summary:", "Key point:"],
    copy: ["Here is how", "This means", "Consider", "Note that", "Remember"],
    script: ["Scene ", "Part ", "Step ", "Segment ", "Passage "],
  };
  const pool = prefixes[kind];
  const p = pool[index % pool.length];
  return `${p} ${feature} — variant ${index + 1} (seed=${seed.slice(0, 8)}). Demo only. Not real performance.`;
}

/** Create up to maxVariantCount variants. Must respect budget caps. */
export function generateVariants(
  feature: string,
  seed: string,
  stage: string,
  kind: VariantKind,
  count?: number
): VariantRecord[] {
  const n = Math.min(count ?? MARKETING_DEFAULTS.defaultVariantCount, MARKETING_DEFAULTS.maxVariantCount);
  const out: VariantRecord[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `var_${kind}_${seed.slice(0, 6)}_${i}`,
      stage,
      kind,
      index: i,
      text: deterministicVariant(seed, kind, i, feature),
      seed,
      aiEnhanced: false,
    });
  }
  return out;
}

/** Deduplicate by seed + kind + text fingerprint. */
export function deduplicateVariants(records: VariantRecord[]): VariantRecord[] {
  const seen = new Set<string>();
  return records.filter((r) => {
    const key = `${r.seed}:${r.kind}:${r.text.slice(0, 120)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}