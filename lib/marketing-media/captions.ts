/** Caption generation – deterministic cues from script scenes.
 *  Pure module: does not burn captions into video (subtitles filter not available)
 *  but produces SRT‑compatible CaptionCue[] for client‑side players.
 */

import { Script, ScriptScene } from "./types";

export type CaptionCue = {
  startMs: number;
  endMs: number;
  text: string;
};

/** Generate caption cues from a script by distributing voiceover words evenly.
 *  Input voiceoverDurationMs optional – if missing, sum of scene durations is used.
 */
export function generateCaptionsFromScript(
  script: Script,
  voiceoverDurationMs?: number
): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let cursorMs = 0;
  for (const scene of script.scenes) {
    const words = scene.voiceover.split(/\s+/).filter(Boolean);
    const sceneDurationMs = voiceoverDurationMs
      ? (scene.durationSec / script.durationSec) * voiceoverDurationMs
      : scene.durationSec * 1000;
    const perWord = sceneDurationMs / Math.max(1, words.length);
    for (const w of words) {
      cues.push({ startMs: cursorMs, endMs: cursorMs + perWord, text: w });
      cursorMs += perWord;
    }
    // brief pause between scenes
    cursorMs += 120;
  }
  return cues;
}

/** Convert CaptionCue[] to SRT string. */
export function captionsToSrt(cues: CaptionCue[]): string {
  return cues
    .map((c, i) => {
      const start = formatTimestamp(c.startMs);
      const end = formatTimestamp(c.endMs);
      return `${i + 1}\n${start} --> ${end}\n${c.text}\n`;
    })
    .join("\n");
}

/** Helper: ms → HH:MM:SS,mmm */
function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = ms % 1000;
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")},${millis
    .toString()
    .padStart(3, "0")}`;
}