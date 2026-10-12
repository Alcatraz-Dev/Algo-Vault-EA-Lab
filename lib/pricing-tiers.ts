import { Crown, Star, Zap, type LucideIcon } from "lucide-react";

/**
 * The real subscription tiers.
 *
 * Extracted from `app/pricing/page.tsx` so the home page can show the same
 * plans without duplicating the numbers — a landing band that restates pricing
 * by hand is the fastest route to a figure that drifts from the paid page.
 * Change it here and both surfaces move together.
 *
 * `icon` is a component reference (not an emoji): DESIGN.md §18 bans emoji as
 * iconography, so the tier mark is a Lucide glyph exactly like the rest of the
 * product.
 */
export type PricingTier = {
    id: string;
    name: string;
    /** Monthly price in USD. 0 = free forever. */
    price: number;
    /** Unit the price is quoted in. */
    period: string;
    description: string;
    /** Short list shown on the home-page band; the pricing page lists more. */
    features: string[];
    /** Highlighted tier — the plan most teams land on. */
    highlighted?: boolean;
    cta: string;
    ctaHref: string;
    icon: LucideIcon;
};

/** The three headline features shown per tier on the landing pricing band. */
export const TIER_HIGHLIGHTS: Record<string, string[]> = {
    free: [
        "Lite versions of every public tool",
        "AI Scalping Terminal (Free)",
        "Live performance for 1 account",
    ],
    pro: [
        "Every Pro tool unlocked",
        "Strategy Lab, Backtest, Walk-Forward, Monte Carlo",
        "Copy Trading (5 verified masters)",
    ],
    enterprise: [
        "Unlimited live accounts",
        "API access and white-label options",
        "Dedicated account manager and SLA",
    ],
};

export const PRICING_TIERS: PricingTier[] = [
    {
        id: "free",
        name: "Free / Lite",
        price: 0,
        period: "forever",
        description:
            "The Lite versions of every public tool — useful on their own, free forever.",
        features: TIER_HIGHLIGHTS.free,
        cta: "Get Started",
        ctaHref: "/register",
        icon: Star,
    },
    {
        id: "pro",
        name: "Pro",
        price: 29,
        period: "month",
        description:
            "Unlock every Pro tool, the chart workspace, replay, persistence and AI explanations.",
        features: TIER_HIGHLIGHTS.pro,
        highlighted: true,
        cta: "Start Pro",
        ctaHref: "/account/subscribe?plan=pro",
        icon: Zap,
    },
    {
        id: "enterprise",
        name: "Enterprise",
        price: 99,
        period: "month",
        description:
            "For teams and institutions managing multiple accounts at scale.",
        features: TIER_HIGHLIGHTS.enterprise,
        cta: "Contact Sales",
        ctaHref: "/account/subscribe?plan=enterprise",
        icon: Crown,
    },
];

export function tierPriceLabel(tier: PricingTier): string {
    return tier.price === 0 ? "Free" : `$${tier.price}`;
}

export function tierPeriodLabel(tier: PricingTier): string {
    return tier.price === 0 ? "forever" : `/ ${tier.period}`;
}
