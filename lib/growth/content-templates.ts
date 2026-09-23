/**
 * Growth Engine — deterministic content templates.
 *
 * Used as an honest fallback when the AI gateway is unavailable. Templates
 * never contain performance claims, guarantees or fake testimonials, and they
 * always carry the standard risk framing on trading-related content.
 */
import { RISK_DISCLOSURE_TEXT } from "./constants";

function disclosureFor(topic: string): string {
    const trading = /(trad|forex|cfd|leverag|signal|strategy|bot|market)/i.test(topic);
    return trading ? `\n\n*${RISK_DISCLOSURE_TEXT}*` : "";
}

export function mainDraft(
    topic: string,
    type: string,
    brief: string,
    opts?: { tone?: string; language?: string; affiliateDisclosure?: string }
): string {
    const tone = opts?.tone || "professional";
    const title = `How to approach ${topic} with a risk-first mindset`;
    const intro = `At AlgoVault we believe trading education should be honest, practical, and grounded in risk management. This guide covers the essentials of ${topic} for traders who want to make informed decisions.`;
    const body = brief.trim()
        ? `Context for this piece: ${brief.trim()}`
        : `We'll break down the core concepts, what to watch for, and how to avoid common pitfalls.`;
    const affiliate = opts?.affiliateDisclosure ? `\n\n${opts.affiliateDisclosure}` : "";
    const disclosure = disclosureFor(topic);

    switch (type) {
        case "X_POST": return `🧵 ${title} ${disclosure}\n\n${intro} ${body.slice(0, 120)}${affiliate}`.slice(0, 280);
        case "LINKEDIN_POST": return `${title}\n\n${intro}\n\n${body}\n\nWhat's your framework for ${topic}?${disclosure}${affiliate}`;
        case "INSTAGRAM_CAPTION": return `${title}\n\n${intro}\n\nSave this for later.${disclosure}${affiliate}\n\n#AlgoVault #TradingEducation #RiskFirst`;
        case "SHORT_VIDEO_SCRIPT": return `[HOOK] ${topic} — what most traders get wrong.\n[BODY] ${body}\n[CTA] Follow AlgoVault for honest trading education.${disclosure}`;
        case "YOUTUBE_SCRIPT": return `# ${title}\n\n## Intro\n${intro}\n## Main\n${body}\n## Outro\nSubscribe to AlgoVault for risk-first trading insight.${disclosure}`;
        case "SEO_ARTICLE": return `# ${title}\n\n${intro}\n\n${body}\n\n## Key takeaways\n- Educate before you execute.\n- Always define risk before reward.\n- Verify every claim you read.${disclosure}`;
        case "EMAIL_CAMPAIGN": return `Subject: ${title}\n\n${intro}\n\n${body}\n\n${affiliate}\n\n— The AlgoVault team${disclosure}`;
        case "DISCORD_ANNOUNCEMENT": return `**${title}**\n\n${intro}\n\n${body}${disclosure}${affiliate}`;
        case "EDUCATIONAL_CONTENT": return `# ${title}\n\n${intro}\n\n${body}\n\n## Next steps\nExplore AlgoVault's tools for structured, risk-aware analysis.${disclosure}`;
        case "FEATURE_ANNOUNCEMENT":
        case "PRODUCT_ANNOUNCEMENT": return `# Announcing: ${topic}\n\n${intro}\n\n${body}\n\nSee the product page on AlgoVault for details.${disclosure}`;
        case "MARKETPLACE_PROMOTION": return `# Marketplace spotlight: ${topic}\n\n${intro}\n\n${body}\n\nBrowse the AlgoVault marketplace to compare options side by side.${disclosure}`;
        case "AFFILIATE_CONTENT": return `# ${title}\n\n${intro}\n\n${body}\n\n${affiliate || "*We may earn a commission if you purchase through our partner links — at no extra cost to you.*"}${disclosure}`;
        default: return `${title}\n\n${intro}\n\n${body}${disclosure}${affiliate}`;
    }
}

export function emailVariant(main: string): string {
    const stripped = main.replace(/^Subject:[^\n]*\n/i, "");
    return `Subject: AlgoVault update\n\n${stripped}`.slice(0, 3000);
}

export function socialVariant(main: string, channel: string): string {
    const core = main.replace(/\n+/g, " ").slice(0, 180);
    switch (channel) {
        case "X": return `🧵 ${core}\n\nFollow @AlgoVault for risk-first trading education.`;
        case "LINKEDIN": return `${core}`;
        case "INSTAGRAM": return `${core}\n\n#TradingEducation #RiskFirst #AlgoVault`;
        case "FACEBOOK": return `${core}`;
        case "YOUTUBE": return `${core} — full video on the AlgoVault channel.`;
        case "TIKTOK": return `[CAPTION] ${core}`;
        case "DISCORD": return `📣 ${core}`;
        case "EMAIL": return emailVariant(main);
        default: return core;
    }
}

/** Convenience namespace used by the Content/Social agent executors. */
export const ct = { mainDraft, emailVariant, socialVariant } as const;