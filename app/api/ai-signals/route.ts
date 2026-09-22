import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { scanSymbol, loadSignalConfig } from "@/lib/ai-signals/engine";
import { passesQualityFilter } from "@/lib/ai-signals/quality-filter";
import { trackDailySignals } from "@/lib/ai-signals/analytics";
import { getTierForTimeframe, isDuplicateSignal } from "@/lib/ai-signals/tiers";
import { isProUser } from "@/lib/ai-signals/access";
import { AISignal, SignalTier } from "@/lib/ai-signals/types";
import { recordSignalEvent, indexSignalByDate } from "@/lib/ai-signals/events";
import { notifySignalEvent } from "@/lib/ai-signals/notify";

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const symbolFilter = searchParams.get("symbol")?.toUpperCase();
        const categoryFilter = searchParams.get("category");
        const statusFilter = searchParams.get("status");
        const timeframeFilter = searchParams.get("timeframe");
        const queryLimit = Math.min(Number(searchParams.get("limit")) || 50, 200);

        const snap = await adminDatabase.ref("aiSignals").get();
        let signals: AISignal[] = [];
        snap.forEach((child) => {
            signals.push(child.val() as AISignal);
        });

        if (symbolFilter) signals = signals.filter((s) => s.symbol.toUpperCase().includes(symbolFilter));
        if (categoryFilter) signals = signals.filter((s) => s.category === categoryFilter);
        if (statusFilter) signals = signals.filter((s) => s.status === statusFilter);
        if (timeframeFilter) signals = signals.filter((s) => s.timeframe === timeframeFilter);

        signals.sort((a, b) => b.createdAt - a.createdAt);
        signals = signals.slice(0, queryLimit);

        // Server-side read-time enforcement: free users never receive PRO (M1)
        // signals. The client is never trusted with tier/subscription decisions.
        // Legacy signals without a tier are treated as FREE.
        const config = await loadSignalConfig();
        const isPro = await isProUser(user.uid);
        const responseSignals = signals.filter((s) => s.tier !== "PRO" || isPro);
        const daily = await trackDailySignals(user.uid);
        const limit = isPro ? config.proSignalsPerDay : config.freeSignalsPerDay;

        return NextResponse.json({
            success: true,
            signals: responseSignals,
            total: responseSignals.length,
            dailyCount: daily.total,
            dailyLimit: limit,
            remaining: Math.max(0, limit - daily.total),
        });
    } catch (err) {
        console.error("AI Signals GET error:", err);
        return NextResponse.json({ error: "Failed to load signals" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const config = await loadSignalConfig();
        if (!config.enabled) {
            return NextResponse.json({ error: "Signal generation is currently disabled" }, { status: 400 });
        }

        const body = await request.json().catch(() => ({}));
        const singleSymbol = body.symbol?.toUpperCase();

        const daily = await trackDailySignals(user.uid);
        const isPro = await isProUser(user.uid);
        const limit = isPro ? config.proSignalsPerDay : config.freeSignalsPerDay;
        const remaining = limit - daily.total;

        if (remaining <= 0) {
            return NextResponse.json(
                { error: `Daily limit reached (${limit}/${limit}). Upgrade to Pro for more signals.` },
                { status: 429 }
            );
        }

        // Server-side tier enforcement: PRO timeframes (M1) are only ever
        // generated for active Pro users. The client can never request a tier.
        const allowedTimeframes = isPro
            ? config.proTimeframes.concat(config.freeTimeframes)
            : (config.freeTimeframes ?? []);

        const recentSnap = await adminDatabase.ref("aiSignals").get();
        const recentSignals: AISignal[] = [];
        recentSnap.forEach((child) => {
            recentSignals.push(child.val() as AISignal);
        });

        const symbols = singleSymbol ? [singleSymbol] : config.symbols;
        const generatedSignals: AISignal[] = [];

        for (const symbol of symbols) {
            try {
                const partials = await scanSymbol(symbol, config, allowedTimeframes);
                for (const partial of partials) {
                    const filterResult = passesQualityFilter(partial, config, recentSignals);
                    if (!filterResult.passed) continue;

                    const timeframe = partial.timeframe || config.timeframes[0];
                    const tier: SignalTier = getTierForTimeframe(timeframe, config);

                    if (isDuplicateSignal(
                        { symbol, timeframe, direction: partial.direction || "BUY", strategyVersion: partial.strategyVersion || "" },
                        recentSignals
                    )) continue;

                    // Timeframe-boundary cooldown (M1/min, M5/5min, M15/15min).
                    if (!(await withinTimeframeWindow(symbol, timeframe))) continue;

                    const signal: AISignal = {
                        id: `sig_${symbol.toLowerCase()}_${Date.now()}`,
                        symbol,
                        direction: partial.direction || "BUY",
                        timeframe,
                        tier,
                        category: partial.category || "forex",
                        entry: partial.entry || 0,
                        stopLoss: partial.stopLoss || 0,
                        tp1: partial.tp1,
                        tp2: partial.tp2,
                        tp3: partial.tp3,
                        confidence: partial.confidence || 0,
                        strength: partial.strength || "MODERATE",
                        marketRegime: partial.marketRegime || "RANGING",
                        riskReward: partial.riskReward || 0,
                        riskRewardTp2: partial.riskRewardTp2,
                        riskRewardTp3: partial.riskRewardTp3,
                        status: partial.status || "READY",
                        analysis: partial.analysis || {},
                        confidenceBreakdown: partial.confidenceBreakdown || { trendAlignment: { score: 0, max: 0, detail: "" }, marketStructure: { score: 0, max: 0, detail: "" }, liquidity: { score: 0, max: 0, detail: "" }, momentum: { score: 0, max: 0, detail: "" }, volume: { score: 0, max: 0, detail: "" }, orderFlow: { score: 0, max: 0, detail: "" }, entryConfirmation: { score: 0, max: 0, detail: "" }, total: 0 },
                        reasoning: partial.reasoning || "",
                        currentPrice: partial.currentPrice || 0,
                        distanceToEntry: partial.distanceToEntry || 0,
                        distanceToSL: partial.distanceToSL || 0,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        expiresAt: Date.now() + config.signalExpirationHours * 3600 * 1000,
                        engineVersion: partial.engineVersion || config.engineVersion,
                        strategyVersion: partial.strategyVersion || config.strategyVersion,
                        analysisVersion: partial.analysisVersion || config.analysisVersion,
                        generatedBy: partial.generatedBy || "Hybrid AI Engine",
                        lastCheckedAt: Date.now(),
                        result: "PENDING",
                        resultR: 0,
                        profitPoints: 0,
                        tp1Hit: false,
                        tp2Hit: false,
                        tp3Hit: false,
                        createdFor: user.uid,
                        followCount: 0,
                        tradeCount: 0,
                        suggestedRiskPercent: config.riskDefaults.riskPercent,
                        pipValue: partial.pipValue || 0,
                        contractSize: partial.contractSize || 0,
                        typicalSpread: partial.typicalSpread || 0,
                        digits: partial.digits || 0,
                        timeline: [
                            { id: `evt_${Date.now()}_CREATED`, timestamp: Date.now(), type: "SIGNAL_CREATED", message: "Signal created", metadata: { symbol, timeframe, tier, user: user.uid } },
                        ],
                    };

await adminDatabase.ref(`aiSignals/${signal.id}`).set(signal);
                        await recordSignalEvent(signal, "CREATED", partial.currentPrice, {
                            symbol,
                            timeframe,
                            tier,
                            confidence: partial.confidence || 0,
                        });
                        await indexSignalByDate(signal);
                        await adminDatabase
                            .ref(`signalLastGenerated/${symbol}/${timeframe}`)
                            .set({ at: Date.now() });

                        // Maintenance-free reverse follower index (additive).
                        await adminDatabase
                            .ref(`signalFollowers/${signal.id}/${user.uid}`)
                            .set(true);

                        // Fire-and-forget lifecycle notification (deduped).
                        void notifySignalEvent(signal, "NEW_SIGNAL");

                        recentSignals.push(signal);
                        generatedSignals.push(signal);

                    if (generatedSignals.length >= remaining) break;
                }
            } catch (err) {
                console.error(`Error scanning ${symbol}:`, err);
            }
            if (generatedSignals.length >= remaining) break;
        }

        return NextResponse.json({
            success: true,
            signals: generatedSignals,
            generated: generatedSignals.length,
            dailyCount: daily.total + generatedSignals.length,
            dailyLimit: limit,
            remaining: Math.max(0, remaining - generatedSignals.length),
            tier: isPro ? "pro" : "free",
        });
    } catch (err) {
        console.error("AI Signals POST error:", err);
        return NextResponse.json({ error: "Failed to generate signals" }, { status: 500 });
    }
}

const TF_WINDOW_MS: Record<string, number> = {
    M1: 60 * 1000,
    M5: 5 * 60 * 1000,
    M15: 15 * 60 * 1000,
};

/**
 * Enforces per-timeframe generation windows so a symbol is only scanned for a
 * given timeframe at its natural cadence (M1 → 1min, M5 → 5min, M15 → 15min).
 */
async function withinTimeframeWindow(symbol: string, timeframe: string): Promise<boolean> {
    const windowMs = TF_WINDOW_MS[String(timeframe).toUpperCase()];
    if (!windowMs) return true;

    try {
        const snap = await adminDatabase.ref(`signalLastGenerated/${symbol}/${timeframe}`).get();
        if (snap.exists()) {
            const last = Number(snap.val()?.at) || 0;
            if (Date.now() - last < windowMs) return false;
        }
    } catch {
        // allow generation if the marker read fails
    }

    return true;
}
