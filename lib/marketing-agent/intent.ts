/**
 * Marketing Agent — IntentParser (§2, §72).
 *
 * The prompt is the primary input. This parser is deterministic-first: it
 * resolves everything it can from the instruction without spending AI budget,
 * and only asks the AI router for help when the request genuinely cannot be
 * resolved (`needsAiClarification`).
 *
 * It is a logical responsibility inside the existing AI orchestration layer —
 * not a separate model (§3).
 *
 * Pure module: no I/O.
 */

import {
  MARKETING_LANGUAGES,
  MARKETING_PLATFORMS,
  type MarketingLanguage,
  type MarketingPlatform,
} from "./collections";
import type { MarketingCommand, ParsedIntent } from "./types";
import { resolveProducts } from "./product-knowledge";

// ─── Platform aliases ────────────────────────────────────────────────────────

const PLATFORM_ALIASES: { platform: MarketingPlatform; patterns: RegExp }[] = [
  { platform: "TIKTOK", patterns: /\b(tiktok|tok)\b/i },
  { platform: "INSTAGRAM_REELS", patterns: /\b(instagram\s*reels?|reels?)\b/i },
  { platform: "INSTAGRAM_STORIES", patterns: /\binstagram\s*stories\b|\bstories\b/i },
  { platform: "INSTAGRAM_FEED", patterns: /\binstagram\b|\binsta\b|\big\b/i },
  { platform: "YOUTUBE_SHORTS", patterns: /\byoutube\s*shorts?\b|\bshorts\b/i },
  { platform: "YOUTUBE", patterns: /\byoutube\b|\byt\b/i },
  { platform: "FACEBOOK", patterns: /\bfacebook\b|\bfb\b/i },
  { platform: "LINKEDIN", patterns: /\blinkedin\b/i },
  { platform: "X", patterns: /\bx\b(?=\s*(post|thread|tweet)|\s*and|\s*,|\s*$)|\btwitter\b|\btweets?\b/i },
];

const ALL_PLATFORMS_WILDCARD = /\b(all (major )?social( media)?( platforms)?|every platform|all platforms)\b/i;

const LANGUAGE_ALIASES: { language: MarketingLanguage; patterns: RegExp }[] = [
  { language: "en", patterns: /\benglish\b|\b(en)\b/i },
  { language: "fr", patterns: /\bfrench\b|\bfran[cç]ais\b|\b(fr)\b/i },
  { language: "ar", patterns: /\barabic\b|\b(arabic version|in arabic)\b|\bar\b/i },
];

const TONES: { tone: string; patterns: RegExp }[] = [
  { tone: "energetic", patterns: /\b(energetic|high[-\s]?energy|dynamic|hype)\b/i },
  { tone: "professional", patterns: /\b(professional|corporate|polished|formal)\b/i },
  { tone: "premium", patterns: /\b(premium|luxury|elevated|refined)\b/i },
  { tone: "educational", patterns: /\b(educational|tutorial|explainer|how[-\s]?to|teach)\b/i },
  { tone: "playful", patterns: /\b(playful|fun|casual|friendly|quirky)\b/i },
  { tone: "urgent", patterns: /\b(urgent|limited time|act now|fast[-\s]?paced)\b/i },
];

// Order matters: the FIRST matching pattern wins, so specific commands
// (remix, translate, analyze, variant …) must be tested before the generic
// CREATE, and CREATE must be tested before secondary actions such as
// SCHEDULE/PUBLISH — "Create … and schedule them for next week" is a CREATE
// with a scheduling request attached, not a scheduling command.
const COMMAND_PATTERNS: { command: MarketingCommand; pattern: RegExp }[] = [
  { command: "CLONE_STRUCTURE", pattern: /\b(same structure|use the same (video|structure|layout)|clone (this|the) (video|structure))\b/i },
  { command: "REMIX", pattern: /\b(remix|another version|make another|new versions?|different version|alternate version)\b/i },
  { command: "REWRITE", pattern: /\b(rewrite|make the hook stronger|stronger hook|reword)\b/i },
  { command: "TRANSLATE", pattern: /\b(translate|translation|french version|arabic version|localize|localise|in french|in arabic)\b/i },
  { command: "SHORTEN", pattern: /\b(shorten|make it shorter|cut it down|more concise)\b/i },
  { command: "EXTEND", pattern: /\b(extend|make it longer|longer version|expand the video)\b/i },
  { command: "ANALYZE", pattern: /\b(analy[sz]e|performance of|what worked|review the (creatives|campaign))\b/i },
  { command: "REFRESH", pattern: /\b(refresh|creative fatigue|fresh (opening|hook)|tired of (this|the) creative)\b/i },
  { command: "VARIANT", pattern: /\b(variant|variants|\d+\s+(hook |cta |opening |alternative)s?|create 5|create ten)\b/i },
  { command: "REPURPOSE", pattern: /\b(repurpose|turn this into|adapt it for|for instagram and tiktok)\b/i },
  { command: "PAUSE", pattern: /\b(pause|stop the campaign|hold the schedule)\b/i },
  { command: "RESUME", pattern: /\b(resume|continue the campaign|restart the schedule)\b/i },
  { command: "CREATE_CAMPAIGN", pattern: /\b(create (a|an|the) campaign|new campaign|campaign for)\b/i },
  { command: "CREATE", pattern: /\b(create|make|generate|build|produce|design|shoot|film)\b/i },
  { command: "SCHEDULE", pattern: /\b(schedul(e|ing)|post (this|them) (at|for|every)|next week|this week|every (monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i },
  { command: "PUBLISH", pattern: /\b(publish|post it|go live|ship it|push it out)\b/i },
];

const DEMO_PATTERNS = /\b(show|demonstrate|demo|walkthrough|real (page|ui|product|interface)|actual (page|ui|product)|open the .* page|screen ?record|capture the|inside algovault)\b/i;

const SCHEDULE_HINT_PATTERNS = [
  /\bnext week\b/i,
  /\bthis week\b/i,
  /\bthis weekend\b/i,
  /\bevery (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bat \d{1,2}:\d{2}\b/i,
  /\bat \d{1,2}\s?(am|pm)\b/i,
  /\bfor \d+ (days|weeks|months)\b/i,
];

const CONSTRAINT_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bwithout (voice|voiceover|narration)\b|\bno voice(over)?\b|\bcaptions[-\s]only\b/i, label: "NO_VOICEOVER" },
  { re: /\bwith (a )?voice(over| narration)?\b|\bnarrat(e|ion)\b/i, label: "VOICEOVER" },
  { re: /\bmore (of the|the) ([a-z ]+ page)\b/i, label: "SHOW_MORE_PRODUCT" },
  { re: /\b(remove|drop|without) (the )?(voiceover|captions|music|logo)\b/i, label: "REMOVE_ELEMENT" },
  { re: /\b\d{1,2}[-\s]?second\b/i, label: "FIXED_DURATION" },
];

const REFERENCE_PATTERNS = [
  /\b(the|this|last|yesterday'?s?|previous|earlier)\s+(video|creative|campaign|ad|reel|short)\b/i,
  /\blast (week|month|night|time)\b/i,
  /\bwe (made|created|produced|ran)\b/i,
  /\bsame style as\b/i,
];

function detectPlatforms(text: string): MarketingPlatform[] {
  if (ALL_PLATFORMS_WILDCARD.test(text)) return [...MARKETING_PLATFORMS];
  const found: MarketingPlatform[] = [];
  for (const { platform, patterns } of PLATFORM_ALIASES) {
    if (patterns.test(text)) found.push(platform);
  }
  // "Instagram" alone means the feed/reels pair rather than nothing.
  if (found.includes("INSTAGRAM_FEED") && !found.includes("INSTAGRAM_REELS") && /\breels?\b/i.test(text)) {
    found.push("INSTAGRAM_REELS");
  }
  return Array.from(new Set(found));
}

function detectLanguages(text: string): MarketingLanguage[] {
  const found: MarketingLanguage[] = [];
  for (const { language, patterns } of LANGUAGE_ALIASES) {
    if (patterns.test(text)) found.push(language);
  }
  // "English and French versions" pattern already caught; default handled by planner.
  return Array.from(new Set(found));
}

function detectDurationSec(text: string): number | null {
  const m =
    /(\d{1,3})[\s-]?(second|sec|s)\b/i.exec(text) ||
    /(\d{1,3})\s?(s)\b/i.exec(text) ||
    /(\d{1,2})[\s-]?(minute|min)\b/i.exec(text);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return /min/i.test(m[2]) ? Math.min(value * 60, 600) : Math.min(value, 600);
}

function detectVariantCount(text: string): number {
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  const numeric = /\b(\d{1,2})\s+(hook|cta|opening|version|variant|alternative|different)\w*/i.exec(text);
  if (numeric) return Math.max(1, Math.min(10, Number(numeric[1])));
  const worded = /\b(create\s+)?(one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:[a-z-]+\s+)?(hook|cta|opening|version|variant|alternative)\w*/i.exec(text);
  if (worded) return Math.max(1, Math.min(10, words[worded[2].toLowerCase()] ?? 1));
  if (/\b(multiple|several|a few)\s+(hook|cta|version|variant)\w*/i.test(text)) return 3;
  if (/\bvariants?\b/i.test(text)) return 3;
  return 1;
}

function detectCommand(text: string): MarketingCommand {
  for (const { command, pattern } of COMMAND_PATTERNS) {
    if (pattern.test(text)) return command;
  }
  return "CREATE";
}

function detectRemix(text: string, command: MarketingCommand): ParsedIntent["remix"] {
  const isRemix =
    command === "REMIX" ||
    command === "REWRITE" ||
    command === "CLONE_STRUCTURE" ||
    command === "VARIANT" ||
    command === "SHORTEN" ||
    command === "EXTEND" ||
    /\b(hook|cta)\b/i.test(text) && /\b(chang|keep|swap|replace|different)\w*/i.test(text);
  if (!isRemix) return null;

  const language = detectLanguages(text)[0];
  const platforms = detectPlatforms(text);
  const count = detectVariantCount(text);
  const tone = TONES.find((t) => t.patterns.test(text))?.tone;

  return {
    keepCapture: !/\b(new capture|re[-\s]?capture|refresh (the )?capture)\b/i.test(text),
    changeHook: /\b(hook|opening)\b/i.test(text) || command === "REWRITE",
    changeCta: /\b(cta|call to action)\b/i.test(text),
    tone,
    language,
    platforms: platforms.length ? platforms : undefined,
    count: count > 1 ? count : undefined,
  };
}

/**
 * Deterministic intent parse. Never throws; never mutates the prompt.
 */
export function parseIntent(prompt: string, overrides?: Partial<ParsedIntent>): ParsedIntent {
  const text = (prompt || "").trim();
  const lower = text.toLowerCase();

  const platforms = detectPlatforms(text);
  const languages = detectLanguages(text);
  const durationSec = detectDurationSec(text);
  const command = detectCommand(text);
  const products = resolveProducts(text);
  const tone = TONES.find((t) => t.patterns.test(text))?.tone ?? null;
  const wantsSchedule = /\b(schedul(e|ing)|next week|this week|every (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|at \d{1,2}:\d{2})\b/i.test(text);
  const wantsPublish = /\b(publish|post (it|them)|go live|ship)\b/i.test(text);

  const constraints = CONSTRAINT_PATTERNS.filter((c) => c.re.test(text)).map((c) => c.label);
  const scheduleHint = SCHEDULE_HINT_PATTERNS.map((re) => re.exec(text)?.[0]).find(Boolean) ?? null;
  const referencePrompt = REFERENCE_PATTERNS.map((re) => re.exec(text)?.[0]).find(Boolean) ?? null;

  // Claims the user explicitly asked to make — these must pass §51.
  const claimsRequested = (
    [
      /\b(claim|claims|say|says|saying|tell (them|viewers) that)\b[^.]{0,140}/gi,
      /\b(guarantee\w*|risk[- ]free|100%|best|fastest|only)\b[^.]{0,80}/gi,
    ].flatMap((re) => text.match(re) ?? [])
  ).map((s) => s.trim()).filter(Boolean).slice(0, 10);

  // A request is considered resolvable when it names a product or a clear verb.
  const resolvable = products.length > 0 && (command !== "CREATE" || text.length >= 8);

  const intent: ParsedIntent = {
    prompt: text,
    command,
    products,
    platforms,
    languages,
    durationSec,
    aspectRatio: null,
    tone,
    style: null,
    objective: inferObjective(lower),
    audience: inferAudience(lower, products),
    wantsBrowserDemo: DEMO_PATTERNS.test(text),
    wantsVoiceover: constraints.includes("NO_VOICEOVER")
      ? false
      : constraints.includes("VOICEOVER")
        ? true
        : null,
    variantCount: detectVariantCount(text),
    wantsSchedule,
    wantsPublish,
    scheduleHint,
    referencePrompt,
    remix: detectRemix(text, command),
    constraints,
    claimsRequested,
    needsAiClarification: !resolvable,
    confidence: resolvable ? (platforms.length && durationSec ? 0.9 : 0.7) : 0.3,
    ...overrides,
  };

  return intent;
}

function inferObjective(lower: string): string {
  if (/\b(sign ?up|register|start trial|get started|convert)\b/.test(lower)) return "REGISTRATION";
  if (/\b(explain|how (it|to)|walkthrough|teach|tutorial|educat)\b/.test(lower)) return "EDUCATION";
  if (/\b(promote|launch|announce|new feature)\b/.test(lower)) return "AWARENESS";
  if (/\b(subscribe|upgrade|pro)\b/.test(lower)) return "SUBSCRIPTION";
  if (/\b(sell|marketplace|store|buy)\b/.test(lower)) return "MARKETPLACE_SALES";
  return "AWARENESS";
}

function inferAudience(lower: string, products: string[]): string {
  if (/\bnew (traders|users|to trading)\b/.test(lower)) return "New traders";
  if (/\bpro (users|traders)\b/.test(lower)) return "Pro traders";
  if (/\bdevelopers?\b/.test(lower)) return "Developers";
  if (/\b(businesses|institutions|funds)\b/.test(lower)) return "Institutional users";
  if (products.includes("scalping-terminal")) return "Short-term traders";
  if (products.includes("strategy-lab")) return "Systematic traders";
  return "Traders evaluating AlgoVault";
}

/**
 * Optional AI pass used only when `needsAiClarification` is true. Runs through
 * the existing AI router with a strict JSON contract and falls back to the
 * deterministic intent when the model is unavailable — the deterministic
 * result is always a valid answer (§4 Task 1).
 */
export async function parseIntentWithAi(
  prompt: string,
  runStructured: <T>(input: {
    prompt: string;
    schema: string;
    system: string;
  }) => Promise<T | null>
): Promise<ParsedIntent> {
  const base = parseIntent(prompt);
  if (!base.needsAiClarification) return base;

  try {
    const ai = await runStructured<ParsedIntent>({
      prompt,
      schema:
        '{ "command": string, "products": string[], "platforms": string[], "languages": string[], ' +
        '"durationSec": number|null, "tone": string|null, "objective": string|null, "audience": string|null, ' +
        '"wantsBrowserDemo": boolean, "wantsVoiceover": boolean|null, "variantCount": number, ' +
        '"wantsSchedule": boolean, "wantsPublish": boolean, "constraints": string[] }',
      system:
        "You are the AlgoVault Marketing Agent intent parser. Return ONLY a JSON object. " +
        "platforms must be a subset of TIKTOK, INSTAGRAM_REELS, INSTAGRAM_STORIES, INSTAGRAM_FEED, YOUTUBE_SHORTS, YOUTUBE, FACEBOOK, LINKEDIN, X. " +
        "languages must be a subset of en, fr, ar. Never invent product features. When unsure, keep the deterministic values.",
    });
    if (!ai) return base;

    const merged: ParsedIntent = {
      ...base,
      command: (ai.command as MarketingCommand) ?? base.command,
      products: Array.isArray(ai.products) && ai.products.length ? ai.products : base.products,
      platforms: Array.isArray(ai.platforms) ? (ai.platforms.filter((p) => (MARKETING_PLATFORMS as readonly string[]).includes(p)) as MarketingPlatform[]) : base.platforms,
      languages: Array.isArray(ai.languages) ? (ai.languages.filter((l) => (MARKETING_LANGUAGES as readonly string[]).includes(l)) as MarketingLanguage[]) : base.languages,
      durationSec: typeof ai.durationSec === "number" ? ai.durationSec : base.durationSec,
      tone: ai.tone ?? base.tone,
      objective: ai.objective ?? base.objective,
      audience: ai.audience ?? base.audience,
      wantsBrowserDemo: typeof ai.wantsBrowserDemo === "boolean" ? ai.wantsBrowserDemo : base.wantsBrowserDemo,
      wantsVoiceover: typeof ai.wantsVoiceover === "boolean" ? ai.wantsVoiceover : base.wantsVoiceover,
      variantCount: typeof ai.variantCount === "number" ? Math.max(1, Math.min(10, ai.variantCount)) : base.variantCount,
      wantsSchedule: typeof ai.wantsSchedule === "boolean" ? ai.wantsSchedule : base.wantsSchedule,
      wantsPublish: typeof ai.wantsPublish === "boolean" ? ai.wantsPublish : base.wantsPublish,
      constraints: Array.isArray(ai.constraints) ? Array.from(new Set([...base.constraints, ...ai.constraints.map(String)])) : base.constraints,
      needsAiClarification: false,
      confidence: Math.max(base.confidence, 0.75),
    };
    return merged;
  } catch {
    return base;
  }
}
