/** TTS provider — local `/usr/bin/say` → WAV → mp3 via ffmpeg.
 *  Honest availability check (binary presence). Reports NOT_AVAILABLE when
 *  `/usr/bin/say` is missing or ffmpeg fails to transcode.
 */

import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { GenerateVoiceoverResult, MediaAsset, GenerateVoiceoverInput } from "./types";

const SAY_BIN = "/usr/bin/say";
const FFMPEG = "/opt/homebrew/bin/ffmpeg";

export async function isTtsAvailable(): Promise<boolean> {
  try { fs.accessSync(SAY_BIN, fs.constants.X_OK); return true; } catch { return false; }
}

export async function generateVoiceoverWithSay(input: GenerateVoiceoverInput): Promise<GenerateVoiceoverResult> {
  const available = await isTtsAvailable();
  if (!available) {
    return { ok: false, error: "TTS not available (say binary not found).", provider: "tts-local" };
  }
  try {
    const tmpDir = path.join("/tmp", `tts_${Date.now().toString(36)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const wavPath = path.join(tmpDir, "tts.wav");
    const outPath = path.join(tmpDir, "tts.mp3");
    const text = input.script?.scenes?.map((s) => s.voiceover).join(". ") || "Hello.";
    await execFile(SAY_BIN, ["-o", wavPath, text], { encoding: "utf8", timeout: 30000 });
    await execFile(FFMPEG, ["-i", wavPath, "-vn", "-ar", "44100", "-ac", "2", "-b:a", "128k", outPath], { encoding: "utf8", timeout: 30000 });
    if (fs.existsSync(outPath)) {
      const asset: MediaAsset = {
        id: `tts_${Date.now()}`,
        kind: "audio",
        url: `/marketing-video/assets/${path.basename(outPath)}`,
        localPath: outPath,
        source: "tts-local",
        durationSec: input.script?.durationSec || 30,
        createdAt: Date.now(),
      };
      return { ok: true, audio: asset, provider: "tts-local" };
    }
    return { ok: false, error: "Transcode failed." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Voiceover generation failed.", provider: "tts-local" };
  }
}