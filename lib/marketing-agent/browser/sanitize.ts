/**
 * Marketing Agent — product demonstration safety (§52).
 *
 * Two layers of protection:
 *  1. `describeMasks` produces explicit mask directives the capture provider
 *     applies while recording (selector-based, so no private pixel is ever
 *     written to disk).
 *  2. `sanitizeText` scrubs anything that could leak through an OCR/vision
 *     pass or through the interaction log.
 *
 * Fail-closed: if a provider cannot apply masks, the capture is refused.
 *
 * Pure module: no I/O.
 */

import type { CaptureStep } from "../types";

export type MaskDirective = {
  selector: string;
  reason: string;
  /** Applied in post when the provider cannot mask during capture. */
  mode: "BLUR" | "BLACK_OUT";
};

const ALWAYS_MASK: MaskDirective[] = [
  { selector: "input[type=password]", reason: "Password field", mode: "BLACK_OUT" },
  { selector: "[data-sensitive]", reason: "Marked sensitive", mode: "BLACK_OUT" },
  { selector: "[data-account-balance]", reason: "Account balance", mode: "BLACK_OUT" },
  { selector: "[data-email]", reason: "User email", mode: "BLACK_OUT" },
  { selector: "[data-phone]", reason: "User phone", mode: "BLACK_OUT" },
  { selector: "[data-private]", reason: "Private customer data", mode: "BLACK_OUT" },
  { selector: "[data-api-key], .api-key", reason: "API key", mode: "BLACK_OUT" },
  { selector: "[data-broker-credential]", reason: "Broker credentials", mode: "BLACK_OUT" },
  { selector: "[data-position-private]", reason: "Private position", mode: "BLACK_OUT" },
  { selector: "[data-notification-private]", reason: "Private notification", mode: "BLACK_OUT" },
  { selector: "[data-message-private]", reason: "Private message", mode: "BLACK_OUT" },
  { selector: "[role=dialog][data-private]", reason: "Private dialog", mode: "BLACK_OUT" },
];

/** Combine the standing policy with plan-declared regions and step masks. */
export function describeMasks(input: {
  planRegions: { selector: string; reason: string }[];
  steps: CaptureStep[];
  stepOrder?: number;
}): MaskDirective[] {
  const out = new Map<string, MaskDirective>();
  for (const m of ALWAYS_MASK) out.set(m.selector, m);
  for (const r of input.planRegions) {
    if (!r?.selector || !r.reason) continue;
    out.set(r.selector, { selector: r.selector, reason: r.reason, mode: "BLACK_OUT" });
  }
  if (input.stepOrder !== undefined) {
    for (const step of input.steps) {
      if (step.order !== input.stepOrder) continue;
      for (const m of step.mask ?? []) {
        if (!m.selector || !m.reason) continue;
        out.set(m.selector, { selector: m.selector, reason: m.reason, mode: "BLACK_OUT" });
      }
    }
  }
  return Array.from(out.values());
}

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const LONG_DIGITS = /\b\d{6,}\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER = /\b(bearer|token|api[_-]?key|secret|password)\s*[:=]\s*\S+/gi;
const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g;

/**
 * Scrub personal/credential material from text that will be stored in an
 * interaction log, caption, annotation or plan echo.
 */
export function sanitizeText(input: string): string {
  if (!input) return "";
  return input
    .replace(JWT, "[REDACTED_TOKEN]")
    .replace(BEARER, (m) => `${m.split(/[:=]/)[0]}=[REDACTED]`)
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .replace(IBAN, "[REDACTED_ACCOUNT]")
    .replace(LONG_DIGITS, (m) => (m.length >= 6 && m.length <= 12 ? "[REDACTED_NUMBER]" : m));
}

/** Fields never allowed into a creative, an artifact or a log (§47). */
export const FORBIDDEN_CONTENT_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bpassword\s*[:=]/i, label: "password" },
  { pattern: /\bapi[_-]?key\s*[:=]/i, label: "api key" },
  { pattern: /\baccess[_-]?token\s*[:=]/i, label: "access token" },
  { pattern: /\bsecret\s*[:=]/i, label: "secret" },
  { pattern: /\bprivate[_-]?key\b/i, label: "private key" },
  { pattern: /\bSSN\b|\bsocial security\b/i, label: "national id" },
];

export function containsForbiddenContent(text: string): string | null {
  for (const { pattern, label } of FORBIDDEN_CONTENT_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

/**
 * Classification of what a capture step is allowed to record (§52).
 * `DEMO_ACCOUNT` is the only state in which the capture may run when the route
 * requires authentication.
 */
export type CaptureSessionKind = "PUBLIC_ROUTE" | "DEMO_ACCOUNT" | "PROHIBITED";

export function sessionKindFor(input: {
  routeRequiresAuth: boolean;
  demoSessionAvailable: boolean;
}): CaptureSessionKind {
  if (!input.routeRequiresAuth) return "PUBLIC_ROUTE";
  if (input.demoSessionAvailable) return "DEMO_ACCOUNT";
  return "PROHIBITED";
}

/** Whether a completed frame is safe to publish. */
export function frameIsPublishable(frame: { sanitized: boolean; forbiddenLabels?: string[] }): boolean {
  if (!frame.sanitized) return false;
  if (frame.forbiddenLabels && frame.forbiddenLabels.length > 0) return false;
  return true;
}
