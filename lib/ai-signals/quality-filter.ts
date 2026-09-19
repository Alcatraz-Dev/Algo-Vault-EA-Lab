import { AISignal, SignalConfig, MarketRegime } from "./types";
import { getSymbolSpec } from "./symbol-specs";
import { getCurrentSession } from "@/lib/analytics/sessions";

export interface QualityFilterResult {
    passed: boolean;
    reasons: string[];
}

const DEFAULT_CONFIG: Partial<SignalConfig> = {
    minimumConfidence: 75,
    minimumRiskReward: 2.0,
    signalCooldownMinutes: 15,
    signalExpirationHours: 4,
    sessions: ["london", "new_york", "overlap"],
};

export function passesQualityFilter(
    signal: Partial<AISignal>,
    config: Partial<SignalConfig>,
    recentSignals: AISignal[],
    currentSpread?: number
): QualityFilterResult {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const reasons: string[] = [];

    if ((signal.confidence || 0) < (cfg.minimumConfidence || 75)) {
        reasons.push(`Confidence ${signal.confidence}% below minimum ${cfg.minimumConfidence}%`);
    }

    if ((signal.riskReward || 0) < (cfg.minimumRiskReward || 2.0)) {
        reasons.push(`Risk/Reward ${signal.riskReward?.toFixed(1)} below minimum ${cfg.minimumRiskReward}`);
    }

    if (signal.marketRegime === "UNCERTAIN") {
        reasons.push("Market regime is UNCERTAIN — avoid trading");
    }

    if (signal.marketRegime === "LOW_VOLATILITY") {
        reasons.push("Low volatility regime — limited opportunity");
    }

    if (signal.marketRegime === "HIGH_VOLATILITY") {
        if ((signal.confidence || 0) < 80) {
            reasons.push("High volatility requires confidence >= 80%");
        }
    }

    if (cfg.sessions && cfg.sessions.length > 0) {
        const now = new Date();
        const { current: currentSession } = getCurrentSession(now);
        if (!cfg.sessions.includes(currentSession as never)) {
            reasons.push(`Current session "${currentSession}" not in allowed sessions`);
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
        return { expire: true, reason: "Market became UNCERTAIN — setup invalidated" };
    }

    return { expire: false, reason: "" };
}
