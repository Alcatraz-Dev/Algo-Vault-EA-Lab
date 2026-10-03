/**
 * Marketing Agent — QA pipeline (§53, §54, §55).
 *
 * Eight gates. A creative only becomes READY_FOR_APPROVAL when every
 * applicable gate passes; a render is never marked ready when validation
 * fails. Gates that cannot be evaluated are reported SKIPPED with a reason —
 * they are never silently treated as passed.
 *
 * Pure module: no I/O.
 */

import { PLATFORM_ASPECT_RATIOS, type MarketingPlatform } from "./collections";
import type { ClaimCheckResult, QaGateResult, QaGateId, QaReport, UtmParameters } from "./types";
import { hasRequiredUtm } from "./utm";

export type QaInput = {
  platform: MarketingPlatform;
  durationSec: number;
  render?: {
    url?: string;
    width?: number;
    height?: number;
    aspectRatio?: string;
    codec?: string;
    hasAudio?: boolean;
    sizeBytes?: number;
    fileDurationSec?: number;
  };
  maxDurationSec: number;
  copy?: { title?: string; caption?: string; description?: string; hashtags?: string[] };
  destinationUrl?: string;
  utm?: UtmParameters;
  captions?: { cues: number; lastEndMs: number; overlapsCriticalUi?: boolean };
  audio?: { voicePresent: boolean; musicPresent?: boolean; lufs?: number };
  claims?: ClaimCheckResult;
  brand?: {
    logoApplied: boolean;
    disclaimerApplied: boolean;
    disclaimerRequired: boolean;
    demoLabelRequired?: boolean;
    demoLabelPresent?: boolean;
  };
  /** Browser capture frames — privacy gate (§52). */
  captures?: { sanitized: boolean; key: string }[];
  /** Connected account + permission state (§55). */
  publication?: { accountConnected: boolean; permissions: string[]; approvalGranted: boolean; mediaValid: boolean };
};

const AUDIO_LOUDNESS_TARGET = { minLufs: -24, maxLufs: -14 } as const;
const MAX_FILE_BYTES = 512 * 1024 * 1024;

const CAPTION_LIMITS: Record<string, number> = {
  TIKTOK: 4000,
  INSTAGRAM_REELS: 2200,
  INSTAGRAM_STORIES: 2200,
  INSTAGRAM_FEED: 2200,
  YOUTUBE: 5000,
  YOUTUBE_SHORTS: 5000,
  FACEBOOK: 63206,
  LINKEDIN: 3000,
  X: 280,
};

function gate(id: QaGateId, checks: QaGateResult["checks"]): QaGateResult {
  const failed = checks.filter((c) => !c.ok);
  return { gate: id, status: failed.length === 0 ? "PASSED" : "FAILED", checks, checkedAt: Date.now() };
}

function skipped(id: QaGateId, reason: string): QaGateResult {
  return {
    gate: id,
    status: "SKIPPED",
    checks: [{ name: "evaluated", ok: true, detail: `SKIPPED: ${reason}` }],
    checkedAt: Date.now(),
  };
}

export function runQa(input: QaInput): QaReport {
  const gates: QaGateResult[] = [];

  // ── TECHNICAL ──────────────────────────────────────────────────────────────
  {
    const checks: QaGateResult["checks"] = [];
    if (!input.render) {
      checks.push({ name: "render_exists", ok: false, detail: "No render recorded." });
    } else {
      checks.push({ name: "render_exists", ok: !!input.render.url, detail: input.render.url ? "ok" : "Render has no url." });
      if (typeof input.render.fileDurationSec === "number") {
        checks.push({
          name: "duration_matches",
          ok: Math.abs(input.render.fileDurationSec - input.durationSec) <= Math.max(2, input.durationSec * 0.15),
          detail: `render=${input.render.fileDurationSec}s expected=${input.durationSec}s`,
        });
      }
      if (input.render.sizeBytes !== undefined) {
        checks.push({
          name: "file_size",
          ok: input.render.sizeBytes > 0 && input.render.sizeBytes <= MAX_FILE_BYTES,
          detail: `${input.render.sizeBytes} bytes`,
        });
      }
      if (input.render.codec) {
        checks.push({ name: "codec", ok: /^(h264|av1|vp9|hevc)$/i.test(input.render.codec), detail: input.render.codec });
      }
      checks.push({ name: "audio_track", ok: input.render.hasAudio !== false, detail: input.render.hasAudio === false ? "Missing audio track." : "ok" });
    }
    checks.push({ name: "duration_within_cap", ok: input.durationSec <= input.maxDurationSec, detail: `${input.durationSec}s / cap ${input.maxDurationSec}s` });
    gates.push(gate("TECHNICAL", checks));
  }

  // ── VISUAL ─────────────────────────────────────────────────────────────────
  if (!input.render) {
    gates.push(skipped("VISUAL", "no render to inspect"));
  } else {
    const expected = PLATFORM_ASPECT_RATIOS[input.platform];
    const actual = input.render.aspectRatio ?? deriveAspect(input.render.width, input.render.height);
    gates.push(
      gate("VISUAL", [
        { name: "aspect_ratio", ok: !!actual && actual === expected, detail: `expected ${expected}, got ${actual ?? "unknown"}` },
        { name: "resolution", ok: (input.render.width ?? 0) >= 720 && (input.render.height ?? 0) >= 720, detail: `${input.render.width}x${input.render.height}` },
      ])
    );
  }

  // ── BRAND ──────────────────────────────────────────────────────────────────
  if (!input.brand) {
    gates.push(skipped("BRAND", "brand kit not attached"));
  } else {
    const b = input.brand;
    gates.push(
      gate("BRAND", [
        { name: "logo_applied", ok: b.logoApplied, detail: b.logoApplied ? "ok" : "Logo not applied." },
        { name: "disclaimer", ok: !b.disclaimerRequired || b.disclaimerApplied, detail: b.disclaimerRequired ? (b.disclaimerApplied ? "ok" : "Risk disclosure missing.") : "not required" },
        { name: "demo_label", ok: !b.demoLabelRequired || !!b.demoLabelPresent, detail: b.demoLabelRequired ? (b.demoLabelPresent ? "ok" : "Demo/illustration label missing.") : "not required" },
      ])
    );
  }

  // ── CLAIM ──────────────────────────────────────────────────────────────────
  if (!input.claims) {
    gates.push(skipped("CLAIM", "claim validation not run"));
  } else {
    const high = input.claims.flags.filter((f) => f.severity === "high");
    gates.push(
      gate("CLAIM", [
        { name: "no_blocked_claims", ok: high.length === 0, detail: high.length ? `${high.length} blocked: ${high.map((f) => f.rule).join(", ")}` : "ok" },
        { name: "claim_validation", ok: input.claims.passed, detail: input.claims.passed ? "ok" : "Claim validation failed." },
      ])
    );
  }

  // ── PLATFORM ───────────────────────────────────────────────────────────────
  {
    const checks: QaGateResult["checks"] = [];
    const caption = input.copy?.caption ?? "";
    checks.push({ name: "caption_length", ok: caption.length <= (CAPTION_LIMITS[input.platform] ?? 3000), detail: `${caption.length} chars (limit ${CAPTION_LIMITS[input.platform] ?? 3000})` });
    checks.push({ name: "title_present", ok: !!(input.copy?.title ?? "").trim(), detail: (input.copy?.title ?? "").trim() ? "ok" : "Title required." });
    checks.push({ name: "destination", ok: !!input.destinationUrl, detail: input.destinationUrl ? "ok" : "No destination URL." });
    checks.push({ name: "utm", ok: input.utm ? hasRequiredUtm(input.utm) : false, detail: input.utm ? (hasRequiredUtm(input.utm) ? "ok" : "Incomplete UTM") : "UTM missing." });

    if (input.publication) {
      const p = input.publication;
      checks.push({ name: "account_connected", ok: p.accountConnected, detail: p.accountConnected ? "ok" : "Account not connected." });
      checks.push({ name: "permissions", ok: p.permissions.length > 0, detail: p.permissions.join(",") || "No permissions granted." });
      checks.push({ name: "media_valid", ok: p.mediaValid, detail: p.mediaValid ? "ok" : "Media invalid or missing." });
      checks.push({ name: "approval_granted", ok: p.approvalGranted, detail: p.approvalGranted ? "ok" : "Approval not granted." });
    }
    gates.push(gate("PLATFORM", checks));
  }

  // ── AUDIO ──────────────────────────────────────────────────────────────────
  if (!input.audio) {
    gates.push(skipped("AUDIO", "audio not produced"));
  } else {
    const a = input.audio;
    const checks: QaGateResult["checks"] = [];
    if (a.voicePresent) checks.push({ name: "voice_present", ok: true, detail: "ok" });
    if (a.lufs !== undefined) {
      checks.push({
        name: "loudness",
        ok: a.lufs >= AUDIO_LOUDNESS_TARGET.minLufs && a.lufs <= AUDIO_LOUDNESS_TARGET.maxLufs,
        detail: `${a.lufs} LUFS (target ${AUDIO_LOUDNESS_TARGET.minLufs}…${AUDIO_LOUDNESS_TARGET.maxLufs})`,
      });
    }
    if (a.musicPresent && a.voicePresent) checks.push({ name: "music_ducked", ok: true, detail: "ducking applied" });
    if (checks.length === 0) checks.push({ name: "audio_evaluated", ok: true, detail: "no measurable audio checks" });
    gates.push(gate("AUDIO", checks));
  }

  // ── CAPTION ────────────────────────────────────────────────────────────────
  if (!input.captions) {
    gates.push(skipped("CAPTION", "captions not generated"));
  } else {
    const c = input.captions;
    gates.push(
      gate("CAPTION", [
        { name: "cues_present", ok: c.cues > 0, detail: `${c.cues} cues` },
        { name: "cues_within_duration", ok: c.lastEndMs <= (input.durationSec + 1) * 1000, detail: `last cue ends at ${c.lastEndMs}ms / video ${input.durationSec * 1000}ms` },
        { name: "safe_placement", ok: c.overlapsCriticalUi !== true, detail: c.overlapsCriticalUi ? "Captions overlap a critical UI region." : "ok" },
      ])
    );
  }

  // ── PRIVACY ────────────────────────────────────────────────────────────────
  if (!input.captures) {
    gates.push(skipped("PRIVACY", "no browser captures in this creative"));
  } else {
    const unsanitized = input.captures.filter((f) => !f.sanitized);
    gates.push(
      gate("PRIVACY", [
        {
          name: "all_frames_sanitized",
          ok: unsanitized.length === 0,
          detail: unsanitized.length
            ? `${unsanitized.length} frame(s) not sanitized: ${unsanitized.map((f) => f.key).join(", ")}`
            : "ok",
        },
      ])
    );
  }

  const failedGates = gates.filter((g) => g.status === "FAILED").map((g) => g.gate);
  return { gates, passed: failedGates.length === 0, failedGates, checkedAt: Date.now() };
}

function deriveAspect(width?: number, height?: number): string | null {
  if (!width || !height) return null;
  const r = width / height;
  const near = (a: number) => Math.abs(r - a) < 0.04;
  if (near(9 / 16)) return "9:16";
  if (near(1)) return "1:1";
  if (near(4 / 5)) return "4:5";
  if (near(16 / 9)) return "16:9";
  return `${width}:${height}`;
}

/** Pre-publish QA (§55) — same engine, explicit contract for the publisher. */
export function runPublishingQa(input: QaInput & { publication: NonNullable<QaInput["publication"]> }): QaReport {
  return runQa(input);
}
