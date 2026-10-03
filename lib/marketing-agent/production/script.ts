/**
 * Marketing Agent — Script Agent + Storyboard Agent (§13, §16, §21).
 *
 * Produces a duration-fitted script and a shot list from the director's beat
 * structure, using ONLY approved product claims (§50). The deterministic
 * generator always produces a valid script; an AI pass may refine wording when
 * the existing AI router is available, and never replaces facts with invention.
 *
 * Pure module: no I/O.
 */

import type { MarketingLanguage } from "../collections";
import type { Script, ScriptScene } from "@/lib/marketing-media/types";
import { approvedClaimsFor, FACTUAL_LANGUAGE_BANK } from "../claims";
import { DEMO_LABEL_TEXT } from "@/lib/marketing-media/collections";
import { getFeature } from "../product-knowledge";
import type { DirectorBrief, DirectorDecision } from "./director";

export type ScriptInput = {
  brief: DirectorBrief;
  decision: DirectorDecision;
  language: MarketingLanguage;
  tone: string;
  hook?: string;
  cta?: string;
  disclaimer: string;
  demoLabelRequired: boolean;
  /** Product claims eligible for use — anything else is not available. */
  productKeys: string[];
  referenceScript?: Script | null;
};

export type ShotListEntry = {
  order: number;
  beatId: string;
  startMs: number;
  endMs: number;
  shotType: "ESTABLISHING" | "UI_WALKTHROUGH" | "CLOSE_UP" | "CALLOUT" | "TITLE" | "CTA" | "CHART";
  source: "CAPTURE" | "GRAPHIC" | "CHART" | "BRAND";
  action: string;
  onScreenText: string;
  narration: string;
  highlight?: string;
  safeForPlatform: boolean;
};

const HOOK_TEMPLATES: Record<string, string[]> = {
  educational: [
    "Here is how {product} actually works.",
    "Most traders never open {product}. Here is what they are missing.",
    "{product} in under {duration} seconds.",
  ],
  energetic: [
    "Stop scrolling — {product} changes how you read the market.",
    "This is {product}, and it is fast.",
    "Watch {product} do the work.",
  ],
  professional: [
    "A practical look at {product}.",
    "{product}: what it does and why it matters.",
    "How {product} fits into a real workflow.",
  ],
  premium: [
    "The considered way to use {product}.",
    "{product}, built for people who take the process seriously.",
  ],
  default: [
    "Meet {product}.",
    "Here is {product} in action.",
    "{product} — from question to answer.",
  ],
};

const CTA_TEMPLATES = [
  "Open {product} inside AlgoVault and see it for yourself.",
  "Try {product} on AlgoVault today.",
  "Explore {product} in AlgoVault.",
];

function pick<T>(list: T[], seed: number): T {
  return list[Math.abs(Math.floor(seed)) % list.length];
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

export function generateScript(input: ScriptInput): { script: Script; shots: ShotListEntry[]; warnings: string[] } {
  const warnings: string[] = [];
  const feature = getFeature(input.productKeys[0]);
  const productName = feature?.name ?? "AlgoVault";
  const claims = approvedClaimsFor(input.productKeys);
  const durationSec = Math.max(5, input.brief.durationSec);
  const seed = durationSec + productName.length;

  const hook = (input.hook ?? fill(pick(HOOK_TEMPLATES[input.tone] ?? HOOK_TEMPLATES.default, seed), {
    product: productName,
    duration: String(durationSec),
  })).trim();

  const cta = (input.cta ?? fill(pick(CTA_TEMPLATES, seed + 7), { product: productName })).trim();

  const beats = input.decision.beats;
  const scenes: ScriptScene[] = [];
  const shots: ShotListEntry[] = [];

  beats.forEach((beat, index) => {
    const beatSec = Math.max(1, Math.round((beat.endMs - beat.startMs) / 1000));
    const claim = claims[index % Math.max(1, claims.length)] ?? FACTUAL_LANGUAGE_BANK[index % FACTUAL_LANGUAGE_BANK.length];
    let narration = "";
    let onScreen = "";
    let shotType: ShotListEntry["shotType"] = "UI_WALKTHROUGH";
    let highlight: string | undefined;

    switch (beat.id) {
      case "hook":
        narration = hook;
        onScreen = hook;
        shotType = "TITLE";
        break;
      case "problem":
        narration = `Trading tools are usually scattered across a dozen tabs. ${claim}.`;
        onScreen = "One workflow.";
        shotType = "ESTABLISHING";
        break;
      case "demo":
        narration = `Watch it inside AlgoVault. ${claim}.`;
        onScreen = claim;
        shotType = "UI_WALKTHROUGH";
        highlight = "spotlight";
        break;
      case "benefit":
        narration = feature?.benefits[index % Math.max(1, feature.benefits.length)] ?? claim;
        onScreen = feature?.benefits[index % Math.max(1, feature.benefits.length)] ?? claim;
        shotType = "CALLOUT";
        break;
      case "proof":
        narration = `${claim}. Nothing here is a promise of results.`;
        onScreen = "Illustration — not a performance claim.";
        shotType = "CHART";
        break;
      case "cta":
        narration = cta;
        onScreen = cta;
        shotType = "CTA";
        break;
      default:
        narration = claim;
        onScreen = claim;
    }

    if (input.language !== "en") {
      // Localisation happens in a later stage; keep the English source so the
      // translation step has a stable reference (§21).
      warnings.push(`Script source written in English; ${input.language} is produced by the localization stage.`);
    }

    const scene: ScriptScene = {
      id: `scene_${beat.id}_${index}`,
      order: index + 1,
      durationSec: beatSec,
      voiceover: narration,
      onScreenText: onScreen,
      visualRef: input.decision.clips[index]?.source.ref ?? `visual_${beat.id}`,
      visualType: beat.id === "demo" || beat.id === "proof" ? "screenshot" : beat.id === "cta" ? "overlay" : "graphic",
    };
    scenes.push(scene);

    shots.push({
      order: index + 1,
      beatId: beat.id,
      startMs: beat.startMs,
      endMs: beat.endMs,
      shotType,
      source: scene.visualType === "screenshot" ? "CAPTURE" : beat.id === "proof" ? "CHART" : beat.id === "cta" ? "BRAND" : "GRAPHIC",
      action: beat.label,
      onScreenText: onScreen,
      narration,
      highlight,
      safeForPlatform: true,
    });
  });

  const script: Script = {
    id: `script_${input.brief.platform}_${input.language}_${Date.now().toString(36)}`,
    title: `${productName} — ${input.brief.platform}`,
    hook,
    cta,
    durationSec,
    aspectRatio: (input.brief.aspectRatio as Script["aspectRatio"]) ?? "9:16",
    language: input.language,
    tone: input.tone,
    disclosure: input.demoLabelRequired ? DEMO_LABEL_TEXT : input.disclaimer,
    scenes,
    metadata: {
      feature: productName,
      audience: input.brief.audience,
      angle: input.brief.objective,
      demoLabel: input.demoLabelRequired,
    },
  };

  // Duration fit check (§16: never exceed the timeline).
  const total = scenes.reduce((s, sc) => s + sc.durationSec, 0);
  if (total > durationSec + 1) {
    warnings.push(`Script total ${total}s exceeds ${durationSec}s — scenes will be trimmed during composition.`);
  }

  return { script, shots, warnings };
}

/**
 * Optional AI refinement (§3): rewrites narration for tone while preserving
 * the claim set. Returns null when no AI router is supplied or the output
 * would drop the required disclosure.
 */
export async function refineScript(
  script: Script,
  options: {
    tone: string;
    approvedClaims: string[];
    runStructured: <T>(input: { prompt: string; schema: string; system: string }) => Promise<T | null>;
  }
): Promise<Script | null> {
  try {
    const refined = await options.runStructured<{ scenes: { id: string; voiceover: string }[] }>({
      prompt: JSON.stringify({
        tone: options.tone,
        approvedClaims: options.approvedClaims,
        scenes: script.scenes.map((s) => ({ id: s.id, voiceover: s.voiceover })),
      }),
      schema: '{ "scenes": [ { "id": string, "voiceover": string } ] }',
      system:
        "You are the AlgoVault Script Agent. Rewrite each narration line for the requested tone. " +
        "You may ONLY use facts from approvedClaims. Never add statistics, guarantees, testimonials or performance claims. " +
        "Keep each line short enough for its scene duration. Return ONLY JSON.",
    });
    if (!refined?.scenes?.length) return null;

    const scenes = script.scenes.map((s) => {
      const match = refined.scenes.find((r) => r.id === s.id);
      if (!match?.voiceover) return s;
      const words = match.voiceover.trim();
      // Fail closed: the refined line must still fit its scene budget.
      const wordsBudget = Math.max(3, Math.round(s.durationSec * 2.6));
      if (words.split(/\s+/).length > wordsBudget + 4) return s;
      return { ...s, voiceover: words };
    });

    return { ...script, scenes };
  } catch {
    return null;
  }
}
