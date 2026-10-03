/**
 * Marketing Agent — platform copy + publishing package (§20, §34, §55).
 *
 * One creative request → per-platform title/caption/description/CTA/hashtags/
 * first comment/UTM. Hashtag count is restrained (§20: no stuffing) and every
 * claim passes the claim validator before it can leave this module.
 *
 * Pure module: no I/O.
 */

import { MARKETING_PLATFORM_LABELS, type MarketingLanguage, type MarketingPlatform } from "../collections";
import { approvedClaimsFor, runClaimValidation, RISK_DISCLOSURE_TEXT } from "../claims";
import { captionLimit } from "../publishing/capabilities";
import { applyUtm, buildUtm } from "../utm";
import type { PlatformCopy, PublishingPackage, UtmParameters } from "../types";
import type { Script } from "@/lib/marketing-media/types";

const HASHTAG_BUDGET: Record<MarketingPlatform, number> = {
  TIKTOK: 4,
  INSTAGRAM_REELS: 5,
  INSTAGRAM_STORIES: 0,
  INSTAGRAM_FEED: 5,
  YOUTUBE_SHORTS: 3,
  YOUTUBE: 4,
  FACEBOOK: 3,
  LINKEDIN: 3,
  X: 1,
};

export type CopyInput = {
  script: Script;
  platform: MarketingPlatform;
  language: MarketingLanguage;
  campaignName: string;
  creativeId: string;
  variantKey?: string;
  products: string[];
  destinationUrl: string;
  medium?: string;
  /** Extra instruction from the prompt, e.g. "make it more professional". */
  tone?: string;
};

export function generatePlatformCopy(input: CopyInput): { copy: PlatformCopy; warnings: string[] } {
  const warnings: string[] = [];
  const label = MARKETING_PLATFORM_LABELS[input.platform];
  const featureName = input.script.metadata.feature || "AlgoVault";
  const claims = approvedClaimsFor(input.products);

  const title = platformTitle(input.platform, featureName, input.script.hook).slice(0, 120);
  const body = input.script.scenes.map((s) => s.voiceover).filter(Boolean).join(" ");
  const cta = input.script.cta;

  const utm = buildUtm({
    platform: input.platform,
    campaignName: input.campaignName,
    creativeId: input.creativeId,
    variantKey: input.variantKey,
    language: input.language,
    medium: input.medium ?? "social",
  });
  const destinationUrl = applyUtm(input.destinationUrl || "/", utm);

  const hashtags = buildHashtags(input.platform, featureName, input.products);
  const disclosure = input.script.disclosure?.trim() || RISK_DISCLOSURE_TEXT;

  let caption = "";
  let description = "";

  switch (input.platform) {
    case "X":
      caption = `${title}\n${cta}`.slice(0, 280);
      description = "";
      break;
    case "LINKEDIN":
      caption = [title, "", body.slice(0, 700), "", cta, "", disclosure].filter(Boolean).join("\n");
      description = body.slice(0, 2000);
      break;
    case "FACEBOOK":
    case "YOUTUBE":
    case "YOUTUBE_SHORTS":
      caption = [title, "", body.slice(0, 900), "", cta, "", hashtags.join(" ")].filter(Boolean).join("\n");
      description = [body.slice(0, 3000), "", cta, "", destinationUrl, "", disclosure].filter(Boolean).join("\n");
      break;
    case "INSTAGRAM_STORIES":
      caption = "";
      description = "";
      break;
    default:
      caption = [body.slice(0, 1000), "", cta, "", hashtags.join(" ")].filter(Boolean).join("\n").slice(0, 1800);
      description = body.slice(0, 1200);
  }

  const limit = captionLimit(input.platform);
  if (caption.length > limit) {
    caption = `${caption.slice(0, limit - 1)}…`;
    warnings.push(`Caption trimmed to the ${input.platform} limit of ${limit} characters.`);
  }

  const firstComment =
    input.platform === "INSTAGRAM_REELS" || input.platform === "INSTAGRAM_FEED"
      ? [destinationUrl, disclosure].filter(Boolean).join("\n\n").slice(0, 900)
      : undefined;

  const copy: PlatformCopy = {
    platform: input.platform,
    title,
    caption,
    description,
    cta,
    hashtags,
    firstComment,
    destinationUrl,
    utm,
  };

  // Claims gate (§51) — blocked copy never reaches a publishing job.
  const claimResult = runClaimValidation(
    [
      { field: "title", text: title },
      { field: "caption", text: caption },
      { field: "description", text: description },
      { field: "cta", text: cta },
      ...claims.map((c) => ({ field: "claim", text: c })),
    ],
    { policy: "STRICT" }
  );
  if (!claimResult.passed) {
    warnings.push(`Claim validation flagged ${claimResult.flags.length} statement(s) for review.`);
    copy.unsupported = Array.from(new Set(claimResult.flags.map((f) => f.rule)));
  }

  return { copy, warnings };
}

function platformTitle(platform: MarketingPlatform, feature: string, hook: string): string {
  const shortHook = hook.split(/[.!?]/)[0]?.trim() ?? "";
  switch (platform) {
    case "YOUTUBE":
    case "YOUTUBE_SHORTS":
      return `${feature} — ${shortHook}`.slice(0, 95);
    case "LINKEDIN":
      return `${feature}: ${shortHook}`;
    case "X":
      return shortHook || feature;
    default:
      return shortHook || feature;
  }
}

/** Conservative hashtag set — never spammy (§20). */
function buildHashtags(platform: MarketingPlatform, feature: string, products: string[]): string[] {
  const budget = HASHTAG_BUDGET[platform];
  if (budget === 0) return [];

  const base = ["AlgoVault", "TradingTools"];
  const featureTag = feature.replace(/[^A-Za-z0-9]/g, "");
  const productTags = products.slice(0, 2).map((p) => p.replace(/[^a-z0-9]/gi, ""));
  const platformTag = platform === "TIKTOK" ? ["fyp"] : platform === "YOUTUBE_SHORTS" || platform === "YOUTUBE" ? ["Shorts"] : [];

  const all = Array.from(new Set([featureTag, ...base, ...productTags, ...platformTag].filter(Boolean)));
  return all.slice(0, budget).map((t) => `#${t}`);
}

export function buildPublishingPackage(input: {
  jobId: string;
  creativeId: string;
  versionId: string;
  platform: MarketingPlatform;
  language: MarketingLanguage;
  copy: PlatformCopy;
  mediaUrl: string;
  durationSec: number;
  now?: number;
  actor: string;
}): PublishingPackage {
  return {
    jobId: input.jobId,
    creativeId: input.creativeId,
    versionId: input.versionId,
    platform: input.platform,
    language: input.language,
    copy: input.copy,
    mediaUrl: input.mediaUrl,
    mediaMime: "video/mp4",
    durationSec: input.durationSec,
    createdAt: input.now ?? Date.now(),
    createdBy: input.actor,
  };
}

export type { UtmParameters };
