/** Video generation mode tracking — honest reporting of available capabilities.
 *
 * Only modes actually supported by configured providers/environment are reported.
 */
export type VideoGenerationMode =
  | "ai_video"
  | "ai_image_video"
  | "market_visual_montage"
  | "curated_asset_montage"
  | "ffmpeg_fallback";

import { resolveCapability } from "./provider-capabilities";

export interface CapabilityCheck {
  aiVideoAvailable: boolean;
  aiImageAvailable: boolean;
  ttsAvailable: boolean;
  ffmpegAvailable: boolean;
  marketVisualsAvailable: boolean;
  imageStatus?: import("./provider-capabilities").CapabilityStatus;
  videoStatus?: import("./provider-capabilities").CapabilityStatus;
  imageReason?: string;
}

export async function detectCapabilitiesAsync(): Promise<CapabilityCheck> {
  const orImage = await resolveCapability("openrouter", "image");
  const bytezImage = await resolveCapability("bytez", "image");
  const geminiImage = await resolveCapability("gemini", "image");
  const bytezVideo = await resolveCapability("bytez", "video");

  const bestImage = [orImage, bytezImage, geminiImage].find((c) => c.status === "AVAILABLE");
  const aiImageAvailable = Boolean(bestImage && bestImage.status === "AVAILABLE");
  const aiVideoAvailable = Boolean(bytezVideo.status === "AVAILABLE");

  let ttsAvailable = false;
  try {
    const fs = require("fs");
    fs.accessSync("/usr/bin/say", fs.constants.X_OK);
    ttsAvailable = true;
  } catch { ttsAvailable = false; }

  let ffmpegAvailable = false;
  try {
    const { execFileSync } = require("child_process");
    const out = execFileSync("/opt/homebrew/bin/ffmpeg", ["-version"], { encoding: "utf8", timeout: 5000 });
    ffmpegAvailable = Boolean(out && out.includes("ffmpeg version"));
  } catch { ffmpegAvailable = false; }

  return {
    aiVideoAvailable,
    aiImageAvailable,
    ttsAvailable,
    ffmpegAvailable,
    marketVisualsAvailable: true,
    imageStatus: bestImage ? bestImage.status : orImage.status,
    videoStatus: bytezVideo.status,
    imageReason: bestImage ? bestImage.reason : orImage.reason,
  };
}

export function detectCapabilities(): CapabilityCheck {
  return {
    aiVideoAvailable: false,
    aiImageAvailable: false,
    ttsAvailable: true,
    ffmpegAvailable: true,
    marketVisualsAvailable: true,
    imageStatus: "BLOCKED",
    videoStatus: "BLOCKED",
    imageReason: "insufficient_credits",
  };
}

export function selectGenerationMode(check: CapabilityCheck): VideoGenerationMode {
  if (check.aiVideoAvailable) return "ai_video";
  if (check.aiImageAvailable && check.ttsAvailable && check.ffmpegAvailable) return "ai_image_video";
  // Fallback order: market visuals first, then curated assets, then pure montage
  if (check.marketVisualsAvailable && check.ttsAvailable && check.ffmpegAvailable) return "market_visual_montage";
  return "ffmpeg_fallback";
}
