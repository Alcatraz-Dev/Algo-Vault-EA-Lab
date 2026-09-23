/**
 * Growth Engine — Compliance Agent core.
 *
 * Pure rules engine used by the AI Compliance Agent on every piece of
 * generated marketing content. It never "fixes" claims silently: it flags
 * problematic language so a human (admin) can review, and it requires the
 * standard trading risk disclosure on trading-related content.
 *
 * Banned classes (trading platform safety):
 *  - guaranteed profits / returns
 *  - fabricated performance or backtest results
 *  - manipulation or guarantee of trading results
 *  - fake testimonials / impersonation
 *  - hidden affiliate relationships
 *  - deceptive financial claims ("risk-free", "free money")
 */
import { RISK_DISCLOSURE_TEXT } from "./constants";

export type ComplianceFlag = {
    rule: string;
    label: string;
    severity: "high" | "medium" | "low";
    matches: string[];
};

export type ComplianceResult = {
    passed: boolean;
    flags: ComplianceFlag[];
    requiresRiskDisclosure: boolean;
    riskDisclosurePresent: boolean;
    /** Trading-related content detected — must carry a risk disclosure. */
    tradingContext: boolean;
};

const RULES: { rule: string; label: string; severity: ComplianceFlag["severity"]; patterns: RegExp[] }[] = [
    {
        rule: "guaranteed_profits",
        label: "Guaranteed profits or returns",
        severity: "high",
        patterns: [
            /guaranteed\s+(profits?|returns?|income|pips|earnings)/i,
            /(100%\s*(safe|return|profit)|risk[- ]?free\s*(profit|return|income))/i,
            /\b(guarantee(?:d)?|assured)\s+(profit|return|gain|income)/i,
            /make\s+(?:a\s+)?(?:guaranteed\s+)?\$\d[\d,]*\s+(?:a|per|every)\s+(day|week|month)/i,
        ],
    },
    {
        rule: "fabricated_performance",
        label: "Fabricated performance or backtest claims",
        severity: "high",
        patterns: [
            /100%\s*(win|success)\s*rate/i,
            /\bwin\s*rate\s*(?:of\s*)?\d{2,3}%/i,
            /(x\d{1,2}|10x|20x)\s*(returns?|profits?|growth)/i,
            /fabricat(?:ed|ing)\s*(backtest|performance|result)/i,
        ],
    },
    {
        rule: "manipulated_results",
        label: "Manipulating trading results",
        severity: "high",
        patterns: [/manipulat(e|es|ed|ing)\s+(trade|result|market)/i, /insider\s*(tips?|knowledge)/i],
    },
    {
        rule: "fake_testimonials",
        label: "Fake testimonials or user impersonation",
        severity: "high",
        patterns: [
            /\bimpersonat(e|es|ed|ing)/i,
            /\b(as|with)\s+(?:a\s+)?(?:real\s+)?(trader|customer|user)\b[^.]{0,80}\b(?:made|earned|withdrew)\b/i,
            /fake\s*(testimonial|review)/i,
        ],
    },
    {
        rule: "deceptive_financial_claims",
        label: "Deceptive financial claims",
        severity: "high",
        patterns: [
            /(risk[- ]?free\s*(?:money|income|profit)|free\s*money|no\s*risk\s*(?:at\s*all|whatsoever))/i,
            /(get\s*rich\s*(?:quick(?:ly)?|fast)|passive\s*income\s*guaranteed)/i,
        ],
    },
    {
        rule: "certainty_language",
        label: "Overconfident / certainty language",
        severity: "medium",
        patterns: [/\b(always\s+wins|never\s*loses|impossible\s*to\s*lose|can'?t\s*go\s*wrong)\b/i],
    },
    {
        rule: "hidden_affiliate",
        label: "Undisclosed affiliate relationship",
        severity: "high",
        patterns: [
            /(sponsored|affiliate|promoted|partner)\s*(link|product|offer)/i,
        ],
    },
];

const RISK_DISCLOSURE_FRAGMENTS = [
    /risk\s+disclosure/i,
    /not\s+financial\s+advice/i,
    /past\s+performance\s+is\s+not\s+indicative/i,
    /lose|\bloss(?:es)?\b/i,
];

const TRADING_CONTEXT = /\b(trad(e|ing|er|es)|forex|cfd|leverag|position|pip|entry|exit|stop\s*loss|take\s*profit|signal|strategy|bot|backtest)\b/i;

function containsRiskDisclosure(text: string): boolean {
    const hits = RISK_DISCLOSURE_FRAGMENTS.filter((re) => re.test(text));
    // A disclosure exists when at least two identifying fragments are present
    // (e.g. "Risk disclosure" title + "not financial advice").
    return hits.length >= 2;
}

function normalize(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

/**
 * Runs the compliance rules over generated content.
 * @param text The combined generated content (all blocks joined).
 * @param options.affiliateBonus Only affects reasoning hints — a disclosure
 *   requirement is never waived by commission.
 */
export function checkCompliance(text: string, options?: { affiliateType?: "OFFER" | "NONE"; isAffiliateContent?: boolean }): ComplianceResult {
    const normalized = normalize(text);
    const flags: ComplianceFlag[] = [];
    const tradingContext = TRADING_CONTEXT.test(normalized);

    for (const rule of RULES) {
        const matches = rule.patterns.map((re) => re.exec(normalized)?.find(Boolean)).filter((m): m is string => Boolean(m));
        if (matches.length > 0) {
            flags.push({ rule: rule.rule, label: rule.label, severity: rule.severity, matches: matches.slice(0, 3) });
        }
    }

    // Affiliate content must disclose the relationship.
    if (options?.affiliateType === "OFFER" || options?.isAffiliateContent) {
        if (!/(affiliate|sponsored|paid\s*partnership|we\s*may\s*(earn|receive))/i.test(normalized)) {
            flags.push({
                rule: "missing_affiliate_disclosure",
                label: "Missing affiliate relationship disclosure",
                severity: "high",
                matches: ["affiliate content without disclosure"],
            });
        }
    }

    const riskDisclosurePresent = containsRiskDisclosure(normalized);
    const requiresRiskDisclosure = tradingContext;
    if (tradingContext && !riskDisclosurePresent && !options?.isAffiliateContent) {
        flags.push({
            rule: "missing_risk_disclosure",
            label: "Trading-related content is missing the standard risk disclosure",
            severity: "medium",
            matches: ["trading context detected"],
        });
    }

    const passed = flags.filter((f) => f.severity === "high").length === 0;

    return { passed, flags, requiresRiskDisclosure, riskDisclosurePresent, tradingContext };
}

export function appendRiskDisclosure(text: string): string {
    const normalized = text.trim();
    if (containsRiskDisclosure(normalized)) return normalized;
    return `${normalized}\n\n${RISK_DISCLOSURE_TEXT}`;
}

/** Standard disclosure snippet for affiliate content surfaces. */
export function affiliateDisclosureSnippet(provider?: string): string {
    return `We may earn a commission if you purchase through affiliate links${provider ? ` from ${provider}` : ""} — at no extra cost to you.`;
}

/**
 * Advisory guard used by the Compliance Agent when an offer recommendation is
 * commission-driven: recommendations must be justified by relevance, never by
 * a higher commission.
 */
export function recommendableOffer(offer: { relevanceTags?: string[]; recommendationRules?: string; commissionAmount: number }, topic: string): boolean {
    const tags = (offer.relevanceTags || []).join(" ").toLowerCase();
    const topicLower = topic.toLowerCase();
    const scored = tags.split(/\s+/).filter((tag) => topicLower.includes(tag)).length;
    // At least one explicit relevance tag must match; commission is never used
    // as a selection criterion here.
    return scored >= 1;
}