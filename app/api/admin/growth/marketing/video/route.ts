/** Video generation endpoint — extends existing Marketing Studio.
 * Admin-only; uses existing auth; validates inputs; never exposes API keys.
 */
import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { requireGrowthAdmin } from "@/lib/growth/server-auth";
import { generateVoiceoverWithSay } from "@/lib/marketing-media/tts";
import { renderVideo } from "@/lib/marketing-media/video-render";
import { MARKETING_COLLECTIONS } from "@/lib/marketing-media/collections";
import { detectCapabilities, detectCapabilitiesAsync, selectGenerationMode } from "@/lib/marketing-media/video-generation-mode";
import type { Script, MediaAsset } from "@/lib/marketing-media/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidPreset(p: string): boolean {
  return ["9:16", "1:1", "16:9"].includes(p);
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireGrowthAdmin(req);
    if (!admin) return NextResponse.json({ error: "Admin required" }, { status: 403 });

    const body = await req.json().catch(() => ({})) as {
      creativeId?: string;
      conceptName?: string;
      preset?: string;
      scenes?: Array<{ durationSec?: number; hook?: string; voiceover?: string }>;
      outputName?: string;
    };

    if (!body.outputName || !body.preset || !isValidPreset(body.preset)) {
      return NextResponse.json({ error: "Invalid preset or missing outputName" }, { status: 422 });
    }
    if (!body.scenes || !Array.isArray(body.scenes) || body.scenes.length === 0 || body.scenes.length > 10) {
      return NextResponse.json({ error: "Invalid scenes (max 10)" }, { status: 422 });
    }

    const script = {
      id: body.outputName,
      title: body.conceptName || body.outputName,
      scenes: body.scenes.map((s: any, i: number) => ({
        id: `sc_${i}`,
        order: i,
        durationSec: Math.max(3, Math.min(30, s.durationSec || 5)),
        voiceover: String(s.voiceover || ""),
        onScreenText: String(s.hook || `Scene ${i + 1}`),
        visualRef: `vis_${i}`,
        visualType: "graphic",
      })) as Script["scenes"],
      durationSec: body.scenes.reduce((sum: number, s: any) => sum + Math.max(3, Math.min(30, s.durationSec || 5)), 0),
    } as Script;

    // 1) Voiceover
    const voice = await generateVoiceoverWithSay({ script: script as any } as any);
    const audioPath = voice.ok ? voice.audio?.localPath : undefined;

    // 2) Visual assets — reuse existing market visuals if symbol available; else empty
    const assets: unknown[] = [];

    const caps = await detectCapabilitiesAsync();
    const mode = selectGenerationMode(caps);

    // 3) Render
    const result = await renderVideo({
      script,
      preset: { id: body.preset, label: body.preset, width: body.preset === "9:16" ? 1080 : body.preset === "1:1" ? 1080 : 1920, height: body.preset === "9:16" ? 1920 : body.preset === "1:1" ? 1080 : 1080, maxDurationSec: 60, aspectRatio: body.preset as "9:16" | "1:1" | "16:9", platforms: ["TIKTOK", "INSTAGRAM", "YOUTUBE"] },
      outputName: body.outputName,
      assets: assets as MediaAsset[],
      audioPath,
    });

    if (!result.ok || !result.video) {
      return NextResponse.json({ ok: false, error: result.error || "Render failed." }, { status: 500 });
    }

    // 4) Persist asset reference to marketingAssets (admin write via adminDatabase bypasses rules)
    const assetRef = adminDatabase.ref(`${MARKETING_COLLECTIONS.assets}`).push();
    await assetRef.set({
      id: result.video.id,
      creativeId: body.creativeId || null,
      kind: "video",
      url: result.video.url,
      localPath: result.video.localPath,
      source: result.video.source,
      durationSec: result.video.durationSec,
      createdAt: result.video.createdAt,
      preset: body.preset,
      generationMode: mode,
    });

    // 5) Update creative state if linked
    if (body.creativeId) {
      const snap = await adminDatabase.ref(`${MARKETING_COLLECTIONS.creatives}/${body.creativeId}`).get();
      if (snap.exists()) {
        await adminDatabase.ref(`${MARKETING_COLLECTIONS.creatives}/${body.creativeId}`).update({
          videoAssetId: result.video.id,
          videoUrl: result.video.url,
          updatedAt: Date.now(),
        });
      }
    }

    return NextResponse.json({ ok: true, video: result.video, audioGenerated: voice.ok, generationMode: mode }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Video generation failed." }, { status: 500 });
  }
}
