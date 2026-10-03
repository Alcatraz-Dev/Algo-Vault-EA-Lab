/**
 * Marketing Agent — composition builder (§11, §13, §17, §18).
 *
 * Assembles the persisted, editable `CompositionDocument` that is handed to
 * the creative provider (Hypit) and re-rendered for every platform/language
 * variant. This is what makes a creative re-runnable instead of an opaque MP4.
 *
 * Pure module: no I/O.
 */

import type { MarketingLanguage } from "../collections";
import type { CompositionDocument, MotionLayer, TimelineClip } from "../provider";
import type { Script, CaptionCue } from "@/lib/marketing-media/types";
import type { DirectorDecision } from "./director";

export type CompositionInput = {
  script: Script;
  decision: DirectorDecision;
  language: MarketingLanguage;
  aspectRatio: string;
  durationSec: number;
  tone: string;
  captions: CaptionCue[];
  captionStyle: string;
  voiceTrack?: string | null;
  musicTrack?: string | null;
  brand: { logo?: string | null; primaryColor?: string | null; lowerThird?: boolean };
  disclaimer: string | null;
  demoLabel: string | null;
  /** Emphasis words per cue (§17). */
  emphasisByCue?: Record<number, string[]>;
};

export function buildComposition(input: CompositionInput): CompositionDocument {
  const totalMs = Math.max(1000, input.durationSec * 1000);

  const timeline: TimelineClip[] = input.decision.clips.map((clip, index) => {
    const scene = input.script.scenes[index];
    const startMs = Math.min(clip.startMs, totalMs);
    const endMs = Math.min(Math.max(clip.endMs, startMs + 250), totalMs);
    return {
      ...clip,
      id: `clip_${index + 1}_${clip.kind}`,
      startMs,
      endMs,
      text: scene?.voiceover || scene?.onScreenText || clip.text,
      emphasis: scene ? splitEmphasis(scene.voiceover) : undefined,
    };
  });

  const motion: MotionLayer[] = input.decision.motion.map((m, index) => {
    const clipId = timeline[Math.min(m.clipIndex, timeline.length - 1)]?.id ?? timeline[0]?.id ?? "clip_1";
    const { clipIndex, ...rest } = m;
    void clipIndex;
    return { ...rest, id: `motion_${index + 1}`, clipId } satisfies MotionLayer;
  });

  const cues = input.captions
    .filter((c) => c.endMs <= totalMs + 1000)
    .map((cue, index) => ({
      startMs: cue.startMs,
      endMs: cue.endMs,
      text: cue.text,
      emphasis: input.emphasisByCue?.[index],
    }));

  return {
    version: 1,
    durationSec: input.durationSec,
    aspectRatio: input.aspectRatio as CompositionDocument["aspectRatio"],
    language: input.language,
    tone: input.tone,
    timeline,
    captions: { cues, style: input.captionStyle },
    audio: {
      voice: input.voiceTrack ?? undefined,
      music: input.musicTrack ?? undefined,
      ducking: !!input.voiceTrack && !!input.musicTrack,
    },
    motion,
    branding: {
      logo: input.brand.logo ?? undefined,
      primaryColor: input.brand.primaryColor ?? undefined,
      lowerThird: input.brand.lowerThird ?? true,
    },
    disclaimer: input.disclaimer ?? undefined,
    demoLabel: input.demoLabel ?? undefined,
    notes: "Editable source of truth. Re-render from this document for any platform/language variant.",
  };
}

/**
 * Recompose for a different aspect ratio (§19). Adjusts anchors and caption
 * placement — never stretches or crops the source.
 */
export function recompose(doc: CompositionDocument, aspectRatio: string): CompositionDocument {
  if (aspectRatio === doc.aspectRatio) return doc;
  const vertical = aspectRatio === "9:16" || aspectRatio === "4:5";

  return {
    ...doc,
    aspectRatio: aspectRatio as CompositionDocument["aspectRatio"],
    timeline: doc.timeline.map((clip) => ({
      ...clip,
      anchor: vertical ? (clip.kind === "demo" ? "center" : "bottom") : clip.kind === "demo" ? "center" : "top",
    })),
    captions: {
      ...doc.captions,
      style: vertical ? `${doc.captions.style}|vertical-safe` : `${doc.captions.style}|horizontal-bar`,
    },
    notes: `${doc.notes ?? ""} Recomposed for ${aspectRatio}.`,
  };
}

/** Translate every user-facing string for a localized render (§21). */
export function localize(doc: CompositionDocument, language: MarketingLanguage, translation: Record<string, string>): CompositionDocument {
  const map = (value: string | undefined): string | undefined => {
    if (!value) return value;
    return translation[value] ?? value;
  };
  return {
    ...doc,
    language,
    timeline: doc.timeline.map((c) => ({ ...c, text: map(c.text) })),
    captions: {
      ...doc.captions,
      cues: doc.captions.cues.map((c) => ({ ...c, text: map(c.text) ?? c.text })),
    },
    disclaimer: map(doc.disclaimer),
    demoLabel: map(doc.demoLabel),
    motion: doc.motion.map((m) => ({ ...m, label: map(m.label) })),
  };
}

/** Word-level emphasis heuristics for animated captions (§17). */
function splitEmphasis(text: string): string[] | undefined {
  if (!text) return undefined;
  const words = text.split(/\s+/).filter(Boolean);
  const emphasis = words.filter((w) => w.replace(/[^A-Za-z]/g, "").length > 6);
  if (emphasis.length === 0) return undefined;
  return emphasis.slice(0, 3);
}

/** Caption placement rules that avoid covering critical UI (§17). */
export function captionPlacement(aspectRatio: string): { region: "lower_third" | "bottom_bar" | "center"; maxLines: number; safeFromUi: boolean } {
  switch (aspectRatio) {
    case "9:16":
      return { region: "lower_third", maxLines: 3, safeFromUi: true };
    case "4:5":
      return { region: "bottom_bar", maxLines: 2, safeFromUi: true };
    case "1:1":
      return { region: "bottom_bar", maxLines: 2, safeFromUi: true };
    default:
      return { region: "bottom_bar", maxLines: 2, safeFromUi: true };
  }
}
