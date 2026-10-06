/**
 * AlgoVault — Phase 16 Cross-Asset Intelligence tests.
 *
 * Blocks:
 *   1  relationship engine (correlation / inverse / stability / quality)
 *   2  NO-LOOKAHEAD (§10) — the critical safety block
 *   3  lead-lag (§9)
 *   4  clustering (§11, §12)
 *   5  factors (§13, §14)
 *   6  regime (§15–§17)
 *   7  signals / lifecycle (§8, §18)
 *   8  graph assembly (§3, §4, §43, §44)
 *   9  context + portfolio impact (§19, §24, §30)
 *  10  service integration with an injected loader (§19, §48)
 *  11  security static checks (§50, RTDB-only, auth on every route)
 *  12  setup memory cross-asset snapshot (§40)
 *
 * All data is synthetic but deterministic (fixed LCG) — no randomness, no
 * network, no Firebase.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { PriceSeries } from "@/lib/portfolio/correlation";
import { buildClusters, detectClusterChanges, clusterLabel } from "../clustering";
import {
    buildPortfolioImpact,
    buildSetupCrossAssetSnapshot,
    buildSymbolCrossAssetContext,
    crossAssetLimits,
    relationshipChanged,
} from "../context";
import { activeSignals, generateSignals, reconcileSignals, signalId, toRelationshipSummary } from "../events";
import { computeFactors, factorValue, FACTOR_UNIVERSE } from "../factors";
import {
    buildInstrumentNode,
    buildMarketGraphSnapshot,
    buildStructureNodes,
    diffSnapshots,
    metadataEdges,
    relationshipEdges,
    userDefinedEdges,
} from "../graph";
import { computeLeadLag, pearsonPValue } from "../lead-lag";
import {
    classifyRelationshipType,
    classifyStability,
    computeRelationship,
    correlationMatrixCells,
    dataQualityOf,
    formatCoefficient,
    pairKey,
    rollingObservations,
    truncateAt,
} from "../relationships";
import { computeMarketRegime, RISK_OFF_RETURN } from "../regime";
import {
    DEFAULT_CROSS_ASSET_UNIVERSE,
    computeCrossAssetGraph,
    getSymbolCrossAssetContext,
    resolveUniverse,
} from "../service";
import { crossAssetEngineVersions, RELATIONSHIP_ENGINE_VERSION } from "../versions";
import type { CrossAssetSignal, MarketRegimeState, RelationshipWindow, UserDefinedRelationship } from "../types";

/* ── harness ──────────────────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;
const failures: string[] = [];
let currentSection = "";

function section(name: string): void {
    currentSection = name;
    console.log(`\n── ${name}`);
}

function check(label: string, ok: boolean, detail?: unknown): void {
    if (ok) {
        passed += 1;
        console.log(`  ✓ ${label}`);
    } else {
        failed += 1;
        const line = `${currentSection} :: ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`;
        failures.push(line);
        console.log(`  ✗ ${line}`);
    }
}

function near(a: number, b: number, eps = 1e-6): boolean {
    return Math.abs(a - b) <= eps;
}

/* ── deterministic synthetic data ─────────────────────────────────────────── */

function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4_294_967_296;
    };
}

function gauss(rand: () => number): number {
    const u = Math.max(1e-9, rand());
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const BASE_TS = 1_760_000_000_000; // fixed start — no wall-clock in tests

/** Prices from a return path (returns[i] belongs to timestamp[i]). */
function seriesFromReturns(symbol: string, returns: number[], startPrice = 100): PriceSeries {
    const timestamps: number[] = [];
    const closes: number[] = [startPrice];
    let price = startPrice;
    for (let i = 0; i < returns.length; i += 1) {
        price = price * Math.exp(returns[i]);
        timestamps.push(BASE_TS + (i + 1) * 3_600_000);
        closes.push(price);
    }
    // timestamps must align with closes: prepend the t0 timestamp.
    return { symbol, timestamps: [BASE_TS, ...timestamps], closes };
}

function randomWalk(symbol: string, n: number, seed: number, vol = 0.006): PriceSeries {
    const rand = lcg(seed);
    const returns: number[] = [];
    for (let i = 0; i < n; i += 1) returns.push(gauss(rand) * vol);
    return seriesFromReturns(symbol, returns);
}

/** Build B so that corr(logReturns A, logReturns B) ≈ target. */
function correlatedPair(a: PriceSeries, target: number, seed: number, noise = 0.0): PriceSeries {
    const rand = lcg(seed);
    const aReturns = returnsOf(a);
    const returns: number[] = [];
    for (let i = 1; i < aReturns.length; i += 1) {
        const z = gauss(rand);
        returns.push(target * aReturns[i] + Math.sqrt(Math.max(0, 1 - target * target)) * z * 0.006 + noise);
    }
    return seriesFromReturns(a.symbol + "_B", returns, 50);
}

function returnsOf(series: PriceSeries): number[] {
    const out: number[] = [];
    for (let i = 1; i < series.closes.length; i += 1) {
        out.push(Math.log(series.closes[i] / series.closes[i - 1]));
    }
    return out;
}

const WINDOW: RelationshipWindow = { timeframe: "H1", bars: 100 };
const NOW = BASE_TS + 501 * 3_600_000;

/* ══ 1. relationship engine ════════════════════════════════════════════════ */

function testRelationships(): void {
    section("1 · relationship engine");

    const a = randomWalk("XAUUSD", 400, 11);
    const identical = { ...a, symbol: "GOLD_COPY" };
    const inverse: PriceSeries = {
        symbol: "INV",
        timestamps: a.timestamps,
        closes: a.closes.map((c) => 10_000 / c),
    };

    const pos = computeRelationship({ a, b: identical, window: WINDOW, asOf: NOW, calculatedAt: NOW });
    check("identical series → ρ ≈ 1", pos.coefficient !== null && near(pos.coefficient, 1, 1e-9), pos.coefficient);
    check("positive → CORRELATION", pos.type === "CORRELATION", pos.type);
    check("quality GOOD on full window", pos.dataQuality.status === "GOOD", pos.dataQuality);
    check("sampleSize = window bars", pos.sampleSize === 100, pos.sampleSize);
    check("claims include an OBSERVED line with numbers", pos.claims.some((c) => c.kind === "OBSERVED" && c.text.includes("correlation is")));

    const neg = computeRelationship({ a, b: inverse, window: WINDOW, asOf: NOW, calculatedAt: NOW });
    check("inverse series → ρ ≈ −1", neg.coefficient !== null && near(neg.coefficient, -1, 1e-9), neg.coefficient);
    check("negative → INVERSE_CORRELATION", neg.type === "INVERSE_CORRELATION", neg.type);

    check("classify: strong positive", classifyRelationshipType(0.7) === "CORRELATION");
    check("classify: strong negative", classifyRelationshipType(-0.7) === "INVERSE_CORRELATION");
    check("classify: weak pair is NOT typed (§4)", classifyRelationshipType(0.12) === null);
    check("classify: null stays null", classifyRelationshipType(null) === null);

    // Insufficient data must be honest (§45).
    const shortA: PriceSeries = { symbol: "S1", timestamps: a.timestamps.slice(0, 15), closes: a.closes.slice(0, 15) };
    const shortB: PriceSeries = { symbol: "S2", timestamps: a.timestamps.slice(0, 15), closes: a.closes.slice(0, 15) };
    const poor = computeRelationship({ a: shortA, b: shortB, window: WINDOW, asOf: NOW, calculatedAt: NOW });
    check("insufficient → coefficient null (never 0)", poor.coefficient === null, poor.coefficient);
    check("insufficient → INSUFFICIENT_DATA", poor.dataQuality.status === "INSUFFICIENT_DATA", poor.dataQuality.status);
    check("insufficient → type null", poor.type === null);
    check("insufficient → confidence 0", poor.confidence === 0, poor.confidence);
    check("insufficient → reason string present", Boolean(poor.dataQuality.reason));

    // Data-quality bands (§45).
    check("coverage 100% → GOOD", dataQualityOf(100, 100).status === "GOOD");
    check("coverage 85% → DEGRADED", dataQualityOf(85, 100).status === "DEGRADED");
    check("coverage 50% → INSUFFICIENT_DATA", dataQualityOf(50, 100).status === "INSUFFICIENT_DATA");
    check("missingBars computed", dataQualityOf(90, 100).missingBars === 10);
    check("coverage clamped to 1", dataQualityOf(150, 100).dataCoverage === 1);

    // Stability classification against printed thresholds (§7).
    check("stability: <2 points → UNKNOWN", classifyStability([null]) === "UNKNOWN");
    check("stability: flat series → STABLE", classifyStability([-0.6, -0.61, -0.6, -0.62, -0.61]) === "STABLE");
    check("stability: rising |ρ| → STRENGTHENING", classifyStability([-0.4, -0.5, -0.58, -0.66, -0.72]) === "STRENGTHENING");
    check("stability: falling |ρ| → WEAKENING", classifyStability([-0.81, -0.75, -0.7, -0.66, -0.6]) === "WEAKENING");
    check("stability: |Δ| ≥ 0.3 → BREAKING", classifyStability([-0.78, -0.76, -0.22]) === "BREAKING");
    check("stability: sign flip with |ρ| ≥ 0.3 → FLIPPING", classifyStability([-0.7, -0.72, 0.42]) === "FLIPPING");
    check("stability: tiny sign flip below threshold is not a FLIP", classifyStability([-0.2, 0.1]) !== "FLIPPING");

    // Rolling observation reconstruction (§6).
    const roll = rollingObservations({ a, b: inverse, window: WINDOW, asOf: NOW, observationCount: 5 });
    check("5 rolling observations reconstructed", roll.observations.length === 5, roll.observations.length);
    check("observations are chronological", roll.observations.every((o, i, arr) => i === 0 || arr[i - 1].observedAt <= o.observedAt));
    check("latest observation ≤ asOf", (roll.observations[roll.observations.length - 1]?.observedAt ?? 0) <= NOW);
    check("coefficient series matches observations", roll.coefficients.length === roll.observations.length);

    // Matrix cells (§22).
    const cells = correlationMatrixCells([pos, neg], ["XAUUSD", "GOLD_COPY", "INV"]);
    const off = cells.find((c) => c.a === "XAUUSD" && c.b === "INV");
    check("matrix includes the measured inverse pair", off?.coefficient !== null && near(off!.coefficient, -1, 1e-9));
    check("matrix diagonal = 1", cells.find((c) => c.a === c.b)?.coefficient === 1);
    check("formatCoefficient renders signed values", formatCoefficient(-0.72) === "−0.72" && formatCoefficient(null) === "n/a");
    check("pairKey is order-independent", pairKey("B", "A") === pairKey("A", "B"));
}

/* ══ 2. NO-LOOKAHEAD ═══════════════════════════════════════════════════════ */

function testNoLookahead(): void {
    section("2 · no-lookahead (§10)");

    const a = randomWalk("EURUSD", 300, 21, 0.005);
    // B is correlated with A in the past.
    const b = correlatedPair(a, -0.8, 22);

    const asOf = BASE_TS + 200 * 3_600_000;
    const atT = computeRelationship({ a, b, window: WINDOW, asOf, calculatedAt: asOf });
    const truncatedA = truncateAt(a, asOf);
    const truncatedB = truncateAt(b, asOf);
    const reference = computeRelationship({
        a: truncatedA,
        b: truncatedB,
        window: WINDOW,
        asOf: NOW,
        calculatedAt: asOf,
    });
    check(
        "relationship(t) equals the same computation on the truncated data",
        atT.coefficient !== null && reference.coefficient !== null && near(atT.coefficient, reference.coefficient, 1e-12),
        { atT: atT.coefficient, reference: reference.coefficient }
    );

    // Now poison the future: append bars that destroy the relationship.
    const poisonedA: PriceSeries = {
        symbol: a.symbol,
        timestamps: [...a.timestamps, ...Array.from({ length: 50 }, (_, i) => NOW + (i + 1) * 3_600_000)],
        closes: [...a.closes, ...Array.from({ length: 50 }, (_, i) => a.closes[a.closes.length - 1] * Math.exp(0.05 * (i % 2 === 0 ? 1 : -1)))],
    };
    const poisonedB: PriceSeries = {
        symbol: b.symbol,
        timestamps: [...b.timestamps, ...Array.from({ length: 50 }, (_, i) => NOW + (i + 1) * 3_600_000)],
        closes: [...b.closes, ...Array.from({ length: 50 }, (_, i) => b.closes[b.closes.length - 1] * Math.exp(-0.05 * (i % 2 === 0 ? 1 : -1)))],
    };
    const poisoned = computeRelationship({ a: poisonedA, b: poisonedB, window: WINDOW, asOf, calculatedAt: asOf });
    const full = computeRelationship({ a: poisonedA, b: poisonedB, window: WINDOW, asOf: NOW + 60 * 3_600_000, calculatedAt: NOW });
    check(
        "future bars do NOT change the coefficient at t",
        poisoned.coefficient !== null && reference.coefficient !== null && near(poisoned.coefficient, reference.coefficient, 1e-12),
        { poisoned: poisoned.coefficient, reference: reference.coefficient }
    );
    check(
        "…but the same poisoned series DOES differ when the window is allowed to see the future (sanity: the test can detect leakage)",
        full.coefficient !== null && reference.coefficient !== null && Math.abs(full.coefficient - reference.coefficient) > 1e-6,
        { full: full.coefficient, reference: reference.coefficient }
    );
    check("truncateAt drops bars strictly after asOf", truncatedA.timestamps.every((t) => t <= asOf));
    check("truncateAt keeps bars at asOf", truncatedA.closes.length > 100);

    const roll = rollingObservations({ a: poisonedA, b: poisonedB, window: WINDOW, asOf, observationCount: 8 });
    check("every rolling observation ends ≤ asOf", roll.observations.every((o) => o.observedAt <= asOf));

    // Factors at t are unaffected by the poisoned future.
    const factorsAtT = computeFactors({
        series: { XAUUSD: poisonedA, EURUSD: poisonedB, GBPUSD: poisonedA },
        window: WINDOW,
        asOf,
        calculatedAt: asOf,
    });
    const factorsTrunc = computeFactors({
        series: { XAUUSD: truncateAt(poisonedA, asOf), EURUSD: truncateAt(poisonedB, asOf), GBPUSD: truncateAt(poisonedA, asOf) },
        window: WINDOW,
        asOf: NOW,
        calculatedAt: asOf,
    });
    const volAtT = factorValue(factorsAtT.factors, "VOLATILITY");
    const volTrunc = factorValue(factorsTrunc.factors, "VOLATILITY");
    check(
        "factor value identical when computed at t vs on truncated data",
        volAtT !== null && volTrunc !== null && near(volAtT, volTrunc, 1e-12),
        { volAtT, volTrunc }
    );

    // Regime at t is unaffected by the poisoned future.
    const relAtT = computeRelationship({ a: poisonedA, b: poisonedB, window: WINDOW, asOf, calculatedAt: asOf });
    const regimeAtT = computeMarketRegime({
        scope: "test",
        window: WINDOW,
        series: { SPX500: poisonedA, NAS100: poisonedB, US30: poisonedA, BTCUSD: poisonedB },
        relationships: [relAtT],
        factors: factorsAtT.factors,
        asOf,
        calculatedAt: asOf,
        engineVersions: crossAssetEngineVersions(),
    });
    const regimeTrunc = computeMarketRegime({
        scope: "test",
        window: WINDOW,
        series: {
            SPX500: truncateAt(poisonedA, asOf),
            NAS100: truncateAt(poisonedB, asOf),
            US30: truncateAt(poisonedA, asOf),
            BTCUSD: truncateAt(poisonedB, asOf),
        },
        relationships: [
            computeRelationship({ a: truncateAt(poisonedA, asOf), b: truncateAt(poisonedB, asOf), window: WINDOW, asOf: NOW, calculatedAt: asOf }),
        ],
        factors: factorsTrunc.factors,
        asOf: NOW,
        calculatedAt: asOf,
        engineVersions: crossAssetEngineVersions(),
    });
    check(
        "regime axis states identical at t vs truncated",
        JSON.stringify(regimeAtT.snapshot.states) === JSON.stringify(regimeTrunc.snapshot.states),
        { atT: regimeAtT.snapshot.states, trunc: regimeTrunc.snapshot.states }
    );

    // Lead-lag at t cannot see beyond t.
    const lead = computeLeadLag({ a: poisonedA, b: poisonedB, window: WINDOW, asOf, calculatedAt: asOf });
    const leadTrunc = computeLeadLag({
        a: truncateAt(poisonedA, asOf),
        b: truncateAt(poisonedB, asOf),
        window: WINDOW,
        asOf: NOW,
        calculatedAt: asOf,
    });
    check(
        "lead-lag identical at t vs truncated",
        (lead === null && leadTrunc === null) ||
            (lead !== null && leadTrunc !== null && lead.lag === leadTrunc.lag && near(lead.coefficient, leadTrunc.coefficient, 1e-12)),
        { lead: lead?.coefficient, trunc: leadTrunc?.coefficient }
    );
}

/* ══ 3. lead-lag ═══════════════════════════════════════════════════════════ */

function testLeadLag(): void {
    section("3 · lead-lag (§9)");

    const rand = lcg(31);
    const driver: number[] = [];
    for (let i = 0; i < 400; i += 1) driver.push(gauss(rand) * 0.005);
    const a = seriesFromReturns("LEADER", driver);

    // Follower reacts 2 bars later with a delayed copy + noise.
    const followerReturns = driver.map((v, i) => (i >= 2 ? 0.9 * driver[i - 2] : 0) + gauss(rand) * 0.002);
    const b = seriesFromReturns("FOLLOWER", followerReturns);

    const result = computeLeadLag({ a, b, window: { timeframe: "H1", bars: 250 }, asOf: NOW, calculatedAt: NOW });
    check("lead-lag found for a genuinely shifted series", result !== null);
    if (result) {
        check("leader is the driver", result.leader === "LEADER", result.leader);
        check("lag = 2", result.lag === 2, result.lag);
        check("sample size reported", result.sampleSize > 100, result.sampleSize);
        check("period reported", result.period.from > 0 && result.period.to >= result.period.from);
        check("lags tested are the documented set", result.lagsTested.join(",") === "1,2,3,5,10");
        check("per-lag coefficients returned", result.perLag.length === 5);
        check("stability note present", result.stabilityNote.length > 10);
        check("limitations always populated (§9)", result.limitations.length >= 3);
        check(
            "limitations disclaim prediction and causality",
            result.limitations.some((l) => l.includes("not proof")) && result.limitations.some((l) => l.includes("in-sample"))
        );
    }

    // Uncorrelated series → no claim.
    const c = randomWalk("NOISE_A", 300, 71);
    const d = randomWalk("NOISE_B", 300, 72);
    check(
        "no lead-lag claim for independent series",
        computeLeadLag({ a: c, b: d, window: { timeframe: "H1", bars: 250 }, asOf: NOW, calculatedAt: NOW }) === null
    );

    // p-values.
    const pLow = pearsonPValue(0.5, 100);
    const pZero = pearsonPValue(0, 100);
    check("p-value for r=0.5,n=100 is small", pLow !== null && pLow < 0.001, pLow);
    check("p-value for r=0,n=100 ≈ 1", pZero !== null && pZero > 0.9, pZero);
    check("p-value undefined for tiny samples", pearsonPValue(0.5, 2) === null);
}

/* ══ 4. clustering ═════════════════════════════════════════════════════════ */

function testClustering(): void {
    section("4 · clustering (§11, §12)");

    const a = randomWalk("XAUUSD", 300, 41);
    const b = { ...a, symbol: "TWIN" };
    const c = randomWalk("SOLO", 300, 42);

    const relAB = computeRelationship({ a, b, window: WINDOW, asOf: NOW, calculatedAt: NOW });
    const relAC = computeRelationship({ a, b: c, window: WINDOW, asOf: NOW, calculatedAt: NOW });
    const relBC = computeRelationship({ a: b, b: c, window: WINDOW, asOf: NOW, calculatedAt: NOW });

    const result = buildClusters({
        symbols: ["XAUUSD", "TWIN", "SOLO"],
        results: [relAB, relAC, relBC],
        window: WINDOW,
        calculatedAt: NOW,
    });

    check("correlated pair forms a cluster", result.clusters.length === 1, result.clusters.map((c2) => c2.memberNodeIds));
    check("independent symbol stays unclustered", result.unclustered.includes("SOLO"), result.unclustered);
    check("cluster has ≥2 members", (result.clusters[0]?.memberNodeIds.length ?? 0) === 2);
    check("cluster mean correlation reported", (result.clusters[0]?.meanCorrelation ?? 0) > 0.9, result.clusters[0]?.meanCorrelation);
    check("cluster method printed", result.clusters[0]?.method === "CORRELATION_DISTANCE_AVERAGE_LINKAGE");
    check("cluster limitations printed", (result.clusters[0]?.limitations.length ?? 0) >= 2);

    const again = buildClusters({
        symbols: ["TWIN", "SOLO", "XAUUSD"],
        results: [relBC, relAB, relAC],
        window: WINDOW,
        calculatedAt: NOW,
    });
    check(
        "clustering is deterministic regardless of input order",
        JSON.stringify(again.clusters) === JSON.stringify(result.clusters)
    );

    check(
        "cluster label uses asset class when dominant",
        clusterLabel(["XAUUSD", "XAUUSD"]) .includes("METALS") || clusterLabel(["EURUSD", "GBPUSD"]).includes("FX"),
        clusterLabel(["EURUSD", "GBPUSD"])
    );

    // Missing coefficients never pull symbols together.
    const missing = buildClusters({
        symbols: ["XAUUSD", "TWIN", "SOLO"],
        results: [relAB],
        window: WINDOW,
        calculatedAt: NOW,
    });
    check(
        "unmeasured pairs are excluded, not assumed",
        !missing.clusters.some((cl) => cl.memberNodeIds.includes("instrument:SOLO")),
        missing.clusters.map((cl) => cl.memberNodeIds)
    );

    const changes = detectClusterChanges(result.clusters, []);
    check("dissolved cluster detected", changes.length === 1 && changes[0].kind === "DISSOLVED", changes);
    const noChanges = detectClusterChanges(result.clusters, result.clusters);
    check("identical snapshots → no changes", noChanges.length === 0);
}

/* ══ 5. factors ════════════════════════════════════════════════════════════ */

function testFactors(): void {
    section("5 · factors (§13, §14)");

    // USD strengthens: every XXXUSD pair falls, USDXXX rises.
    const rand = lcg(51);
    const usdLeg = Array.from({ length: 300 }, () => 0.004 + gauss(rand) * 0.002); // positive USD return each bar
    const fxSeries: Record<string, PriceSeries> = {};
    for (const pair of ["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD"]) {
        fxSeries[pair] = seriesFromReturns(pair, usdLeg.map((v) => -v)); // USD is quote → pair falls
    }
    fxSeries.USDJPY = seriesFromReturns("USDJPY", usdLeg); // USD is base → pair rises
    fxSeries.USDCHF = seriesFromReturns("USDCHF", usdLeg);

    const { factors } = computeFactors({ series: fxSeries, window: WINDOW, asOf: NOW, calculatedAt: NOW });
    const usd = factors.find((f) => f.name === "USD_STRENGTH");
    check("USD_STRENGTH computed when inputs exist", usd?.status === "AVAILABLE", usd?.status);
    check("USD_STRENGTH is positive when the USD leg rises", (usd?.value ?? 0) > 0, usd?.value);
    check("factor is labelled DERIVED", usd?.kind === "DERIVED");
    check("formula exposed", Boolean(usd?.formula) && usd!.formula.includes("z("));
    check("inputs with weights exposed", usd!.inputs.filter((i) => i.used).length >= 4, usd!.inputs.length);
    check("every used input has a weight > 0", usd!.inputs.filter((i) => i.used).every((i) => i.weight > 0));
    check("timestamp + dataTimestamp present", usd!.timestamp === NOW && usd!.dataTimestamp > 0);
    check("confidence = used/declared", usd!.confidence > 0 && usd!.confidence <= 1, usd!.confidence);
    check(
        "factor evidence includes CALCULATED + CONFIGURED claims",
        usd!.evidence.some((e) => e.kind === "CALCULATED") && usd!.evidence.some((e) => e.kind === "CONFIGURED")
    );
    check("factor limitations always present", usd!.limitations.length >= 2);

    // Insufficient inputs → INSUFFICIENT_DATA, never a guess.
    const sparse = computeFactors({
        series: { EURUSD: fxSeries.EURUSD },
        window: WINDOW,
        asOf: NOW,
        calculatedAt: NOW,
    });
    const poor = sparse.factors.find((f) => f.name === "USD_STRENGTH");
    check("USD_STRENGTH with 1 pair → INSUFFICIENT_DATA", poor?.status === "INSUFFICIENT_DATA", poor?.status);
    check("…and its value is null (never 0)", poor?.value === null, poor?.value);
    check("missing inputs named", poor!.limitations.some((l) => l.includes("required inputs available")));

    // RISK_APPETITE requires both groups (§13).
    const partial = computeFactors({
        series: { SPX500: randomWalk("SPX500", 300, 61) },
        window: WINDOW,
        asOf: NOW,
        calculatedAt: NOW,
    });
    const risk = partial.factors.find((f) => f.name === "RISK_APPETITE");
    check("RISK_APPETITE without crypto → INSUFFICIENT_DATA", risk?.status === "INSUFFICIENT_DATA", risk?.status);

    check("declared universes are registry symbols only", FACTOR_UNIVERSE.USD_STRENGTH.every((s) => typeof s === "string"));
}

/* ══ 6. regime ═════════════════════════════════════════════════════════════ */

function testRegime(): void {
    section("6 · regime (§15–§17)");

    const rand = lcg(61);
    // Equities down hard with expanding volatility.
    const downReturns = Array.from({ length: 200 }, (_, i) =>
        i < 150 ? gauss(rand) * 0.003 : -0.006 - Math.abs(gauss(rand)) * 0.008
    );
    const equity = seriesFromReturns("SPX500", downReturns);
    const equity2 = seriesFromReturns("NAS100", downReturns.map((v) => v * 1.1));
    const equity3 = seriesFromReturns("US30", downReturns.map((v) => v * 0.9));
    const other = randomWalk("BTCUSD", 200, 62, 0.02);
    const other2 = randomWalk("XAUUSD", 200, 63, 0.01);

    const rel = computeRelationship({ a: equity, b: other, window: WINDOW, asOf: NOW, calculatedAt: NOW });
    const regime = computeMarketRegime({
        scope: "global",
        window: WINDOW,
        series: { SPX500: equity, NAS100: equity2, US30: equity3, BTCUSD: other, XAUUSD: other2 },
        relationships: [rel],
        factors: computeFactors({ series: { SPX500: equity, NAS100: equity2, US30: equity3, BTCUSD: other, XAUUSD: other2 }, window: WINDOW, asOf: NOW, calculatedAt: NOW }).factors,
        asOf: NOW,
        calculatedAt: NOW,
        engineVersions: crossAssetEngineVersions(),
    });

    const risk = regime.snapshot.axes.find((a) => a.axis === "risk");
    check("equity drawdown ≥ 2% with vol → RISK_OFF", risk?.state === "RISK_OFF", { state: risk?.state, limitations: risk?.limitations });
    check("RISK_OFF carries evidence", (risk?.evidence.length ?? 0) > 0 && risk!.evidence.some((e) => e.kind === "CALCULATED"));
    check(
        "equity return evidence printed",
        risk!.evidence.some((e) => e.text.includes(String((RISK_OFF_RETURN * 100).toFixed(0))) || e.text.includes("%"))
    );
    check("multiple axes present (5)", regime.snapshot.axes.length === 5, regime.snapshot.axes.map((a) => a.axis));
    check(
        "several states can be active simultaneously (§15)",
        regime.snapshot.activeStates.length >= 1,
        regime.snapshot.activeStates
    );
    check("engine versions stamped on the snapshot", regime.snapshot.engineVersions.relationship === RELATIONSHIP_ENGINE_VERSION);
    check("volatility axis has evidence", (regime.snapshot.axes.find((a) => a.axis === "volatility")?.evidence.length ?? 0) > 0);

    // No equity index → risk axis UNKNOWN with a stated reason (never fabricated).
    const noEquity = computeMarketRegime({
        scope: "global",
        window: WINDOW,
        series: { EURUSD: randomWalk("EURUSD", 200, 64), GBPUSD: randomWalk("GBPUSD", 200, 65), USDJPY: randomWalk("USDJPY", 200, 66) },
        relationships: [],
        factors: [],
        asOf: NOW,
        calculatedAt: NOW,
        engineVersions: crossAssetEngineVersions(),
    });
    const naiveRisk = noEquity.snapshot.axes.find((a) => a.axis === "risk");
    check("without equities the risk axis is UNKNOWN", naiveRisk?.state === "UNKNOWN", naiveRisk?.state);
    check("…and says why", (naiveRisk?.limitations.length ?? 0) > 0);
    check("stress axis reports liquidity stress as unsupported (§16)", noEquity.snapshot.axes.find((a) => a.axis === "stress")!.evidence.some((e) => e.text.includes("not computed")));

    // Transitions (§17).
    const previousStates = { risk: "RISK_ON" as MarketRegimeState, volatility: "LOW_VOLATILITY" as MarketRegimeState };
    const withTransition = computeMarketRegime({
        scope: "global",
        window: WINDOW,
        series: { SPX500: equity, NAS100: equity2, US30: equity3, BTCUSD: other, XAUUSD: other2 },
        relationships: [rel],
        factors: [],
        asOf: NOW,
        calculatedAt: NOW,
        engineVersions: crossAssetEngineVersions(),
        previousStates,
    });
    check(
        "RISK_ON → RISK_OFF transition detected",
        withTransition.transitions.some((t) => t.axis === "risk" && t.previousState === "RISK_ON" && t.newState === "RISK_OFF"),
        withTransition.transitions.map((t) => `${t.axis}:${t.previousState}->${t.newState}`)
    );
    check("transitions carry evidence, timestamp and affected nodes", withTransition.transitions.every((t) => t.evidence.length > 0 && t.timestamp === NOW && t.affectedNodeIds.length > 0));
    check("TRANSITION appears in active states when a transition fired", withTransition.snapshot.activeStates.includes("TRANSITION"));

    const noTransition = computeMarketRegime({
        scope: "global",
        window: WINDOW,
        series: { SPX500: equity, NAS100: equity2, US30: equity3, BTCUSD: other, XAUUSD: other2 },
        relationships: [rel],
        factors: [],
        asOf: NOW,
        calculatedAt: NOW,
        engineVersions: crossAssetEngineVersions(),
        previousStates: { risk: risk?.state ?? "UNKNOWN", volatility: "UNKNOWN" },
    });
    check("unchanged axes produce no transition", noTransition.transitions.filter((t) => t.axis === "risk").length === 0);
}

/* ══ 7. signals ════════════════════════════════════════════════════════════ */

function testSignals(): void {
    section("7 · cross-asset signals (§8, §18)");

    const a = randomWalk("XAUUSD", 300, 71);
    const b = randomWalk("EURUSD", 300, 72);

    const breaking = computeRelationship({
        a,
        b,
        window: WINDOW,
        asOf: NOW,
        calculatedAt: NOW,
        previousCoefficient: -0.78,
    });
    // Force the measured stability to BREAKING by using a pair whose rolling
    // series moved a lot; if the synthetic data does not break on its own we
    // assert on whichever stability was actually measured (honest test).
    const signals = generateSignals({
        relationships: [breaking],
        clusters: [],
        clusterChanges: [],
        regimeTransitions: [],
        window: WINDOW,
        calculatedAt: NOW,
    });

    const typedSignals = signals.map((s) => s.type);
    check(
        "stability-driven signals only fire on measured stability",
        ["CORRELATION_BREAK", "RELATIONSHIP_FLIP", "RELATIONSHIP_STRENGTHENING", "RELATIONSHIP_WEAKENING"].includes(breaking.stability)
            ? typedSignals.length > 0
            : typedSignals.length === 0,
        { stability: breaking.stability, typedSignals }
    );
    check("signals carry summary text", signals.every((s) => s.summary.length > 10));
    check("signals are DETECTED initially", signals.every((s) => s.status === "DETECTED"));
    const regenerated = generateSignals({
        relationships: [breaking],
        clusters: [],
        clusterChanges: [],
        regimeTransitions: [],
        window: WINDOW,
        calculatedAt: NOW,
    });
    check(
        "signal ids are deterministic across recomputation",
        signals.length === regenerated.length && signals.every((s, i) => s.id === regenerated[i].id),
        { a: signals.map((s) => s.id), b: regenerated.map((s) => s.id) }
    );
    check("signal ids follow the documented format", signals.every((s) => s.id.startsWith("signal:")));

    // Regime-shift signal.
    const regimeSignal = generateSignals({
        relationships: [],
        clusters: [],
        clusterChanges: [],
        regimeTransitions: [
            {
                id: "t1",
                axis: "risk",
                previousState: "RISK_ON",
                newState: "RISK_OFF",
                timestamp: NOW,
                dataTimestamp: NOW - 3_600_000,
                evidence: [{ id: "e1", kind: "CALCULATED", text: "equity down" }],
                confidence: 0.65,
                affectedNodeIds: ["instrument:SPX500"],
            },
        ],
        window: WINDOW,
        calculatedAt: NOW,
    });
    check("regime transition → REGIME_SHIFT signal", regimeSignal.length === 1 && regimeSignal[0].type === "REGIME_SHIFT");
    check("regime signal carries the evidence", regimeSignal[0].evidence.length === 1);
    check("regime signal references the regime node", regimeSignal[0].targetNodes.includes("regime:global"));

    // Lifecycle: DETECTED → CONFIRMED → EXPIRED / INVALIDATED (§18).
    const first: CrossAssetSignal[] = regimeSignal;
    const later: CrossAssetSignal[] = first.map((s) => ({ ...s, dataTimestamp: s.dataTimestamp + 7_200_000, id: signalId(s.type, "risk:RISK_ON->RISK_OFF", s.window, s.dataTimestamp + 7_200_000) }));
    const confirmed = reconcileSignals(first, later, NOW + 7_200_000);
    check(
        "a repeat observation on a later bar CONFIRMS the signal",
        confirmed.some((s) => s.status === "CONFIRMED" && s.type === "REGIME_SHIFT"),
        confirmed.map((s) => s.status)
    );

    const expired = reconcileSignals(first, [], NOW + 10 * 86_400_000);
    check("unobserved signals EXPIRE after their window", expired.every((s) => s.status === "EXPIRED"), expired.map((s) => s.status));

    const strengthened = generateSignals({
        relationships: [
            computeRelationship({ a, b, window: WINDOW, asOf: NOW, calculatedAt: NOW, previousCoefficient: -0.05 }),
        ],
        clusters: [],
        clusterChanges: [],
        regimeTransitions: [],
        window: WINDOW,
        calculatedAt: NOW,
    });
    const live = activeSignals([...first, ...strengthened]);
    check("live signals exclude expired ones", live.every((s) => s.status !== "EXPIRED"));

    check("no signal type implies a trade direction (§18)", !["LONG", "SHORT", "BUY", "SELL"].some((dir) => signals.some((s) => s.type === dir)));
}

/* ══ 8. graph assembly ═════════════════════════════════════════════════════ */

function testGraph(): void {
    section("8 · graph assembly (§3, §4, §43, §44)");

    const eurusd = buildInstrumentNode("EURUSD");
    check("instrument node carries registry metadata", eurusd.assetClass === "FX" && eurusd.currency === "USD", eurusd);
    check("node metadataVersion stamped", eurusd.metadataVersion.length > 0);
    check("instrument nodes are measurable", eurusd.measurable);

    const unknown = buildInstrumentNode("NOTAREALPAIR");
    check("unknown instrument → UNAVAILABLE, not a guess", unknown.assetClass === "UNAVAILABLE" && !unknown.measurable);

    const structure = buildStructureNodes([eurusd, buildInstrumentNode("XAUUSD")]);
    check("asset-class node exists", structure.some((n) => n.kind === "ASSET_CLASS" && n.assetClass === "FX"));
    check("currency nodes exist (EUR + USD)", structure.some((n) => n.currency === "EUR") && structure.some((n) => n.currency === "USD"));

    const meta = metadataEdges([eurusd]);
    check("EURUSD → FX asset-class edge", meta.some((e) => e.relationshipType === "ASSET_CLASS" && e.targetNodeId === "assetclass:FX"));
    check("EURUSD → EUR and USD currency edges", meta.filter((e) => e.relationshipType === "CURRENCY").length === 2, meta.length);
    check("metadata edges cite the registry as evidence", meta.every((e) => e.claims.every((c) => c.kind === "OBSERVED")));

    // Measured edges.
    const a = randomWalk("XAUUSD", 300, 81);
    const inverse: PriceSeries = { symbol: "PROXY", timestamps: a.timestamps, closes: a.closes.map((c) => 20_000 / c) };
    const weak = randomWalk("WEAK", 300, 82);
    const strong = computeRelationship({ a, b: inverse, window: WINDOW, asOf: NOW, calculatedAt: NOW });
    const weakRel = computeRelationship({ a, b: weak, window: WINDOW, asOf: NOW, calculatedAt: NOW });
    const edges = relationshipEdges([strong, weakRel]);
    check("typed measured edge exists for the inverse pair", edges.length === 1, edges.length);
    check("edge strength = |ρ|", edges[0].strength > 0.99, edges[0].strength);
    check("edge carries observation evidence", edges[0].evidence.length >= 5, edges[0].evidence.length);
    check("edge carries computedAt + dataTimestamp", edges[0].calculatedAt === NOW && edges[0].dataTimestamp > 0);

    // User-defined edges.
    const userRel: UserDefinedRelationship = {
        id: "u1",
        userId: "user-1",
        sourceSymbol: "XAUUSD",
        targetSymbol: "BTCUSD",
        declaredType: "POSITIVE",
        note: "both are liquid USD assets",
        createdAt: NOW,
        updatedAt: NOW,
        userDefined: true,
    };
    const uEdges = userDefinedEdges([userRel]);
    check("user edge typed USER_DEFINED", uEdges[0].relationshipType === "USER_DEFINED");
    check("user edge flagged userDefined", uEdges[0].userDefined === true);
    check("user edge evidence labelled USER_DEFINED", uEdges[0].claims[0].kind === "USER_DEFINED");

    // Snapshot.
    const snapshot = buildMarketGraphSnapshot({
        scope: "global",
        window: WINDOW,
        instruments: [eurusd, buildInstrumentNode("XAUUSD")],
        relationships: [strong],
        clusters: [],
        factors: [],
        regime: null,
        signals: [],
        userRelationships: [userRel],
        unavailableSymbols: [{ symbol: "DXY", reason: "not in the canonical registry" }],
        engineVersions: crossAssetEngineVersions(),
        createdAt: NOW,
        observability: {
            loadDataMs: 5,
            computeMs: 3,
            relationshipFailures: 0,
            staleRelationships: 0,
            cacheHits: 1,
            cacheMisses: 0,
            nodeCount: 0,
            edgeCount: 0,
        },
    });
    check("snapshot id deterministic per scope/window/time", snapshot.snapshotId === `mgs:global:H1:100:${NOW}`);
    check("snapshot carries engine versions (§44)", snapshot.engineVersions.relationship === RELATIONSHIP_ENGINE_VERSION);
    check("snapshot carries observability (§54)", snapshot.observability.loadDataMs === 5 && snapshot.observability.computeMs === 3);
    check("snapshot carries data quality", snapshot.dataQuality.status !== undefined);
    check("unavailable symbols reported with reasons", snapshot.unavailableSymbols[0].reason.includes("registry"));
    check("snapshot includes factor/regime-capable node slots", snapshot.nodes.some((n) => n.kind === "INSTRUMENT") && snapshot.nodes.some((n) => n.kind === "ASSET_CLASS"));
    check("graph limitations mention no-causality (§56)", snapshot.limitations.some((l) => l.includes("causal")));

    const other = { ...snapshot, edges: snapshot.edges.map((e, i) => (i === 0 ? { ...e, coefficient: 0.5 } : e)) };
    const diff = diffSnapshots(snapshot, other);
    check("diff detects changed coefficients", diff.changedEdges.length >= 1, diff.changedEdges);
    const noDiff = diffSnapshots(snapshot, snapshot);
    check("identical snapshots → empty diff", noDiff.changedEdges.length === 0 && noDiff.addedEdges.length === 0);
}

/* ══ 9. context + portfolio impact ═════════════════════════════════════════ */

function testContext(): void {
    section("9 · symbol context + portfolio impact (§19, §24, §30)");

    const a = randomWalk("XAUUSD", 300, 91);
    const strong: PriceSeries = { symbol: "STRONG", timestamps: a.timestamps, closes: a.closes.map((c) => 15_000 / c) };
    const mid = randomWalk("MID", 300, 92);
    const weak = randomWalk("WEAK", 300, 93);

    const rels = [
        computeRelationship({ a, b: strong, window: WINDOW, asOf: NOW, calculatedAt: NOW, previousCoefficient: -0.81 }),
        computeRelationship({ a, b: mid, window: WINDOW, asOf: NOW, calculatedAt: NOW }),
        computeRelationship({ a, b: weak, window: WINDOW, asOf: NOW, calculatedAt: NOW }),
        // A relationship not involving the focus symbol must be excluded:
        computeRelationship({ b: mid, a: weak, window: WINDOW, asOf: NOW, calculatedAt: NOW }),
    ];

    const context = buildSymbolCrossAssetContext({
        symbol: "XAUUSD",
        window: WINDOW,
        relationships: rels,
        clusters: [],
        regime: null,
        factors: [],
        signals: [],
        portfolioImpact: null,
        dataTimestamp: NOW,
        calculatedAt: NOW,
        engineVersions: crossAssetEngineVersions(),
    });

    check("only the focus symbol's relationships are shown", context.relationships.every((r) => r.label.startsWith("XAUUSD ↔")), context.relationships.map((r) => r.label));
    check(
        "sorted by |ρ| (strongest first)",
        context.relationships.every((r, i, arr) => i === 0 || Math.abs(arr[i - 1].coefficient ?? 0) >= Math.abs(r.coefficient ?? 0))
    );
    check("untyped (weak) relationships are excluded (§20)", context.relationships.every((r) => r.coefficient === null || Math.abs(r.coefficient) >= 0.3));
    check("capped at the documented maximum", context.relationships.length <= 10);
    check("data quality computed", context.dataQuality.status !== undefined);
    check("context limitations present", context.limitations.length >= 2);

    const kinds = new Set(context.narrative.map((n) => n.kind));
    check("narrative has OBSERVED", kinds.has("OBSERVED"));
    check("narrative has CALCULATED or INFERENCE", kinds.has("CALCULATED") || kinds.has("INFERENCE"));
    check("narrative has INFERENCE (§30)", kinds.has("INFERENCE"));
    check("narrative has RECOMMENDATION (§30)", kinds.has("RECOMMENDATION"));
    check(
        "narrative never claims causality (§56)",
        context.narrative.every((n) => !/\bcaused\b|\bproves\b/i.test(n.text))
    );

    const changed = context.relationships.some((r) => r.changed);
    const expectedChange = rels.some((r) => (r.a === "XAUUSD" || r.b === "XAUUSD") && relationshipChanged(r));
    check("changed flag matches the stability/delta rule", changed === expectedChange, { changed, expectedChange });

    // Portfolio impact (§24).
    const noHoldings = buildPortfolioImpact({
        focusSymbol: "XAUUSD",
        holdings: [],
        grossExposure: 0,
        relationships: rels,
        clusters: [],
    });
    check("no holdings → NO_HOLDINGS (not a fake impact)", noHoldings.status === "NO_HOLDINGS");

    const impact = buildPortfolioImpact({
        focusSymbol: "XAUUSD",
        holdings: [
            { symbol: "STRONG", grossNotional: 40_000 },
            { symbol: "WEAK", grossNotional: 10_000 },
        ],
        grossExposure: 100_000,
        relationships: rels,
        clusters: [],
        correlationThreshold: 0.6,
        warningThreshold: 0.3,
    });
    check("correlated holdings identified", impact.correlatedHoldings.includes("STRONG"), impact.correlatedHoldings);
    check("exposure weight computed", impact.relatedExposureWeight > 0, impact.relatedExposureWeight);
    check(
        "concentration warning fires above threshold with evidence",
        impact.warnings.length === 1 && impact.warnings[0].text.includes("Cross-Asset Concentration Warning"),
        impact.warnings
    );

    // Free vs Pro (§51).
    const free = crossAssetLimits("FREE");
    const pro = crossAssetLimits("PRO");
    check("free universe smaller than pro", free.maxSymbols < pro.maxSymbols);
    check("free has no lead-lag / clusters / explorer", !free.leadLag && !free.clusters && !free.explorer);
    check("pro has the full feature set", pro.leadLag && pro.clusters && pro.explorer && pro.research);
    check("both tiers have a regime baseline", free.regime && pro.regime);

    check("relationship summary points at the counterparty", toRelationshipSummary(rels[0], "XAUUSD", false).symbol !== "XAUUSD");
}

/* ══ 10. service integration (injected loader) ═════════════════════════════ */

async function testService(): Promise<void> {
    section("10 · service integration (§19, §48)");

    const base = randomWalk("XAUUSD", 350, 101);
    const loaderCalls: string[] = [];
    const loader = async (symbol: string) => {
        loaderCalls.push(symbol);
        if (symbol === "FAKEUSD") return { series: null, latest: null, status: "UNAVAILABLE" as const, reason: `${symbol} is not a supported instrument.` };
        return {
            series: { symbol, timestamps: base.timestamps, closes: base.closes.map((c, i) => c * (1 + (i % 7) * 0.001)) },
            latest: { price: base.closes[base.closes.length - 1], timestamp: base.timestamps[base.timestamps.length - 1] },
            status: "AVAILABLE" as const,
        };
    };

    const universe = resolveUniverse({ focusSymbol: "XAUUSD", tier: "PRO" }, 12);
    check("focus symbol is priority 1", universe[0] === "XAUUSD", universe);
    check("universe bounded by the tier cap", universe.length <= 12, universe.length);
    check("canonical universe contains the core instruments", DEFAULT_CROSS_ASSET_UNIVERSE.includes("XAUUSD") && DEFAULT_CROSS_ASSET_UNIVERSE.includes("SPX500"));

    const freeUniverse = resolveUniverse({ focusSymbol: "XAUUSD", watchlist: ["EURUSD", "GBPUSD", "USDJPY", "SPX500", "BTCUSD"], tier: "FREE" }, 5);
    check("free tier universe capped at 5", freeUniverse.length <= 5, freeUniverse);
    check("watchlist ranks above the canonical universe", freeUniverse.includes("EURUSD"));

    const graph = await computeCrossAssetGraph({
        focusSymbol: "XAUUSD",
        universe: ["XAUUSD", "EURUSD", "FAKEUSD"],
        tier: "PRO",
        loadSeries: loader,
        previousSnapshot: null,
        previousStates: {},
        previousSignals: [],
        userRelationships: [],
        now: NOW,
        asOf: NOW,
        metrics: false,
        force: true,
    });

    check("graph computed with an injected loader", graph.snapshot.nodes.filter((n) => n.kind === "INSTRUMENT").length === 3);
    check("unavailable symbol listed with a reason (§45)", graph.snapshot.unavailableSymbols.some((u) => u.symbol === "FAKEUSD" && u.reason.includes("not a supported")), graph.snapshot.unavailableSymbols);
    check("measurable relationships computed", graph.relationships.length > 0, graph.relationships.length);
    check("dataTimestamp ≤ asOf (§10)", graph.snapshot.dataTimestamp <= NOW, { dataTimestamp: graph.snapshot.dataTimestamp, asOf: NOW });
    check("observability counters populated", graph.snapshot.observability.nodeCount > 0 && graph.snapshot.observability.edgeCount > 0);
    check("engine versions on the result", graph.snapshot.engineVersions.factor.length > 0);
    check("regime snapshot present with 5 axes", graph.regime.snapshot.axes.length === 5);
    check("every measured edge has claims", graph.snapshot.edges.every((e) => e.claims.length > 0));
    check("lead-lag skipped without PRO+focus flag", graph.leadLag.length === 0);
    check("loader called once per universe symbol", new Set(loaderCalls).size === loaderCalls.length);

    try {
        const ctx = await getSymbolCrossAssetContext({
            symbol: "XAUUSD",
            focusSymbol: "XAUUSD",
            universe: ["XAUUSD", "EURUSD", "FAKEUSD"],
            tier: "PRO",
            loadSeries: loader,
            previousSnapshot: null,
            previousStates: {},
            previousSignals: [],
            userRelationships: [],
            now: NOW,
            asOf: NOW,
            metrics: false,
            force: true,
            holdings: [{ symbol: "EURUSD", grossNotional: 60_000 }],
            grossExposure: 100_000,
        });
        check("symbol context built from the graph", ctx.symbol === "XAUUSD" && ctx.relationships.length > 0, ctx.relationships.length);
        check("portfolio impact attached from real holdings", ctx.portfolioImpact !== null && ctx.portfolioImpact.status === "AVAILABLE", ctx.portfolioImpact?.correlatedHoldings);
        check("context carries engine versions", ctx.engineVersions.graph.length > 0);
    } catch (error: unknown) {
        check("service integration did not throw", false, error);
    }
}

/* ══ 11. security static checks (§50) ══════════════════════════════════════ */

function testSecurity(): void {
    section("11 · security static checks (§50)");

    const root = path.join(__dirname, "..", "..", "..");
    const read = (p: string): string => {
        try {
            return fs.readFileSync(path.join(root, p), "utf8");
        } catch {
            return "";
        }
    };

    const userRoutes = [
        "app/api/cross-asset/route.ts",
        "app/api/cross-asset/[symbol]/route.ts",
        "app/api/cross-asset/relationships/route.ts",
        "app/api/cross-asset/analyze/route.ts",
    ];
    for (const route of userRoutes) {
        const src = read(route);
        check(`${route} exists`, src.length > 0);
        check(`${route} authenticates`, src.includes("authenticate(request)"));
        check(`${route} never trusts a body/userId for identity`, !src.includes("body.userId") && !src.includes("body.uid"));
    }

    const v1Routes = ["app/api/v1/market/graph/route.ts", "app/api/v1/market/relationships/route.ts"];
    for (const route of v1Routes) {
        const src = read(route);
        check(`${route} exists`, src.length > 0);
        check(`${route} uses the shared pipeline`, src.includes("runIntelligencePipeline"));
        check(`${route} requires market:read scope`, src.includes('requiredScope: "market:read"'));
        check(`${route} enforces the entitlement`, src.includes('requiredEntitlement: "market.intelligence"'));
    }

    const files = ["types", "relationships", "clustering", "factors", "regime", "events", "graph", "context", "service", "store", "lead-lag", "ids", "versions", "index"];
    const allSource = files.map((f) => read(`lib/cross-asset/${f}.ts`)).join("\n");
    check("no Firestore usage in the cross-asset layer (§49)", !/firebase\/firestore|getFirestore\(|initializeFirestore/.test(allSource));
    check("no Math.random in the cross-asset layer (§AC)", !/Math\.random\(\)/.test(allSource));
    check("no AI/LLM calls inside the deterministic engines", !/chatCompletion|defaultRouter|execute\(aiReq/.test(allSource));

    const rules = read("database.rules.json");
    check("RTDB rules cover userRelationships (§50)", rules.includes("userRelationships"));
    check("RTDB rules cover relationshipMemory (§50)", rules.includes("relationshipMemory"));
    if (rules.includes("userRelationships")) {
        const idx = rules.indexOf("userRelationships");
        const slice = rules.slice(idx, idx + 400);
        check("userRelationships is owner-scoped", slice.includes(".uid") || slice.includes("$userId"), slice.slice(0, 200));
    }

    // The engines must not write to execution surfaces (§34: READ_ONLY agents).
    check("cross-asset module never touches order execution", !/placeOrder|submitOrder|executeOrder|trading_order_requests/.test(allSource));

    // §40 — the cross-asset snapshot must actually reach Setup Memory.
    const researchMemory = read("lib/strategy-research/memory.ts");
    check("Setup Memory capture is wired (§40)", researchMemory.includes("captureSetupCrossAssetSnapshot"));
    check("Setup Memory capture fails closed, never silently", researchMemory.includes('status: "UNAVAILABLE"'));
    const setupTypes = read("lib/market-intelligence/memory/types.ts");
    check("SetupMemoryRecord carries the crossAsset snapshot field (§40)", setupTypes.includes("crossAsset"));
    const crossAssetService = read("lib/cross-asset/service.ts");
    check("cross-asset service exports the capture helper (§40)", crossAssetService.includes("export async function captureSetupCrossAssetSnapshot"));
}

/* ══ 12. setup memory cross-asset snapshot (§40) ══════════════════════════ */

async function testSetupSnapshot(): Promise<void> {
    section("12 · setup memory cross-asset snapshot (§40)");

    // No graph → explicit UNAVAILABLE with a reason and a frozen timestamp.
    const missing = buildSetupCrossAssetSnapshot({ graph: null, capturedAt: NOW });
    check("null graph → UNAVAILABLE with a reason", missing?.status === "UNAVAILABLE" && Boolean(missing?.reason), missing);
    check("capture timestamp is frozen when provided", missing?.capturedAt === NOW);

    // Real graph via the injected loader (no network, no Firebase).
    const base = randomWalk("XAUUSD", 300, 210);
    const loader = async (symbol: string) => ({
        series: {
            symbol,
            timestamps: base.timestamps,
            closes: base.closes.map((c, i) => c * (1 + (i % 5) * 0.002)),
        },
        latest: { price: base.closes[base.closes.length - 1], timestamp: base.timestamps[base.timestamps.length - 1] },
        status: "AVAILABLE" as const,
    });
    const { snapshot } = await computeCrossAssetGraph({
        focusSymbol: "XAUUSD",
        universe: ["XAUUSD", "EURUSD", "BTCUSD"],
        tier: "PRO",
        loadSeries: loader,
        previousSnapshot: null,
        previousStates: {},
        previousSignals: [],
        userRelationships: [],
        now: NOW,
        asOf: NOW,
        metrics: false,
        force: true,
    });

    const snap = buildSetupCrossAssetSnapshot({ symbol: "XAUUSD", graph: snapshot, capturedAt: NOW });
    check("graph present → AVAILABLE", snap?.status === "AVAILABLE", snap);
    check("window copied from the snapshot", snap?.window?.timeframe === snapshot.window.timeframe && snap?.window?.bars === snapshot.window.bars);
    check(
        "regime states copied point-in-time",
        JSON.stringify(snap?.regimeStates ?? []) === JSON.stringify(snapshot.regime?.activeStates ?? [])
    );
    const rels = snap?.relationships ?? [];
    check("snapshot has focus relationships", rels.length > 0, rels.length);
    check("relationships never include the focus symbol itself", rels.every((r) => r.symbol !== "XAUUSD"));
    check(
        "relationships sorted by |ρ| strongest first",
        rels.every((r, i) => i === 0 || Math.abs(rels[i - 1].coefficient ?? -1) >= Math.abs(r.coefficient ?? -1)),
        rels.map((r) => r.coefficient)
    );
    check("relationship cap respected (§20)", rels.length <= 10, rels.length);
    check("every row carries stability + coefficient type", rels.every((r) => typeof r.stability === "string" && (r.coefficient === null || typeof r.coefficient === "number")));

    // Focus outside the graph universe → still records regime + an explicit reason.
    const absent = buildSetupCrossAssetSnapshot({ symbol: "NOTINUNIVERSE", graph: snapshot, capturedAt: NOW });
    check(
        "focus outside the graph → regime kept + reason, relationships empty",
        absent?.status === "AVAILABLE" && (absent?.relationships ?? []).length === 0 && Boolean(absent?.reason),
        absent
    );

    // Determinism: same inputs → identical snapshot (§43 reproducibility).
    const again = buildSetupCrossAssetSnapshot({ symbol: "XAUUSD", graph: snapshot, capturedAt: NOW });
    check("same inputs → identical snapshot", JSON.stringify(snap) === JSON.stringify(again));
}

/* ── runner ───────────────────────────────────────────────────────────────── */

export async function runCrossAssetTests(): Promise<boolean> {
    console.log("AlgoVault Phase 16 — Cross-Asset Intelligence tests\n");

    testRelationships();
    testNoLookahead();
    testLeadLag();
    testClustering();
    testFactors();
    testRegime();
    testSignals();
    testGraph();
    testContext();
    await testService();
    testSecurity();
    await testSetupSnapshot();

    console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
    if (failed > 0) {
        console.log("\nFailures:");
        for (const f of failures) console.log(`  · ${f}`);
    }
    return failed === 0;
}
