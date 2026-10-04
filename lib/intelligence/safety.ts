/**
 * Financial-safety language guard + evidence-tone prompts.
 *
 * The AI layer may speak in probabilities, evidence and invalidation — never
 * in guarantees. `assertSafeFinancialLanguage` runs on every AI-generated
 * user-facing summary before it leaves the server, so a misbehaving model can
 * never put "guaranteed profit" in front of a trader.
 */

const BANNED_PATTERNS: Array<{ re: RegExp; reason: string }> = [
    { re: /\bguaranteed?\s+(profit|return|win|wins|income|pips?|money)\b/i, reason: "guaranteed outcome" },
    { re: /\b(guarantee|guarantees|guaranteed)\b/i, reason: "guarantee claim" },
    { re: /\brisk[-\s]?free\b/i, reason: "risk-free claim" },
    { re: /\bcertain\s+win\b/i, reason: "certainty claim" },
    { re: /\b100%\s+(win|accuracy|profit|success)\b/i, reason: "certainty percentage" },
    { re: /\bcannot\s+lose\b/i, reason: "impossible-loss claim" },
    { re: /\bzero\s+risk\b/i, reason: "zero-risk claim" },
    { re: /\bno\s+risk\b/i, reason: "no-risk claim" },
];

export interface SafetyCheckResult {
    safe: boolean;
    reason?: string;
}

/**
 * Check AI text for prohibited financial claims. Returns the first violation.
 * Deliberately strict: a borderline phrasing is better rewritten than shipped.
 */
export function checkFinancialLanguage(text: string | undefined | null): SafetyCheckResult {
    if (!text) return { safe: true };
    for (const { re, reason } of BANNED_PATTERNS) {
        if (re.test(text)) return { safe: false, reason };
    }
    return { safe: true };
}

/**
 * Sanitize in place: replaces banned phrasings with compliant wording so a
 * mostly-good summary is salvageable instead of discarded entirely.
 * Returns the sanitized text (or the original when already safe).
 */
export function sanitizeFinancialLanguage(text: string | undefined | null): string {
    if (!text) return "";
    let out = text;
    for (const { re } of BANNED_PATTERNS) {
        out = out.replace(re, "high-probability scenario");
    }
    return out;
}

/**
 * Shared system-prompt clause enforcing evidence tone. Versioned so a prompt
 * change is visible in decision audits.
 */
export const FINANCIAL_TONE_CLAUSE = [
    "You are part of AlgoVault's trading intelligence system.",
    "Speak only in terms of confidence, evidence, probability, scenarios, invalidation and risk.",
    "Never state or imply guaranteed profit, risk-free trades, certain wins or guaranteed returns.",
    "Trading involves substantial risk of loss.",
    "Your output is informational analysis, not financial advice.",
].join(" ");
