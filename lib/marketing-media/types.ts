/**
 * Marketing Media Provider — shared types.
 *
 * The Marketing Content Factory is built around replaceable provider
 * interfaces so that no single external service (video renderer, TTS,
 * image generator, storage) is hard-coded into the application. Each
 * provider reports its own availability and failures honestly; nothing
 * fabricates success.
 */

export type AspectRatio = "9:16" | "1:1" | "16:9";

export type VideoPreset = {
  id: string;
  label: string;
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  maxDurationSec: number;
  platforms: string[];
};

export const VIDEO_PRESETS: VideoPreset[] = [
  {
    id: "tiktok",
    label: "TikTok",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    maxDurationSec: 60,
    platforms: ["TIKTOK", "INSTAGRAM", "YOUTUBE_SHORTS"],
  },
  {
    id: "instagram-reel",
    label: "Instagram Reel",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    maxDurationSec: 60,
    platforms: ["INSTAGRAM"],
  },
  {
    id: "youtube-shorts",
    label: "YouTube Shorts",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    maxDurationSec: 60,
    platforms: ["YOUTUBE"],
  },
  {
    id: "youtube-standard",
    label: "YouTube",
    aspectRatio: "16:9",
    width: 1920,
    height: 1080,
    maxDurationSec: 600,
    platforms: ["YOUTUBE"],
  },
  {
    id: "x-video",
    label: "X Video",
    aspectRatio: "16:9",
    width: 1280,
    height: 720,
    maxDurationSec: 120,
    platforms: ["X"],
  },
  {
    id: "linkedin-video",
    label: "LinkedIn Video",
    aspectRatio: "16:9",
    width: 1280,
    height: 720,
    maxDurationSec: 120,
    platforms: ["LINKEDIN"],
  },
  {
    id: "square",
    label: "Square",
    aspectRatio: "1:1",
    width: 1080,
    height: 1080,
    maxDurationSec: 60,
    platforms: ["INSTAGRAM", "X", "LINKEDIN"],
  },
];

export function getVideoPreset(id: string): VideoPreset | undefined {
  return VIDEO_PRESETS.find((p) => p.id === id);
}

export function presetForPlatform(platform: string): VideoPreset {
  return (
    VIDEO_PRESETS.find((p) => p.platforms.includes(platform)) ||
    VIDEO_PRESETS.find((p) => p.id === "tiktok")!
  );
}

/** A scene in a video script. */
export type ScriptScene = {
  id: string;
  order: number;
  durationSec: number;
  voiceover: string;
  onScreenText: string;
  visualRef: string;
  visualType: "screenshot" | "chart" | "graphic" | "overlay" | "broll" | "logo";
  overlay?: string;
};

export type Script = {
  id: string;
  title: string;
  hook: string;
  cta: string;
  durationSec: number;
  aspectRatio: AspectRatio;
  language: string;
  tone: string;
  disclosure: string;
  scenes: ScriptScene[];
  metadata: {
    feature: string;
    audience: string;
    angle: string;
    demoLabel?: boolean;
  };
};

export type CaptionCue = {
  startMs: number;
  endMs: number;
  text: string;
};

export type MediaAsset = {
  id: string;
  kind: "image" | "video" | "audio" | "font" | "overlay";
  url: string;
  localPath?: string;
  source: string;
  width?: number;
  height?: number;
  durationSec?: number;
  sizeBytes?: number;
  createdAt: number;
};

export type ComposeVideoInput = {
  script: Script;
  assets: MediaAsset[];
  captions?: CaptionCue[];
  music?: MediaAsset;
  preset: VideoPreset;
  outputName: string;
};

export type ComposeVideoResult = {
  ok: boolean;
  video?: MediaAsset;
  thumbnail?: MediaAsset;
  error?: string;
  provider?: string;
  fallbackUsed?: boolean;
};

export type GenerateScriptInput = {
  feature: string;
  audience: string;
  angle: string;
  tone: string;
  language: string;
  durationSec: number;
  aspectRatio: AspectRatio;
  cta: string;
  demoLabel?: boolean;
};

export type GenerateVoiceoverInput = {
  script: Script;
  voice?: string;
  language: string;
};

export type GenerateVoiceoverResult = {
  ok: boolean;
  audio?: MediaAsset;
  error?: string;
  provider?: string;
};

export type GenerateCaptionsInput = {
  script: Script;
  voiceoverDurationMs?: number;
};

export type GenerateCaptionsResult = {
  ok: boolean;
  captions?: CaptionCue[];
  error?: string;
  provider?: string;
};

export type GenerateThumbnailInput = {
  script: Script;
  assets: MediaAsset[];
  preset: VideoPreset;
};

export type GenerateThumbnailResult = {
  ok: boolean;
  thumbnail?: MediaAsset;
  error?: string;
  provider?: string;
};

export type GenerateVisualsInput = {
  script: Script;
  preferredSources?: string[];
};

export type GenerateVisualsResult = {
  ok: boolean;
  assets: MediaAsset[];
  missing: string[];
  error?: string;
  provider?: string;
};

/** Provider interface — every capability is optional; missing capabilities
 *  surface as `NOT_AVAILABLE` instead of throwing. */
export interface MarketingMediaProvider {
  readonly id: string;
  readonly capabilities: (
    | "script"
    | "voiceover"
    | "captions"
    | "visuals"
    | "compose"
    | "thumbnail"
  )[];
  isAvailable(): Promise<boolean>;
  generateScript?(input: GenerateScriptInput): Promise<{ ok: boolean; script?: Script; error?: string }>;
  generateVoiceover?(input: GenerateVoiceoverInput): Promise<GenerateVoiceoverResult>;
  generateCaptions?(input: GenerateCaptionsInput): Promise<GenerateCaptionsResult>;
  generateVisuals?(input: GenerateVisualsInput): Promise<GenerateVisualsResult>;
  composeVideo?(input: ComposeVideoInput): Promise<ComposeVideoResult>;
  generateThumbnail?(input: GenerateThumbnailInput): Promise<GenerateThumbnailResult>;
}

export type MediaProviderStatus = {
  id: string;
  available: boolean;
  capabilities: MarketingMediaProvider["capabilities"];
  reason?: string;
};