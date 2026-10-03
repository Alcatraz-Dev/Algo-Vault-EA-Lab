/**
 * Intelligence dossier — the deterministic context every agent reads.
 *
 * This module is the ONLY bridge between AI Trading Teams and the existing
 * AlgoVault intelligence engines. It reuses (never re-implements):
 *   - SmartMoneyEngine            (BOS/CHOCH, OB, FVG, sweeps, sessions)
 *   - lib/analytics/*             (structure, liquidity, regime, volatility,
 *                                  sessions, multi-timeframe, score, indicators)
 *   - fetchCandles                (existing market data providers)
 *   - Setup Memory records        (monitoring/setups/{uid})
 *   - Strategy Research missions  (lib/strategy-research/storage)
 *
 * POINT-IN-TIME SAFETY (spec §34): every candle series passes through
 * `enforcePointInTime` before any engine sees it, so replay/backtest/research
 * runs can never observe future candles.
 */

import { MarketCandle, Timeframe as DataTimeframe, SupportedSymbol, SUPPORTED_SYMBOLS } from "@/lib/market-data/types";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { SmartMoneyEngine } from "@/lib/market-intelligence/smart-money/engine";
import { detectStructure, getOverallStructureBias } from "@/lib/analytics/market-structure";
import { detectLiquidity } from "@/lib/analytics/liquidity";
import { detectRegime } from "@/lib/analytics/market-regime";
import { analyzeVolatility, calculateATR } from "@/lib/analytics/volatility";
import { getSessionData, getCurrentSession } from "@/lib/analytics/sessions";
import { calculateMarketScore } from "@/lib/analytics/market-score";
import { getMultiTimeframeBias } from "@/lib/analytics/multi-timeframe";
import { computeIndicatorSnapshot } from "@/lib/analytics/indicators";
import { enforcePointInTime } from "./validation";
import type { TeamAgentDefinition, TeamDataMode } from "./types";

// ─── dossier types ──────────────────────────────────────────────────────────

export interface DossierMeta {
    market: string;
    mode: TeamDataMode;
    asOf: number | null;
    generatedAt: number;
    dataTimestamp: string;
    candleCounts: Record<string, number>;
    providers: string[];
    quality: "ok" | "partial" | "unavailable";
    limitations: string[];
}

export interface DossierSections {
    regime: Record<string, unknown> | null;
    volatility: Record<string, unknown> | null;
    session: Record<string, unknown> | null;
    structure: Record<string, unknown> | null;
    smartMoney: Record<string, unknown> | null;
    liquidity: Record<string, unknown> | null;
    multiTimeframe: Record<string, unknown> | null;
    score: Record<string, unknown> | null;
    indicators: Record<string, unknown> | null;
    recentCandles: Record<string, unknown> | null;
    setups: Record<string, unknown> | null;
    research: Record<string, unknown> | null;
    calendar: Record<string, unknown> | null;
    account: Record<string, unknown> | null;
}

export type DossierSectionKey = keyof DossierSections;

export interface IntelligenceDossier {
    meta: DossierMeta;
    /** refId → human label. FACT observations must cite one of these ids. */
    refs: Record<string, string>;
    sections: DossierSections;
    /** Compact JSON payload per section (already context-minimized). */
    payloads: Partial<Record<DossierSectionKey, unknown>>;
}

// ─── helpers ────────────────────────────────────────────────────────────────

const DATA_TIMEFRAMES: DataTimeframe[] = ["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1"];

export function normalizeTimeframe(tf: string): DataTimeframe | null {
    const upper = String(tf || "").trim().toUpperCase();
    return (DATA_TIMEFRAMES as string[]).includes(upper) ? (upper as DataTimeframe) : null;
}

export function normalizeSymbol(symbol: string): SupportedSymbol | null {
    const upper = String(symbol || "").trim().toUpperCase();
    return (SUPPORTED_SYMBOLS as readonly string[]).includes(upper) ? (upper as SupportedSymbol) : null;
}

export function modeToEngineMode(mode: TeamDataMode): "live" | "replay" | "historical" {
    if (mode === "live") return "live";
    if (mode === "replay" || mode === "backtest") return "replay";
    return "historical";
}

/** Short, context-minimized slice of a candle series for the dossier. */
function candleSummary(candles: MarketCandle[]): Record<string, unknown> {
    if (candles.length === 0) return { count: 0 };
    const last = candles[candles.length - 1];
    const recent = candles.slice(-12).map((c) => ({
        t: c.timestamp,
        o: c.open,
        h: c.high,
        l: c.low,
        c: c.close,
    }));
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    return {
        count: candles.length,
        last: { t: last.timestamp, o: last.open, h: last.high, l: last.low, c: last.close },
        windowHigh: Math.max(...highs),
        windowLow: Math.min(...lows),
        recent,
    };
}

// ─── deps (injectable for tests / replay) ───────────────────────────────────

export interface DossierDeps {
    fetchCandles?: (
        symbol: SupportedSymbol,
        timeframe: DataTimeframe,
        options?: { from?: number; to?: number },
    ) => Promise<MarketCandle[]>;
    loadSetups?: (uid: string, market: string) => Promise<Record<string, unknown> | null>;
    loadResearch?: (uid: string, market: string) => Promise<Record<string, unknown> | null>;
    loadCalendar?: (market: string, asOf: number | null) => Promise<Record<string, unknown> | null>;
    loadAccountRisk?: (uid: string, market: string) => Promise<Record<string, unknown> | null>;
}

export interface BuildDossierParams {
    userId: string;
    market: string;
    entryTimeframe: string;
    confirmationTimeframe: string;
    contextTimeframe: string;
    mode: TeamDataMode;
    asOf: number | null;
    deps?: DossierDeps;
}

// ─── builder ────────────────────────────────────────────────────────────────

export async function buildDossier(params: BuildDossierParams): Promise<IntelligenceDossier> {
    const deps = params.deps ?? {};
    const loadCandles = deps.fetchCandles ?? fetchCandles;
    const refs: Record<string, string> = {};
    const limitations: string[] = [];
    const providers: string[] = [];
    const candleCounts: Record<string, number> = {};
    const addRef = (id: string, label: string) => {
        refs[id] = label;
    };

    const symbol = normalizeSymbol(params.market);
    if (!symbol) {
        limitations.push(`Market "${params.market}" is not in the supported symbol list.`);
    }

    const entryTf = normalizeTimeframe(params.entryTimeframe);
    const confirmTf = normalizeTimeframe(params.confirmationTimeframe);
    const contextTf = normalizeTimeframe(params.contextTimeframe);
    for (const [label, tf] of [
        ["entry", params.entryTimeframe],
        ["confirmation", params.confirmationTimeframe],
        ["context", params.contextTimeframe],
    ] as const) {
        if (!tf) limitations.push(`Unsupported ${label} timeframe "${tf}".`);
    }

    // ── load candle series (point-in-time enforced) ────────────────────────
    const wanted: { key: string; tf: DataTimeframe | null }[] = [
        { key: "entry", tf: entryTf },
        { key: "confirmation", tf: confirmTf },
        { key: "context", tf: contextTf },
    ];
    const series: Partial<Record<"entry" | "confirmation" | "context", MarketCandle[]>> = {};

    if (symbol) {
        await Promise.all(
            wanted.map(async ({ key, tf }) => {
                if (!tf) return;
                try {
                    const raw = await loadCandles(symbol, tf, params.asOf ? { to: params.asOf } : undefined);
                    // Defense in depth: strip anything beyond the cutoff even if
                    // the provider ignored `to` (spec §34 — no future leakage).
                    const clean = enforcePointInTime(raw ?? [], params.asOf);
                    series[key as "entry"] = clean;
                    candleCounts[key] = clean.length;
                    if (clean.length === 0) {
                        limitations.push(`No candles returned for ${symbol} ${tf}.`);
                    }
                } catch (err) {
                    limitations.push(`Candle load failed for ${symbol} ${tf}: ${err instanceof Error ? err.message : String(err)}`);
                    series[key as "entry"] = [];
                    candleCounts[key] = 0;
                }
            }),
        );
    }

    const entry = series.entry ?? [];
    const confirmation = series.confirmation ?? [];
    const context = series.context ?? [];
    const primary = entry.length > 0 ? entry : confirmation.length > 0 ? confirmation : context;
    const primaryTf = entryTf ?? confirmTf ?? contextTf;

    // Hard invariant: no candle beyond asOf, ever.
    if (params.asOf !== null) {
        for (const candles of [entry, confirmation, context]) {
            for (const c of candles) {
                if (c.timestamp > params.asOf) {
                    limitations.push("FUTURE_LEAKAGE_GUARD: candle beyond asOf was stripped.");
                }
            }
        }
    }

    const sections: DossierSections = {
        regime: null,
        volatility: null,
        session: null,
        structure: null,
        smartMoney: null,
        liquidity: null,
        multiTimeframe: null,
        score: null,
        indicators: null,
        recentCandles: null,
        setups: null,
        research: null,
        calendar: null,
        account: null,
    };
    const payloads: IntelligenceDossier["payloads"] = {};

    const setSection = (key: DossierSectionKey, value: Record<string, unknown> | null, payload?: unknown) => {
        sections[key] = value;
        if (value) {
            payloads[key] = payload ?? value;
            addRef(key, `dossier.${key}`);
        }
    };

    if (primary.length > 0 && primaryTf) {
        // ── regime ─────────────────────────────────────────────────────────
        try {
            const regime = detectRegime(primary, primaryTf);
            addRef("regime.label", `Regime: ${regime.regime}`);
            addRef("regime.confidence", `Regime confidence ${regime.confidence}`);
            (regime.factors || []).forEach((f, i) => addRef(`regime.factor[${i}]`, String(f)));
            setSection("regime", regime as unknown as Record<string, unknown>);
        } catch (err) {
            limitations.push(`Regime classification failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        // ── volatility ─────────────────────────────────────────────────────
        try {
            const vol = analyzeVolatility(primary);
            const atr = vol.atr || calculateATR(primary);
            addRef("volatility.atr", `ATR ${atr}`);
            addRef("volatility.state", `Volatility state ${vol.state}`);
            setSection("volatility", { ...(vol as unknown as Record<string, unknown>), atr });
        } catch (err) {
            limitations.push(`Volatility analysis failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        // ── session ────────────────────────────────────────────────────────
        try {
            const now = params.asOf ? new Date(params.asOf) : new Date();
            const current = getCurrentSession(now);
            const sessionData = getSessionData(primary, now);
            addRef("session.current", `Current session ${current.name}`);
            setSection("session", {
                current: current.current,
                name: current.name,
                ...(sessionData as unknown as Record<string, unknown>),
            });
        } catch (err) {
            limitations.push(`Session analysis failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        // ── structure ──────────────────────────────────────────────────────
        try {
            const events = detectStructure(primary, primaryTf);
            const bias = getOverallStructureBias(events);
            addRef("structure.bias", `Structure bias ${bias}`);
            events.slice(-8).forEach((e, i) => addRef(`structure.event[${i}]`, `${e.type} ${e.direction} @ ${e.price}`));
            setSection("structure", {
                bias,
                timeframe: primaryTf,
                events: events.slice(-8),
                eventCount: events.length,
            });
        } catch (err) {
            limitations.push(`Structure detection failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        // ── smart money (existing engine — no second BOS/CHOCH engine) ─────
        try {
            const engine = new SmartMoneyEngine({ mode: modeToEngineMode(params.mode) });
            const sm = engine.run(primary, primaryTf as never, modeToEngineMode(params.mode));
            sm.events.slice(-10).forEach((e, i) => addRef(`smartMoney.event[${i}]`, `${e.type} ${e.direction ?? ""}`.trim()));
            sm.sweeps.slice(-5).forEach((e, i) => addRef(`smartMoney.sweep[${i}]`, `Sweep ${e.direction ?? ""}`.trim()));
            sm.orderBlocks.slice(-4).forEach((_, i) => addRef(`smartMoney.orderBlock[${i}]`, "Order block"));
            sm.fvg.slice(-4).forEach((_, i) => addRef(`smartMoney.fvg[${i}]`, "Fair value gap"));
            setSection("smartMoney", {
                events: sm.events.slice(-10),
                sweeps: sm.sweeps.slice(-5),
                orderBlocks: sm.orderBlocks.slice(-4),
                fvg: sm.fvg.slice(-4),
                structureState: sm.structureState,
                sessions: sm.sessions.slice(-4),
                engineMode: modeToEngineMode(params.mode),
                limitations: sm.limitations,
            });
        } catch (err) {
            limitations.push(`Smart Money engine failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        // ── liquidity ──────────────────────────────────────────────────────
        try {
            const liq = detectLiquidity(primary, primaryTf);
            const levels = (liq.levels ?? []) as { id: string; price: number; type: string }[];
            const sweeps = (liq.sweeps ?? []) as unknown[];
            levels.slice(-8).forEach((l, i) => addRef(`liquidity.level[${i}]`, `${l.type} @ ${l.price}`));
            addRef("liquidity.summary", `${levels.length} liquidity levels, ${sweeps.length} sweeps`);
            setSection("liquidity", {
                levels: levels.slice(-8),
                sweeps: sweeps.slice(-5),
                totalLevels: levels.length,
                totalSweeps: sweeps.length,
            });
        } catch (err) {
            limitations.push(`Liquidity detection failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        // ── indicators snapshot ────────────────────────────────────────────
        try {
            const snap = computeIndicatorSnapshot(primary);
            Object.entries(snap as unknown as Record<string, unknown>).forEach(([k, v]) => {
                if (typeof v === "number" || typeof v === "string") addRef(`indicators.${k}`, `${k}=${v}`);
            });
            setSection("indicators", snap as unknown as Record<string, unknown>);
        } catch (err) {
            limitations.push(`Indicator snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        // ── score ──────────────────────────────────────────────────────────
        try {
            const score = calculateMarketScore(primary, primaryTf);
            addRef("score.total", `Market score ${score.total} (${score.bias})`);
            setSection("score", score as unknown as Record<string, unknown>);
        } catch (err) {
            limitations.push(`Market score failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        // ── recent candles (price action) ──────────────────────────────────
        const summary = candleSummary(primary);
        addRef("recentCandles.last", `Last candle close ${String((summary.last as { c?: number } | undefined)?.c ?? "n/a")}`);
        setSection("recentCandles", { timeframe: primaryTf, ...summary });
    } else {
        limitations.push("No usable candle series — deterministic sections skipped.");
    }

    // ── multi-timeframe bias (existing analytics) ──────────────────────────
    try {
        const mtfRecord: Partial<Record<DataTimeframe, MarketCandle[]>> = {};
        if (entryTf && entry.length) mtfRecord[entryTf] = entry;
        if (confirmTf && confirmation.length) mtfRecord[confirmTf] = confirmation;
        if (contextTf && context.length) mtfRecord[contextTf] = context;
        const mtf = getMultiTimeframeBias(mtfRecord as Record<DataTimeframe, MarketCandle[]>);
        mtf.forEach((m, i) => addRef(`multiTimeframe[${i}]`, `${m.timeframe} bias ${m.bias}`));
        setSection("multiTimeframe", {
            entryTimeframe: params.entryTimeframe,
            confirmationTimeframe: params.confirmationTimeframe,
            contextTimeframe: params.contextTimeframe,
            bias: mtf,
        });
    } catch (err) {
        limitations.push(`Multi-timeframe bias failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // ── optional user data (setup memory, research, calendar, account) ─────
    if (deps.loadSetups) {
        try {
            const setups = await deps.loadSetups(params.userId, params.market);
            if (setups) {
                addRef("setups.records", "Setup memory records");
                setSection("setups", setups);
            } else {
                setSection("setups", { records: [], note: "No setup memory records for this market." });
            }
        } catch (err) {
            limitations.push(`Setup memory unavailable: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    if (deps.loadResearch) {
        try {
            const research = await deps.loadResearch(params.userId, params.market);
            if (research) {
                addRef("research.missions", "Research missions");
                setSection("research", research);
            } else {
                setSection("research", { missions: [], note: "No research missions found." });
            }
        } catch (err) {
            limitations.push(`Research records unavailable: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    if (deps.loadCalendar) {
        try {
            const calendar = await deps.loadCalendar(params.market, params.asOf);
            if (calendar) {
                addRef("calendar.events", "Scheduled economic events");
                setSection("calendar", calendar);
            } else {
                setSection("calendar", { events: [], note: "No calendar feed available — treat event risk as UNKNOWN." });
            }
        } catch {
            setSection("calendar", { events: [], note: "Calendar feed unavailable — treat event risk as UNKNOWN." });
        }
    } else {
        setSection("calendar", { events: [], note: "No calendar feed configured for this run." });
    }
    if (deps.loadAccountRisk) {
        try {
            const account = await deps.loadAccountRisk(params.userId, params.market);
            if (account) {
                addRef("account.risk", "Account risk state");
                setSection("account", account);
            }
        } catch {
            // Account data is optional; absence is reported by the risk agent.
        }
    }

    const quality: DossierMeta["quality"] =
        candleCounts.entry || candleCounts.confirmation || candleCounts.context
            ? limitations.length > 0
                ? "partial"
                : "ok"
            : "unavailable";

    const dataTimestamp = (() => {
        const all = [entry, confirmation, context].filter((s) => s.length > 0);
        if (all.length === 0) return new Date().toISOString();
        const lastTs = Math.max(...all.map((s) => s[s.length - 1].timestamp));
        return new Date(lastTs).toISOString();
    })();

    return {
        meta: {
            market: params.market,
            mode: params.mode,
            asOf: params.asOf,
            generatedAt: Date.now(),
            dataTimestamp,
            candleCounts,
            providers,
            quality,
            limitations,
        },
        refs,
        sections,
        payloads,
    };
}

// ─── per-agent slicing (context minimization, spec §26) ─────────────────────

const SECTION_BUDGET: DossierSectionKey[] = [
    "regime",
    "volatility",
    "session",
    "structure",
    "smartMoney",
    "liquidity",
    "multiTimeframe",
    "score",
    "indicators",
    "recentCandles",
    "setups",
    "research",
    "calendar",
    "account",
];

export interface AgentContextSlice {
    /** Section keys actually handed to the agent. */
    sections: DossierSectionKey[];
    /** Only refs belonging to the provided sections. */
    refs: Record<string, string>;
    data: Record<string, unknown>;
    includedSections: DossierSectionKey[];
    missingSections: string[];
}

/**
 * Returns the minimal dossier slice for one agent: only the sections its
 * definition declares, plus a hard cap on payload size.
 */
export function sliceDossierForAgent(
    dossier: IntelligenceDossier,
    agent: Pick<TeamAgentDefinition, "requiredSections" | "tools" | "category" | "id">,
    opts: { maxChars?: number } = {},
): AgentContextSlice {
    const maxChars = opts.maxChars ?? 24000;

    const wanted = new Set<DossierSectionKey>();
    for (const key of SECTION_BUDGET) {
        if (agent.requiredSections.includes(key)) wanted.add(key);
    }
    // Chief analyst gets the compact summary of everything (handled by prompt).
    if (agent.category === "chief") {
        for (const key of SECTION_BUDGET) if (dossier.payloads[key]) wanted.add(key);
    }
    // Category → sections heuristic for agents without explicit section lists.
    if (wanted.size === 0) {
        const byCategory: Record<string, DossierSectionKey[]> = {
            regime: ["regime", "volatility", "session"],
            "smart-money": ["smartMoney", "structure", "liquidity"],
            technical: ["indicators", "multiTimeframe", "score"],
            "price-action": ["recentCandles", "structure"],
            liquidity: ["liquidity", "structure"],
            macro: ["calendar"],
            quant: ["volatility", "score", "research"],
            research: ["research", "setups"],
            risk: ["volatility", "calendar", "account", "setups"],
            contrarian: ["structure", "indicators", "volatility"],
            validation: ["multiTimeframe", "structure", "setups"],
            chief: SECTION_BUDGET,
        };
        for (const key of byCategory[agent.category] ?? []) {
            if (dossier.payloads[key]) wanted.add(key);
        }
    }

    const data: Record<string, unknown> = {};
    const refs: Record<string, string> = {};
    const includedSections: DossierSectionKey[] = [];
    const missingSections: string[] = [];

    for (const key of SECTION_BUDGET) {
        const isWanted = wanted.has(key);
        const payload = dossier.payloads[key];
        if (isWanted && payload) includedSections.push(key);
        if (isWanted && !payload) missingSections.push(key);
    }

    // Serialize sections in priority order, respecting the character budget.
    let used = 0;
    for (const key of includedSections) {
        const payload = dossier.payloads[key];
        if (payload === undefined) continue;
        let serialized = safeStringify(payload);
        if (used + serialized.length > maxChars) {
            // Truncate the payload rather than dropping the section silently.
            serialized = serialized.slice(0, Math.max(0, maxChars - used)) + "…(truncated)";
        }
        if (serialized.length > 0) {
            data[key] = serialized.startsWith("{") || serialized.startsWith("[")
                ? safeParse(serialized)
                : serialized;
            used += serialized.length;
        }
        for (const [refId, label] of Object.entries(dossier.refs)) {
            if (refId === key || refId.startsWith(`${key}.`) || refId.startsWith(`${key}[`)) {
                refs[refId] = label;
            }
        }
    }

    return { sections: includedSections, refs, data, includedSections, missingSections };
}

export function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value) ?? "";
    } catch {
        return String(value);
    }
}

function safeParse(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

/** Compact dossier summary used by the Chief Analyst (never the raw payloads). */
export function summarizeDossierForChief(dossier: IntelligenceDossier): Record<string, unknown> {
    const pick = (key: DossierSectionKey, keys?: string[]): unknown => {
        const payload = dossier.payloads[key];
        if (!payload || typeof payload !== "object") return payload ?? null;
        if (!keys) return payload;
        const source = payload as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const k of keys) if (k in source) out[k] = source[k];
        return out;
    };
    return {
        meta: dossier.meta,
        regime: pick("regime"),
        volatility: pick("volatility"),
        structure: pick("structure"),
        smartMoney: pick("smartMoney", ["structureState", "events", "sweeps"]),
        liquidity: pick("liquidity", ["totalLevels", "totalSweeps"]),
        multiTimeframe: pick("multiTimeframe"),
        score: pick("score", ["total", "bias", "confidence"]),
        calendar: pick("calendar"),
        setups: pick("setups"),
    };
}
