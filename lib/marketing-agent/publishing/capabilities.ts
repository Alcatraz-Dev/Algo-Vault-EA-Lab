/**
 * Marketing Agent — platform capability matrix (§64, §65).
 *
 * Captures what each platform's OFFICIAL API actually supports today. This is
 * deliberately conservative: a capability is `true` only where an official,
 * documented surface exists, and every `false` carries the reason so the UI can
 * show NOT_SUPPORTED instead of failing silently.
 *
 * Pure module: no I/O.
 */

import { MARKETING_PLATFORMS, type MarketingPlatform } from "../collections";
import type { PublishingCapability } from "./types";

const CAPABILITIES: Record<MarketingPlatform, PublishingCapability> = {
  TIKTOK: {
    platform: "TIKTOK",
    canPublishVideo: true,
    canScheduleNatively: false,
    canUploadThumbnail: false,
    canAddDescription: true,
    canAddHashtags: false,
    canAddFirstComment: false,
    canRetrieveMetrics: true,
    maxVideoDurationSec: 600,
    maxCaptionChars: 2200,
    supportedAspectRatios: ["9:16", "1:1"],
    apiSurface: "TikTok Content Posting API (direct-post)",
    notes: [
      "Scheduling is not offered by the Content Posting API — AlgoVault's scheduler triggers publication instead.",
      "Hashtags are part of the caption text; there is no separate hashtag field.",
      "Requires an approved app and audited content scope.",
    ],
  },
  INSTAGRAM_REELS: {
    platform: "INSTAGRAM_REELS",
    canPublishVideo: true,
    canScheduleNatively: false,
    canUploadThumbnail: true,
    canAddDescription: true,
    canAddHashtags: false,
    canAddFirstComment: true,
    canRetrieveMetrics: true,
    maxVideoDurationSec: 90,
    maxCaptionChars: 2200,
    supportedAspectRatios: ["9:16"],
    apiSurface: "Instagram Graph API — /media (REELS container)",
    notes: [
      "Publishing requires a Business/Creator account linked to a Facebook Page.",
      "No native scheduling; AlgoVault schedules and calls publish at the due time.",
      "Hashtags belong in the caption text.",
    ],
  },
  INSTAGRAM_STORIES: {
    platform: "INSTAGRAM_STORIES",
    canPublishVideo: true,
    canScheduleNatively: false,
    canUploadThumbnail: false,
    canAddDescription: false,
    canAddHashtags: false,
    canAddFirstComment: false,
    canRetrieveMetrics: true,
    maxVideoDurationSec: 60,
    maxCaptionChars: 0,
    supportedAspectRatios: ["9:16"],
    apiSurface: "Instagram Graph API — /media (STORIES container)",
    notes: ["Stories have no caption field — on-screen captions must be burned in.", "No native scheduling."],
  },
  INSTAGRAM_FEED: {
    platform: "INSTAGRAM_FEED",
    canPublishVideo: true,
    canScheduleNatively: false,
    canUploadThumbnail: true,
    canAddDescription: true,
    canAddHashtags: false,
    canAddFirstComment: true,
    canRetrieveMetrics: true,
    maxVideoDurationSec: 60,
    maxCaptionChars: 2200,
    supportedAspectRatios: ["1:1", "4:5"],
    apiSurface: "Instagram Graph API — /media (REELS/FEED container)",
    notes: ["Feed video publishing uses the REELS container; aspect ratio must match the container."],
  },
  YOUTUBE: {
    platform: "YOUTUBE",
    canPublishVideo: true,
    canScheduleNatively: true,
    canUploadThumbnail: true,
    canAddDescription: true,
    canAddHashtags: false,
    canAddFirstComment: false,
    canRetrieveMetrics: true,
    maxVideoDurationSec: 43200,
    maxCaptionChars: 5000,
    supportedAspectRatios: ["16:9", "9:16"],
    apiSurface: "YouTube Data API v3 — videos.insert + videos.update",
    notes: [
      "Native scheduling is supported via publishAt on an upload with privacyStatus=private.",
      "Thumbnail upload requires the channel to be verified.",
      "Quota: a single upload costs 1600 of 10 000 daily units.",
    ],
  },
  YOUTUBE_SHORTS: {
    platform: "YOUTUBE_SHORTS",
    canPublishVideo: true,
    canScheduleNatively: true,
    canUploadThumbnail: true,
    canAddDescription: true,
    canAddHashtags: false,
    canAddFirstComment: false,
    canRetrieveMetrics: true,
    maxVideoDurationSec: 180,
    maxCaptionChars: 5000,
    supportedAspectRatios: ["9:16"],
    apiSurface: "YouTube Data API v3 — videos.insert (vertical, #Shorts in title/description)",
    notes: ["Shorts are regular uploads with a vertical aspect ratio and a #Shorts marker."],
  },
  FACEBOOK: {
    platform: "FACEBOOK",
    canPublishVideo: true,
    canScheduleNatively: true,
    canUploadThumbnail: true,
    canAddDescription: true,
    canAddHashtags: false,
    canAddFirstComment: false,
    canRetrieveMetrics: true,
    maxVideoDurationSec: 14400,
    maxCaptionChars: 63206,
    supportedAspectRatios: ["16:9", "9:16", "1:1"],
    apiSurface: "Meta Graph API — /{page-id}/video_uploads",
    notes: ["Scheduling uses the `unpublished_content` schedule field.", "Requires Page permissions with content publishing rights."],
  },
  LINKEDIN: {
    platform: "LINKEDIN",
    canPublishVideo: true,
    canScheduleNatively: false,
    canUploadThumbnail: true,
    canAddDescription: true,
    canAddHashtags: false,
    canAddFirstComment: false,
    canRetrieveMetrics: true,
    maxVideoDurationSec: 600,
    maxCaptionChars: 3000,
    supportedAspectRatios: ["16:9", "1:1", "9:16"],
    apiSurface: "LinkedIn UGC API — /assets + /ugcPosts",
    notes: [
      "Video must be uploaded as an asset and registered before the post is created.",
      "No native scheduling — AlgoVault's scheduler triggers publication.",
      "Organic video posting requires an approved partner application.",
    ],
  },
  X: {
    platform: "X",
    canPublishVideo: true,
    canScheduleNatively: false,
    canUploadThumbnail: true,
    canAddDescription: false,
    canAddHashtags: false,
    canAddFirstComment: false,
    canRetrieveMetrics: true,
    maxVideoDurationSec: 140,
    maxCaptionChars: 280,
    supportedAspectRatios: ["16:9", "1:1", "9:16"],
    apiSurface: "X API v2 — media/upload (v1.1) + /2/tweets",
    notes: [
      "Video upload uses the v1.1 media/upload endpoint with chunked upload.",
      "Hashtags are plain text in the tweet body.",
      "No native scheduling; API tier determines media upload access.",
    ],
  },
};

export function getCapability(platform: MarketingPlatform): PublishingCapability {
  return CAPABILITIES[platform];
}

export function listCapabilities(): PublishingCapability[] {
  return MARKETING_PLATFORMS.map((p) => CAPABILITIES[p]);
}

/** Capability object the admin UI renders (§65). */
export function capabilityMatrix(): {
  platform: MarketingPlatform;
  canPublishVideo: boolean;
  canSchedule: boolean;
  canUploadThumbnail: boolean;
  canAddDescription: boolean;
  canAddHashtags: boolean;
  canRetrieveMetrics: boolean;
  apiSurface: string;
  notes: string[];
}[] {
  return listCapabilities().map((c) => ({
    platform: c.platform,
    canPublishVideo: c.canPublishVideo,
    canSchedule: c.canScheduleNatively,
    canUploadThumbnail: c.canUploadThumbnail,
    canAddDescription: c.canAddDescription,
    canAddHashtags: c.canAddHashtags,
    canRetrieveMetrics: c.canRetrieveMetrics,
    apiSurface: c.apiSurface,
    notes: c.notes,
  }));
}

/** Caption limit used by QA and by copy generation. */
export function captionLimit(platform: MarketingPlatform): number {
  return CAPABILITIES[platform]?.maxCaptionChars ?? 3000;
}
