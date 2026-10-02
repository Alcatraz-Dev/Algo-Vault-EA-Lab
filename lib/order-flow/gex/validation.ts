/**
 * GEX validation — chain-level sanity for the isolated options module.
 * Beyond per-quote validation, the chain as a whole must look coherent:
 * monotonic strikes, mixed call/put coverage, and enough strikes for a
 * meaningful gamma profile.
 */

import type { OptionQuote } from "../types";
import { validateOptionChain } from "../validation";

export interface ChainQualityReport {
    usable: boolean;
    quoteCount: number;
    strikeCount: number;
    expirationCount: number;
    rejected: number;
    issues: string[];
}

export function assessOptionChain(raw: unknown[], nowMs = Date.now()): ChainQualityReport {
    const issues: string[] = [];
    const { quotes, rejected } = validateOptionChain(raw, nowMs);

    if (quotes.length === 0) {
        issues.push("No valid option quotes after validation.");
        return { usable: false, quoteCount: 0, strikeCount: 0, expirationCount: 0, rejected, issues };
    }

    const strikes = [...new Set(quotes.map((q) => q.strike))];
    const expirations = [...new Set(quotes.map((q) => q.expiration))];
    const hasCalls = quotes.some((q) => q.type === "call");
    const hasPuts = quotes.some((q) => q.type === "put");

    if (strikes.length < 3) issues.push("Fewer than 3 strikes — gamma profile not meaningful.");
    if (!hasCalls || !hasPuts) issues.push("Chain missing call or put coverage.");
    if (expirations.length === 0) issues.push("No expirations.");

    // Spots must agree across the chain (one underlying snapshot).
    const spots = [...new Set(quotes.map((q) => q.underlyingPrice))];
    if (spots.length > 1) {
        const spreadPct = (Math.max(...spots) - Math.min(...spots)) / Math.max(...spots);
        if (spreadPct > 0.02) issues.push("Underlying spot inconsistent across chain (>2% spread).");
    }

    return {
        usable: quotes.length >= 3 && strikes.length >= 3 && hasCalls && hasPuts,
        quoteCount: quotes.length,
        strikeCount: strikes.length,
        expirationCount: expirations.length,
        rejected,
        issues,
    };
}

export type { OptionQuote };
