/**
 * Marketing Agent — Creative Director (§10, §13, §14).
 *
 * Decides WHAT to show and WHEN, following the priority order:
 *   REAL PRODUCT → CLEAR EXPLANATION → BENEFIT → PROOF → CTA
 *
 * Generic stock footage is never preferred over a real product demonstration
 * when a real capture exists (§10).
 *
 * Pure module: no I/O.
 */

import type { MarketingPlatform } from "../collections";
import type { MotionLayer, TimelineClip } from "../provider";
import { featureDirection, getFeature } from "../product-knowledge";

export type DirectorBrief = {
  productKeys: string[];
  durationSec: number;
  platform: MarketingPlatform;
  aspectRatio: string;
  tone: string;
  audience: string;
  hasCapture: boolean;
  captureFrameCount: number;
  /** Frames keyed by capture step order, when available. */
  captureFrames?: { key: string; stepOrder: number; url: string }[];
  wantsVoiceover: boolean;
  objective: string;
};

export type DirectorMotion = Omit<MotionLayer, "id" | "clipId"> & { clipIndex: number };

export type DirectorDecision = {
  /** Beats of the video in milliseconds. */
  beats: { id: string; label: string; startMs: number; endMs: number }[];
  clips: Omit<TimelineClip, "id">[];
  motion: DirectorMotion[];
  show: string[];
  avoid: string[];
  ctaAtMs: number;
  disclaimerFromMs: number;
  reasoning: string[];
};

type BeatSpec = { id: string; label: string; weight: number };

const BASE_BEATS: BeatSpec[] = [
  { id: "hook", label: "Hook", weight: 0.07 },
  { id: "problem", label: "Problem", weight: 0.1 },
  { id: "demo", label: "Product demonstration", weight: 0.33 },
  { id: "benefit", label: "Benefits", weight: 0.23 },
  { id: "proof", label: "Differentiation / use case", weight: 0.17 },
  { id: "cta", label: "CTA + disclaimer", weight: 0.1 },
];

/** Vertical short-form compresses the story into fewer, punchier beats. */
function beatsFor(platform: MarketingPlatform, durationSec: number): BeatSpec[] {
  const vertical = platform === "TIKTOK" || platform === "INSTAGRAM_REELS" || platform === "INSTAGRAM_STORIES" || platform === "YOUTUBE_SHORTS";
  if (vertical && durationSec <= 30) {
    return [
      { id: "hook", label: "Hook", weight: 0.12 },
      { id: "demo", label: "Product demonstration", weight: 0.4 },
      { id: "benefit", label: "Benefits", weight: 0.26 },
      { id: "cta", label: "CTA + disclaimer", weight: 0.22 },
    ];
  }
  return BASE_BEATS;
}

/**
 * Produce the beat structure, clip skeleton and motion plan for one creative.
 */
export function directCreative(brief: DirectorBrief): DirectorDecision {
  const reasoning: string[] = [];
  const totalMs = Math.max(5, brief.durationSec) * 1000;
  const beatsSpec = beatsFor(brief.platform, brief.durationSec);

  // Real product > everything (§10).
  if (brief.hasCapture && brief.captureFrameCount > 0) {
    reasoning.push(`Real AlgoVault capture available (${brief.captureFrameCount} frames) — prioritised over generated visuals.`);
  } else {
    reasoning.push("No product capture available — using approved product graphics and clearly-labelled illustrative visuals.");
  }

  const weightSum = beatsSpec.reduce((s, b) => s + b.weight, 0);
  let cursor = 0;
  const beats = beatsSpec.map((b) => {
    const startMs = cursor;
    const endMs = Math.min(totalMs, cursor + Math.round((b.weight / weightSum) * totalMs));
    cursor = endMs;
    return { id: b.id, label: b.label, startMs, endMs };
  });
  // Guarantee the final beat reaches the end of the timeline.
  if (beats.length > 0) beats[beats.length - 1].endMs = totalMs;

  const productKeys = brief.productKeys;
  const show = Array.from(new Set(productKeys.flatMap((k) => featureDirection(k).show)));
  const avoid = Array.from(new Set(productKeys.flatMap((k) => featureDirection(k).avoid)));

  const frames = (brief.captureFrames ?? []).slice().sort((a, b) => a.stepOrder - b.stepOrder);
  const clips: Omit<TimelineClip, "id">[] = [];
  const motion: DirectorMotion[] = [];

  beats.forEach((beat, beatIndex) => {
    const isDemo = beat.id === "demo";
    const frame = frames[beatIndex % Math.max(1, frames.length)];

    const clip: Omit<TimelineClip, "id"> = {
      startMs: beat.startMs,
      endMs: beat.endMs,
      kind: (isDemo ? "demo" : beat.id === "hook" ? "hook" : beat.id === "benefit" ? "benefit" : beat.id === "proof" ? "proof" : beat.id === "cta" ? "cta" : "problem") as TimelineClip["kind"],
      source: isDemo && frame
        ? { type: "capture", ref: frame.url }
        : brief.hasCapture && frame
          ? { type: "capture", ref: frame.url }
          : { type: "asset", ref: "brand-default" },
      anchor: brief.aspectRatio === "16:9" ? "center" : "bottom",
    };
    clips.push(clip);
    const clipIndex = clips.length - 1;

    if (beat.id === "hook") {
      motion.push({ type: "animated_typography", from: beat.startMs, to: Math.min(beat.endMs, beat.startMs + 1800), label: "Opening title", clipIndex, style: "bold-swap" });
      motion.push({ type: "highlight", from: beat.startMs + 300, to: beat.endMs, clipIndex, style: "spotlight" });
    }
    if (beat.id === "demo") {
      motion.push({ type: "ui_callout", from: beat.startMs + 200, to: Math.min(beat.endMs, beat.startMs + 2500), label: "Feature callout", clipIndex, style: "callout-entrance" });
      motion.push({ type: "arrow", from: beat.startMs + 600, to: beat.endMs, clipIndex, style: "animated-arrow" });
      motion.push({ type: "lower_third", from: beat.startMs, to: beat.endMs, label: getFeature(productKeys[0])?.name ?? "AlgoVault", clipIndex, style: "product-label" });
    }
    if (beat.id === "benefit") {
      motion.push({ type: "data_card", from: beat.startMs, to: Math.min(beat.endMs, beat.startMs + 2600), label: "Benefit card", clipIndex, style: "benefit-list" });
      motion.push({ type: "icon", from: beat.startMs + 400, to: beat.endMs, clipIndex, style: "icon-reveal" });
    }
    if (beat.id === "proof") {
      motion.push({ type: "chart", from: beat.startMs, to: beat.endMs, clipIndex, style: "illustrative-only" });
      motion.push({ type: "highlight", from: beat.startMs, to: beat.endMs, clipIndex, style: "section-highlight" });
    }
    if (beat.id === "cta") {
      motion.push({ type: "cta", from: beat.startMs, to: beat.endMs, label: "Call to action", clipIndex, style: "cta-reveal" });
      motion.push({ type: "logo", from: beat.startMs, to: beat.endMs, clipIndex, style: "logo-in" });
    }
  });

  // Transition layer spanning every cut (§14: transitions, not effects spam).
  for (let i = 1; i < clips.length; i++) {
    motion.push({ type: "transition", from: beats[i].startMs - 220, to: beats[i].startMs + 220, clipIndex: i, style: "cut-fade" });
  }

  const ctaBeat = beats.find((b) => b.id === "cta");
  const ctaAtMs = ctaBeat?.startMs ?? Math.max(0, totalMs - 4000);
  const disclaimerFromMs = Math.max(0, totalMs - Math.min(6000, Math.round(totalMs * 0.25)));

  reasoning.push(`Platform ${brief.platform} (${brief.aspectRatio}) → ${beats.length} beats over ${brief.durationSec}s.`);
  if (!brief.wantsVoiceover) reasoning.push("No voiceover requested — captions carry the narrative.");

  return { beats, clips, motion, show, avoid, ctaAtMs, disclaimerFromMs, reasoning };
}

/**
 * Highlight system available in the editing/composition stage (§9).
 * Applied as motion layers — the product UI itself is never modified.
 */
export const HIGHLIGHT_EFFECTS = [
  "cursor",
  "zoom",
  "spotlight",
  "bounding_box",
  "animated_arrow",
  "callout",
  "click_ripple",
  "section_highlight",
  "blur",
  "dim",
  "animated_path",
  "text_annotation",
] as const;

export type HighlightEffect = (typeof HIGHLIGHT_EFFECTS)[number];

/** Which effects are appropriate for a beat — avoids overuse (§14). */
export function effectsForBeat(beatId: string): HighlightEffect[] {
  switch (beatId) {
    case "hook":
      return ["zoom", "text_annotation"];
    case "demo":
      return ["spotlight", "bounding_box", "animated_arrow", "click_ripple", "dim"];
    case "benefit":
      return ["callout", "section_highlight"];
    case "proof":
      return ["animated_path", "section_highlight"];
    case "cta":
      return ["cursor", "callout"];
    default:
      return ["dim"];
  }
}
