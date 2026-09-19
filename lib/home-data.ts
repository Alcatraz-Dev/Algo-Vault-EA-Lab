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

export type HomeLiveAccount = {
    id: string;
    productName?: string;
    mt5Account?: string;
    broker?: string;
    server?: string;
    currency?: string;
    balance?: number;
    equity?: number;
    floatingProfit?: number;
    drawdown?: number;
    status?: string;
    lastHeartbeatAt?: number;
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
};

export type HomeReview = {
    id: string;
    userName?: string;
    productName?: string;
    rating?: number;
    comment?: string;
    createdAt?: number;
};

export type HomeData = {
    stats: {
        strategies: number;
        backtests: number;
        liveAccounts: number;
        liveOnline: number;
        averageRating: number;
        reviewCount: number;
    };
    featured: HomeProduct[];
    latestBacktests: HomeBacktest[];
    liveAccounts: HomeLiveAccount[];
    reviews: HomeReview[];
};

function toArray<T>(data: Record<string, unknown> | undefined): T[] {
    if (!data) return [];
    return Object.entries(data).map(([id, value]) => ({
        id,
        ...(value as object),
    })) as T[];
}

export async function getHomeData(): Promise<HomeData> {
    const now = Date.now();

    const [botsSnap, backtestsSnap, liveSnap, reviewsSnap, usersSnap] =
        await Promise.all([
            adminDatabase.ref("bots").get(),
            adminDatabase.ref("backtests").get(),
            adminDatabase.ref("live_accounts").get(),
            adminDatabase.ref("reviews").get(),
            adminDatabase.ref("users").get(),
        ]);

    const bots = toArray<HomeProduct>(botsSnap.val() as Record<string, unknown>);
    const backtests = toArray<HomeBacktest>(backtestsSnap.val() as Record<string, unknown>);
    const liveAccounts = toArray<HomeLiveAccount>(liveSnap.val() as Record<string, unknown>);
    const usersData = (usersSnap.val() || {}) as Record<
        string,
        { displayName?: string; email?: string }
    >;

    const reviewsRaw = toArray<{
        productId?: string;
        userId?: string;
        status?: string;
        rating?: number;
        comment?: string;
        createdAt?: number;
        id?: string;
    }>(reviewsSnap.val() as Record<string, unknown>);

    const publishedReviews = reviewsRaw
        .filter((r) => r.status === "published")
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

    const totalRating = publishedReviews.reduce(
        (sum, r) => sum + Number(r.rating || 0),
        0
    );
    const averageRating =
        publishedReviews.length > 0
            ? Number((totalRating / publishedReviews.length).toFixed(1))
            : 0;

    const reviews: HomeReview[] = publishedReviews.slice(0, 3).map((r) => {
        const product = bots.find((b) => b.id === r.productId);
        const user = r.userId ? usersData[r.userId] : undefined;
        return {
            id: r.id || "",
            userName: user?.displayName || "Trader",
            productName: product?.name || "AlgoVault Product",
            rating: Number(r.rating || 0),
            comment: r.comment || "",
            createdAt: r.createdAt,
        };
    });

    const featured = [...bots]
        .sort((a, b) => {
            const aScore = Number(a.rating?.average || 0) * (a.rating?.count ? Math.min(a.rating.count, 5) : 0);
            const bScore = Number(b.rating?.average || 0) * (b.rating?.count ? Math.min(b.rating.count, 5) : 0);
            if (bScore !== aScore) return bScore - aScore;
            return Number(b.createdAt || 0) - Number(a.createdAt || 0);
        })
        .slice(0, 6);

    const latestBacktests = [...backtests]
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
        .slice(0, 3);

    const liveSorted = [...liveAccounts].sort(
        (a, b) => Number(b.lastHeartbeatAt || 0) - Number(a.lastHeartbeatAt || 0)
    );
    const liveOnline = liveSorted.filter(
        (a) => a.lastHeartbeatAt && now - a.lastHeartbeatAt < 90_000
    ).length;

    return {
        stats: {
            strategies: bots.length,
            backtests: backtests.length,
            liveAccounts: liveAccounts.length,
            liveOnline,
            averageRating,
            reviewCount: publishedReviews.length,
        },
        featured,
        latestBacktests,
        liveAccounts: liveSorted.slice(0, 5),
        reviews,
    };
}