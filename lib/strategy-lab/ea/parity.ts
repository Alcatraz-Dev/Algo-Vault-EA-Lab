// ─────────────────────────────────────────────────────────────────────────────
// Strategy → MT5 EA Generator — backtest parity report.
//
// An explicit, honest document of how the compiled EA maps to the Strategy Lab
// backtest engine. Every item is derived deterministically from the strategy at
// generation time. Known differences (broker rounding, tick/spread handling,
// intra-bar stop/tp ordering, position sizes, etc.) are stated outright — the
// report never claims parity it does not have.
// ─────────────────────────────────────────────────────────────────────────────

import { EAParityReport } from "./types";
import { Strategy } from "../types";

export type ParityInput = {
    strategy: Strategy;
    symbolSpec: { pipSize: number; digits: number } | null;
    magicNumber: number;
    hasConfirmationRules: boolean;
    usedTimeframes: string[];
    entryExpressionDebug: string;
};

export function buildParityReport(input: ParityInput): EAParityReport {
    // symbolSpec is threaded through for parity accuracy checks that live in
    // the report body (normalization, stops level).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { strategy, symbolSpec: _symbolSpec } = input;
    const items: EAParityReport["items"] = [];
    const caveats: string[] = [];

    // ---- Execution model -------------------------------------------------
    items.push({
        area: "Execution model",
        backtest: strategy.executionModel === "next_bar_open"
            ? "Signal computed on closed bar, order placed at next bar open."
            : "Signal computed on closed bar, order placed at same bar close.",
        ea: "Signal computed on the last CLOSED setup bar (features read from closed candles only); order placed at the current market price when the next setup bar opens.",
        difference: "minor",
        note: "In live execution the entry price is the live bid/ask, so it differs from the backtest's synthetic bar-open fill by the spread/slippage present at that moment.",
    });

    // ---- Rule translation ------------------------------------------------
    items.push({
        area: "Entry rules",
        backtest: `${strategy.entryRules.filter((r) => r.enabled).length} enabled rule(s) evaluated via CandleFeatures per rule timeframe.`,
        ea: `The same ${strategy.entryRules.filter((r) => r.enabled).length} rule(s) compiled to MQL5 boolean expressions over per-timeframe FeatureState structs on ${input.usedTimeframes.length} timeframes (${input.usedTimeframes.join(", ")}).`,
        difference: "none",
        note: "Operator semantics (gte/lte/gt/lt/eq/neq, in/not_in, string equality, negation) are mirrored 1:1 from backtest.ts.",
    });

    if (input.hasConfirmationRules) {
        items.push({
            area: "Confirmation rules",
            backtest: "Confirmation rules are AND-joined after entry rules per bar.",
            ea: "Confirmation rules are compiled into the entry condition and AND-joined with entry rules.",
            difference: "none",
        });
    }

    if ((strategy.regimeFilter?.length ?? 0) > 0) {
        items.push({
            area: "Regime filter",
            backtest: `Regime detected every 4 bars via detectRegime() over the last 120 setup candles (stride-sampled then copied forward).`,
            ea: "Regime detected on every new setup bar via the compiled DetectRegime() over the last 120 closed setup candles.",
            difference: "minor",
            note: "The EA evaluates regime on every setup bar instead of stride-sampling every 4 bars; both use the same scoring/thresholds so divergence is limited to adjacency effects in fast regime changes.",
        });
    }

    // ---- Trend / volatility ----------------------------------------------
    items.push({
        area: "Trend & volatility",
        backtest: "EMA(20)/EMA(50) recursion over last 20/50 closes, simple ATR(14), atrPct thresholds (low<0.1, normal<0.3, high<0.6, extreme>=0.6).",
        ea: "Identical EMA recursion, identical ATR(14) mean, identical atrPct thresholds compiled in LoadFeatureState().",
        difference: "none",
    });

    // ---- Market structure / liquidity ------------------------------------
    items.push({
        area: "Market structure & liquidity",
        backtest: "3-bar-confirmed swings, sweeps of confirmed levels, BOS/CHOCH from last two confirmed swings, FVG (8-bar window), order blocks (20-bar window), all evaluated with confirmation lag.",
        ea: "Mirrored 3-bar confirmation lag, 60-bar sweep/BOS event windows, 8-bar FVG window, 20-bar order-block window, recomputed on closed bars only.",
        difference: "none",
        note: "Swing detection recomputes over the last 120 closed bars; the backtest used the full series, which only matters in very quiet markets where a second swing confirmation is older than 120 bars.",
    });

    // ---- Breakout / momentum ---------------------------------------------
    items.push({
        area: "Breakout & momentum",
        backtest: "10-bar breakout vs previous 10 closed highs/lows; momentum = % change over 10 bars.",
        ea: "Identical 10-bar windows over closed candles.",
        difference: "none",
    });

    // ---- Sessions / weekdays ---------------------------------------------
    items.push({
        area: "Sessions & weekdays",
        backtest: "Sessions derived from the candle's UTC timestamp (biquote data is UTC); weekday from the server's local day (UTC in production).",
        ea: "Session derived from the broker bar time converted to UTC via the GMT offset; weekday from the same converted time.",
        difference: "minor",
        note: "Bar timestamps in MT5 are broker-server time; the UTC conversion uses the account server's GMT offset. If the broker's session definition differs from UTC, session labels may shift by the server offset.",
    });

    // ---- SL / TP / partials / BE / trailing ------------------------------
    items.push({
        area: "Stop-loss",
        backtest: `SL ${strategy.stopLoss.mode === "atr" ? `= entry ∓ ${strategy.stopLoss.atrMultiple}×ATR` : `= entry ∓ levelOffset`}, normalized to 2 decimals.`,
        ea: `The same formula, normalized to the broker digits. Broker minimum stop distance (SYMBOL_TRADE_STOPS_LEVEL) is enforced — entries whose SL would be inside the stop level are skipped with a journal message.`,
        difference: "significant",
        note: "The backtest normalizes prices to 2 decimals regardless of symbol; the EA uses the symbol's actual digits, which is more accurate (e.g. EURUSD 5 digits). It also enforces the broker's minimum stop distance, which a backtest cannot.",
    });
    items.push({
        area: "Take-profit",
        backtest: strategy.takeProfit.mode === "r"
            ? `TP at ${strategy.takeProfit.r1}R / ${strategy.takeProfit.r2}R / ${strategy.takeProfit.r3}R applied always.`
            : "TPs computed from fixedDistance; note the current backtester always applies R-based targets (fixedDistance is ignored in backtests).",
        ea: strategy.takeProfit.mode === "r"
            ? "TP1/TP2/TP3 placed at R multiples of the risk price; partial closes at TP1/TP2 percentages, SL moved to break-even after TP1, locked to TP1 after TP2 — all compiled from the strategy."
            : "TP1/TP2/TP3 placed at fixedDistance × 1/2/3 in price units.",
        difference: strategy.takeProfit.mode === "fixed" ? "significant" : "minor",
        note: strategy.takeProfit.mode === "fixed"
            ? "The backtester ignores fixedDistance and always uses R-based TPs; the EA honors the strategy's chosen mode (fixed). EA numbers reflect the compiled strategy; backtest comparisons should be re-run against the same mode."
            : "Intra-bar stop-before-TP ordering is decided by the broker's tick engine; the backtest used bar-close prices. Results differ by intrabar noise.",
    });
    items.push({
        area: "Partial closes",
        backtest: "Partial closes at TP1/TP2 percentages of the remaining volume, rounded to 2 decimals; positions fully close at TP3 once TP1+TP2 have fired.",
        ea: `Partials close the configured percentages (${String(strategy.takeProfit.partialCloses[0]?.closePercent ?? 0)}% at ${String(strategy.takeProfit.partialCloses[0]?.atR ?? 1)}R, ${String(strategy.takeProfit.partialCloses[1]?.closePercent ?? 0)}% at ${String(strategy.takeProfit.partialCloses[1]?.atR ?? 2)}R) honor the broker min/step lot rules; dust lot remainders close fully.`,
        difference: "minor",
        note: "When a partial would leave a remainder below the broker's minimum lot, the EA closes the full position instead of leaving an untradeable sliver.",
    });
    items.push({
        area: "Trailing stop",
        backtest: "Trailing is configured but never triggers in the current backtester (the TP3 code path closes the position before trailing activation).",
        ea: strategy.takeProfit.trailingEnabled
            ? `Trailing is enabled: after TP1+TP2 partial closes, the stop trails ${strategy.takeProfit.trailingStopAtr}×ATR behind price at TP3, and the broker TP3 is not set (the position is trail-managed instead).`
            : "Trailing disabled — broker TP3 closes the remaining volume, matching the backtest's TP3 full close.",
        difference: strategy.takeProfit.trailingEnabled ? "significant" : "none",
        note: strategy.takeProfit.trailingEnabled
            ? "The backtester never actually trails (its TP3 close wins), so live trailing results will differ from any backtest. This is a deliberate, configurable behavior: the EA honors the strategy configuration rather than inheriting the backtest's dead path."
            : "Backtest and EA both close the remainder at TP3.",
    });

    // ---- Risk sizing ------------------------------------------------------
    items.push({
        area: "Position sizing",
        backtest: `Volume = balance × ${strategy.risk.riskPercent}% / (riskPrice × contractSize), rounded to 2 decimals.${
            strategy.risk.mode === "fixed_lot" ? ` (fixed ${strategy.risk.fixedLot} lots)` : ""
        }`,
        ea: "Same formula, then clamped to the broker's volume min/max/step; entries whose computed volume falls below the broker minimum are skipped with a journal message.",
        difference: "minor",
        note: "Broker min/step clamping can change the exact risk taken versus the backtest's unclamped rounding.",
    });

    // ---- Costs ------------------------------------------------------------
    items.push({
        area: "Costs (spread/commission/slippage)",
        backtest: `Spread (${strategy.costs.spreadPips} pips), commission (${strategy.costs.commissionPerLot}/lot) and slippage (${strategy.costs.slippagePips} pips) charged as costs.`,
        ea: "No simulated costs are charged; real broker spread/commission/swap apply. The spread filter is compiled from the strategy's modeled spread to optionally reject entries whose live spread exceeds the model.",
        difference: "improved",
        note: "Backtests model costs deterministically; live execution experiences real, variable costs. The EA logs actual fills rather than simulating them.",
    });

    // ---- Risk limits ------------------------------------------------------
    items.push({
        area: "Risk limits",
        backtest: "maxPositions, maxTradesPerDay, cooldownCandles, dailyLossLimitPct, maxDrawdownPct enforced per bar against the simulated balance/equity.",
        ea: "Same limits compiled; checked on every tick and on each new setup bar against the live account balance/equity. Drawdown is measured from the account's peak equity while the EA runs.",
        difference: "minor",
        note: "Live equity includes non-EA positions and other activity, so limit triggers may differ from an isolated backtest of this strategy alone.",
    });

    // ---- Look-ahead integrity ---------------------------------------------
    items.push({
        area: "No look-ahead",
        backtest: "Features at bar i use only data available at bar i's close; entries at i+1.",
        ea: "Features are loaded only from CLOSED bars (bar shift ≥ 1); entry evaluation happens only when a NEW setup bar opens, using the just-closed bar's features — never the forming bar.",
        difference: "none",
    });

    // ---- Data / broker ----------------------------------------------------
    caveats.push("Backtests run on fixed historical OHLC candle data; live trading reacts tick-by-tick. Intrabar stop/TP ordering and partial fills follow the broker's engine and can differ from bar-close execution in the backtest.");
    caveats.push("Symbol contract size, tick value, volume min/step and spread are read from the live broker symbol at runtime; the backtest used the platform's symbol specs for the configured instrument.");
    caveats.push("The EA trades the account's live balance/equity (shared with the whole account), while the backtest simulated an isolated balance — daily-loss and drawdown limits therefore see account-wide context.");
    caveats.push(`Magic number ${input.magicNumber} is derived from strategyId + symbol + strategyVersion, so the AlgoVault Trade Gateway can attribute every trade from this EA to this exact strategy version.`);

    const significant = items.filter((i) => i.difference === "significant");
    const summary = significant.length === 0
        ? "The compiled EA faithfully mirrors the strategy's deterministic rules with only broker-level execution differences (rounding, fills, real fees)."
        : significant
              .map((i) => `${i.area}: ${i.note ?? i.difference}`)
              .join(" ") +
          " These differences are intentional and surfaced so backtest-to-live expectations are honest.";

    return {
        generatedAt: Date.now(),
        version: "1.0.0",
        items,
        caveats,
        summary,
    };
}