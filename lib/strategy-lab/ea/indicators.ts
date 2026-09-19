// ─────────────────────────────────────────────────────────────────────────────
// Strategy → MT5 EA Generator — indicator translation.
//
// Deterministic mappings between Strategy Lab indicator concepts and MQL5
// indicator calls. NOTE: the compiled EA (mql5.ts) computes its indicator math
// manually inside LoadFeatureState so timestamps/closed-bar semantics match the
// backtest exactly — these helpers are the reference mapping for diagnostics
// and future indicator-rule extensions. Moody note: EMA uses MODE_EMA (not
// MODE_SMA) — an EMA built with MODE_SMA is a silent bug.
// ─────────────────────────────────────────────────────────────────────────────

export type MqlIndicator = {
    type: string;
    period: number;
    timeframe: string;
    symbol: string;
};

/** Strict MQL5 ENUM_TIMEFRAMES mapping (throws on unsupported keys). */
export function mql5Timeframe(tf: string): string {
    switch (tf) {
        case "M1": return "PERIOD_M1";
        case "M3": return "PERIOD_M3";
        case "M5": return "PERIOD_M5";
        case "M15": return "PERIOD_M15";
        case "M30": return "PERIOD_M30";
        case "H1": return "PERIOD_H1";
        case "H4": return "PERIOD_H4";
        case "D1": return "PERIOD_D1";
        default: throw new Error(`Unsupported timeframe for MQL5: ${tf}`);
    }
}

const MA_MODE = {
    EMA: "MODE_EMA",
    SMA: "MODE_SMA",
} as const;

export function mql5IndicatorCall(ind: { type: string; params: Record<string, number>; timeframe: string; symbol?: string }, handleVar: string): string {
    const sym = ind.symbol ? `"${ind.symbol}"` : "Symbol()";
    const tf = mql5Timeframe(ind.timeframe);
    const p = ind.params;
    switch (ind.type) {
        case "EMA":
        case "SMA": {
            const mode = MA_MODE[ind.type as "EMA" | "SMA"] ?? "MODE_SMA";
            return `${handleVar} = iMA(${sym}, ${tf}, ${p.period ?? 20}, 0, ${mode}, PRICE_CLOSE);`;
        }
        case "RSI":
            return `iRSI(${sym}, ${tf}, ${p.period ?? 14}, PRICE_CLOSE)`;
        case "MACD": {
            const fast = p.fastPeriod ?? 12;
            const slow = p.slowPeriod ?? 26;
            const signal = p.signalPeriod ?? 9;
            return `iMACD(${sym}, ${tf}, ${fast}, ${slow}, ${signal}, PRICE_CLOSE)`;
        }
        case "Stochastic": {
            const k = p.kPeriod ?? 5;
            const d = p.dPeriod ?? 3;
            return `iStochastic(${sym}, ${tf}, ${k}, ${d}, 0, MODE_SMA, 0, STO_LOWHIGH)`;
        }
        case "ATR":
            return `iATR(${sym}, ${tf}, ${p.period ?? 14})`;
        case "BollingerBands": {
            const period = p.period ?? 20;
            const dev = p.deviation ?? 2;
            return `iBands(${sym}, ${tf}, ${period}, 0, ${dev}, PRICE_CLOSE)`;
        }
        case "ADX":
            return `iADX(${sym}, ${tf}, ${p.period ?? 14})`;
        case "VWAP":
            return `iVWAP(${sym}, ${tf}, ${p.period ?? 20})`;
        case "AwesomeOscillator":
            return `iAO(${sym}, ${tf})`;
        case "Volume":
            return `iVolume(${sym}, ${tf})`;
        default:
            return `0 /* unsupported: ${ind.type} */`;
    }
}

export function mql5IndicatorHandleDecl(ind: { type: string; id: string; params: Record<string, number>; timeframe: string; symbol?: string }): string {
    const sym = ind.symbol ? `"${ind.symbol}"` : "_Symbol";
    const tf = mql5Timeframe(ind.timeframe);
    const p = ind.params;
    switch (ind.type) {
        case "EMA":
        case "SMA": {
            const mode = MA_MODE[ind.type as "EMA" | "SMA"] ?? "MODE_SMA";
            return `iMA(${sym}, ${tf}, ${p.period ?? 20}, 0, ${mode}, PRICE_CLOSE)`;
        }
        case "RSI":
            return `iRSI(${sym}, ${tf}, ${p.period ?? 14}, PRICE_CLOSE)`;
        case "MACD": {
            const fast = p.fastPeriod ?? 12;
            const slow = p.slowPeriod ?? 26;
            const signal = p.signalPeriod ?? 9;
            return `iMACD(${sym}, ${tf}, ${fast}, ${slow}, ${signal}, PRICE_CLOSE)`;
        }
        case "Stochastic": {
            const k = p.kPeriod ?? 5;
            const d = p.dPeriod ?? 3;
            return `iStochastic(${sym}, ${tf}, ${k}, ${d}, 0, MODE_SMA, 0, STO_LOWHIGH)`;
        }
        case "ATR":
            return `iATR(${sym}, ${tf}, ${p.period ?? 14})`;
        case "BollingerBands": {
            const period = p.period ?? 20;
            const dev = p.deviation ?? 2;
            return `iBands(${sym}, ${tf}, ${period}, 0, ${dev}, PRICE_CLOSE)`;
        }
        case "ADX":
            return `iADX(${sym}, ${tf}, ${p.period ?? 14})`;
        case "VWAP":
            return `iVWAP(${sym}, ${tf}, ${p.period ?? 20})`;
        case "AwesomeOscillator":
            return `iAO(${sym}, ${tf})`;
        case "Volume":
            return `iVolume(${sym}, ${tf})`;
        default:
            return `-1 /* unsupported: ${ind.type} */`;
    }
}
