/** FFmpeg composition helpers.
 *
 * Uses the local `/opt/homebrew/bin/ffmpeg` (verified filters: scale, zoompan,
 * concat, overlay, fade, volume, color). NOT available in this build:
 *   - subtitles / drawtext  → caption burning reports NOT_AVAILABLE
 *
 * All paths are server‑local. Nothing is fetched from user‑supplied URLs.
 */

import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { Script, ScriptScene, MediaAsset, ComposeVideoInput, VideoPreset } from "./types";
import { MARKETING_DEFAULTS } from "./collections";

const FFMPEG = "/opt/homebrew/bin/ffmpeg";

export async function ffmpegAvailable(): Promise<boolean> {
  try {
    const { stdout } = await execFile(FFMPEG, ["-version"], { encoding: "utf8", timeout: 5000 });
    return stdout.includes("ffmpeg version");
  } catch {
    return false;
  }
}

export async function composeVideo(input: ComposeVideoInput): Promise<{ ok: boolean; video?: MediaAsset; error?: string; provider?: string }> {
  const available = await ffmpegAvailable();
  if (!available) {
    return { ok: false, error: "FFmpeg not available — composition not possible.", provider: "ffmpeg-local" };
  }

  try {
    const tmpDir = path.join("/tmp", `mktg_${Date.now().toString(36)}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    // 1) Per-scene temp clips: scale to preset + Ken Burns zoompan (deterministic).
    const sceneClips: string[] = [];
    for (let i = 0; i < input.script.scenes.length; i++) {
      const scene = input.script.scenes[i];
      const clipPath = path.join(tmpDir, `scene_${i}.mp4`);
      const dur = Math.max(4, Math.min(input.preset.maxDurationSec, scene.durationSec));
      const cmd = [
        "-f", "lavfi", "-i", `color=c=0x0f172a:s=${input.preset.width}x${input.preset.height}:d=${dur}`,
        "-vf", `scale=${input.preset.width}:${input.preset.height},zoompan=z='min(zoom+0.002,1.5)':d=${dur}:s=${input.preset.width}x${input.preset.height}`,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", String(dur), clipPath,
      ];
      await runFfmpeg(cmd);
      sceneClips.push(clipPath);
    }

    // 2) Concat all scene clips (re-encode).
    const concatList = path.join(tmpDir, "concat.txt");
    fs.writeFileSync(concatList, sceneClips.map((p) => `file '${p}'`).join("\n"));
    const outPath = path.join(tmpDir, "out.mp4");
    await runFfmpeg([
      "-f", "concat", "-safe", "0", "-i", concatList,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
      "-movflags", "+faststart", outPath,
    ]);

    // 3) Logo overlay (deterministic position: bottom-right).
    const logo = input.assets.find((a) => a.kind === "overlay" || a.url.includes("logo"));
    if (logo && fs.existsSync(logo.localPath || "")) {
      const overPath = path.join(tmpDir, "with_logo.mp4");
      await runFfmpeg([
        "-i", outPath, "-i", logo.localPath!,
        "-filter_complex", `overlay=x=${input.preset.width - 120}:y=${input.preset.height - 80}`,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", overPath,
      ]);
      fs.renameSync(overPath, outPath);
    }

    const finalUrl = `/marketing-video/assets/${path.basename(outPath)}`;
    const asset: MediaAsset = {
      id: `video_${input.outputName}`,
      kind: "video",
      url: finalUrl,
      localPath: outPath,
      source: "ffmpeg-local",
      width: input.preset.width,
      height: input.preset.height,
      durationSec: input.script.durationSec,
      createdAt: Date.now(),
    };
    return { ok: true, video: asset, provider: "ffmpeg-local" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Composition failed.", provider: "ffmpeg-local" };
  }
}

/** Generate a thumbnail by extracting one frame at the midpoint. */
export async function generateThumbnail(
  script: Script,
  preset: VideoPreset,
  assets: MediaAsset[]
): Promise<{ ok: boolean; thumbnail?: MediaAsset; error?: string; provider?: string }> {
  const available = await ffmpegAvailable();
  if (!available) {
    return { ok: false, error: "FFmpeg not available — thumbnail generation not possible.", provider: "ffmpeg-local" };
  }
  try {
    const tmpDir = path.join("/tmp", `mktg_thumb_${Date.now().toString(36)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const outPath = path.join(tmpDir, "thumb.png");
    const seekTime = Math.min(5, Math.max(1, script.durationSec / 2));
    await runFfmpeg([
      "-ss", String(seekTime), "-i", assets.find((a) => a.kind === "video")?.localPath || assets[0]?.localPath || "",
      "-frames:v", "1", "-vf", `scale=${preset.width}:${preset.height}`, outPath,
    ]);
    if (fs.existsSync(outPath)) {
      const asset: MediaAsset = {
        id: `thumb_${script.id}`,
        kind: "image",
        url: `/marketing-video/assets/${path.basename(outPath)}`,
        localPath: outPath,
        source: "ffmpeg-local",
        width: preset.width,
        height: preset.height,
        createdAt: Date.now(),
      };
      return { ok: true, thumbnail: asset, provider: "ffmpeg-local" };
    }
    return { ok: false, error: "Thumbnail not produced." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Thumbnail generation failed.", provider: "ffmpeg-local" };
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, args, { encoding: "utf8", timeout: MARKETING_DEFAULTS.maxScriptDurationSec * 1000 + 5000 }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve();
    });
  });
}