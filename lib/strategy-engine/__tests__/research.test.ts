// Research-layer tests: unified backtest (experiment records, analytics,
// integrity flags), versioning, validation, chart markers and alert bridge.

import { acceptanceSeries, acceptanceStrategy, approx, check, section } from "./harness";
import { runResearchBacktest, SIMULATION_ASSUMPTIONS, RELIABILITY } from "../backtest";
import { defaultBacktestConfig } from "@/lib/strategy-lab/backtest";
import {
    experimentId,
    isReproducible,
    strategyVersionManifest,
} from "../versioning";
import { validateStrategyDefinition } from "../validation";
import { buildStrategyMarkers, markersForStrategy } from "../chart-markers";
import { buildStrategyAlert, strategyAlertConditions } from "../alerts";
import type { Strategy } from "@/lib/strategy-lab/types";

export function runResearchTests(): boolean {
    const { candles } = acceptanceSeries();
    const strategy = acceptanceStrategy();
    const cfg = defaultBacktestConfig();
    const request = {
        strategy,
        symbol: "XAUUSD" as const,
        timeframe: "M5" as const,
        candlesByTF: { M5: candles },
        config: cfg,
        from: candles[0].timestamp,
        to: candles[candles.length - 1].timestamp,
        datasetSource: "synthetic-acceptance",
        createdAt: 1_700_000_000_000,
    };

    section("Unified backtest: experiment record + reproducibility");
    const run1 = runResearchBacktest(request);
    const run2 = runResearchBacktest(request);
    check(run1.experiment.experimentId === run2.experiment.experimentId, "same inputs → same experiment id");
    check(run1.result.metrics.netProfit === run2.result.metrics.netProfit, "same inputs → identical results");
    check(run1.experiment.manifest.strategyVersion.startsWith("fp_"), "strategy version = structural fingerprint");
    check(run1.experiment.manifest.engineVersion.length > 0, "engine version recorded");
    check(run1.experiment.manifest.executionModelVersion.length > 0, "execution model version recorded");
    check(run1.experiment.manifest.smcVersion.length > 0, "smart money version recorded");
    check(run1.experiment.manifest.indicatorVersions.engine.length > 0, "indicator version recorded");
    check(run1.experiment.results.totalTrades === run1.result.metrics.totalTrades, "results mirror the actual run");
    check(run1.experiment.dataset.bars === candles.length, "dataset bars recorded");
    check(run1.experiment.environment === "backtest", "environment recorded");

    const changed: Strategy = { ...strategy, risk: { ...strategy.risk, riskPercent: 2 } };
    const changedId = experimentId({
        strategy: changed, symbol: "XAUUSD", timeframe: "M5",
        from: request.from, to: request.to, config: cfg,
    });
    check(changedId !== run1.experiment.experimentId, "changing risk creates a NEW experiment id");

    section("Versioning: old results stay reproducible");
    const manifestV1 = strategyVersionManifest(strategy);
    check(isReproducible(manifestV1, strategy), "unchanged strategy reproduces its results");
    const v2: Strategy = { ...strategy, entryRules: strategy.entryRules.filter((r) => r.id !== "r-bos"), version: "2.0.0" };
    const manifestV2 = strategyVersionManifest(v2);
    check(manifestV2.strategyVersion !== manifestV1.strategyVersion, "removing a rule produces a new version");
    check(!isReproducible(manifestV1, v2), "v1 results are NOT considered reproducible under v2");
    const cosmetic: Strategy = { ...strategy, name: "Renamed", description: "other text" };
    check(
        strategyVersionManifest(cosmetic).strategyVersion === manifestV1.strategyVersion,
        "cosmetic changes do not change the structural version"
    );

    section("Unified backtest: analytics (MAE/MFE, segments, drawdown, P&L)");
    const trades = run1.result.trades;
    check(trades.length > 0, "trades exist for analytics");
    check(run1.analytics.excursions.length === trades.length, "MAE/MFE computed for every trade");
    check(run1.analytics.excursions.every((e) => e.mae >= 0 && e.mfe >= 0), "excursions are non-negative");
    check(run1.analytics.excursionSummary.status === "ok", "excursion summary available");
    check(
        run1.analytics.excursions.every((e) => e.mfe > 0),
        "uptrend dataset produces positive MFE"
    );

    const sessionTotal = run1.analytics.sessions.reduce((s, g) => s + g.trades, 0);
    check(sessionTotal === trades.length, "session segmentation covers every trade");
    const regimeTotal = run1.analytics.regimes.reduce((s, g) => s + g.trades, 0);
    check(regimeTotal === trades.length, "regime segmentation covers every trade");
    const dirTotal = run1.analytics.directions.reduce((s, g) => s + g.trades, 0);
    check(dirTotal === trades.length, "long/short segmentation covers every trade");

    const tradeIds = new Set(trades.map((t) => t.id));
    check(
        run1.analytics.drawdownPeriods.every((p) => p.tradeIds.every((id) => tradeIds.has(id))),
        "drawdown periods reference only real trades (click-to-inspect)"
    );

    const dailyNet = run1.analytics.daily.reduce((s, b) => s + b.net, 0);
    check(approx(dailyNet, run1.result.metrics.netProfit, 0.01), "daily P&L sums to net profit");
    const monthlyNet = run1.analytics.monthly.reduce((s, b) => s + b.net, 0);
    check(approx(monthlyNet, run1.result.metrics.netProfit, 0.01), "monthly P&L sums to net profit");
    check(run1.analytics.advanced.status === "ok", "advanced metrics computed");

    check(
        run1.integrity.assumptions.length === SIMULATION_ASSUMPTIONS.length && run1.integrity.assumptions.some((a) => a.startsWith("OHLC")),
        "simulation assumptions documented next to the result"
    );

    section("Integrity: insufficient data is flagged, never faked");
    const tiny = runResearchBacktest({
        ...request,
        candlesByTF: { M5: candles.slice(0, 30) },
        to: candles[29].timestamp,
    });
    check(tiny.integrity.insufficientData, "tiny dataset flagged INSUFFICIENT_DATA");
    check(
        tiny.integrity.reasons.some((r) => r.includes("INSUFFICIENT_DATA")),
        "explicit INSUFFICIENT_DATA reason present"
    );
    check(RELIABILITY.minBars > 30, "reliability threshold documented");

    section("Strategy validation");
    const valid = validateStrategyDefinition(strategy);
    check(valid.valid, `acceptance strategy validates (${valid.errors.join("; ") || "no errors"})`);

    const noSl = validateStrategyDefinition({ ...strategy, stopLoss: undefined as unknown as Strategy["stopLoss"] });
    check(!noSl.valid && noSl.errors.some((e) => e.includes("Stop Loss is required for this risk model")), "missing SL reported with a clear message");

    const badSession = validateStrategyDefinition({
        ...strategy,
        filters: { ...strategy.filters, sessions: ["tokyo" as never] },
    });
    check(!badSession.valid && badSession.errors.some((e) => e.includes("Invalid session")), "invalid session rejected");

    const badTf = validateStrategyDefinition({
        ...strategy,
        timeframes: { ...strategy.timeframes, setup: "X9" as never },
    });
    check(!badTf.valid && badTf.errors.some((e) => e.includes("Invalid timeframe")), "invalid timeframe rejected");

    const noIndicator = validateStrategyDefinition({
        ...strategy,
        entryRules: [{ id: "r-x", enabled: true, group: "indicator", label: "x", operator: "gt", value: 50, groupLogic: "AND" }],
    });
    check(!noIndicator.valid && noIndicator.errors.some((e) => e.includes("must specify which indicator")), "indicator rule requires an indicator");

    const zeroSize = validateStrategyDefinition({
        ...strategy,
        risk: { ...strategy.risk, mode: "fixed_lot", fixedLot: 0 },
    });
    check(!zeroSize.valid && zeroSize.errors.some((e) => e.includes("Fixed lot")), "impossible position size rejected");

    const noConditions = validateStrategyDefinition({ ...strategy, entryRules: [], confirmationRules: [] });
    check(noConditions.valid && noConditions.warnings.some((w) => w.includes("No entry conditions")), "unconditional strategy warns but is not fatal");

    section("Chart markers");
    const markers = buildStrategyMarkers({ strategy, trades });
    check(markers.length > 0, "markers built for trades");
    check(new Set(markers.map((m) => m.id)).size === markers.length, "marker ids are unique (no duplicates)");
    check(markers.every((m) => m.strategyId === strategy.id), "markers attributed to the strategy");
    check(
        markers.filter((m) => m.kind === "entry").every((m) => trades.some((t) => t.id === m.tradeId && t.openedAt === m.time)),
        "entry markers use market time coordinates from real trades"
    );
    check(markers.every((m) => Number.isFinite(m.time) && Number.isFinite(m.price)), "all markers in market coordinates");

    const noEntries = buildStrategyMarkers({ strategy, trades, toggles: { entries: false } });
    check(!noEntries.some((m) => m.kind === "entry"), "toggling entries off removes entry markers");
    check(noEntries.some((m) => m.kind === "exit"), "other markers unaffected by the toggle");

    const foreign = markersForStrategy(markers, "another-strategy");
    check(foreign.length === 0, "stale markers from other strategies are filtered out");

    section("Strategy → alerts (same conditions)");
    const alert = buildStrategyAlert({ strategy, symbol: "XAUUSD", timeframe: "M5", candlesByTF: { M5: candles } });
    check(alert !== null, "alert fires when the strategy conditions are true on the last bar");
    if (alert) {
        check(alert.strategyVersion === strategy.version, "alert carries the strategy version");
        check(alert.conditions.length > 0 && alert.conditions.every((c) => c.passed), "alert lists only passing conditions");
        check(alert.message.includes("XAUUSD"), "alert message identifies the symbol");
    }

    const neverFires: Strategy = {
        ...strategy,
        entryRules: strategy.entryRules.map((r) => (r.indicator === "rsi" ? { ...r, value: 99 } : r)),
    };
    const noAlert = buildStrategyAlert({ strategy: neverFires, symbol: "XAUUSD", timeframe: "M5", candlesByTF: { M5: candles } });
    check(noAlert === null, "no alert when conditions are false");

    const descriptors = strategyAlertConditions(strategy);
    check(descriptors.length === strategy.entryRules.length + strategy.confirmationRules.length, "alert descriptors mirror canonical conditions");
    check(descriptors.some((d) => d.expression.includes("rsi")), "indicator condition exposed to the alert engine");

    return true;
}
