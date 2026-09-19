import { AISignal, SignalConfig, SignalTier } from "./types";

/**
 * Tier enforcement for the AI signal system.
 *
 * FREE  → M5, M15
 * PRO   → M1 (plus everything in FREE)
 *
 * All enforcement happens server-side. The frontend never decides access —
 * the API strips PRO signals unless the authenticated user has an active
 * Pro/Enterprise entitlement.
 */

export function getTierForTimeframe(timeframe: string, config: SignalConfig): SignalTier {
    const tf = String(timeframe || "").toUpperCase();
    if ((config.proTimeframes || []).includes(tf)) return "PRO";
    return "FREE";
}

export function hasProAccess(isProUser: boolean): boolean {
    return isProUser;
}

/**
 * Returns the subset of signals the user is entitled to see.
 * PRO signals are stripped entirely for non-Pro users — entries, SL, TPs,
 * strength and reasoning are never exposed.
 */
export function enforceTierAccess(
    signals: AISignal[],
    userIsPro: boolean
): { signals: AISignal[]; blockedProCount: number } {
    if (userIsPro) {
        return { signals: [...signals], blockedProCount: 0 };
    }

    const allowed: AISignal[] = [];
    let blocked = 0;

    for (const signal of signals) {
        const tier = signal.tier || getTierForTimeframe(signal.timeframe, { proTimeframes: ["M1"] } as SignalConfig);
        if (tier === "PRO") {
            blocked++;
            continue;
        }
        allowed.push(signal);
    }

    return { signals: allowed, blockedProCount: blocked };
}

/**
 * Sanitizes a signal for public/free display — removes anything a free user
 * must not see. Used as defense-in-depth on top of enforceTierAccess.
 */
export function sanitizeFreeSignal(signal: AISignal): AISignal {
    return {
        ...signal,
        entry: 0,
        stopLoss: 0,
        tp1: undefined,
        tp2: undefined,
        tp3: undefined,
        tp4: undefined,
        reasoning: "",
        analysis: {},
    };
}

/**
 * Builds a stable dedup key so identical setups are not re-created while a
 * signal window is still active (symbol + timeframe + direction + setup).
 */
export function getSignalDedupeKey(signal: Pick<AISignal, "symbol" | "timeframe" | "direction" | "strategyVersion">): string {
    return [
        String(signal.symbol || "").toUpperCase(),
        String(signal.timeframe || "").toUpperCase(),
        String(signal.direction || "").toUpperCase(),
        String(signal.strategyVersion || ""),
    ].join(":");
}

/**
 * True when an equivalent setup is already live (READY/ACTIVE/TP stages) and
 * should suppress a new duplicate signal.
 */
export function isDuplicateSignal(
    candidate: Pick<AISignal, "symbol" | "timeframe" | "direction" | "strategyVersion">,
    existing: AISignal[]
): boolean {
    const key = getSignalDedupeKey(candidate);
    const activeStatuses = ["FORMING", "WATCH", "READY", "ACTIVE", "TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER"];

    return existing.some((s) => {
        if (!activeStatuses.includes(s.status)) return false;
        if (s.symbol !== candidate.symbol) return false;
        if (s.timeframe !== candidate.timeframe) return false;
        if (s.direction !== candidate.direction) return false;
        return getSignalDedupeKey(s) === key;
    });
}

export type { SignalTier };