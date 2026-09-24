/** Marketing Content Factory — media compliance wrapper.
 *  Reuses the growth engine's deterministic compliance rules
 *  (`lib/growth/compliance.ts`) and the shared risk disclosure text.
 *  Adds media‑specific checks: demo label presence, CTA honesty, hook honesty.
 */

import { checkCompliance, appendRiskDisclosure } from "../growth/compliance";
import { DEMO_LABEL_TEXT, RISK_DISCLOSURE_TEXT } from "./collections";

export type MediaComplianceResult = {
  passed: boolean;
  blocked: boolean;
  flags: { rule: string; label: string; severity: string }[];
  riskDisclosureRequired: boolean;
  riskDisclosurePresent: boolean;
  demoLabelPresent: boolean;
  demoLabelRequired: boolean;
  ctaHonest: boolean;
  checkedAt: number;
};

const DEMO_LABEL_PATTERNS = [
  /demo/i,
  /illustrative/i,
  /not real trading performance/i,
  /not real performance/i,
  /for reference only/i,
];

const CTA_BANNED = [
  /guaranteed\s+(profit|return|income)/i,
  /risk[- ]?free/i,
  /100%\s*(safe|return|profit)/i,
];

function hasDemoLabel(text: string): boolean {
  return DEMO_LABEL_PATTERNS.some((re) => re.test(text));
}

function ctaHonestCheck(cta: string): { ok: boolean; reason?: string } {
  for (const re of CTA_BANNED) {
    if (re.test(cta)) return { ok: false, reason: `CTA contains banned phrase: ${re.source}` };
  }
  return { ok: true };
}

/** Run media compliance over script + hook + CTA. */
export function runMediaCompliance(
  script: { hook: string; cta: string; disclosure: string; scenes: { voiceover: string }[] },
  options?: { demoLabelRequired?: boolean }
): MediaComplianceResult {
  const now = Date.now();
  const combined = [
    script.hook,
    script.cta,
    script.disclosure,
    script.scenes.map((s) => s.voiceover).join(" "),
  ].join("\n");

  const base = checkCompliance(combined, { isAffiliateContent: false });
  const demoLabelRequired = options?.demoLabelRequired ?? true;
  const demoLabelPresent = hasDemoLabel(combined);
  const ctaCheck = ctaHonestCheck(script.cta);

  const flags = base.flags.map((f) => ({ rule: f.rule, label: f.label, severity: f.severity }));
  if (demoLabelRequired && !demoLabelPresent) {
    flags.push({ rule: "missing_demo_label", label: "Demo/illustrative label missing", severity: "medium" });
  }
  if (!ctaCheck.ok && ctaCheck.reason) {
    flags.push({ rule: "banned_cta", label: "CTA contains banned phrase", severity: "high" });
  }

  const high = flags.filter((f) => f.severity === "high");
  const passed = high.length === 0;
  return {
    passed,
    blocked: high.length > 0,
    flags,
    riskDisclosureRequired: base.requiresRiskDisclosure,
    riskDisclosurePresent: base.riskDisclosurePresent,
    demoLabelPresent,
    demoLabelRequired,
    ctaHonest: ctaCheck.ok,
    checkedAt: now,
  };
}

/** Ensure a text block carries the demo label + risk disclosure. */
export function ensureDemoAndRisk(text: string): string {
  let out = text;
  if (!hasDemoLabel(out)) out = `${DEMO_LABEL_TEXT}\n${out}`;
  out = appendRiskDisclosure(out);
  return out;
}

export { RISK_DISCLOSURE_TEXT, DEMO_LABEL_TEXT };