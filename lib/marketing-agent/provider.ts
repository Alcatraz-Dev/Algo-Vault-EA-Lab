/**
 * Marketing Agent — creative production provider contract (§11, §12, §90).
 *
 * `MarketingCreativeProvider` is the abstraction the whole production pipeline
 * talks to. `HypitMarketingProvider` is the primary implementation; the
 * built-in FFmpeg provider (delegating to the existing Marketing Content
 * Factory) is the rollback path when Hypit is disabled or unavailable, so a
 * Hypit failure can never break Growth / Marketing Factory (§90).
 *
 * Every method returns an explicit result — no provider may throw its way to a
 * fake success.
 */

import type { MarketingAspectRatio, MarketingLanguage, MarketingPlatform } from "./collections";
import type { QaReport } from "./types";

export type CreativeProviderCapability =
  | "project"
  | "ingest"
  | "composition"
  | "captions"
  | "motion"
  | "timeline"
  | "render"
  | "preview"
  | "export"
  | "variants"
  | "localization"
  | "rerender"
  | "status"
  | "cancel"
  | "diagnostics";

export type ProviderHealth = {
  id: string;
  label: string;
  state: "CONNECTED" | "READY" | "DEGRADED" | "NOT_CONFIGURED" | "DISABLED" | "ERROR";
  detail?: string;
  version?: string;
  compatible?: boolean;
  expectedVersion?: string;
  checkedAt: number;
};

export type ProviderResult<T> = { ok: true; value: T } | { ok: false; error: string; code: string };

export type ProjectInput = {
  name: string;
  creativeId: string;
  language: MarketingLanguage;
  aspectRatio: MarketingAspectRatio;
  durationSec: number;
  /** Editable composition document — persisted verbatim (§11). */
  composition: CompositionDocument;
  workspaceDir: string;
};

/**
 * The persisted, editable composition. This is the system of record for a
 * creative: re-rendering a variant regenerates the output from this document
 * instead of mutating an opaque MP4 (§11, §23).
 */
export type CompositionDocument = {
  version: 1;
  durationSec: number;
  aspectRatio: MarketingAspectRatio;
  language: MarketingLanguage;
  tone: string;
  timeline: TimelineClip[];
  captions: { cues: { startMs: number; endMs: number; text: string; emphasis?: string[] }[]; style: string };
  audio: { voice?: string; music?: string; ducking: boolean };
  motion: MotionLayer[];
  branding: { logo?: string; primaryColor?: string; lowerThird?: boolean };
  disclaimer?: string;
  demoLabel?: string;
  notes?: string;
};

export type TimelineClip = {
  id: string;
  startMs: number;
  endMs: number;
  kind: "hook" | "problem" | "demo" | "benefit" | "proof" | "cta" | "broll" | "title" | "outro";
  source: { type: "capture" | "asset" | "generated" | "solid" | "chart"; ref?: string };
  text?: string;
  /** Recomposition anchors for aspect-ratio changes (§19). */
  anchor: "center" | "top" | "bottom" | "left" | "right";
  emphasis?: string[];
};

export type MotionLayer = {
  id: string;
  type: "animated_typography" | "lower_third" | "ui_callout" | "data_card" | "icon" | "arrow" | "highlight" | "transition" | "chart" | "cta" | "logo";
  clipId: string;
  from: number;
  to: number;
  label?: string;
  target?: string;
  style?: string;
};

export type RenderInput = {
  projectId: string;
  compositionId: string;
  platform: MarketingPlatform;
  aspectRatio: MarketingAspectRatio;
  width: number;
  height: number;
  language: MarketingLanguage;
  outputName: string;
  workspaceDir: string;
  timeoutMs?: number;
};

export type RenderOutput = {
  buildId: string;
  file: string;
  width: number;
  height: number;
  durationSec: number;
  sizeBytes?: number;
  codec?: string;
  hasAudio?: boolean;
};

export type ProviderStatusPayload = {
  buildId: string;
  state: "QUEUED" | "RUNNING" | "RENDERED" | "FAILED" | "CANCELLED";
  progress?: number;
  file?: string;
  error?: string;
};

export interface MarketingCreativeProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: CreativeProviderCapability[];

  health(): Promise<ProviderHealth>;
  /** Detected vs expected version — used by the compatibility gate (§12, §85). */
  versionCheck(): Promise<{ detected: string | null; expected: string; compatible: boolean; detail: string }>;

  createProject(input: ProjectInput): Promise<ProviderResult<{ projectId: string; projectDir: string }>>;
  /** Copy/ingest capture frames, audio and graphics into the project. */
  ingestAssets(input: { projectId: string; assets: { key: string; sourcePath: string; kind: string }[]; workspaceDir: string }): Promise<ProviderResult<{ ingested: string[]; missing: string[] }>>;
  /** Persist an updated composition (always versioned, never destructive). */
  updateComposition(input: { projectId: string; composition: CompositionDocument; workspaceDir: string }): Promise<ProviderResult<{ compositionId: string }>>;
  render(input: RenderInput): Promise<ProviderResult<RenderOutput>>;
  status(input: { buildId: string; workspaceDir: string }): Promise<ProviderStatusPayload>;
  cancel(input: { buildId: string; workspaceDir: string }): Promise<ProviderResult<{ cancelled: boolean }>>;
  /** Pre-flight diagnostics for the admin health surface (§84). */
  diagnostics(input?: { workspaceDir?: string }): Promise<{ checks: { name: string; ok: boolean; detail?: string }[] }>;
}

// ─── Registry ────────────────────────────────────────────────────────────────

const REGISTRY = new Map<string, MarketingCreativeProvider>();

export function registerCreativeProvider(provider: MarketingCreativeProvider): void {
  REGISTRY.set(provider.id, provider);
}

export function getCreativeProvider(id?: string): MarketingCreativeProvider | undefined {
  if (id && REGISTRY.has(id)) return REGISTRY.get(id);
  // Preferred order: Hypit first, then the built-in FFmpeg provider.
  return REGISTRY.get("hypit") ?? REGISTRY.get("ffmpeg-local") ?? REGISTRY.values().next().value;
}

export function listCreativeProviders(): MarketingCreativeProvider[] {
  return Array.from(REGISTRY.values());
}

export type ResolvedProvider = {
  provider: MarketingCreativeProvider | null;
  fallbackUsed: boolean;
  reason?: string;
  health: ProviderHealth[];
};

/**
 * Resolve the provider honouring the `marketingAgentHypitEnabled` flag (§90).
 * When Hypit is disabled or unhealthy, the local provider takes over and the
 * caller is told explicitly.
 */
export async function resolveCreativeProvider(options: {
  hypitEnabled?: boolean;
  preferredId?: string;
}): Promise<ResolvedProvider> {
  const health: ProviderHealth[] = [];
  const candidates = listCreativeProviders();

  if (options.hypitEnabled !== false) {
    const hypit = candidates.find((p) => p.id === "hypit");
    if (hypit) {
      const h = await hypit.health();
      health.push(h);
      if (h.state === "CONNECTED" || h.state === "READY") {
        return { provider: hypit, fallbackUsed: false, health };
      }
      const local = candidates.find((p) => p.id === "ffmpeg-local");
      if (local) {
        const lh = await local.health();
        health.push(lh);
        return {
          provider: lh.state === "READY" ? local : null,
          fallbackUsed: true,
          reason: `Hypit unavailable (${h.detail ?? h.state}); using the built-in composition provider.`,
          health,
        };
      }
      return { provider: null, fallbackUsed: false, reason: h.detail ?? "Hypit unavailable and no fallback registered.", health };
    }
  }

  const local = candidates.find((p) => p.id === (options.preferredId ?? "ffmpeg-local")) ?? candidates[0];
  if (!local) return { provider: null, fallbackUsed: false, reason: "No creative provider registered.", health };
  const lh = await local.health();
  health.push(lh);
  return { provider: lh.state === "READY" ? local : null, fallbackUsed: local.id !== "hypit", reason: lh.detail, health };
}

/** Minimum supported Hypit version (§12, §85). Bump deliberately, never "latest". */
export { EXPECTED_HYPIIIT_VERSION, isVersionCompatible } from "./provider-constants";

/** Shared shape so QA can be attached to any provider result. */
export type RenderWithQa = { render: RenderOutput; qa: QaReport };
