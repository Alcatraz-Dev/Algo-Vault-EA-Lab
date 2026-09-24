/**
 * Local deterministic Marketing Media Provider.
 *
 * This is the always-available fallback provider. It never calls external
 * AI/TTS/video services — it produces honest, deterministic output:
 *   - scripts / scenes / captions: generated from deterministic templates
 *   - voiceover: no TTS configured → NOT_AVAILABLE
 *   - visuals: returns the curated AlgoVault asset library
 *   - compose: renders via local FFmpeg when available
 *   - thumbnail: renders via local FFmpeg when available
 *
 * Nothing here fabricates external success. When a capability is missing the
 * caller gets a clear `ok:false` with `provider:"local-deterministic"`.
 */
import {
    MarketingMediaProvider,
    GenerateScriptInput,
    Script,
    ScriptScene,
    CaptionCue,
    MediaAsset,
    ComposeVideoInput,
    ComposeVideoResult,
    GenerateVisualsInput,
    GenerateVisualsResult,
    GenerateVoiceoverInput,
    GenerateVoiceoverResult,
    GenerateCaptionsInput,
    GenerateCaptionsResult,
    GenerateThumbnailInput,
    GenerateThumbnailResult,
    getVideoPreset,
} from "../types";

import { getMarketingAssetLibrary, lookupAsset } from "../assets";
import { registerMarketingMediaProvider } from "./index";

const PROVIDER_ID = "local-deterministic";

function deterministicId(seed: string): string {
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
        h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    }
    return `loc_${h.toString(36)}`;
}

function estimateDuration(sec: number, presetMax: number): number {
    return Math.max(8, Math.min(presetMax, sec));
}

export class LocalDeterministicProvider implements MarketingMediaProvider {
    readonly id = PROVIDER_ID;
    readonly capabilities: MarketingMediaProvider["capabilities"] = [
        "script",
        "visuals",
        "captions",
        "compose",
        "thumbnail",
    ];

    async isAvailable(): Promise<boolean> {
        return true;
    }

    async generateScript(input: GenerateScriptInput): Promise<{ ok: boolean; script?: Script; error?: string }> {
        try {
            const preset = getVideoPreset("tiktok");
            const duration = estimateDuration(input.durationSec ?? 30, preset?.maxDurationSec ?? 60);
            const scenes: ScriptScene[] = buildScenes(input, duration);
            const script: Script = {
                id: deterministicId(`script:${input.feature}:${input.angle}`),
                title: `${input.feature} — ${input.angle}`,
                hook: input.angle,
                cta: input.cta || "Learn more at AlgoVault.",
                durationSec: duration,
                aspectRatio: input.aspectRatio,
                language: input.language || "en",
                tone: input.tone || "professional",
                disclosure: "Risk disclosure: Trading carries risk. Past performance is not indicative of future results.",
                scenes,
                metadata: {
                    feature: input.feature,
                    audience: input.audience,
                    angle: input.angle,
                    demoLabel: Boolean(input.demoLabel),
                },
            };
            return { ok: true, script };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : "Script generation failed." };
        }
    }

    async generateVisuals(input: GenerateVisualsInput): Promise<GenerateVisualsResult> {
        const assets: MediaAsset[] = [];
        const missing: string[] = [];
        for (const scene of input.script.scenes) {
            const asset = lookupAsset(scene.visualRef);
            if (asset) {
                assets.push({
                    id: asset.id,
                    kind: "image",
                    url: asset.url,
                    source: "algovault-assets",
                    width: asset.width,
                    height: asset.height,
                    createdAt: Date.now(),
                });
            } else {
                missing.push(scene.visualRef);
            }
        }
        return { ok: true, assets, missing };
    }

    async generateCaptions(input: GenerateCaptionsInput): Promise<GenerateCaptionsResult> {
        try {
            const captions: CaptionCue[] = [];
            let cursor = 0;
            for (const scene of input.script.scenes) {
                const words = scene.voiceover.split(/\s+/).filter(Boolean);
                const perWord = (scene.durationSec * 1000) / Math.max(1, words.length);
                for (const w of words) {
                    captions.push({ startMs: cursor, endMs: cursor + perWord, text: w });
                    cursor += perWord;
                }
                cursor += 120; // brief pause between scenes
            }
            return { ok: true, captions };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : "Caption generation failed." };
        }
    }

    async generateVoiceover(input: GenerateVoiceoverInput): Promise<GenerateVoiceoverResult> {
        try {
            const ttsMod = await import("../tts");
            if (await ttsMod.isTtsAvailable()) {
                return await ttsMod.generateVoiceoverWithSay(input);
            }
        } catch { /* fall through */ }
        return {
            ok: false,
            error: "TTS provider not configured. Set TTS_PROVIDER or a voice API key to enable voiceover generation.",
            provider: PROVIDER_ID,
        };
    }

    async composeVideo(input: ComposeVideoInput): Promise<ComposeVideoResult> {
        try {
            const ffmpegMod = await import("../ffmpeg");
            if (await ffmpegMod.ffmpegAvailable()) {
                return await ffmpegMod.composeVideo(input);
            }
        } catch { /* fall through */ }
        return {
            ok: false,
            error: "Local video composition is not available (FFmpeg/render backend not configured).",
            provider: PROVIDER_ID,
            fallbackUsed: false,
        };
    }

    async generateThumbnail(input: GenerateThumbnailInput): Promise<GenerateThumbnailResult> {
        try {
            const ffmpegMod = await import("../ffmpeg");
            if (await ffmpegMod.ffmpegAvailable()) {
                return await ffmpegMod.generateThumbnail(input.script, input.preset, input.assets);
            }
        } catch { /* fall through */ }
        return {
            ok: false,
            error: "Local thumbnail generation is not available (FFmpeg/render backend not configured).",
            provider: PROVIDER_ID,
        };
    }
}

function buildScenes(input: GenerateScriptInput, durationSec: number): ScriptScene[] {
    const scenes: ScriptScene[] = [];
    const perScene = Math.max(6, Math.floor(durationSec / 4));
    const hook = `Stop staring at charts all day — here's how ${input.feature} helps.`;
    const demo = `Watch how AlgoVault turns raw market data into actionable intelligence.`;
    const cta = input.cta || "Try AlgoVault today.";
    const parts = [hook, demo, cta];
    for (let i = 0; i < parts.length; i++) {
        scenes.push({
            id: `scene_${i + 1}`,
            order: i,
            durationSec: perScene,
            voiceover: parts[i],
            onScreenText: parts[i].toUpperCase(),
            visualRef: assetForIndex(i),
            visualType: i === 0 ? "chart" : i === 1 ? "screenshot" : "logo",
        });
    }
    return scenes;
}

function assetForIndex(i: number): string {
    const map = ["01-market-hero", "03-ai-intelligence", "logo-mark"];
    return map[i] || map[map.length - 1];
}

registerProviderIfAvailable();

export function registerLocalDeterministicProvider(): void {
    registerMarketingMediaProvider(new LocalDeterministicProvider());
}

function registerProviderIfAvailable(): void {
    registerLocalDeterministicProvider();
}