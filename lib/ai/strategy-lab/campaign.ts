/**
 * AlgoVault Strategy Factory — durable breeding campaigns.
 *
 * A campaign runs the exact same deterministic evolution pipeline as a one-shot
 * `runEvolution`, but generation by generation, with a persisted cursor so it
 * can be paused, resumed and cancelled instead of running to completion inside
 * a single request.
 *
 * Hard rules (inherited from the evolution engine and honoured here):
 *
 * 1. **No fabricated numbers.** Every count, score, grade and survivor comes
 *    from `runEvolutionGeneration`, which backtests real candles. A candidate
 *    that could not be evaluated is counted in `unevaluated` and never
 *    vaulted.
 * 2. **One evaluation path.** The campaign builds its generation context with
 *    the same `buildEvolutionContext` used by `runEvolution`, so a campaign
 *    and a one-shot run over the same inputs produce identical generations.
 * 3. **Determinism + data honesty.** `from`/`to` and the seed are frozen at
 *    creation; the data fingerprint recorded at creation is compared on every
 *    advance so data drift between generations is surfaced, never hidden.
 *
 * Concurrency: `advanceCampaign` claims an RTDB lease (mirroring the
 * strategy-research `claimMissionLease` pattern). Only one worker advances a
 * campaign at a time; cancellation is cooperative — the status is checked at
 * generation boundaries.
 */

import type { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import type {
    AnalysisPeriod,
    BacktestMetrics,
    DataBundle,
    DataCoverage,
    EquityPoint,
    TimeframeHierarchy,
} from "@/lib/strategy-lab/types";
import type { StrategyDna } from "@/lib/ai/strategy-lab/dna";
import {
    buildEvolutionContext,
    buildSeedPopulation,
    runEvolutionGeneration,
    type EvolutionTotals,
    type GenerationReport,
} from "@/lib/ai/strategy-lab/evolution";

// ── limits ──────────────────────────────────────────────────────────────────

/** Default compute budget per `advance` call before the campaign pauses. */
export const DEFAULT_MAX_WORK_MS = 45_000;
/** Upper bound on passports kept per campaign (deduped by dna signature). */
export const MAX_VAULT_PER_CAMPAIGN = 200;
/** Down-sampled equity curve size stored on a passport. */
export const EQUITY_CURVE_SAMPLES = 240;

// ── types ───────────────────────────────────────────────────────────────────

export type CampaignStatus =
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "cancel_requested";

/**
 * Frozen inputs of a campaign. `from`/`to` and `seed` are captured at creation
 * so every generation — even across hours of pause/resume — evaluates over the
 * same window and the same rng seed stream.
 */
export type CampaignSpec = {
    symbol: SupportedSymbol;
    /** Setup timeframe used for the backtest loop (and the passport label). */
    timeframe: Timeframe;
    period: AnalysisPeriod;
    hierarchy: TimeframeHierarchy;
    from: number;
    to: number;
    generations: number;
    seedPopulation: number;
    seed: string;
};

export type CampaignProgress = {
    /** 1-based generation to run next. */
    generation: number;
    totalGenerations: number;
    /** Real counts accumulated across executed generations. */
    candidates: number;
    evaluated: number;
    unevaluated: number;
    survivors: number;
    /** Passports actually saved to the vault for this campaign. */
    vaulted: number;
    /** Best composite score seen across all generations (null until first evaluation). */
    topScore: number | null;
    /** Best composite score of the most recent generation. */
    lastScore: number | null;
    /** Cumulative compute time across advance calls, ms. */
    elapsedMs: number;
    /** Short machine-readable stage label for the live-progress UI. */
    stage: string;
};

/** A vaulted survivor — the "passport" that survives the campaign. */
export type CampaignSurvivor = {
    id: string;
    campaignId: string;
    uid: string;
    symbol: SupportedSymbol;
    timeframe: Timeframe;
    generation: number;
    signature: string;
    dna: StrategyDna;
    score: number;
    grade: "A" | "B" | "C" | "D";
    robustnessScore: number;
    metrics: BacktestMetrics;
    /** Down-sampled equity curve for the passport chart. */
    equityCurve: EquityPoint[];
    createdAt: number;
};

export type Campaign = {
    id: string;
    uid: string;
    spec: CampaignSpec;
    status: CampaignStatus;
    progress: CampaignProgress;
    /** Population to evaluate next (seeds for gen 1, children afterwards). */
    population: StrategyDna[];
    /** Per-generation reports; only the newest keeps candidate `details`. */
    generationReports: GenerationReport[];
    /** Passport ids vaulted for this campaign (dedupe + bounded). */
    survivors: string[];
    dataAsOf: number | null;
    dataFingerprint: string;
    /** True when the data bundle changed between creation and an advance. */
    dataChanged: boolean;
    coverage: DataCoverage[];
    failReason: string | null;
    error: string | null;
    cancelRequestedAt: number | null;
    createdAt: number;
    updatedAt: number;
    completedAt: number | null;
    /** Monotonic write counter (bumped on every persist). */
    version: number;
};

/**
 * Persistence boundary used by the driver. Implemented against RTDB in
 * `campaign-storage.ts`; tests provide an in-memory implementation.
 */
export type CampaignStore = {
    claimLease(uid: string, campaignId: string, workerId: string, ttlMs?: number): Promise<boolean>;
    releaseLease(uid: string, campaignId: string, workerId: string): Promise<void>;
    get(uid: string, campaignId: string): Promise<Campaign | null>;
    create(campaign: Campaign): Promise<void>;
    update(uid: string, campaignId: string, patch: Partial<Campaign>): Promise<void>;
    delete(uid: string, campaignId: string): Promise<void>;
    list(uid: string, options?: { limit?: number; status?: CampaignStatus }): Promise<Campaign[]>;
    saveSurvivor(uid: string, survivor: CampaignSurvivor): Promise<void>;
    getSurvivor(uid: string, survivorId: string): Promise<CampaignSurvivor | null>;
    listSurvivors(uid: string, options?: { campaignId?: string; limit?: number }): Promise<CampaignSurvivor[]>;
    deleteSurvivors(uid: string, campaignId: string): Promise<void>;
};

export type CampaignDraftInput = {
    id: string;
    uid: string;
    spec: CampaignSpec;
    bundle: DataBundle;
    now?: number;
};

export type CampaignDraftResult = {
    campaign: Campaign | null;
    /** Explicit reason when the campaign cannot be created honestly. */
    unavailable: string | null;
};

export type AdvanceCampaignInput = {
    campaignId: string;
    uid: string;
    workerId: string;
    store: CampaignStore;
    /** Loads the data bundle for the spec (injected so tests stay offline). */
    loadData: (spec: CampaignSpec) => Promise<DataBundle>;
    maxWorkMs?: number;
    now?: number;
};

export type AdvanceCampaignResult = {
    ok: boolean;
    reason:
        | "advanced"
        | "paused"
        | "completed"
        | "cancelled"
        | "lease-held"
        | "not-found"
        | "already-done"
        | "data-insufficient";
    campaign: Campaign | null;
    error?: string;
};

// ── helpers ─────────────────────────────────────────────────────────────────

/** FNV-1a — deterministic 32-bit hash. */
function fnv1a(input: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

/** Deterministic fingerprint of a data bundle (counts + first/last bars). */
export function fingerprintDataBundle(bundle: Pick<DataBundle, "candles">): string {
    const parts: string[] = [];
    const timeframes = Object.keys(bundle.candles).sort() as Timeframe[];
    for (const tf of timeframes) {
        const bars = bundle.candles[tf] ?? [];
        const first = bars[0]?.timestamp ?? 0;
        const last = bars[bars.length - 1]?.timestamp ?? 0;
        parts.push(`${tf}:${bars.length}:${first}:${last}`);
    }
    return fnv1a(parts.join("|")).toString(36);
}

/** Deterministic id for a passport derived from campaign + dna signature. */
export function passportId(campaignId: string, signature: string): string {
    return `surv_${campaignId}_${fnv1a(signature).toString(36)}`;
}

/** Bounded, evenly spaced sample of an equity curve for passport charts. */
export function downsampleEquity(points: EquityPoint[], maxPoints: number): EquityPoint[] {
    if (points.length <= maxPoints) return points;
    const stride = points.length / maxPoints;
    const out: EquityPoint[] = [];
    for (let i = 0; i < maxPoints; i++) {
        const idx = Math.min(points.length - 1, Math.floor(i * stride));
        out.push(points[idx]);
    }
    return out;
}

export function stripCampaignReportDetails(report: GenerationReport): GenerationReport {
    const rest: GenerationReport = { ...report };
    delete rest.details;
    return rest;
}

// ── creation ────────────────────────────────────────────────────────────────

/**
 * Build the initial campaign record from a validated spec and a real data
 * bundle. Returns `unavailable` instead of a campaign when the dataset cannot
 * honestly support one (too few bars, or the seed generator produced nothing).
 */
export function buildCampaignDraft(input: CampaignDraftInput): CampaignDraftResult {
    const now = input.now ?? Date.now();
    const { spec, bundle } = input;
    const setupCandles = bundle.candles[spec.timeframe] ?? [];

    if (setupCandles.length < 100) {
        return {
            campaign: null,
            unavailable: `Campaign needs at least 100 bars on ${spec.timeframe}; the data bundle returned ${setupCandles.length}.`,
        };
    }

    const ctx = buildEvolutionContext({
        runId: input.id,
        uid: input.uid,
        symbol: spec.symbol,
        timeframe: spec.timeframe,
        hierarchy: spec.hierarchy,
        candlesByTF: bundle.candles,
        setupTimeframe: spec.timeframe,
        from: spec.from,
        to: spec.to,
        generations: spec.generations,
        seedPopulation: spec.seedPopulation,
        seed: spec.seed,
    });

    const population = buildSeedPopulation({
        symbol: spec.symbol,
        timeframe: spec.timeframe,
        hierarchy: spec.hierarchy,
        featureBars: ctx.usableFeatures,
        size: ctx.seedSize,
        seed: `${spec.seed}:g1`,
    });

    if (population.length === 0) {
        return {
            campaign: null,
            unavailable:
                "The seed generator could not produce distinct candidate genomes from the closed DNA template.",
        };
    }

    const campaign: Campaign = {
        id: input.id,
        uid: input.uid,
        spec,
        status: "queued",
        progress: {
            generation: 1,
            totalGenerations: spec.generations,
            candidates: 0,
            evaluated: 0,
            unevaluated: 0,
            survivors: 0,
            vaulted: 0,
            topScore: null,
            lastScore: null,
            elapsedMs: 0,
            stage: "queued",
        },
        population,
        generationReports: [],
        survivors: [],
        dataAsOf: setupCandles[setupCandles.length - 1]?.timestamp ?? null,
        dataFingerprint: fingerprintDataBundle(bundle),
        dataChanged: false,
        coverage: bundle.coverage,
        failReason: null,
        error: null,
        cancelRequestedAt: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        version: 1,
    };

    return { campaign, unavailable: null };
}

// ── the driver ──────────────────────────────────────────────────────────────

/**
 * Advance a campaign by up to one generation (or fewer when the work budget is
 * exhausted). Safe to call concurrently: a lease guarantees a single worker.
 *
 * - `queued` → `running` on first advance.
 * - After each generation the cursor, progress, reports and vault are
 *   persisted, then `cancel_requested` is re-read at the next generation
 *   boundary (cooperative cancel).
 * - When the budget is exhausted the campaign stays `running` and resumes on
 *   the next advance call with the persisted cursor.
 */
export async function advanceCampaign(input: AdvanceCampaignInput): Promise<AdvanceCampaignResult> {
    const { campaignId, uid, workerId, store } = input;
    const maxWorkMs = input.maxWorkMs ?? DEFAULT_MAX_WORK_MS;
    const t0 = Date.now();

    const claimed = await store.claimLease(uid, campaignId, workerId);
    if (!claimed) {
        return { ok: false, reason: "lease-held", campaign: null };
    }

    try {
        let campaign = await store.get(uid, campaignId);
        if (!campaign) {
            return { ok: false, reason: "not-found", campaign: null };
        }

        if (
            campaign.status === "completed" ||
            campaign.status === "cancelled" ||
            campaign.status === "failed"
        ) {
            return { ok: false, reason: "already-done", campaign };
        }

        if (campaign.status === "cancel_requested") {
            const done = {
                ...campaign,
                status: "cancelled" as const,
                updatedAt: Date.now(),
                version: campaign.version + 1,
            };
            await store.update(uid, campaignId, {
                status: done.status,
                updatedAt: done.updatedAt,
                version: done.version,
            });
            return { ok: true, reason: "cancelled", campaign: done };
        }

        if (campaign.status === "queued") {
            campaign = {
                ...campaign,
                status: "running",
                progress: { ...campaign.progress, stage: "running" },
                updatedAt: Date.now(),
                version: campaign.version + 1,
            };
            await store.update(uid, campaignId, {
                status: campaign.status,
                progress: campaign.progress,
                updatedAt: campaign.updatedAt,
                version: campaign.version,
            });
        }

        const callStart = Date.now();
        const baseElapsedMs = campaign.progress.elapsedMs;
        const baseVersion = campaign.version;

        // Load a fresh bundle inside the lease; surface data drift honestly.
        let bundle: DataBundle;
        try {
            bundle = await input.loadData(campaign.spec);
        } catch (err) {
            const failed = {
                ...campaign,
                status: "failed" as const,
                failReason: "Market data feed failed while advancing the campaign.",
                error: err instanceof Error ? err.message : String(err),
                updatedAt: Date.now(),
                version: campaign.version + 1,
            };
            await store.update(uid, campaignId, {
                status: failed.status,
                failReason: failed.failReason,
                error: failed.error,
                updatedAt: failed.updatedAt,
                version: failed.version,
            });
            return { ok: false, reason: "data-insufficient", campaign: failed, error: failed.error ?? undefined };
        }

        const setupCandles = bundle.candles[campaign.spec.timeframe] ?? [];
        if (setupCandles.length < 100) {
            const failed = {
                ...campaign,
                status: "failed" as const,
                failReason: `Campaign needs at least 100 bars on ${campaign.spec.timeframe}; the data bundle returned ${setupCandles.length}.`,
                updatedAt: Date.now(),
                version: campaign.version + 1,
            };
            await store.update(uid, campaignId, {
                status: failed.status,
                failReason: failed.failReason,
                updatedAt: failed.updatedAt,
                version: failed.version,
            });
            return { ok: false, reason: "data-insufficient", campaign: failed };
        }

        const fingerprint = fingerprintDataBundle(bundle);
        const dataChanged = fingerprint !== campaign.dataFingerprint;

        const ctx = buildEvolutionContext({
            runId: campaign.id,
            uid,
            symbol: campaign.spec.symbol,
            timeframe: campaign.spec.timeframe,
            hierarchy: campaign.spec.hierarchy,
            candlesByTF: bundle.candles,
            setupTimeframe: campaign.spec.timeframe,
            from: campaign.spec.from,
            to: campaign.spec.to,
            generations: campaign.spec.generations,
            seedPopulation: campaign.spec.seedPopulation,
            seed: campaign.spec.seed,
        });

        let generation = campaign.progress.generation;
        let population = campaign.population;
        let totals: EvolutionTotals = {
            candidates: campaign.progress.candidates,
            evaluated: campaign.progress.evaluated,
            unevaluated: campaign.progress.unevaluated,
            survivors: campaign.progress.survivors,
        };
        let topScore = campaign.progress.topScore;
        let reports = [...campaign.generationReports];
        let survivorsList = [...campaign.survivors];
        let version = baseVersion;
        let done = false;
        let cancelled = false;

        while (generation <= ctx.totalGenerations && population.length > 0) {
            // Cooperative cancel: re-read at a generation boundary so an admin
            // can stop the campaign without racing a running backtest.
            const latest = await store.get(uid, campaignId);
            if (latest?.status === "cancel_requested") {
                cancelled = true;
                break;
            }

            const outcome = runEvolutionGeneration(ctx, { generation, population, totals });

            population = outcome.nextPopulation;
            totals = outcome.totals;
            version += 1;

            const genScores = (outcome.report.details ?? [])
                .map((d) => d.score)
                .filter((s): s is number => s !== null);
            const lastScore = genScores.length > 0 ? Math.max(...genScores) : null;
            topScore =
                lastScore === null
                    ? topScore
                    : topScore === null
                      ? lastScore
                      : Math.max(topScore, lastScore);

            // Vault this generation's survivors (dedupe by passport id).
            for (const s of outcome.survivors) {
                if (s.score === null || s.score === undefined || !s.metrics) continue;
                if (survivorsList.length >= MAX_VAULT_PER_CAMPAIGN) break;
                const pid = passportId(campaignId, s.signature);
                if (survivorsList.includes(pid)) continue;
                const curve = downsampleEquity(s.backtest?.equity ?? [], EQUITY_CURVE_SAMPLES);
                await store.saveSurvivor(uid, {
                    id: pid,
                    campaignId,
                    uid,
                    symbol: campaign.spec.symbol,
                    timeframe: campaign.spec.timeframe,
                    generation,
                    signature: s.signature,
                    dna: s.dna,
                    score: s.score,
                    grade: s.grade ?? "C",
                    robustnessScore: s.robustnessScore ?? 0,
                    metrics: s.metrics,
                    equityCurve: curve,
                    createdAt: Date.now(),
                });
                survivorsList.push(pid);
            }

            // Keep the report payload bounded: strip details from everything
            // but the newest generation.
            reports = reports.map(stripCampaignReportDetails);
            reports.push(outcome.report);

            const nextProgress: CampaignProgress = {
                generation: generation + 1,
                totalGenerations: ctx.totalGenerations,
                candidates: totals.candidates,
                evaluated: totals.evaluated,
                unevaluated: totals.unevaluated,
                survivors: totals.survivors,
                vaulted: survivorsList.length,
                topScore,
                lastScore,
                elapsedMs: baseElapsedMs + (Date.now() - callStart),
                stage: outcome.finished
                    ? "breeding_complete"
                    : `breeding_generation_${generation + 1}`,
            };

            await store.update(uid, campaignId, {
                status: "running",
                progress: nextProgress,
                population,
                generationReports: reports,
                survivors: survivorsList,
                dataAsOf: setupCandles[setupCandles.length - 1]?.timestamp ?? null,
                dataFingerprint: fingerprint,
                dataChanged,
                updatedAt: Date.now(),
                version,
            });

            if (outcome.finished) {
                done = true;
                break;
            }
            if (Date.now() - callStart >= maxWorkMs) break;
            generation += 1;
        }

        if (cancelled) {
            const done = {
                ...campaign,
                status: "cancelled" as const,
                updatedAt: Date.now(),
                version: version + 1,
            };
            await store.update(uid, campaignId, {
                status: done.status,
                updatedAt: done.updatedAt,
                version: done.version,
            });
            return { ok: true, reason: "cancelled", campaign: done };
        }

        if (done) {
            await store.update(uid, campaignId, {
                status: "completed",
                completedAt: Date.now(),
                updatedAt: Date.now(),
            });
        }

        const final = await store.get(uid, campaignId);
        return {
            ok: true,
            reason: done ? "completed" : "paused",
            campaign: final,
        };
    } finally {
        await store.releaseLease(uid, campaignId, workerId).catch(() => undefined);
    }
}

/** Reconcile a campaign after the user requests cancellation. */
export function markCampaignCancelRequested(campaign: Campaign, now = Date.now()): Campaign {
    if (campaign.status === "completed" || campaign.status === "failed" || campaign.status === "cancelled") {
        return campaign;
    }
    return {
        ...campaign,
        status: "cancel_requested",
        cancelRequestedAt: campaign.cancelRequestedAt ?? now,
        updatedAt: now,
        version: campaign.version + 1,
    };
}