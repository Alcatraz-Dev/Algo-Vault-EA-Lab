"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged, User } from "firebase/auth";
import {
    Activity,
    AlertTriangle,
    Beaker,
    ChevronRight,
    FlaskConical,
    Lock,
    Pause,
    Play,
    Plus,
    RotateCcw,
    ScrollText,
    Square,
    Trash2,
    Zap,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import {
    MISSION_STAGES,
    RESEARCH_CONCEPTS,
    RESEARCH_PERIODS,
    RESEARCH_RISK_PROFILES,
    RESEARCH_SESSIONS,
    RESEARCH_TRADING_STYLES,
    type MissionStage,
    type ResearchConcept,
    type ResearchMission,
    type ResearchMissionSpec,
    type ResearchRiskProfile,
    type ResearchSession,
    type ResearchTradingStyle,
} from "@/lib/strategy-research/types";
import {
    strategyResearchApi,
    type CandidateSummary,
} from "@/lib/strategy-research/client-api";
import { SUPPORTED_SYMBOLS, type SupportedSymbol, type Timeframe } from "@/lib/market-data/types";
import { CompatibilityPanel } from "@/components/performance-arena/CompatibilityPanel";

const TIMEFRAMES: Timeframe[] = ["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1"];

const STAGE_LABELS: Record<MissionStage, string> = {
    data: "Data",
    hypotheses: "Hypotheses",
    compile: "Compile",
    backtest: "Backtest",
    validate: "OOS / Walk-Forward",
    monte_carlo: "Monte Carlo",
    rank: "Rank",
    done: "Done",
};

const LIFECYCLE_TONE: Record<string, "info" | "positive" | "warning" | "negative"> = {
    discovered: "info",
    hypothesis: "info",
    compiled: "info",
    backtesting: "info",
    backtested: "info",
    oos_testing: "info",
    walk_forward: "info",
    monte_carlo: "info",
    robustness_analysis: "info",
    ranked: "warning",
    survivor: "positive",
    incubated: "positive",
    forward_testing: "positive",
    validated: "positive",
    rejected: "negative",
    failed: "negative",
    cancelled: "warning",
};

const LIFECYCLE_LABELS: Record<string, string> = {
    discovered: "Discovered",
    hypothesis: "Hypothesis",
    compiled: "Compiled",
    backtesting: "Backtesting",
    backtested: "Backtested",
    oos_testing: "OOS Testing",
    walk_forward: "Walk-Forward",
    monte_carlo: "Monte Carlo",
    robustness_analysis: "Robustness",
    ranked: "Ranked",
    survivor: "Candidate",
    incubated: "Incubating",
    forward_testing: "Forward Testing",
    validated: "Research Complete",
    rejected: "Rejected",
    failed: "Failed",
    cancelled: "Cancelled",
};

type AccessState =
    | { kind: "loading" }
    | { kind: "signed_out" }
    | { kind: "locked"; reason: string }
    | { kind: "granted" };

interface BuilderState {
    name: string;
    markets: SupportedSymbol[];
    timeframes: Timeframe[];
    tradingStyle: ResearchTradingStyle;
    concepts: ResearchConcept[];
    sessions: ResearchSession[];
    direction: "long" | "short" | "both";
    riskProfile: ResearchRiskProfile;
    historicalPeriod: (typeof RESEARCH_PERIODS)[number];
    maxCandidates: number;
    requireOOS: boolean;
    requireWalkForward: boolean;
    requireMonteCarlo: boolean;
    forwardTesting: boolean;
    maxAIRequests: number;
    maxBacktests: number;
    maxDurationMinutes: number;
}

const DEFAULT_BUILDER: BuilderState = {
    name: "XAUUSD Scalping Research",
    markets: ["XAUUSD"],
    timeframes: ["M1", "M5", "M15"],
    tradingStyle: "scalping",
    concepts: ["smart_money", "liquidity", "fvg", "order_blocks", "vwap", "atr"],
    sessions: ["london", "new_york"],
    direction: "both",
    riskProfile: "conservative",
    historicalPeriod: "6M",
    maxCandidates: 8,
    requireOOS: true,
    requireWalkForward: true,
    requireMonteCarlo: true,
    forwardTesting: false,
    maxAIRequests: 6,
    maxBacktests: 300,
    maxDurationMinutes: 45,
};

function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Chip({
    active,
    onClick,
    children,
    disabled,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={`rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
                active
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:text-foreground"
            }`}
        >
            {children}
        </button>
    );
}

export default function StrategyResearchClient() {
    const [user, setUser] = useState<User | null>(null);
    const [access, setAccess] = useState<AccessState>({ kind: "loading" });
    const [missions, setMissions] = useState<ResearchMission[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [events, setEvents] = useState<Awaited<ReturnType<typeof strategyResearchApi.getMission>>["events"]>([]);
    const [candidates, setCandidates] = useState<CandidateSummary[]>([]);
    const [candidateTotal, setCandidateTotal] = useState(0);
    const [candidateOffset, setCandidateOffset] = useState(0);
    const [builder, setBuilder] = useState<BuilderState>(DEFAULT_BUILDER);
    const [builderOpen, setBuilderOpen] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ level: "info" | "error"; text: string } | null>(null);
    const [activeRunId, setActiveRunId] = useState<string | null>(null);
    const runGuard = useRef(false);

    const navGroups: NavGroup[] = useMemo(() => APP_NAV.map((g) => ({ ...g })), []);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            if (!u) setAccess({ kind: "signed_out" });
        });
        return () => unsub();
    }, []);

    const token = useCallback(async () => auth.currentUser?.getIdToken() ?? null, []);

    const refreshMissions = useCallback(async () => {
        const t = await token();
        if (!t) return;
        try {
            const { missions: list } = await strategyResearchApi.listMissions(t);
            setMissions(list);
            setAccess({ kind: "granted" });
            setSelectedId((prev) => prev ?? (list[0]?.id ?? null));
        } catch (err) {
            const message = err instanceof Error ? err.message : "";
            if (message.toLowerCase().includes("subscription") || message.toLowerCase().includes("license") || message.toLowerCase().includes("pro")) {
                setAccess({ kind: "locked", reason: message });
            }
        }
    }, [token]);

    const refreshMissionDetail = useCallback(
        async (missionId: string) => {
            const t = await token();
            if (!t) return;
            try {
                const detail = await strategyResearchApi.getMission(t, missionId);
                setMissions((prev) => prev.map((m) => (m.id === missionId ? detail.mission : m)));
                setEvents(detail.events);
            } catch {
                // keep previous view
            }
        },
        [token]
    );

    const refreshCandidates = useCallback(
        async (missionId: string, offset = candidateOffset) => {
            const t = await token();
            if (!t) return;
            try {
                const page = await strategyResearchApi.listCandidates(t, missionId, { offset, limit: 20 });
                setCandidates(page.candidates);
                setCandidateTotal(page.total);
                setCandidateOffset(page.offset);
            } catch {
                setCandidates([]);
                setCandidateTotal(0);
            }
        },
        [token, candidateOffset]
    );

    useEffect(() => {
        if (access.kind !== "granted") return;
        // Deferred so no state is set synchronously inside the effect
        // (react-hooks/set-state-in-effect); real work still happens immediately.
        const t = setTimeout(() => {
            void refreshMissions();
        }, 0);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [access.kind]);

    useEffect(() => {
        if (!selectedId) return;
        const t = setTimeout(() => {
            void refreshMissionDetail(selectedId);
            void refreshCandidates(selectedId, 0);
        }, 0);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId]);

    // Probe access once signed in.
    useEffect(() => {
        if (!user) return;
        const t = setTimeout(() => {
            void refreshMissions();
        }, 0);
        return () => clearTimeout(t);
    }, [user, refreshMissions]);

    // ── Auto-run loop: while a mission is running, keep advancing it. ────────
    // `effectiveRunId` is derived at render time so a paused/cancelled mission
    // stops the loop WITHOUT a synchronous setState inside this effect.
    const activeRunMission = activeRunId ? missions.find((m) => m.id === activeRunId) : undefined;
    const effectiveRunId = activeRunMission?.status === "running" ? activeRunId : null;

    useEffect(() => {
        if (!effectiveRunId || runGuard.current) return;
        const missionId = effectiveRunId;
        let cancelled = false;
        runGuard.current = true;
        (async () => {
            try {
                const t = await token();
                if (!t || cancelled) return;
                const { result, mission: updated } = await strategyResearchApi.advance(t, missionId, {
                    runAll: true,
                    maxUnits: 40,
                });
                if (updated) {
                    setMissions((prev) => prev.map((m) => (m.id === missionId ? updated : m)));
                    await refreshMissionDetail(missionId);
                    await refreshCandidates(missionId, 0);
                }
                if (result.completed || !result.didWork) {
                    setActiveRunId(null);
                    setNotice({
                        level: result.status === "failed" ? "error" : "info",
                        text: result.message,
                    });
                }
            } catch (err) {
                setActiveRunId(null);
                setNotice({ level: "error", text: err instanceof Error ? err.message : "Research run failed." });
            } finally {
                runGuard.current = false;
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effectiveRunId, missions]);

    // ── Actions ──────────────────────────────────────────────────────────────

    const createMission = async () => {
        setBusy("create");
        setNotice(null);
        try {
            const t = await token();
            if (!t) throw new Error("Sign in required.");
            const spec: Partial<ResearchMissionSpec> = {
                markets: builder.markets,
                timeframes: builder.timeframes,
                tradingStyle: builder.tradingStyle,
                concepts: builder.concepts,
                sessions: builder.sessions,
                direction: builder.direction,
                riskProfile: builder.riskProfile,
                historicalPeriod: builder.historicalPeriod,
                maxCandidates: builder.maxCandidates,
                requireOOS: builder.requireOOS,
                requireWalkForward: builder.requireWalkForward,
                requireMonteCarlo: builder.requireMonteCarlo,
                forwardTesting: builder.forwardTesting,
                budget: {
                    maxHypotheses: builder.maxCandidates,
                    maxBacktests: builder.maxBacktests,
                    maxAIRequests: builder.maxAIRequests,
                    maxDurationMs: builder.maxDurationMinutes * 60_000,
                },
                executionEnabled: false,
            };
            const { mission } = await strategyResearchApi.createMission(t, { name: builder.name, spec });
            setMissions((prev) => [mission, ...prev]);
            setSelectedId(mission.id);
            setBuilderOpen(false);
            setNotice({ level: "info", text: `Mission "${mission.name}" created — pipeline queued.` });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Mission creation failed.";
            if (message.toLowerCase().includes("subscription") || message.toLowerCase().includes("license")) {
                setAccess({ kind: "locked", reason: message });
            } else {
                setNotice({ level: "error", text: message });
            }
        } finally {
            setBusy(null);
        }
    };

    const control = async (missionId: string, action: "pause" | "resume" | "cancel") => {
        setBusy(`${action}:${missionId}`);
        try {
            const t = await token();
            if (!t) throw new Error("Sign in required.");
            const { mission } = await strategyResearchApi.controlMission(t, missionId, action);
            setMissions((prev) => prev.map((m) => (m.id === missionId ? mission : m)));
            if (action !== "pause") setActiveRunId(null);
            setNotice({ level: "info", text: `Mission ${action}d.` });
        } catch (err) {
            setNotice({ level: "error", text: err instanceof Error ? err.message : "Action failed." });
        } finally {
            setBusy(null);
        }
    };

    const removeMission = async (missionId: string) => {
        setBusy(`delete:${missionId}`);
        try {
            const t = await token();
            if (!t) throw new Error("Sign in required.");
            await strategyResearchApi.deleteMission(t, missionId);
            setMissions((prev) => prev.filter((m) => m.id !== missionId));
            setSelectedId((prev) => (prev === missionId ? null : prev));
            setNotice({ level: "info", text: "Mission deleted." });
        } catch (err) {
            setNotice({ level: "error", text: err instanceof Error ? err.message : "Delete failed." });
        } finally {
            setBusy(null);
        }
    };

    const runMission = (missionId: string) => {
        setNotice(null);
        setActiveRunId(missionId);
    };

    // ── Render guards ────────────────────────────────────────────────────────

    const selected = missions.find((m) => m.id === selectedId) ?? null;

    const lockedView = (reason: string) => (
        <div className="rounded-lg border border-border/30 bg-card/40 p-10">
            <EmptyState
                icon={<Lock className="h-5 w-5" />}
                title="Strategy Research is a Pro feature"
                description={reason}
                action={
                    <div className="flex items-center gap-2">
                        <a href="/account/subscribe">
                            <Button variant="default" size="sm">Upgrade</Button>
                        </a>
                        <a href="/strategy-lab">
                            <Button variant="outline" size="sm">Open Strategy Lab</Button>
                        </a>
                    </div>
                }
            />
        </div>
    );

    return (
        <AppShell
            navGroups={navGroups}
            title="Strategy Research"
            subtitle="Autonomous hypothesis → validation pipeline · Research only · Execution disabled"
            maxWidth="max-w-[1600px]"
        >
            <div className="space-y-6">
                {notice ? (
                    <div
                        className={`rounded-lg border px-4 py-3 text-sm ${
                            notice.level === "error"
                                ? "border-destructive/40 bg-destructive/10 text-destructive"
                                : "border-border bg-card text-foreground"
                        }`}
                    >
                        {notice.text}
                    </div>
                ) : null}

                {access.kind === "loading" ? (
                    <div className="rounded-lg border border-border/30 bg-card/40 p-10 text-center text-sm text-muted-foreground">
                        Checking research access…
                    </div>
                ) : access.kind === "signed_out" ? (
                    <EmptyState
                        icon={<Lock className="h-5 w-5" />}
                        title="Sign in to run strategy research"
                        description="Strategy Research runs autonomous missions in your workspace."
                        action={
                            <a href="/login?redirect=/strategy-research">
                                <Button variant="default" size="sm">Sign In</Button>
                            </a>
                        }
                    />
                ) : access.kind === "locked" ? (
                    lockedView(access.reason)
                ) : (
                    <>
                        {/* ── AA. Performance Arena · challenge-rule compatibility ── */}
                        <CompatibilityPanel />

                        {/* ── A. Research Mission Builder ─────────────────────── */}
                        <section className="rounded-lg border border-border/30 bg-card/40">
                            <div className="flex items-center justify-between px-5 py-4">
                                <div className="flex items-center gap-2">
                                    <Beaker className="h-4 w-4 text-primary" />
                                    <h2 className="text-sm font-semibold">Research Mission Builder</h2>
                                    <Badge variant="outline">Pro</Badge>
                                </div>
                                <Button
                                    variant={builderOpen ? "ghost" : "default"}
                                    size="sm"
                                    onClick={() => setBuilderOpen((v) => !v)}
                                >
                                    {builderOpen ? "Hide" : <><Plus className="mr-1 h-3.5 w-3.5" /> New Mission</>}
                                </Button>
                            </div>

                            {builderOpen ? (
                                <div className="border-t border-border/30 px-5 py-5 space-y-5">
                                    <div className="grid gap-4 md:grid-cols-3">
                                        <label className="block text-xs text-muted-foreground">
                                            Mission name
                                            <input
                                                value={builder.name}
                                                onChange={(e) => setBuilder((b) => ({ ...b, name: e.target.value }))}
                                                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                                                maxLength={80}
                                            />
                                        </label>
                                        <label className="block text-xs text-muted-foreground">
                                            Trading style
                                            <select
                                                value={builder.tradingStyle}
                                                onChange={(e) => setBuilder((b) => ({ ...b, tradingStyle: e.target.value as ResearchTradingStyle }))}
                                                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                                            >
                                                {RESEARCH_TRADING_STYLES.map((s) => (
                                                    <option key={s} value={s}>{s}</option>
                                                ))}
                                            </select>
                                        </label>
                                        <label className="block text-xs text-muted-foreground">
                                            Risk profile
                                            <select
                                                value={builder.riskProfile}
                                                onChange={(e) => setBuilder((b) => ({ ...b, riskProfile: e.target.value as ResearchRiskProfile }))}
                                                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                                            >
                                                {RESEARCH_RISK_PROFILES.map((r) => (
                                                    <option key={r} value={r}>{r}</option>
                                                ))}
                                            </select>
                                        </label>
                                    </div>

                                    <div>
                                        <div className="mb-2 text-xs font-medium text-foreground">Markets (max 3)</div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {SUPPORTED_SYMBOLS.map((s) => (
                                                <Chip
                                                    key={s}
                                                    active={builder.markets.includes(s)}
                                                    disabled={!builder.markets.includes(s) && builder.markets.length >= 3}
                                                    onClick={() => setBuilder((b) => ({ ...b, markets: toggle(b.markets, s) }))}
                                                >
                                                    {s}
                                                </Chip>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="grid gap-4 md:grid-cols-2">
                                        <div>
                                            <div className="mb-2 text-xs font-medium text-foreground">Timeframes</div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {TIMEFRAMES.map((tf) => (
                                                    <Chip
                                                        key={tf}
                                                        active={builder.timeframes.includes(tf)}
                                                        disabled={!builder.timeframes.includes(tf) && builder.timeframes.length >= 4}
                                                        onClick={() => setBuilder((b) => ({ ...b, timeframes: toggle(b.timeframes, tf) }))}
                                                    >
                                                        {tf}
                                                    </Chip>
                                                ))}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="mb-2 text-xs font-medium text-foreground">Sessions</div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {RESEARCH_SESSIONS.map((s) => (
                                                    <Chip
                                                        key={s}
                                                        active={builder.sessions.includes(s)}
                                                        onClick={() => setBuilder((b) => ({ ...b, sessions: toggle(b.sessions, s) }))}
                                                    >
                                                        {s}
                                                    </Chip>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <div className="mb-2 text-xs font-medium text-foreground">Concepts (max 6)</div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {RESEARCH_CONCEPTS.map((c) => (
                                                <Chip
                                                    key={c}
                                                    active={builder.concepts.includes(c)}
                                                    disabled={!builder.concepts.includes(c) && builder.concepts.length >= 6}
                                                    onClick={() => setBuilder((b) => ({ ...b, concepts: toggle(b.concepts, c) }))}
                                                >
                                                    {c.replace(/_/g, " ")}
                                                </Chip>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="grid gap-4 md:grid-cols-4">
                                        <label className="block text-xs text-muted-foreground">
                                            Direction
                                            <select
                                                value={builder.direction}
                                                onChange={(e) => setBuilder((b) => ({ ...b, direction: e.target.value as BuilderState["direction"] }))}
                                                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                                            >
                                                <option value="both">both</option>
                                                <option value="long">long</option>
                                                <option value="short">short</option>
                                            </select>
                                        </label>
                                        <label className="block text-xs text-muted-foreground">
                                            Historical range
                                            <select
                                                value={builder.historicalPeriod}
                                                onChange={(e) => setBuilder((b) => ({ ...b, historicalPeriod: e.target.value as BuilderState["historicalPeriod"] }))}
                                                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                                            >
                                                {RESEARCH_PERIODS.map((p) => (
                                                    <option key={p} value={p}>{p}</option>
                                                ))}
                                            </select>
                                        </label>
                                        <label className="block text-xs text-muted-foreground">
                                            Max candidates
                                            <input
                                                type="number"
                                                min={1}
                                                max={24}
                                                value={builder.maxCandidates}
                                                onChange={(e) => setBuilder((b) => ({ ...b, maxCandidates: Math.max(1, Math.min(24, Number(e.target.value) || 1)) }))}
                                                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                                            />
                                        </label>
                                        <label className="block text-xs text-muted-foreground">
                                            Max AI requests
                                            <input
                                                type="number"
                                                min={0}
                                                max={50}
                                                value={builder.maxAIRequests}
                                                onChange={(e) => setBuilder((b) => ({ ...b, maxAIRequests: Math.max(0, Math.min(50, Number(e.target.value) || 0)) }))}
                                                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                                            />
                                        </label>
                                        <label className="block text-xs text-muted-foreground">
                                            Max backtests
                                            <input
                                                type="number"
                                                min={10}
                                                max={1200}
                                                value={builder.maxBacktests}
                                                onChange={(e) => setBuilder((b) => ({ ...b, maxBacktests: Math.max(10, Math.min(1200, Number(e.target.value) || 10)) }))}
                                                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                                            />
                                        </label>
                                        <label className="block text-xs text-muted-foreground">
                                            Duration budget (min)
                                            <input
                                                type="number"
                                                min={1}
                                                max={240}
                                                value={builder.maxDurationMinutes}
                                                onChange={(e) => setBuilder((b) => ({ ...b, maxDurationMinutes: Math.max(1, Math.min(240, Number(e.target.value) || 1)) }))}
                                                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                                            />
                                        </label>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-4 text-xs">
                                        {(
                                            [
                                                ["requireOOS", "Require OOS"],
                                                ["requireWalkForward", "Require Walk-Forward"],
                                                ["requireMonteCarlo", "Require Monte Carlo"],
                                                ["forwardTesting", "Forward testing (signal-only)"],
                                            ] as const
                                        ).map(([key, label]) => (
                                            <label key={key} className="flex cursor-pointer items-center gap-2 text-muted-foreground">
                                                <input
                                                    type="checkbox"
                                                    checked={builder[key]}
                                                    onChange={(e) => setBuilder((b) => ({ ...b, [key]: e.target.checked }))}
                                                    className="h-3.5 w-3.5 accent-primary"
                                                />
                                                {label}
                                            </label>
                                        ))}
                                        <span className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-muted-foreground">
                                            <Square className="h-3 w-3 text-positive" /> executionEnabled = false (always)
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-3">
                                        <Button size="sm" onClick={createMission} disabled={busy === "create"}>
                                            {busy === "create" ? "Creating…" : <><Plus className="mr-1 h-3.5 w-3.5" /> Create Mission</>}
                                        </Button>
                                        <span className="text-xs text-muted-foreground">
                                            AI proposes hypotheses; deterministic engines test them.
                                        </span>
                                    </div>
                                </div>
                            ) : null}
                        </section>

                        {/* ── B. Research Command Center ─────────────────────── */}
                        <section className="rounded-lg border border-border/30 bg-card/40">
                            <div className="flex items-center justify-between px-5 py-4">
                                <div className="flex items-center gap-2">
                                    <Activity className="h-4 w-4 text-primary" />
                                    <h2 className="text-sm font-semibold">Research Command Center</h2>
                                    <Badge variant="outline">{missions.length} missions</Badge>
                                </div>
                                <Button variant="outline" size="xs" onClick={() => refreshMissions()}>
                                    <RotateCcw className="mr-1 h-3 w-3" /> Refresh
                                </Button>
                            </div>

                            {missions.length === 0 ? (
                                <div className="border-t border-border/30 px-5 py-6">
                                    <EmptyState
                                        compact
                                        icon={<FlaskConical className="h-4 w-4" />}
                                        title="No research missions yet"
                                        description="Create a mission to generate hypotheses and validate candidates through OOS, walk-forward and Monte Carlo stages."
                                    />
                                </div>
                            ) : (
                                <div className="space-y-3 border-t border-border/30 px-5 py-4">
                                    {missions.map((mission) => {
                                        return (
                                            <div
                                                key={mission.id}
                                                className={`rounded-lg border p-4 transition-colors ${
                                                    selectedId === mission.id
                                                        ? "border-primary/50 bg-primary/5"
                                                        : "border-border/40 bg-background"
                                                }`}
                                            >
                                                <div className="flex flex-wrap items-center justify-between gap-3">
                                                    <button
                                                        className="flex items-center gap-2 text-left"
                                                        onClick={() => setSelectedId(mission.id)}
                                                    >
                                                        <span className="text-sm font-semibold">{mission.name}</span>
                                                        <StatusBadge
                                                            label={mission.status}
                                                            tone={
                                                                mission.status === "completed"
                                                                    ? "positive"
                                                                    : mission.status === "failed"
                                                                        ? "negative"
                                                                        : mission.status === "running"
                                                                            ? "info"
                                                                            : "warning"
                                                            }
                                                            dot
                                                        />
                                                        {mission.failState ? (
                                                            <Badge variant="outline" className="text-destructive">
                                                                {mission.failState}
                                                            </Badge>
                                                        ) : null}
                                                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                                    </button>
                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                        {mission.status === "running" ? (
                                                            <>
                                                                <Button
                                                                    size="xs"
                                                                    disabled={busy !== null || activeRunId === mission.id}
                                                                    onClick={() => runMission(mission.id)}
                                                                >
                                                                    <Play className="mr-1 h-3 w-3" />
                                                                    {activeRunId === mission.id ? "Running…" : "Run research"}
                                                                </Button>
                                                                <Button
                                                                    size="xs"
                                                                    variant="outline"
                                                                    disabled={busy !== null}
                                                                    onClick={() => control(mission.id, "pause")}
                                                                >
                                                                    <Pause className="mr-1 h-3 w-3" /> Pause
                                                                </Button>
                                                                <Button
                                                                    size="xs"
                                                                    variant="destructive"
                                                                    disabled={busy !== null}
                                                                    onClick={() => control(mission.id, "cancel")}
                                                                >
                                                                    <Square className="mr-1 h-3 w-3" /> Cancel
                                                                </Button>
                                                            </>
                                                        ) : mission.status === "paused" || mission.status === "failed" ? (
                                                            <>
                                                                <Button
                                                                    size="xs"
                                                                    variant="outline"
                                                                    disabled={busy !== null}
                                                                    onClick={() => control(mission.id, "resume").then(() => runMission(mission.id))}
                                                                >
                                                                    <Play className="mr-1 h-3 w-3" /> Resume
                                                                </Button>
                                                                <Button
                                                                    size="xs"
                                                                    variant="destructive"
                                                                    disabled={busy !== null}
                                                                    onClick={() => control(mission.id, "cancel")}
                                                                >
                                                                    <Square className="mr-1 h-3 w-3" /> Cancel
                                                                </Button>
                                                            </>
                                                        ) : (
                                                            <Button
                                                                size="xs"
                                                                variant="ghost"
                                                                disabled={busy !== null}
                                                                onClick={() => removeMission(mission.id)}
                                                            >
                                                                <Trash2 className="h-3 w-3" />
                                                            </Button>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Stage pipeline */}
                                                <div className="mt-3 flex flex-wrap items-center gap-1">
                                                    {MISSION_STAGES.map((stage) => {
                                                        const state = mission.stages.find((s) => s.stage === stage);
                                                        const status = state?.status ?? "pending";
                                                        return (
                                                            <span
                                                                key={stage}
                                                                title={`${STAGE_LABELS[stage]} — ${status}${state?.error ? ` (${state.error})` : ""}`}
                                                                className={`rounded-md border px-2 py-0.5 text-micro ${
                                                                    status === "completed"
                                                                        ? "border-positive/40 bg-positive/10 text-positive"
                                                                        : status === "running"
                                                                            ? "border-primary/50 bg-primary/10 text-primary"
                                                                            : status === "failed"
                                                                                ? "border-destructive/50 bg-destructive/10 text-destructive"
                                                                                : status === "skipped"
                                                                                    ? "border-border text-muted-foreground/50 line-through"
                                                                                    : "border-border/60 text-muted-foreground"
                                                                }`}
                                                            >
                                                                {STAGE_LABELS[stage]}
                                                            </span>
                                                        );
                                                    })}
                                                </div>

                                                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-micro text-muted-foreground">
                                                    <span>{mission.spec.markets.join(", ")} · {mission.spec.timeframes.join("/")} · {mission.spec.tradingStyle}</span>
                                                    <span>Hypotheses: {mission.hypothesisCount}</span>
                                                    <span>Candidates: {mission.compiledCount}</span>
                                                    <span>Rejected: {mission.rejectedCount}</span>
                                                    <span>Incubating: {mission.survivorCount}</span>
                                                    <span>AI calls: {mission.budgetUsed?.aiRequests ?? 0}/{mission.spec.budget.maxAIRequests}</span>
                                                    <span>Backtests: {mission.budgetUsed?.backtests ?? 0}/{mission.spec.budget.maxBacktests}</span>
                                                    {mission.dataQuality ? (
                                                        <span className={mission.dataQuality.sufficient ? "" : "text-destructive"}>
                                                            Data: {mission.dataQuality.sufficient ? "sufficient" : "insufficient"}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </section>

                        {/* ── C. Candidate Explorer + E. Research Logs ──────── */}
                        <div className="grid gap-6 lg:grid-cols-5">
                            <section className="rounded-lg border border-border/30 bg-card/40 lg:col-span-3">
                                <div className="flex items-center justify-between px-5 py-4">
                                    <div className="flex items-center gap-2">
                                        <FlaskConical className="h-4 w-4 text-primary" />
                                        <h2 className="text-sm font-semibold">Candidate Explorer</h2>
                                        {selected ? <Badge variant="outline">{candidateTotal} candidates</Badge> : null}
                                    </div>
                                    {selected && candidateTotal > 20 ? (
                                        <div className="flex items-center gap-1 text-xs">
                                            <Button
                                                size="xs"
                                                variant="outline"
                                                disabled={candidateOffset === 0}
                                                onClick={() => refreshCandidates(selected.id, Math.max(0, candidateOffset - 20))}
                                            >
                                                Prev
                                            </Button>
                                            <span className="px-1 text-muted-foreground">
                                                {candidateOffset + 1}–{Math.min(candidateOffset + 20, candidateTotal)}
                                            </span>
                                            <Button
                                                size="xs"
                                                variant="outline"
                                                disabled={candidateOffset + 20 >= candidateTotal}
                                                onClick={() => refreshCandidates(selected.id, candidateOffset + 20)}
                                            >
                                                Next
                                            </Button>
                                        </div>
                                    ) : null}
                                </div>

                                {!selected ? (
                                    <div className="border-t border-border/30 px-5 py-6">
                                        <EmptyState
                                            compact
                                            icon={<Beaker className="h-4 w-4" />}
                                            title="Select a mission"
                                            description="Pick a mission above to explore its candidates."
                                        />
                                    </div>
                                ) : candidates.length === 0 ? (
                                    <div className="border-t border-border/30 px-5 py-6">
                                        <EmptyState
                                            compact
                                            icon={<Beaker className="h-4 w-4" />}
                                            title="No candidates yet"
                                            description="Run the mission to generate hypotheses and compile candidates."
                                        />
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto border-t border-border/30">
                                        <table className="w-full text-left text-xs">
                                            <thead>
                                                <tr className="border-b border-border/30 text-muted-foreground">
                                                    <th className="px-4 py-2 font-medium">Candidate</th>
                                                    <th className="px-2 py-2 font-medium">Lifecycle</th>
                                                    <th className="px-2 py-2 font-medium">Backtest</th>
                                                    <th className="px-2 py-2 font-medium">OOS</th>
                                                    <th className="px-2 py-2 font-medium">WF</th>
                                                    <th className="px-2 py-2 font-medium">MC</th>
                                                    <th className="px-2 py-2 font-medium">Score</th>
                                                    <th className="px-2 py-2 font-medium">Warnings</th>
                                                    <th className="px-4 py-2" />
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {candidates.map((c) => (
                                                    <tr key={c.id} className="border-b border-border/20 hover:bg-muted/30">
                                                        <td className="px-4 py-2">
                                                            <div className="max-w-[220px] truncate font-medium">{c.name}</div>
                                                            <div className="text-micro text-muted-foreground">
                                                                {c.market} · {c.timeframe ?? "—"} · {c.direction} · {c.source}
                                                            </div>
                                                        </td>
                                                        <td className="px-2 py-2">
                                                            <StatusBadge
                                                                label={LIFECYCLE_LABELS[c.lifecycle] ?? c.lifecycle}
                                                                tone={LIFECYCLE_TONE[c.lifecycle] ?? "info"}
                                                            />
                                                            {c.rejectedReason ? (
                                                                <div className="mt-0.5 text-micro text-destructive">{c.rejectedReason}</div>
                                                            ) : null}
                                                            {c.linkedTo ? (
                                                                <div className="mt-0.5 text-micro text-muted-foreground">linked duplicate</div>
                                                            ) : null}
                                                        </td>
                                                        <td className="px-2 py-2 text-muted-foreground">
                                                            {c.backtest
                                                                ? `${c.backtest.totalTrades}T · PF ${c.backtest.profitFactor.toFixed(2)}`
                                                                : "—"}
                                                        </td>
                                                        <td className="px-2 py-2">
                                                            {c.outOfSample ? (
                                                                <span
                                                                    className={
                                                                        c.outOfSample.verdict === "robust"
                                                                            ? "text-positive"
                                                                            : c.outOfSample.verdict === "fragile"
                                                                                ? "text-destructive"
                                                                                : "text-warning"
                                                                    }
                                                                >
                                                                    {c.outOfSample.verdict}
                                                                </span>
                                                            ) : (
                                                                <span className="text-muted-foreground">—</span>
                                                            )}
                                                        </td>
                                                        <td className="px-2 py-2 text-muted-foreground">
                                                            {c.walkForward?.enabled
                                                                ? `${c.walkForward.windows}w ${c.walkForward.stable ? "✓" : "✗"}`
                                                                : "—"}
                                                        </td>
                                                        <td className="px-2 py-2 text-muted-foreground">
                                                            {c.monteCarlo?.simulations
                                                                ? `${c.monteCarlo.simulations}`
                                                                : "—"}
                                                        </td>
                                                        <td className="px-2 py-2">
                                                            {c.score ? (
                                                                <span className="font-medium">{c.score.total}</span>
                                                            ) : (
                                                                <span className="text-muted-foreground">—</span>
                                                            )}
                                                        </td>
                                                        <td className="px-2 py-2">
                                                            {c.warnings.length > 0 ? (
                                                                <span className="inline-flex items-center gap-1 text-warning">
                                                                    <AlertTriangle className="h-3 w-3" />
                                                                    {c.warnings.length}
                                                                </span>
                                                            ) : (
                                                                <span className="text-muted-foreground">0</span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-2 text-right">
                                                            <Link
                                                                href={`/strategy-research/${c.missionId}/${c.id}`}
                                                                className="inline-flex items-center gap-1 text-primary hover:underline"
                                                            >
                                                                Detail <ChevronRight className="h-3 w-3" />
                                                            </Link>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </section>

                            {/* ── E. Research Logs ───────────────────────────── */}
                            <section className="rounded-lg border border-border/30 bg-card/40 lg:col-span-2">
                                <div className="flex items-center gap-2 px-5 py-4">
                                    <ScrollText className="h-4 w-4 text-primary" />
                                    <h2 className="text-sm font-semibold">Research Logs</h2>
                                    {selected ? <Badge variant="outline">{events.length} events</Badge> : null}
                                </div>
                                <div className="max-h-[420px] overflow-y-auto border-t border-border/30 px-4 py-3">
                                    {events.length === 0 ? (
                                        <p className="py-6 text-center text-xs text-muted-foreground">
                                            No research events yet. Select a mission and run it.
                                        </p>
                                    ) : (
                                        <ul className="space-y-1.5">
                                            {[...events].reverse().map((e) => (
                                                <li key={e.id} className="rounded-md border border-border/30 bg-background px-3 py-2 text-micro">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span
                                                            className={
                                                                e.level === "error"
                                                                    ? "font-medium text-destructive"
                                                                    : e.level === "warn"
                                                                        ? "font-medium text-warning"
                                                                        : "font-medium text-foreground"
                                                            }
                                                        >
                                                            {e.code ? <span className="mr-1.5 text-muted-foreground">{e.code}</span> : null}
                                                            {e.message}
                                                        </span>
                                                        <span className="shrink-0 text-muted-foreground">
                                                            {new Date(e.at).toLocaleTimeString()}
                                                        </span>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </section>
                        </div>

                        <p className="flex items-center gap-2 px-1 text-micro text-muted-foreground">
                            <Zap className="h-3 w-3" />
                            Research ranking aid only — not investment advice. Live broker execution stays disabled;
                            survivors incubate in the Strategy Lab under existing risk and execution controls.
                        </p>
                    </>
                )}
            </div>
        </AppShell>
    );
}
