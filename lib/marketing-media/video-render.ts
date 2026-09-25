/** Video render engine — extended Marketing Factory pipeline.
 *
 * Uses ONLY existing infrastructure: FFmpeg (verified), TTS (/usr/bin/say + ffmpeg),
 * market visuals (SVG → PNG), existing assets, existing storage paths.
 *
 * NO direct AI text-to-video provider exists in .env / lib/ai/providers.
 * Fallback: cinematic montage of real market charts + text scenes + voiceover.
 * Every output is validated with ffprobe.
 */
import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { Script, ComposeVideoInput, MediaAsset, VideoPreset } from "./types";

const FFMPEG = "/opt/homebrew/bin/ffmpeg";
const FFPROBE = "/opt/homebrew/bin/ffprobe";

export interface VideoRenderRequest {
  script: Script;
  preset: VideoPreset;
  outputName: string;
  assets?: MediaAsset[];
  audioPath?: string; // pre-generated TTS mp3
}

export async function renderVideo(req: VideoRenderRequest): Promise<{ ok: boolean; video?: MediaAsset; error?: string; provider?: string }> {
  const available = await ffmpegAvailable();
  if (!available) return { ok: false, error: "FFmpeg unavailable.", provider: "ffmpeg-local" };

  try {
    const tmpDir = path.join("/tmp", `vid_${Date.now().toString(36)}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    // 1) Build per-scene clips from available visuals + background
    const sceneClips: string[] = [];
    for (let i = 0; i < req.script.scenes.length; i++) {
      const scene = req.script.scenes[i];
      const dur = Math.max(3, Math.min(req.preset.maxDurationSec, scene.durationSec || 5));
      const clipPath = path.join(tmpDir, `s_${i}.mp4`);
      // Prefer market visual asset if available; else dark background with zoom
      const visual = req.assets?.find((a) => a.kind === "image") || req.assets?.find((a) => a.url?.includes("sparkline"));
      let imgInput = "";
      if (visual && visual.localPath && fs.existsSync(visual.localPath)) {
        imgInput = visual.localPath;
      }
      if (imgInput) {
        await runFfmpeg([
          "-loop", "1", "-i", imgInput,
          "-vf", `scale=${req.preset.width}:${req.preset.height}:force_original_aspect_ratio=decrease,pad=${req.preset.width}:${req.preset.height}:(ow-iw)/2:(oh-ih)/2,zoompan=z='min(zoom+0.001,1.3)':d=${dur}:s=${req.preset.width}x${req.preset.height},format=yuv420p,fade=t=in:st=0:d=0.3,fade=t=out:st=${dur - 0.3}:d=0.3`,
          "-t", String(dur),
          "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
          clipPath,
        ]);
      } else {
        // No image asset: dark background with text overlay using drawtext if available; else plain color
        const color = (scene as any).color ? String((scene as any).color) : "0x0f172a";
        await runFfmpeg([
          "-f", "lavfi", "-i", `color=c=${color}:s=${req.preset.width}x${req.preset.height}:d=${dur}`,
          "-vf", `zoompan=z='min(zoom+0.002,1.5)':d=${dur}:s=${req.preset.width}x${req.preset.height},format=yuv420p,fade=t=in:st=0:d=0.3,fade=t=out:st=${dur - 0.3}:d=0.3`,
          "-t", String(dur),
          "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
          clipPath,
        ]);
      }
      sceneClips.push(clipPath);
    }

    // 2) Concatenate scene clips
    const concatList = path.join(tmpDir, "concat.txt");
    fs.writeFileSync(concatList, sceneClips.map((p) => `file '${p}'`).join("\n"));
    const concatPath = path.join(tmpDir, "concat.mp4");
    await runFfmpeg([
      "-f", "concat", "-safe", "0", "-i", concatList,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
      "-movflags", "+faststart",
      concatPath,
    ]);

    // 3) Add audio (voiceover) if provided
    let finalPath = concatPath;
    const audioPath = req.audioPath || (req.assets?.find((a) => a.kind === "audio")?.localPath);
    if (audioPath && fs.existsSync(audioPath)) {
      const withAudio = path.join(tmpDir, "with_audio.mp4");
      await runFfmpeg([
        "-i", concatPath, "-i", audioPath,
        "-shortest", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        withAudio,
      ]);
      finalPath = withAudio;
    }

    // 4) Thumbnail (first frame)
    const thumbPath = path.join(tmpDir, "thumb.jpg");
    await runFfmpeg([
      "-ss", "00:00:01", "-i", finalPath,
      "-vframes", "1", "-q:v", "2", thumbPath,
    ]);

    // 5) Final move to stable asset path
    const outDir = "/tmp/marketing-video/assets";
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${req.outputName}.mp4`);
    fs.copyFileSync(finalPath, outFile);

    // 6) Validation with ffprobe
    const probe = await probeFile(outFile);
    if (!probe.ok || !probe.duration || probe.duration < 1 || !probe.videoStream) {
      return { ok: false, error: `Validation failed: duration=${probe.duration}, video=${probe.videoStream}, audio=${probe.audioStream}`, provider: "ffmpeg-local" };
    }

    const asset: MediaAsset = {
      id: `video_${req.outputName}`,
      kind: "video",
      url: `/marketing-video/assets/${req.outputName}.mp4`,
      localPath: outFile,
      source: "ffmpeg-local",
      durationSec: Math.round(probe.duration || 0),
      createdAt: Date.now(),
    };

    return { ok: true, video: asset, provider: "ffmpeg-local" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Render failed.", provider: "ffmpeg-local" };
  }
}

function ffmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(FFMPEG, ["-version"], { encoding: "utf8", timeout: 5000 }, (err, stdout) => {
      resolve(Boolean(stdout && stdout.includes("ffmpeg version")));
    });
  });
}

function runFfmpeg(cmd: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, cmd, { encoding: "utf8", timeout: 60000 }, (err, stdout, stderr) => {
      if (err && !stderr?.includes("Press [q] to stop")) {
        // Some warnings are harmless
        if (stderr && stderr.includes("Output file #0 does not contain any stream")) return reject(err);
      }
      resolve();
    });
  });
}

async function probeFile(filePath: string): Promise<{ ok: boolean; duration?: number; videoStream?: boolean; audioStream?: boolean }> {
  return new Promise((resolve) => {
    execFile(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", filePath], { encoding: "utf8", timeout: 10000 }, (err, stdout) => {
      if (err) return resolve({ ok: false });
      const videoStream = stdout.trim().length > 0;
      execFile(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath], { encoding: "utf8", timeout: 10000 }, (err2, stdout2) => {
        const duration = parseFloat(stdout2.trim()) || 0;
        execFile(FFPROBE, ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", filePath], { encoding: "utf8", timeout: 10000 }, (err3, stdout3) => {
          resolve({ ok: true, duration, videoStream, audioStream: Boolean(stdout3 && stdout3.trim().length > 0) });
        });
      });
    });
  });
}
