/**
 * Marketing Agent — built-in creative provider (§90 rollback path).
 *
 * Delegates to the EXISTING Marketing Content Factory renderer
 * (`lib/marketing-media/video-render.ts`) rather than implementing a second
 * renderer. It exists so that disabling Hypit — or shipping without a Hypit
 * installation — leaves Growth, Marketing Factory and the agent's own
 * production pipeline fully functional.
 *
 * Server-only module.
 */

import { mkdir, writeFile, copyFile, access } from "node:fs/promises";
import { join, basename } from "node:path";
import type {
  CreativeProviderCapability,
  MarketingCreativeProvider,
  ProjectInput,
  ProviderHealth,
  ProviderResult,
  ProviderStatusPayload,
  RenderInput,
  RenderOutput,
  CompositionDocument,
} from "./provider";
import { registerCreativeProvider, resolveCreativeProvider } from "./provider";
import { HypitMarketingProvider } from "./hypit/provider";
import type { Script, MediaAsset, VideoPreset } from "@/lib/marketing-media/types";
import { renderVideo } from "@/lib/marketing-media/video-render";
import { ffmpegAvailable } from "@/lib/marketing-media/ffmpeg";
import { DEMO_LABEL_TEXT } from "@/lib/marketing-media/collections";

function presetFor(aspectRatio: string, width: number, height: number): VideoPreset {
  return {
    id: `agent-${aspectRatio.replace(":", "")}`,
    label: `Agent ${aspectRatio}`,
    aspectRatio: aspectRatio as unknown as VideoPreset["aspectRatio"],
    width,
    height,
    maxDurationSec: 600,
    platforms: [],
  };
}

function scriptFromComposition(doc: CompositionDocument, projectId: string): Script {
  const scenes = doc.timeline
    .slice()
    .sort((a, b) => a.startMs - b.startMs)
    .map((clip, i) => ({
      id: clip.id,
      order: i + 1,
      durationSec: Math.max(1, Math.round((clip.endMs - clip.startMs) / 1000)),
      voiceover: clip.text ?? "",
      onScreenText: clip.text ?? "",
      visualRef: clip.source.ref ?? clip.id,
      visualType: (clip.kind === "demo" ? "screenshot" : "graphic") as "screenshot" | "graphic",
    }));

  return {
    id: projectId,
    title: projectId,
    hook: scenes[0]?.voiceover ?? "",
    cta: doc.timeline.find((c) => c.kind === "cta")?.text ?? "Discover AlgoVault.",
    durationSec: doc.durationSec,
    aspectRatio: doc.aspectRatio as unknown as Script["aspectRatio"],
    language: doc.language,
    tone: doc.tone,
    disclosure: doc.disclaimer ?? DEMO_LABEL_TEXT,
    scenes: scenes.length ? scenes : [{ id: "s1", order: 1, durationSec: doc.durationSec, voiceover: "", onScreenText: "", visualRef: "default", visualType: "graphic" }],
    metadata: { feature: projectId, audience: "traders", angle: doc.tone, demoLabel: !!doc.demoLabel },
  };
}

export class FfmpegCreativeProvider implements MarketingCreativeProvider {
  readonly id = "ffmpeg-local";
  readonly label = "Built-in renderer (FFmpeg)";
  readonly capabilities: CreativeProviderCapability[] = [
    "project",
    "ingest",
    "composition",
    "captions",
    "motion",
    "timeline",
    "render",
    "preview",
    "export",
    "variants",
    "localization",
    "rerender",
    "status",
    "diagnostics",
  ];

  async health(): Promise<ProviderHealth> {
    const available = await ffmpegAvailable().catch(() => false);
    return {
      id: this.id,
      label: this.label,
      state: available ? "READY" : "NOT_CONFIGURED",
      detail: available
        ? "FFmpeg composition available via the Marketing Content Factory."
        : "FFmpeg not found at the configured path — composition unavailable.",
      checkedAt: Date.now(),
    };
  }

  async versionCheck(): Promise<{ detected: string | null; expected: string; compatible: boolean; detail: string }> {
    const h = await this.health();
    return { detected: h.state === "READY" ? "builtin" : null, expected: "builtin", compatible: h.state === "READY", detail: h.detail ?? "" };
  }

  async createProject(input: ProjectInput): Promise<ProviderResult<{ projectId: string; projectDir: string }>> {
    const h = await this.health();
    if (h.state !== "READY") return { ok: false, error: h.detail ?? "Renderer unavailable.", code: "NOT_CONFIGURED" };
    const projectDir = join(input.workspaceDir, "projects", input.creativeId);
    await mkdir(join(projectDir, "assets"), { recursive: true });
    await writeFile(join(projectDir, "composition.json"), JSON.stringify(input.composition, null, 2), "utf8");
    await writeFile(join(projectDir, "package.json"), JSON.stringify({ name: `algovault-${input.creativeId}`, private: true, version: "1.0.0" }, null, 2), "utf8");
    return { ok: true, value: { projectId: input.creativeId, projectDir } };
  }

  async ingestAssets(input: { projectId: string; assets: { key: string; sourcePath: string; kind: string }[]; workspaceDir: string }): Promise<ProviderResult<{ ingested: string[]; missing: string[] }>> {
    const projectDir = join(input.workspaceDir, "projects", input.projectId);
    const ingested: string[] = [];
    const missing: string[] = [];
    for (const asset of input.assets) {
      try {
        await access(asset.sourcePath);
        const target = join(projectDir, "assets", basename(asset.key).replace(/[^A-Za-z0-9._-]/g, "_"));
        await copyFile(asset.sourcePath, target);
        ingested.push(asset.key);
      } catch {
        missing.push(asset.key);
      }
    }
    return { ok: true, value: { ingested, missing } };
  }

  async updateComposition(input: { projectId: string; composition: CompositionDocument; workspaceDir: string }): Promise<ProviderResult<{ compositionId: string }>> {
    const projectDir = join(input.workspaceDir, "projects", input.projectId);
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "composition.json"), JSON.stringify(input.composition, null, 2), "utf8");
    return { ok: true, value: { compositionId: `${input.projectId}:${Date.now()}` } };
  }

  async render(input: RenderInput): Promise<ProviderResult<RenderOutput>> {
    const projectDir = join(input.workspaceDir, "projects", input.projectId);
    let doc: CompositionDocument;
    try {
      const raw = await import("node:fs/promises").then((fs) => fs.readFile(join(projectDir, "composition.json"), "utf8"));
      doc = JSON.parse(raw) as CompositionDocument;
    } catch {
      return { ok: false, error: "Composition document not found for this project.", code: "NOT_FOUND" };
    }

    const script = scriptFromComposition(doc, input.projectId);
    const assetsDir = join(projectDir, "assets");
    const assets: MediaAsset[] = [];
    try {
      const { readdir } = await import("node:fs/promises");
      for (const name of await readdir(assetsDir)) {
        const p = join(assetsDir, name);
        const isImage = /\.(png|jpe?g|webp)$/i.test(name);
        assets.push({
          id: `asset_${name}`,
          kind: isImage ? "image" : "video",
          url: `/marketing-video/work/${name}`,
          localPath: p,
          source: "agent-project",
          createdAt: Date.now(),
        });
      }
    } catch {
      // no assets — the renderer falls back to its own background
    }

    const result = await renderVideo({
      script,
      preset: presetFor(input.aspectRatio, input.width, input.height),
      outputName: input.outputName,
      assets,
    });

    if (!result.ok || !result.video) {
      return { ok: false, error: result.error ?? "Render failed.", code: "RENDER_FAILED" };
    }

    return {
      ok: true,
      value: {
        buildId: `local_${input.outputName}_${Date.now().toString(36)}`,
        file: result.video.localPath ?? "",
        width: input.width,
        height: input.height,
        durationSec: result.video.durationSec ?? doc.durationSec,
        sizeBytes: result.video.sizeBytes,
        codec: "h264",
        hasAudio: false,
      },
    };
  }

  async status(input: { buildId: string; workspaceDir: string }): Promise<ProviderStatusPayload> {
    return { buildId: input.buildId, state: "RENDERED" };
  }

  async cancel(): Promise<ProviderResult<{ cancelled: boolean }>> {
    return { ok: false, error: "Local renders cannot be cancelled once submitted.", code: "NOT_SUPPORTED" };
  }

  async diagnostics(): Promise<{ checks: { name: string; ok: boolean; detail?: string }[] }> {
    const available = await ffmpegAvailable().catch(() => false);
    return { checks: [{ name: "ffmpeg", ok: available, detail: available ? "available" : "not found" }] };
  }
}

let registered = false;

/**
 * Register the production providers once (idempotent).
 * Order matters: Hypit is preferred, the built-in renderer is the fallback.
 * Call this from server entry points only — both providers spawn processes.
 */
export function registerCreativeProviders(): void {
  if (registered) return;
  registered = true;
  registerCreativeProvider(new HypitMarketingProvider());
  registerCreativeProvider(new FfmpegCreativeProvider());
}

export { resolveCreativeProvider };
