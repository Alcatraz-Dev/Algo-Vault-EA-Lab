import { AISignal, SignalConfig, MarketRegime } from "./types";
import { getSymbolSpec } from "./symbol-specs";
import { isSymbolMarketOpen } from "./sessions-filter";

export interface QualityFilterResult {
    passed: boolean;
    reasons: string[];
}

const DEFAULT_CONFIG: Partial<SignalConfig> = {
    minimumConfidence: 75,
    // Hard rejection floor for scans. config.minimumConfidence (75) only
    // decides READY vs FORMING status — signals between the floor and the
    // READY threshold are still created and shown as FORMING. Without this
    // floor nearly every scan was silently rejected and users never got a
    // signal at all.
    scanMinimumConfidence: 60,
    minimumRiskReward: 2.0,
    signalCooldownMinutes: 15,
    signalExpirationHours: 4,
    sessions: ["london", "new_york", "overlap", "asian"],
};

export function passesQualityFilter(
    signal: Partial<AISignal>,
    config: Partial<SignalConfig>,
    recentSignals: AISignal[],
    currentSpread?: number
): QualityFilterResult {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const reasons: string[] = [];

    if ((signal.confidence || 0) < (cfg.scanMinimumConfidence ?? 60)) {
        reasons.push(
            `Confidence ${signal.confidence}% below scan floor ${cfg.scanMinimumConfidence ?? 60}%`
        );
    }

    if ((signal.riskReward || 0) < (cfg.minimumRiskReward || 2.0)) {
        reasons.push(`Risk/Reward ${signal.riskReward?.toFixed(1)} below minimum ${cfg.minimumRiskReward}`);
    }

    if (signal.marketRegime === "HIGH_VOLATILITY") {
        if ((signal.confidence || 0) < 70) {
            reasons.push("High volatility requires confidence >= 70%");
        }
    }

    if (signal.symbol) {
        const spec = getSymbolSpec(signal.symbol);
        if (spec && currentSpread !== undefined) {
            const maxSpread = spec.typicalSpread * 3;
            if (currentSpread > maxSpread) {
                reasons.push(`Spread ${currentSpread.toFixed(4)} exceeds 3x typical ${maxSpread.toFixed(4)}`);
            }
        }
    }

    if (signal.symbol && signal.timeframe) {
        const cooldown = cfg.signalCooldownMinutes || 15;
        const cutoff = Date.now() - cooldown * 60 * 1000;
        const duplicates = recentSignals.filter(
            (s) =>
                s.symbol === signal.symbol &&
                s.direction === signal.direction &&
                s.timeframe === signal.timeframe &&
                s.createdAt > cutoff &&
                s.status !== "CANCELLED" &&
                s.status !== "EXPIRED"
        );
        if (duplicates.length > 0) {
            reasons.push(`Duplicate signal within ${cooldown}min cooldown`);
        }
    }

    if (signal.symbol) {
        const recent = recentSignals.filter(
            (s) =>
                s.symbol === signal.symbol &&
                s.status === "STOPPED" &&
                Date.now() - (s.completedAt || s.updatedAt) < 30 * 60 * 1000
        );
        if (recent.length > 0) {
            reasons.push("Recent stop loss on this symbol within 30 minutes");
        }
    }

    if (signal.symbol && signal.entry && signal.stopLoss) {
        const spec = getSymbolSpec(signal.symbol);
        if (spec) {
            const distance = Math.abs(signal.entry - signal.stopLoss);
            const minDistance = spec.pipSize * 10;
            if (distance < minDistance) {
                reasons.push(`SL distance too tight (${distance.toFixed(4)} < ${minDistance.toFixed(4)})`);
            }
        }
    }

    return {
        passed: reasons.length === 0,
        reasons,
    };
}

export function shouldExpireSignal(signal: AISignal, config: Partial<SignalConfig>): { expire: boolean; reason: string } {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    if (signal.expiresAt && Date.now() > signal.expiresAt) {
        return { expire: true, reason: "Signal expiration time reached" };
    }

    if (signal.confidence < 50) {
        return { expire: true, reason: "Confidence dropped below 50% — setup invalidated" };
    }

    if (
        signal.marketRegime === "UNCERTAIN" &&
        signal.status !== "TP1_HIT" &&
        signal.status !== "TP2_HIT" &&
        signal.status !== "TP3_HIT" &&
        signal.status !== "RUNNER"
    ) {
        // Grace period: a freshly generated signal must not be expired by the
        // monitor minutes after creation, or scans would appear to "not work".
        const ageMs = Date.now() - (signal.createdAt || 0);
        if (ageMs > 30 * 60 * 1000) {
            return { expire: true, reason: "Market became UNCERTAIN — setup invalidated" };
        }
    }

    return { expire: false, reason: "" };
}
