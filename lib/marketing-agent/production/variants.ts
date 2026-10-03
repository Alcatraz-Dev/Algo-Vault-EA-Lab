/**
 * Marketing Agent — creative variants (§22, §23).
 *
 * One production request → hook / CTA / opening / voice / caption / visual /
 * duration / language / platform variants, each recorded with an unbroken
 * lineage back to the parent creative. Variants are derived from the parent
 * document — they never restart production from zero (§23, §67).
 *
 * Pure module: no I/O.
 */

import { MARKETING_AGENT_DEFAULTS, type MarketingPlatform } from "../collections";
import type { CreativeVersion, CreativeVersionKind } from "../types";

export type VariantKind = "HOOK" | "CTA" | "OPENING" | "VOICE" | "CAPTION" | "VISUAL" | "DURATION" | "LANGUAGE" | "PLATFORM";

export const VARIANT_KINDS: VariantKind[] = ["HOOK", "CTA", "OPENING", "VOICE", "CAPTION", "VISUAL", "DURATION", "LANGUAGE", "PLATFORM"];

const HOOK_LINES = [
  "Stop scrolling — this is how {product} works.",
  "Most traders never open {product}. Here is what they miss.",
  "You are one click away from {product}.",
  "{product} in {duration} seconds.",
  "This changes how you read the market.",
  "Before you trade again, look at this.",
];

const CTA_LINES = [
  "Open {product} inside AlgoVault.",
  "Try {product} today.",
  "Explore {product} in AlgoVault.",
  "See it for yourself — {product} is inside AlgoVault.",
];

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? k);
}

export type VariantSpec = {
  kind: VariantKind;
  label: string;
  /** What changes relative to the parent. */
  change: { field: string; value: string }[];
  /** What is intentionally kept (§75: reuse the demonstration). */
  keep: string[];
};

/**
 * Expand a parent creative into a bounded set of variant specs (§46 caps).
 */
export function buildVariantSpecs(input: {
  count: number;
  kinds?: VariantKind[];
  product: string;
  durationSec: number;
  /** Free-form tone instruction ("educational", "energetic", "premium"). */
  tone?: string;
  keepCapture?: boolean;
  platforms?: MarketingPlatform[];
}): VariantSpec[] {
  const count = Math.max(1, Math.min(input.count, MARKETING_AGENT_DEFAULTS.maxVariants));
  const kinds: VariantKind[] = input.kinds?.length ? input.kinds : (["HOOK", "CTA"] as VariantKind[]);
  const keep = [
    ...(input.keepCapture !== false ? ["browser capture", "product demonstration"] : []),
    "approved claims",
    "brand kit",
    "disclaimer",
  ];

  // Exactly `count` specs in total (not count × kinds) — the caller asked for
  // N variants, and the §46 cap is already baked into `count`.
  const specs: VariantSpec[] = [];
  outer: for (let i = 0; i < count; i++) {
    for (const kind of kinds) {
      if (specs.length >= count) break outer;
      const index = i;
      if (kind === "HOOK") {
        const line = fill(HOOK_LINES[index % HOOK_LINES.length], { product: input.product, duration: String(input.durationSec) });
        specs.push({ kind, label: `Hook ${index + 1}`, change: [{ field: "hook", value: line }], keep });
      } else if (kind === "CTA") {
        const line = fill(CTA_LINES[index % CTA_LINES.length], { product: input.product });
        specs.push({ kind, label: `CTA ${index + 1}`, change: [{ field: "cta", value: line }], keep });
      } else if (kind === "LANGUAGE") {
        specs.push({ kind, label: `Language ${index + 1}`, change: [{ field: "language", value: "target locale" }], keep });
      } else if (kind === "PLATFORM") {
        const platform = input.platforms?.[index % Math.max(1, input.platforms.length)] ?? "TIKTOK";
        specs.push({ kind, label: `Platform ${platform}`, change: [{ field: "platform", value: platform }], keep });
      } else if (kind === "TONE" as VariantKind) {
        specs.push({ kind, label: `Tone ${input.tone ?? "default"}`, change: [{ field: "tone", value: input.tone ?? "professional" }], keep });
      } else {
        specs.push({ kind, label: `${kind} ${index + 1}`, change: [{ field: kind.toLowerCase(), value: "variant" }], keep });
      }
    }
  }
  return specs.slice(0, count);
}

/**
 * Derive the version records for a set of variants, preserving lineage (§22).
 * Returns PARENT first, then each variant with `parentVersionId` set.
 */
export function deriveVersionLineage(input: {
  rootVersionId: string;
  parentVersion: CreativeVersion;
  specs: VariantSpec[];
  nextVersionNumber: (index: number) => number;
}): CreativeVersion[] {
  const out: CreativeVersion[] = [];
  let index = 0;
  for (const spec of input.specs) {
    const versionNumber = input.nextVersionNumber(index++);
    out.push({
      creativeId: input.parentVersion.creativeId,
      parentVersionId: input.parentVersion.id,
      rootVersionId: input.rootVersionId,
      kind: variantKindToVersionKind(spec.kind),
      version: versionNumber,
      label: spec.label,
      language: input.parentVersion.language,
      platform: spec.change.find((c) => c.field === "platform")?.value as MarketingPlatform | undefined,
      aspectRatio: input.parentVersion.aspectRatio,
      durationSec: input.parentVersion.durationSec,
      compositionId: input.parentVersion.compositionId,
      renderState: "NONE",
      scriptId: input.parentVersion.scriptId,
      browserCaptureId: input.parentVersion.browserCaptureId,
      createdAt: Date.now(),
      createdBy: input.parentVersion.createdBy,
    });
  }
  return out;
}

function variantKindToVersionKind(kind: VariantKind): CreativeVersionKind {
  return kind as CreativeVersionKind;
}

/** Remix operations for "make another version" commands (§23). */
export type RemixOperation =
  | { op: "keep"; target: "capture" | "composition" | "claims" | "brand" }
  | { op: "replace"; target: "hook" | "cta" | "tone" | "language" | "platform"; value: string }
  | { op: "remove"; target: "voiceover" | "captions" | "music" }
  | { op: "scale"; target: "variants"; count: number };

export function interpretRemix(input: {
  keepCapture: boolean;
  changeHook: boolean;
  changeCta: boolean;
  tone?: string;
  language?: string;
  platforms?: string[];
  count?: number;
  removeElements?: string[];
}): RemixOperation[] {
  const ops: RemixOperation[] = [];
  if (input.keepCapture) ops.push({ op: "keep", target: "capture" });
  ops.push({ op: "keep", target: "claims" }, { op: "keep", target: "brand" });
  if (input.changeHook) ops.push({ op: "replace", target: "hook", value: "regenerate" });
  if (input.changeCta) ops.push({ op: "replace", target: "cta", value: "regenerate" });
  if (input.tone) ops.push({ op: "replace", target: "tone", value: input.tone });
  if (input.language) ops.push({ op: "replace", target: "language", value: input.language });
  for (const platform of input.platforms ?? []) ops.push({ op: "replace", target: "platform", value: platform });
  for (const target of input.removeElements ?? []) {
    if (target === "voiceover") ops.push({ op: "remove", target: "voiceover" });
    if (target === "captions") ops.push({ op: "remove", target: "captions" });
    if (target === "music") ops.push({ op: "remove", target: "music" });
  }
  if (input.count && input.count > 1) ops.push({ op: "scale", target: "variants", count: input.count });
  return ops;
}
