import {
    ConfidenceBreakdown,
    SignalConfig,
    AISignal,
    SignalStrength,
    STRENGTH_LABELS,
} from "./types";

const DEFAULT_WEIGHTS: SignalConfig["weights"] = {
    trendAlignment: 20,
    marketStructure: 20,
    liquidity: 20,
    momentum: 15,
    volume: 10,
    orderFlow: 0,
    entryConfirmation: 15,
};

export function calculateConfidence(params: {
    trendAlignment: { score: number; detail: string };
    marketStructure: { score: number; detail: string };
    liquidity: { score: number; detail: string };
    momentum: { score: number; detail: string };
    volume: { score: number; detail: string };
    orderFlow: { score: number; detail: string };
    entryConfirmation: { score: number; detail: string };
    weights?: SignalConfig["weights"];
}): ConfidenceBreakdown {
    const w = params.weights || DEFAULT_WEIGHTS;

    const totalWeight =
        w.trendAlignment +
        w.marketStructure +
        w.liquidity +
        w.momentum +
        w.volume +
        w.orderFlow +
        w.entryConfirmation;

    const normalize = (raw: number, max: number, weight: number) => {
        const normalized = Math.min(Math.max(raw / max, 0), 1);
        return Math.round(normalized * weight * 10) / 10;
    };

    const trendScore = normalize(params.trendAlignment.score, 20, w.trendAlignment);
    const structureScore = normalize(params.marketStructure.score, 20, w.marketStructure);
    const liquidityScore = normalize(params.liquidity.score, 15, w.liquidity);
    const momentumScore = normalize(params.momentum.score, 10, w.momentum);
    const volumeScore = normalize(params.volume.score, 10, w.volume);
    const orderFlowScore = normalize(params.orderFlow.score, 15, w.orderFlow);
    const entryScore = normalize(params.entryConfirmation.score, 10, w.entryConfirmation);

    const rawTotal =
        trendScore + structureScore + liquidityScore + momentumScore + volumeScore + orderFlowScore + entryScore;

    const total = Math.round((rawTotal / totalWeight) * 100);

    return {
        trendAlignment: { score: Math.round(trendScore), max: w.trendAlignment, detail: params.trendAlignment.detail },
        marketStructure: { score: Math.round(structureScore), max: w.marketStructure, detail: params.marketStructure.detail },
        liquidity: { score: Math.round(liquidityScore), max: w.liquidity, detail: params.liquidity.detail },
        momentum: { score: Math.round(momentumScore), max: w.momentum, detail: params.momentum.detail },
        volume: { score: Math.round(volumeScore), max: w.volume, detail: params.volume.detail },
        orderFlow: { score: Math.round(orderFlowScore), max: w.orderFlow, detail: params.orderFlow.detail },
        entryConfirmation: { score: Math.round(entryScore), max: w.entryConfirmation, detail: params.entryConfirmation.detail },
        total: Math.min(total, 100),
    };
}

export function getSignalStrength(confidence: number, minStrength?: SignalStrength): SignalStrength {
    let strength: SignalStrength;
    if (confidence >= 95) strength = "HIGH_CONVICTION";
    else if (confidence >= 85) strength = "VERY_STRONG";
    else if (confidence >= 75) strength = "STRONG";
    else if (confidence >= 65) strength = "GOOD";
    else if (confidence >= 50) strength = "MODERATE";
    else strength = "WEAK";

    if (minStrength) {
        const hierarchy: SignalStrength[] = ["WEAK", "MODERATE", "GOOD", "STRONG", "VERY_STRONG", "HIGH_CONVICTION"];
        const minIdx = hierarchy.indexOf(minStrength);
        const curIdx = hierarchy.indexOf(strength);
        if (curIdx < minIdx) return "WEAK";
    }

    return strength;
}

export function getStrengthLabel(strength: SignalStrength): string {
    switch (strength) {
        case "HIGH_CONVICTION": return "HIGH CONVICTION";
        case "VERY_STRONG": return "VERY STRONG";
        case "STRONG": return "STRONG";
        case "GOOD": return "GOOD";
        case "MODERATE": return "MODERATE";
        case "WEAK": return "WEAK";
    }
}

export function getStrengthColor(strength: SignalStrength): string {
    switch (strength) {
        case "HIGH_CONVICTION": return "#10b981";
        case "VERY_STRONG": return "#1d4ed8";
        case "STRONG": return "#2563eb";
        case "GOOD": return "#3b82f6";
        case "MODERATE": return "#f59e0b";
        case "WEAK": return "#ef4444";
    }
}

export function getConfidenceColor(confidence: number): string {
    if (confidence >= 85) return "#10b981";
    if (confidence >= 75) return "#3b82f6";
    if (confidence >= 65) return "#f59e0b";
    if (confidence >= 50) return "#f97316";
    return "#ef4444";
}
