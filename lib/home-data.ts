import { adminDatabase } from "@/lib/firebase-admin";

export type HomeProduct = {
    id: string;
    name: string;
    slug?: string;
    symbol?: string;
    timeframe?: string;
    platform?: string;
    productType?: string;
    status?: string;
    description?: string;
    pricing?: { type?: string; price?: number; currency?: string };
    performance?: {
        profit?: number;
        winRate?: number;
        profitFactor?: number;
        totalTrades?: number;
        backtestPeriod?: string;
    };
    risk?: { level?: string; maxDrawdown?: number };
    rating?: { average?: number; count?: number };
    branding?: { icon?: { fileName?: string } };
    createdAt?: number;
};

export type HomeBacktest = {
    id: string;
    title?: string;
    productSlug?: string;
    pair?: string;
    timeframe?: string;
    period?: string;
    initialBalance?: number;
    netProfit?: number;
    winRate?: number;
    maxDrawdown?: number;
    reportUrl?: string;
    createdAt?: number;
    /** True when this record is part of the labeled sample-preview set. */
    preview?: boolean;
};

/** Aggregate, anonymous measures computed from all recorded backtests. */
export type HomeBacktestAnalytics = {
    total: number;
    /** Runs with complete numeric metrics (used for averages). */
    analyzableCount: number;
    avgWinRate: number;
    avgMaxDrawdown: number;
    avgReturnPct: number;
    totalNetProfit: number;
    positiveCount: number;
    recent: HomeBacktest[];
};

/**
 * Public home-page data. Deliberately holds only aggregate, anonymous
 * statistics and public marketplace/backtest records — no live account
 * numbers, no user identities, no personal details.
 */
export type HomeData = {
    stats: {
        strategies: number;
        backtests: number;
        averageRating: number;
        reviewCount: number;
    };
    featured: HomeProduct[];
    latestBacktests: HomeBacktest[];
    backtestAnalytics: HomeBacktestAnalytics;
    /**
     * True when no recorded backtests exist yet and the page is showing the
     * labeled sample-preview set so the home page never renders empty.
     */
    previewBacktests: boolean;
};

/**
 * Sample-preview backtests, shown only when the database has no recorded
 * runs yet so the home page is never empty. Always flagged `preview` and
 * surfaced as "sample preview" in the UI. No accounts, no user details.
 */
const PREVIEW_BACKTESTS: HomeBacktest[] = [
    {
        id: "preview_bt_1",
        title: "XAUUSD range scalper",
        pair: "XAUUSD",
        timeframe: "M15",
        period: "2023 – 2025",
        initialBalance: 10_000,
        netProfit: 1_840,
        winRate: 58.2,
        maxDrawdown: 6.4,
        preview: true,
        createdAt: Date.UTC(2025, 10, 12),
    },
    {
        id: "preview_bt_2",
        title: "EURUSD breakout flow",
        pair: "EURUSD",
        timeframe: "H1",
        period: "2023 – 2025",
        initialBalance: 10_000,
        netProfit: 1_120,
        winRate: 53.7,
        maxDrawdown: 4.9,
        preview: true,
        createdAt: Date.UTC(2025, 9, 28),
    },
    {
        id: "preview_bt_3",
        title: "BTCUSD momentum entry",
        pair: "BTCUSD",
        timeframe: "M15",
        period: "2023 – 2025",
        initialBalance: 10_000,
        netProfit: 2_730,
        winRate: 47.4,
        maxDrawdown: 12.1,
        preview: true,
        createdAt: Date.UTC(2025, 9, 9),
    },
    {
        id: "preview_bt_4",
        title: "US30 session breakout",
        pair: "US30",
        timeframe: "H1",
        period: "2023 – 2025",
        initialBalance: 10_000,
        netProfit: 940,
        winRate: 51.2,
        maxDrawdown: 7.8,
        preview: true,
        createdAt: Date.UTC(2025, 8, 21),
    },
    {
        id: "preview_bt_5",
        title: "NAS100 London close fade",
        pair: "NAS100",
        timeframe: "M30",
        period: "2023 – 2025",
        initialBalance: 10_000,
        netProfit: -260,
        winRate: 44.9,
        maxDrawdown: 5.3,
        preview: true,
        createdAt: Date.UTC(2025, 7, 30),
    },
    {
        id: "preview_bt_6",
        title: "USDJPY pullback mean-revert",
        pair: "USDJPY",
        timeframe: "H4",
        period: "2023 – 2025",
        initialBalance: 10_000,
        netProfit: 710,
        winRate: 56.8,
        maxDrawdown: 9.2,
        preview: true,
        createdAt: Date.UTC(2025, 7, 11),
    },
];

function toArray<T>(data: Record<string, unknown> | undefined): T[] {
    if (!data) return [];
    return Object.entries(data).map(([id, value]) => ({
        id,
        ...(value as object),
    })) as T[];
}

function optFin(value: unknown): number | undefined {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

/** Coerce an unknown value to a plain object when possible, else null. */
function nested(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : null;
}

function strField(obj: Record<string, unknown> | null, key: string): string | undefined {
    return obj && typeof obj[key] === "string" ? (obj[key] as string) : undefined;
}

function numField(obj: Record<string, unknown> | null, key: string): number | undefined {
    return obj ? optFin(obj[key]) : undefined;
}

/**
 * Public marketplace product — whitelists fields so internal seller/owner
 * identifiers on the raw bot record never reach the page payload.
 */
function sanitizeProduct(raw: Record<string, unknown>, id: string): HomeProduct {
    const pricing = nested(raw.pricing);
    const performance = nested(raw.performance);
    const risk = nested(raw.risk);
    const rating = nested(raw.rating);
    const branding = nested(raw.branding);
    const icon = branding ? nested(branding.icon) : null;

    return {
        id,
        name: strField(raw, "name") ?? "Unnamed strategy",
        slug: strField(raw, "slug"),
        symbol: strField(raw, "symbol"),
        timeframe: strField(raw, "timeframe"),
        platform: strField(raw, "platform"),
        productType: strField(raw, "productType"),
        status: strField(raw, "status"),
        description: strField(raw, "description"),
        pricing: pricing
            ? {
                  type: strField(pricing, "type"),
                  price: numField(pricing, "price"),
                  currency: strField(pricing, "currency"),
              }
            : undefined,
        performance: performance
            ? {
                  profit: numField(performance, "profit"),
                  winRate: numField(performance, "winRate"),
                  profitFactor: numField(performance, "profitFactor"),
                  totalTrades: numField(performance, "totalTrades"),
                  backtestPeriod: strField(performance, "backtestPeriod"),
              }
            : undefined,
        risk: risk
            ? {
                  level: strField(risk, "level"),
                  maxDrawdown: numField(risk, "maxDrawdown"),
              }
            : undefined,
        rating: rating
            ? {
                  average: numField(rating, "average"),
                  count: numField(rating, "count"),
              }
            : undefined,
        branding: branding
            ? {
                  icon: icon ? { fileName: strField(icon, "fileName") ?? undefined } : undefined,
              }
            : undefined,
        createdAt: optFin(raw.createdAt),
    };
}

/**
 * Public backtest record — whitelists fields so internal metadata such as
 * `uploadedBy` (a user UID) or `reportFile` never reaches the page payload.
 */
function sanitizeBacktest(raw: Record<string, unknown>, id: string): HomeBacktest {
    return {
        id,
        title: strField(raw, "title"),
        productSlug: strField(raw, "productSlug"),
        pair: strField(raw, "pair"),
        timeframe: strField(raw, "timeframe"),
        period: strField(raw, "period"),
        initialBalance: optFin(raw.initialBalance),
        netProfit: optFin(raw.netProfit),
        winRate: optFin(raw.winRate),
        maxDrawdown: optFin(raw.maxDrawdown),
        reportUrl: strField(raw, "reportUrl"),
        createdAt: optFin(raw.createdAt),
    };
}

function buildBacktestAnalytics(backtests: HomeBacktest[]): HomeBacktestAnalytics {
    const analyzable = backtests.filter(
        (b) =>
            Number.isFinite(b.netProfit) &&
            Number.isFinite(b.winRate) &&
            Number.isFinite(b.maxDrawdown)
    );
    const withBalance = analyzable.filter(
        (b) => Number.isFinite(b.initialBalance) && Number(b.initialBalance) > 0
    );

    const sum = (pick: (b: HomeBacktest) => number) =>
        analyzable.reduce((acc, b) => acc + Number(pick(b) || 0), 0);

    const avgWinRate = analyzable.length
        ? round1(sum((b) => Number(b.winRate) || 0) / analyzable.length)
        : 0;
    const avgMaxDrawdown = analyzable.length
        ? round1(sum((b) => Number(b.maxDrawdown) || 0) / analyzable.length)
        : 0;
    const avgReturnPct = withBalance.length
        ? round1(
              withBalance.reduce(
                  (acc, b) =>
                      acc + (Number(b.netProfit) / Number(b.initialBalance)) * 100,
                  0
              ) / withBalance.length
          )
        : 0;
    const totalNetProfit = round1(sum((b) => Number(b.netProfit) || 0));
    const positiveCount = analyzable.filter((b) => Number(b.netProfit) > 0).length;

    const recent = [...backtests]
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
        .slice(0, 8);

    return {
        total: backtests.length,
        analyzableCount: analyzable.length,
        avgWinRate,
        avgMaxDrawdown,
        avgReturnPct,
        totalNetProfit,
        positiveCount,
        recent,
    };
}

export async function getHomeData(): Promise<HomeData> {
    const [botsSnap, backtestsSnap, reviewsSnap] = await Promise.all([
        adminDatabase.ref("bots").get(),
        adminDatabase.ref("backtests").get(),
        adminDatabase.ref("reviews").get(),
    ]);

    const botsRaw = toArray<Record<string, unknown>>(botsSnap.val() as Record<string, unknown>);
    const backtestsRaw = toArray<Record<string, unknown>>(backtestsSnap.val() as Record<string, unknown>);

    const bots = botsRaw.map((raw) => sanitizeProduct(raw, String(raw.id || "")));
    const backtests = backtestsRaw.map((raw) => sanitizeBacktest(raw, String(raw.id || "")));

    const reviewsRaw = toArray<{
        status?: string;
        rating?: number;
    }>(reviewsSnap.val() as Record<string, unknown>);

    // Only aggregate numbers leave this module — never review text or identities.
    const publishedReviews = reviewsRaw.filter((r) => r.status === "published");
    const totalRating = publishedReviews.reduce((sum, r) => sum + Number(r.rating || 0), 0);
    const averageRating =
        publishedReviews.length > 0 ? round1(totalRating / publishedReviews.length) : 0;

    const featured = [...bots]
        .sort((a, b) => {
            const aScore = Number(a.rating?.average || 0) * (a.rating?.count ? Math.min(a.rating.count, 5) : 0);
            const bScore = Number(b.rating?.average || 0) * (b.rating?.count ? Math.min(b.rating.count, 5) : 0);
            if (bScore !== aScore) return bScore - aScore;
            return Number(b.createdAt || 0) - Number(a.createdAt || 0);
        })
        .slice(0, 6);

    // When no backtest is recorded yet, show the labeled sample-preview set so
    // the home page is never empty. Real records always take precedence.
    const usePreviewBacktests = backtests.length === 0;
    const displayBacktests = usePreviewBacktests ? PREVIEW_BACKTESTS : backtests;

    const latestBacktests = [...displayBacktests]
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
        .slice(0, 3);

    return {
        stats: {
            strategies: bots.length,
            backtests: displayBacktests.length,
            averageRating,
            reviewCount: publishedReviews.length,
        },
        featured,
        latestBacktests,
        backtestAnalytics: buildBacktestAnalytics(displayBacktests),
        previewBacktests: usePreviewBacktests,
    };
}