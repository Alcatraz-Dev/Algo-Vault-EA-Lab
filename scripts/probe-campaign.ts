import { buildEvolutionContext, runEvolutionGeneration, buildSeedPopulation } from "@/lib/ai/strategy-lab/evolution";
import type { MarketCandle } from "@/lib/market-data/types";

const STEP_MS = 15 * 60 * 1000;
const BASE = 1_750_000_000_000;

function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function candle(ts: number, open: number, close: number, wickUp: number, wickDn: number): MarketCandle {
    const high = Math.max(open, close) + wickUp;
    const low = Math.min(open, close) - wickDn;
    return { timestamp: ts, open, high, low, close, volume: 1000 };
}

function zigzag(seed: number, n: number, up: number, down: number, upBars: number, dnBars: number): MarketCandle[] {
    const rand = rng(seed);
    const out: MarketCandle[] = [];
    let px = 4000;
    let ts = BASE;
    let cycles = 0;
    while (out.length < n) {
        const isUp = cycles % 2 === 0;
        const bars = isUp ? upBars : dnBars;
        const step = isUp ? up : -down;
        for (let b = 0; b < bars && out.length < n; b++) {
            const open = px;
            const close = open + step + (rand() - 0.5) * 1.2;
            const wickUp = isUp ? 1 + rand() * 2.5 : 0.3 + rand() * 0.8;
            const wickDn = isUp ? 0.3 + rand() * 0.8 : 1 + rand() * 2.5;
            out.push(candle(ts, open, close, wickUp, wickDn));
            ts += STEP_MS;
            px = close;
        }
        cycles += 1;
    }
    return out;
}

export { STEP_MS, BASE, rng, candle, zigzag };

const hierarchy = { macro: "M15", structure: "M15", setup: "M15", entry: "M15" } as { macro: any; structure: any; setup: any; entry: any };

console.log("=== multi-gen check on U55/D15 up2.4/dn8 (seedSize x bars) ===");
for (const [n, size] of [[1500, 24], [1800, 24], [2000, 24], [2500, 24]]) {
    const t0 = Date.now();
    const setup = zigzag(11, n, 2.4, 8, 55, 15);
    const ctx = buildEvolutionContext({
        runId: "probe",
        uid: "u1",
        symbol: "XAUUSD",
        timeframe: "M15",
        hierarchy: hierarchy as any,
        candlesByTF: { M15: setup },
        setupTimeframe: "M15",
        from: BASE,
        to: BASE + setup.length * STEP_MS,
        generations: 4,
        seedPopulation: size,
        seed: "u1:XAUUSD:M15:3M",
    });
    let population = buildSeedPopulation({
        symbol: ctx.symbol, timeframe: ctx.timeframe, hierarchy: ctx.hierarchy,
        featureBars: ctx.usableFeatures, size: ctx.seedSize, seed: `${ctx.seed}:g1`,
    });
    let totals = { candidates: 0, evaluated: 0, unevaluated: 0, survivors: 0 };
    const perGen: string[] = [];
    let maxTradeSurv = 0;
    for (let gen = 1; gen <= 4 && population.length > 0; gen++) {
        const out = runEvolutionGeneration(ctx, { generation: gen, population, totals });
        const survs = (out.report.details ?? []).filter((d) => d.survivor);
        for (const s of survs) maxTradeSurv = Math.max(maxTradeSurv, s.metrics?.totalTrades ?? 0);
        perGen.push(`g${gen}=${out.totals.survivors - totals.survivors}surv(${population.length}pop)`);
        population = out.nextPopulation;
        totals = out.totals;
    }
    console.log(`n=${n} size=${size} ${perGen.join(" ")} maxSurvTrades=${maxTradeSurv} elapsed=${Date.now() - t0}ms`);
}