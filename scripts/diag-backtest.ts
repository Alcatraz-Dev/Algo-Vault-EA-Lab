/**
 * Reproduces the exact Strategy Lab → Backtest production path on real data:
 *   loadDataBundle(symbol, "1Y", hierarchy)  →  backtestStrategy(...)
 * Then reports, stage by stage, how many bars survive each filter so we can see
 * exactly where all trades die.
 *
 * Run: node scripts/jiti-tsrun.mjs scripts/diag-backtest.ts
 */
import { loadDataBundle } from "@/lib/strategy-lab/market-data";
import { backtestStrategy, defaultBacktestConfig, evaluateStrategySignal } from "@/lib/strategy-lab/backtest";
import { DEFAULT_HIERARCHY, Strategy } from "@/lib/strategy-lab/types";
import { computeFeatures, featureAtOrBefore } from "@/lib/strategy-lab/features";
import { detectRegime } from "@/lib/analytics/market-regime";
import { analyzeMarket } from "@/lib/strategy-lab/analysis";
import { generateStrategy } from "@/lib/strategy-lab/strategy-generator";
import { MarketCandle } from "@/lib/market-data/types";

const symbol = "XAUUSD";
const hierarchy = { ...DEFAULT_HIERARCHY }; // H4 / H1 / M15 / M5 — same as the analyze step

async function main() {
    console.log("=== Strategy Lab backtest diagnostic ===");
    console.log(`symbol=${symbol} hierarchy=${JSON.stringify(hierarchy)}`);

    const bundle = await loadDataBundle(symbol, "1Y", hierarchy);
    for (const cov of bundle.coverage) {
        console.log(
            `  data ${cov.timeframe}: bars=${cov.availableBars} spanDays=${cov.spanDays.toFixed(1)} from=${new Date(cov.availableFrom).toISOString()}`
        );
    }

    const candlesByTF: Partial<Record<string, MarketCandle[]>> = {};
    for (const tf of [hierarchy.macro, hierarchy.structure, hierarchy.setup, hierarchy.entry]) {
        const data = bundle.candles[tf];
        if (Array.isArray(data) && data.length > 0) candlesByTF[tf] = data;
    }

    const setupTf = hierarchy.setup; // backtest loop runs on the SETUP timeframe
    const candles = candlesByTF[setupTf] ?? [];
    console.log(`  loop timeframe (${setupTf}): ${candles.length} bars`);

    // Build a strategy EXACTLY like the production route does:
    // analyzeMarket(symbol, period, hierarchy) → generateStrategy(...)
    const macroTf = hierarchy.macro;
    const structureTf = hierarchy.structure;
    let analysis: Awaited<ReturnType<typeof analyzeMarket>> | null = null;
    try {
        analysis = await analyzeMarket(symbol, "1Y", hierarchy);
        console.log(`\nanalyzeMarket ok — setup-TF bias: ${analysis.byTimeframe[hierarchy.setup]?.score?.bias ?? "n/a"}`);
    } catch (e) {
        console.log(`\nanalyzeMarket failed (${e instanceof Error ? e.message : e}) — generator will run without measured trends`);
    }
    const setupBias = analysis?.byTimeframe[hierarchy.setup]?.score?.bias;
    const strategy = await generateStrategy(symbol, "1Y", hierarchy, null, setupBias === "bearish" ? "short" : "long", analysis);
    console.log(`generated strategy: "${strategy.name}" direction=${strategy.direction}`);
    console.log(`regimeFilter: ${JSON.stringify(strategy.regimeFilter)}`);
    console.log("entry rules:");
    for (const r of strategy.entryRules) console.log(`  - [${r.group}] ${r.label} → tf=${r.timeframe ?? "(loop)"} value=${JSON.stringify(r.value)}`);
    if (strategy.whyp.weaknesses) console.log(`whyp.weaknesses: ${strategy.whyp.weaknesses}`);

    const legacyStrategy: Strategy = {
        id: "diag",
        name: "diag",
        description: "",
        asset: symbol,
        direction: "long",
        timeframes: hierarchy,
        regimeFilter: ["trending_bullish", "breakout", "high_volatility"],
        entryRules: [
            { id: "r1", enabled: true, group: "trend", label: "EMA structure bullish", operator: "eq", value: "bullish", negate: false, groupLogic: "AND", timeframe: macroTf },
            { id: "r2", enabled: true, group: "confirmation", label: "Positive momentum", operator: "eq", value: "momentum_positive", negate: false, groupLogic: "AND", timeframe: structureTf },
            { id: "r3", enabled: true, group: "structure", label: "Higher highs", operator: "eq", value: "hh", negate: false, groupLogic: "AND", timeframe: structureTf },
            { id: "r4", enabled: true, group: "structure", label: "Higher lows", operator: "eq", value: "hl", negate: false, groupLogic: "AND", timeframe: structureTf },
        ],
        confirmationRules: [],
        stopLoss: { mode: "atr", atrMultiple: 1.5, levelOffset: 0, useSwing: false },
        takeProfit: {
            mode: "r", r1: 1, r2: 2, r3: 3, fixedDistance: 0,
            partialCloses: [{ atR: 1, closePercent: 33 }, { atR: 2, closePercent: 33 }],
            moveBeAfterTp1: true, lockAfterTp2: true, trailingEnabled: false, trailingStopAtr: 1,
        },
        risk: { mode: "percent", riskPercent: 1, fixedLot: 0.01, maxPositions: 1, dailyLossLimitPct: 3, maxDrawdownPct: 20 },
        filters: {
            sessions: ["london", "new_york", "overlap"],
            daysOfWeek: [1, 2, 3, 4, 5],
            volatilityMinAtrPct: 0,
            volatilityMaxAtrPct: 0,
            maxTradesPerDay: 2,
            cooldownCandles: 3,
        },
        executionModel: "next_bar_open",
        costs: { spreadPips: 20, commissionPerLot: 7, slippagePips: 1 },
        sourcePatternId: null,
        whyp: { discovered: "", conditionsSelected: "", occurrenceFrequency: "", historicalPerformance: "", weaknesses: "", poorRegimes: "", generatedByProvider: "" },
        version: "1.0.0",
        created: Date.now(),
        updated: Date.now(),
    };
    void legacyStrategy; // kept for the rule-census below

    // ── Stage-by-stage survival on the loop timeframe ──
    const features = computeFeatures(candles);
    const regimeByBar: string[] = [];
    for (let i = 0; i < candles.length; i++) {
        try {
            const start = Math.max(0, i - 119);
            regimeByBar.push(detectRegime(candles.slice(start, i + 1), setupTf).regime);
        } catch {
            regimeByBar.push("transitional");
        }
    }

    let afterDay = 0, afterSession = 0, afterRegime = 0;
    const regimeCounts = new Map<string, number>();
    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const f = features[i];
        if (strategy.filters.daysOfWeek.length > 0 && !strategy.filters.daysOfWeek.includes(new Date(c.timestamp).getDay())) continue;
        afterDay++;
        if (strategy.filters.sessions.length > 0 && f && !(strategy.filters.sessions as string[]).includes(f.session)) continue;
        afterSession++;
        const r = regimeByBar[i] ?? "transitional";
        regimeCounts.set(r, (regimeCounts.get(r) ?? 0) + 1);
        if (strategy.regimeFilter.length > 0 && !strategy.regimeFilter.includes(r as never)) continue;
        afterRegime++;
    }

    console.log("\n── filter survival (loop bars) ──");
    console.log(`  total bars:          ${candles.length}`);
    console.log(`  after day filter:    ${afterDay}`);
    console.log(`  after session:       ${afterSession}`);
    console.log(`  after regime filter: ${afterRegime}`);
    console.log(`  regime histogram:    ${JSON.stringify(Object.fromEntries(regimeCounts))}`);

    // ── Per-rule pass rates on bars that survive day+session+regime ──
    const macroFeatures = computeFeatures(candlesByTF[macroTf] ?? []);
    const structureFeatures = computeFeatures(candlesByTF[structureTf] ?? []);
    let ruleTrend = 0, ruleMomentum = 0, ruleHH = 0, ruleHL = 0, allRules = 0;
    const momentumSamples: number[] = [];
    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const f = features[i];
        if (!strategy.filters.daysOfWeek.includes(new Date(c.timestamp).getDay())) continue;
        if (f && !(strategy.filters.sessions as string[]).includes(f.session)) continue;
        const r = regimeByBar[i] ?? "transitional";
        if (!strategy.regimeFilter.includes(r as never)) continue;

        const macro = featureAtOrBefore(macroFeatures, c.timestamp);
        const struct = featureAtOrBefore(structureFeatures, c.timestamp);
        if (!macro || !struct) continue;
        const okTrend = macro.trend === "bullish";
        const okMom = struct.momentumPct > 0;
        const okHH = struct.higherHigh;
        const okHL = struct.higherLow;
        if (okTrend) ruleTrend++;
        if (okMom) ruleMomentum++;
        if (okHH) ruleHH++;
        if (okHL) ruleHL++;
        if (okTrend && okMom && okHH && okHL) allRules++;
        momentumSamples.push(Number(struct.momentumPct.toFixed(3)));
    }
    console.log("\n── rule pass rates on surviving bars ──");
    console.log(`  H4 trend bullish:            ${ruleTrend}`);
    console.log(`  H1 momentum positive:        ${ruleMomentum}`);
    console.log(`  H1 higher high:              ${ruleHH}`);
    console.log(`  H1 higher low:               ${ruleHL}`);
    console.log(`  ALL rules (AND):             ${allRules}`);
    console.log(`  H1 momentumPct sample:       ${JSON.stringify(momentumSamples.slice(0, 20))}`);

    // ── Full engine run ──
    const config = { ...defaultBacktestConfig() };
    const result = backtestStrategy(strategy, symbol, candlesByTF as never, config, 0, Number.MAX_SAFE_INTEGER);
    console.log("\n── engine result ──");
    console.log(`  totalTrades: ${result.metrics.totalTrades}`);
    console.log(`  returnPct:   ${result.metrics.returnPct}`);
    console.log(`  equity pts:  ${result.equity.length}`);

    // ── H4 / H1 trend census over their FULL series ──
    const tfTrendCensus = (tf: string) => {
        const feats = computeFeatures(candlesByTF[tf] ?? []);
        const counts = new Map<string, number>();
        for (const f of feats) counts.set(f.trend, (counts.get(f.trend) ?? 0) + 1);
        return JSON.stringify(Object.fromEntries(counts));
    };
    console.log("\n── trend census (full series) ──");
    console.log(`  H4:  ${tfTrendCensus(macroTf)}`);
    console.log(`  H1:  ${tfTrendCensus(structureTf)}`);
    console.log(`  M15: ${tfTrendCensus(setupTf)}`);

    // ── Variant matrix: same strategy, toggled rules/direction ──
    const runVariant = (label: string, mutate: (s: Strategy) => void) => {
        const s = JSON.parse(JSON.stringify(strategy)) as Strategy;
        mutate(s);
        const r = backtestStrategy(s, symbol, candlesByTF as never, config, 0, Number.MAX_SAFE_INTEGER);
        console.log(`  ${label.padEnd(46)} trades=${r.metrics.totalTrades} return=${r.metrics.returnPct}%`);
    };
    console.log("\n── variant matrix ──");
    runVariant("as generated (long, H4 macro rule)", () => {});
    runVariant("long, macro rule timeframe -> M15", (s) => { s.entryRules[0].timeframe = setupTf; });
    runVariant("long, macro rule disabled", (s) => { s.entryRules[0].enabled = false; });
    runVariant("short (all else same)", (s) => { s.direction = "short"; s.entryRules[0].value = "bearish"; s.entryRules[1].value = "momentum_negative"; });
    runVariant("long, regimeFilter emptied", (s) => { s.regimeFilter = []; });

    // ── Also try the live-signal evaluator on the last bar (parity check) ──
    const sig = evaluateStrategySignal(strategy, candlesByTF as never);
    console.log(`  last-bar signal fired: ${sig.fired} regime=${sig.regime}`);

    // ── Engine diagnostics (what the UI now shows) ──
    if (result.diagnostics) {
        console.log("\n── engine diagnostics ──");
        console.log(`  loopBars=${result.diagnostics.loopBars} sessionBars=${result.diagnostics.sessionBars} regimeBars=${result.diagnostics.regimeBars}`);
        for (const r of result.diagnostics.rules) console.log(`  rule ${r.label} (${r.group}/${r.timeframe ?? "loop"}): ${r.passes}/${r.consideredBars}`);
        console.log(`  blockingRuleIds: ${JSON.stringify(result.diagnostics.blockingRuleIds)}`);
    }

    console.log("\nDone.");
}

main().catch((err) => {
    console.error("DIAG FAILED:", err);
    process.exit(1);
});
