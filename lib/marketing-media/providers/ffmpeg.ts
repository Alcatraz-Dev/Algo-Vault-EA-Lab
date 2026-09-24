/** FFmpeg provider wrapper for marketing media.
 *  Registers the ffmpeg capability with the provider registry.
 *  Falls back gracefully when FFmpeg is unavailable.
 */

import { MarketingMediaProvider, GenerateScriptInput, Script, MediaAsset, ComposeVideoInput, ComposeVideoResult, GenerateThumbnailInput, GenerateThumbnailResult } from "../types";
import { createRecord, genId, writeGrowthAudit } from "@/lib/growth/database";
import { composeVideo as composeVideoFn, generateThumbnail as generateThumbnailFn, ffmpegAvailable } from "../ffmpeg";
import { MARKETING_COLLECTIONS } from "../collections";

export class FFmpegProvider implements MarketingMediaProvider {
  readonly id = "ffmpeg";
  readonly capabilities: MarketingMediaProvider["capabilities"] = ["compose", "thumbnail"];

  async isAvailable(): Promise<boolean> {
    return ffmpegAvailable();
  }

  async composeVideo(input: ComposeVideoInput): Promise<ComposeVideoResult> {
    const result = await composeVideoFn(input);
    return result;
  }

  async generateThumbnail(input: GenerateThumbnailInput): Promise<GenerateThumbnailResult> {
    const result = await generateThumbnailFn(input.script, input.preset, input.assets);
    return result;
  }
}

export function registerFfmpegProvider(): void {
  (async () => {
    const avail = await ffmpegAvailable();
    if (!avail) return;
    const { registerMarketingMediaProvider } = await import("./index");
    registerMarketingMediaProvider(new FFmpegProvider());
  })();
}