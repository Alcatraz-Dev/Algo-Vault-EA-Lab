"use client";

/**
 * BotPanel — Bot Studio inside the Trading Terminal.
 *
 * Presentation only. Every number comes from the persisted bot report
 * (`GET /api/bot-studio/scalping/bots/{id}`) or the deployment record. The
 * panel never submits an order itself: start/pause/stop use the existing
 * lifecycle state machine and "Evaluate bar" calls the existing per-bot tick
 * route, which runs the AI Execution Gate and Unified Trading Service.
 *
 * Directional truth: LONG and SHORT are rendered as independent lanes with
 * their own positions, signals and blocks. A lane is never shown as active
 * unless the persisted state supports it; netting/unknown accounts explain
 * why independent opposing positions are restricted.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
    AlertTriangle,
    Bot,
    ChevronDown,
    Inbox,
    Info,
    Loader2,
    Lock,
    Pause,
    Play,
    Plus,
    RefreshCw,
    Save,
    ShieldCheck,
    Square,
    Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { BotDeployment, BotExecution } from "@/lib/bot-studio/types";
import type { LaneReport, ScalpingBotReport } from "@/lib/bot-studio/scalping/report";
import { SUPPORTED_SYMBOLS } from "@/lib/market-data/types";
import {
    SCALPING_ALLOWED_TIMEFRAMES,
    SCALPING_LIMITS,
    SCALPING_PRESETS,
    defaultScalpingConfig,
    type ScalpingBotConfig,
    type ScalpingDirectionMode,
    type ScalpingPresetId,
    type ScalpingSession,
} from "@/lib/bot-studio/scalping";
import { formatVolume, laneStatusLabel, positionModeSummary } from "@/lib/bot-studio/scalping/presentation";
import { useTerminal, useTerminalClock } from "./TerminalContext";
import { useTerminalData } from "./TerminalData";
import { PanelErrorBoundary } from "./PanelErrorBoundary";

interface BotSummary {
    deployment: BotDeployment;
    strategy: {
        id: string;
        name: string;
        symbol: string;
        timeframe: string;
        direction: string | null;
        preset: string | null;
        magicNumber: number;
    };
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function callApi<T>(path: string, token: string, init?: RequestInit): Promise<ApiResult<T>> {
    try {
        const res = await fetch(path, {
            ...init,
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                ...(init?.headers ?? {}),
            },
            cache: "no-store",
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.ok) {
            return { ok: false, error: body?.error ?? `Request failed (HTTP ${res.status}).` };
        }
        return { ok: true, data: body as T };
    } catch {
        return { ok: false, error: "Network error — the request did not complete." };
    }
}

const TIMEFRAMES: ScalpingBotConfig["timeframe"][] = [...SCALPING_ALLOWED_TIMEFRAMES];
const SESSIONS: ScalpingSession[] = ["asian", "london", "new_york", "overlap"];

const STATE_TONE: Record<string, string> = {
    running: "border-positive/40 bg-positive/10 text-positive",
    starting: "border-warning/40 bg-warning/10 text-warning",
    paused: "border-warning/40 bg-warning/10 text-warning",
    pausing: "border-warning/40 bg-warning/10 text-warning",
    stopped: "border-border bg-muted text-muted-foreground",
    ready: "border-border bg-muted text-muted-foreground",
    error: "border-negative/50 bg-negative/10 text-negative",
};

function stamp(value: number | null | undefined): string {
    if (!value) return "never";
    return new Date(value).toLocaleString("en-GB", { hour12: false });
}

function money(value: number | null | undefined, available = true): string {
    if (!available || value === null || value === undefined || !Number.isFinite(value)) return "unavailable";
    return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function count(value: number | null | undefined, available = true): string {
    return !available || value === null || value === undefined || !Number.isFinite(value)
        ? "unavailable"
        : String(value);
}

function pct(value: number | null | undefined, available = true): string {
    return !available || value === null || value === undefined || !Number.isFinite(value)
        ? "unavailable"
        : `${(value * 100).toFixed(1)}%`;
}

function directionLabel(direction: string | null | undefined): string {
    switch (direction) {
        case "both":
            return "LONG + SHORT";
        case "long_only":
            return "LONG only";
        case "short_only":
            return "SHORT only";
        default:
            return "direction unavailable";
    }
}

function directionShort(direction: string | null | undefined): string {
    switch (direction) {
        case "both":
            return "L + S";
        case "long_only":
            return "L";
        case "short_only":
            return "S";
        default:
            return "—";
    }
}

/** UI-level validity only. The server clamps and re-validates every value. */
function configIssues(config: ScalpingBotConfig): string[] {
    const issues: string[] = [];
    if (
        !Number.isFinite(config.riskPerTradePercent) ||
        config.riskPerTradePercent < SCALPING_LIMITS.minRiskPerTradePercent ||
        config.riskPerTradePercent > SCALPING_LIMITS.maxRiskPerTradePercent
    ) {
        issues.push(
            `Risk per trade must be ${SCALPING_LIMITS.minRiskPerTradePercent}–${SCALPING_LIMITS.maxRiskPerTradePercent}%.`,
        );
    }
    if (
        !Number.isFinite(config.minSignalConfidence) ||
        config.minSignalConfidence < SCALPING_LIMITS.minSignalConfidence ||
        config.minSignalConfidence > SCALPING_LIMITS.maxSignalConfidence
    ) {
        issues.push(
            `Minimum confidence must be ${SCALPING_LIMITS.minSignalConfidence}–${SCALPING_LIMITS.maxSignalConfidence}.`,
        );
    }
    if (
        !Number.isFinite(config.stopAtrMultiple) ||
        config.stopAtrMultiple < SCALPING_LIMITS.minStopAtrMultiple ||
        config.stopAtrMultiple > SCALPING_LIMITS.maxStopAtrMultiple
    ) {
        issues.push(
            `Stop distance must be ${SCALPING_LIMITS.minStopAtrMultiple}–${SCALPING_LIMITS.maxStopAtrMultiple}× ATR.`,
        );
    }
    if (
        !Number.isFinite(config.rewardRisk) ||
        config.rewardRisk < SCALPING_LIMITS.minRewardRisk ||
        config.rewardRisk > SCALPING_LIMITS.maxRewardRisk
    ) {
        issues.push(`Reward/risk must be ${SCALPING_LIMITS.minRewardRisk}–${SCALPING_LIMITS.maxRewardRisk}R.`);
    }
    if (
        !Number.isInteger(config.maxTradesPerDay) ||
        config.maxTradesPerDay < SCALPING_LIMITS.minTradesPerDay ||
        config.maxTradesPerDay > SCALPING_LIMITS.maxTradesPerDay
    ) {
        issues.push(
            `Max trades per day must be a whole number between ${SCALPING_LIMITS.minTradesPerDay} and ${SCALPING_LIMITS.maxTradesPerDay}.`,
        );
    }
    if (!Number.isFinite(config.cooldownSeconds) || config.cooldownSeconds < 0 || config.cooldownSeconds > SCALPING_LIMITS.maxCooldownSeconds) {
        issues.push(`Cooldown must be between 0 and ${SCALPING_LIMITS.maxCooldownSeconds} seconds.`);
    }
    if (!Number.isFinite(config.maxSpreadPips) || config.maxSpreadPips < 0 || config.maxSpreadPips > SCALPING_LIMITS.maxSpreadPips) {
        issues.push(`Max spread must be between 0 and ${SCALPING_LIMITS.maxSpreadPips} pips.`);
    }
    if (
        config.dailyNotionalBudget !== null &&
        (!Number.isFinite(config.dailyNotionalBudget) ||
            config.dailyNotionalBudget <= 0 ||
            config.dailyNotionalBudget > SCALPING_LIMITS.maxDailyNotionalBudget)
    ) {
        issues.push(
            `Bot notional cap must be between 0 and ${SCALPING_LIMITS.maxDailyNotionalBudget.toLocaleString("en-US")}, or left blank.`,
        );
    }
    return issues;
}

function Field({
    label,
    hint,
    error,
    children,
}: {
    label: string;
    hint?: string;
    error?: string;
    children: React.ReactNode;
}) {
    return (
        <label className="flex min-w-0 flex-col gap-1">
            <span className="text-micro font-normal uppercase tracking-wide text-muted-foreground">{label}</span>
            {children}
            {error ? (
                <span className="text-micro leading-4 text-negative">{error}</span>
            ) : hint ? (
                <span className="text-micro leading-4 text-muted-foreground">{hint}</span>
            ) : null}
        </label>
    );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
    return (
        <div className="min-w-0 rounded-lg border border-border/60 bg-muted/30 px-2 py-1.5">
            <span className="block text-micro uppercase tracking-wide text-muted-foreground">{label}</span>
            <span
                className={cn(
                    "block truncate font-numeric text-xs font-normal tabular-nums",
                    tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-foreground",
                )}
            >
                {value}
            </span>
        </div>
    );
}

function Skeleton({ className }: { className?: string }) {
    return (
        <div
            className={cn(
                "animate-pulse rounded-md bg-muted motion-reduce:animate-none",
                className,
            )}
        />
    );
}

function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <button
                        type="button"
                        aria-label={label}
                        className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                }
            >
                <Info className="size-3" aria-hidden />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-64 text-micro leading-4">
                {children}
            </TooltipContent>
        </Tooltip>
    );
}

function StatusPill({ status }: { status: LaneReport["status"] }) {
    const tone =
        status === "POSITION_OPEN"
            ? "border-positive/40 bg-positive/10 text-positive"
            : status === "SIGNAL_READY"
              ? "border-primary/40 bg-primary/10 text-primary"
              : status === "BLOCKED"
                ? "border-negative/40 bg-negative/10 text-negative"
                : "border-border bg-muted text-muted-foreground";
    return (
        <span className={cn("rounded border px-1.5 py-0.5 text-micro uppercase tracking-wide", tone)}>
            {laneStatusLabel(status)}
        </span>
    );
}

function OutcomeTag({ outcome }: { outcome: string }) {
    const tone =
        outcome === "executed"
            ? "border-positive/40 bg-positive/10 text-positive"
            : outcome === "rejected"
              ? "border-negative/40 bg-negative/10 text-negative"
              : outcome === "expired"
                ? "border-border bg-muted text-muted-foreground"
                : "border-warning/40 bg-warning/10 text-warning";
    return <span className={cn("rounded border px-1 py-px text-micro lowercase", tone)}>{outcome}</span>;
}

type ConfigTab = "strategy" | "direction" | "sizing" | "risk" | "execution";

const CONFIG_TABS: Array<{ id: ConfigTab; label: string }> = [
    { id: "strategy", label: "Strategy" },
    { id: "direction", label: "Direction" },
    { id: "sizing", label: "Sizing" },
    { id: "risk", label: "Risk" },
    { id: "execution", label: "Execution" },
];

function ConfigEditor({
    config,
    onChange,
    disabled,
    report,
}: {
    config: ScalpingBotConfig;
    onChange: (next: ScalpingBotConfig) => void;
    disabled?: boolean;
    report: ScalpingBotReport | null;
}) {
    const [tab, setTab] = useState<ConfigTab>("strategy");
    const tabRefs = useRef<Partial<Record<ConfigTab, HTMLButtonElement | null>>>({});
    const set = <K extends keyof ScalpingBotConfig>(key: K, value: ScalpingBotConfig[K]) =>
        onChange({ ...config, [key]: value });

    const issues = configIssues(config);
    const mode = report ? positionModeSummary(report.positionMode) : null;
    const spec = report?.sizing.brokerSpec ?? null;

    const focusTab = (next: ConfigTab) => {
        setTab(next);
        tabRefs.current[next]?.focus();
    };

    const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault();
            const delta = event.key === "ArrowRight" ? 1 : -1;
            const next = CONFIG_TABS[(index + delta + CONFIG_TABS.length) % CONFIG_TABS.length];
            focusTab(next.id);
        } else if (event.key === "Home") {
            event.preventDefault();
            focusTab(CONFIG_TABS[0].id);
        } else if (event.key === "End") {
            event.preventDefault();
            focusTab(CONFIG_TABS[CONFIG_TABS.length - 1].id);
        }
    };

    const numberInput = (key: keyof ScalpingBotConfig, step: string, min?: number, max?: number) => (
        <Input
            type="number"
            inputMode="decimal"
            step={step}
            min={min}
            max={max}
            disabled={disabled}
            value={String(config[key] ?? "")}
            onChange={(e) => set(key, Number(e.target.value) as never)}
            className="h-8 text-xs font-numeric"
        />
    );

    return (
        <div className="flex flex-col gap-3">
            {disabled ? (
                <p className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-micro text-warning">
                    <Lock className="mt-px size-3 shrink-0" aria-hidden />
                    This bot is running, so its configuration is locked. Stop or pause it before editing.
                </p>
            ) : null}

            <div
                role="tablist"
                aria-label="Bot configuration sections"
                className="-mx-1 flex gap-0.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]"
            >
                {CONFIG_TABS.map((item, index) => (
                    <button
                        key={item.id}
                        ref={(node) => {
                            tabRefs.current[item.id] = node;
                        }}
                        type="button"
                        role="tab"
                        id={`config-tab-${item.id}`}
                        aria-selected={tab === item.id}
                        aria-controls="config-panel"
                        tabIndex={tab === item.id ? 0 : -1}
                        onClick={() => setTab(item.id)}
                        onKeyDown={(event) => onTabKeyDown(event, index)}
                        className={cn(
                            "shrink-0 rounded-md border px-2 py-1 text-micro transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            tab === item.id
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground",
                        )}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            {issues.length > 0 ? (
                <ul className="flex flex-col gap-0.5 rounded-md border border-negative/30 bg-negative/5 px-2 py-1.5">
                    {issues.map((issue) => (
                        <li key={issue} className="flex items-start gap-1 text-micro leading-4 text-negative">
                            <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                            {issue}
                        </li>
                    ))}
                </ul>
            ) : null}

            <div role="tabpanel" id="config-panel" aria-labelledby={`config-tab-${tab}`}>
                {tab === "strategy" ? (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Field label="Symbol">
                            <Select
                                className="h-8 text-xs"
                                value={config.symbol}
                                disabled={disabled}
                                onChange={(e) => set("symbol", e.target.value as ScalpingBotConfig["symbol"])}
                            >
                                {SUPPORTED_SYMBOLS.map((symbol) => (
                                    <option key={symbol} value={symbol}>
                                        {symbol}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label="Timeframe">
                            <Select
                                className="h-8 text-xs"
                                value={config.timeframe}
                                disabled={disabled}
                                onChange={(e) => set("timeframe", e.target.value as ScalpingBotConfig["timeframe"])}
                            >
                                {TIMEFRAMES.map((tf) => (
                                    <option key={tf} value={tf}>
                                        {tf}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label="Preset" hint="Presets seed the values; every field stays editable.">
                            <Select
                                className="h-8 text-xs"
                                value={config.preset}
                                disabled={disabled}
                                onChange={(e) => {
                                    const preset = e.target.value as ScalpingPresetId;
                                    onChange({
                                        ...defaultScalpingConfig(preset, config.symbol),
                                        direction: config.direction,
                                    });
                                }}
                            >
                                {SCALPING_PRESETS.map((preset) => (
                                    <option key={preset.id} value={preset.id}>
                                        {preset.label}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label="Positions / direction" hint="Platform ceiling: 1 per instrument per direction.">
                            <Input value="1" readOnly disabled className="h-8 text-xs font-numeric" />
                        </Field>
                    </div>
                ) : null}

                {tab === "direction" ? (
                    <div className="flex flex-col gap-2">
                        <div role="radiogroup" aria-label="Directional behavior" className="grid gap-1.5 sm:grid-cols-3">
                            {(
                                [
                                    { id: "both", label: "LONG + SHORT", hint: "Both lanes enabled — default" },
                                    { id: "long_only", label: "LONG only", hint: "Short lane disabled" },
                                    { id: "short_only", label: "SHORT only", hint: "Long lane disabled" },
                                ] as Array<{ id: ScalpingDirectionMode; label: string; hint: string }>
                            ).map((option) => (
                                <button
                                    key={option.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={config.direction === option.id}
                                    disabled={disabled}
                                    onClick={() => set("direction", option.id)}
                                    className={cn(
                                        "rounded-lg border px-2.5 py-2 text-left transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
                                        config.direction === option.id
                                            ? "border-primary/40 bg-primary/10"
                                            : "border-border hover:bg-muted",
                                    )}
                                >
                                    <span className="block text-xs font-medium text-foreground">{option.label}</span>
                                    <span className="block text-micro text-muted-foreground">{option.hint}</span>
                                </button>
                            ))}
                        </div>
                        <div className="rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2">
                            <p className="flex items-center gap-1 text-micro font-medium text-foreground">
                                {mode ? mode.label : "Account position mode"}
                                {mode ? <InfoTip label="What this account mode means">{mode.restriction}</InfoTip> : null}
                            </p>
                            <p className="mt-0.5 text-micro leading-4 text-muted-foreground">
                                {mode
                                    ? mode.restriction
                                    : "Verified from MT5 metadata when the gateway connects. Independent opposing positions are never claimed without it."}
                            </p>
                        </div>
                    </div>
                ) : null}

                {tab === "sizing" ? (
                    <div className="flex flex-col gap-2">
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <Field
                                label="Risk % / trade"
                                hint={`Enforced ceiling: ${SCALPING_LIMITS.maxRiskPerTradePercent}%.`}
                                error={issues.find((i) => i.startsWith("Risk per trade"))}
                            >
                                {numberInput(
                                    "riskPerTradePercent",
                                    "0.05",
                                    SCALPING_LIMITS.minRiskPerTradePercent,
                                    SCALPING_LIMITS.maxRiskPerTradePercent,
                                )}
                            </Field>
                        </div>
                        <div className="rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2">
                            <p className="flex items-center gap-1 text-micro font-medium uppercase tracking-wide text-muted-foreground">
                                Position sizing
                                <InfoTip label="How the bot sizes a position">
                                    Final volume is computed and validated by the canonical server risk engine at
                                    execution. The UI never computes a lot size.
                                </InfoTip>
                            </p>
                            <p className="mt-1 text-xs text-foreground">Risk-based lot — enforced by the server.</p>
                            <p className="mt-1 text-micro leading-4 text-muted-foreground">
                                {spec?.available
                                    ? `Broker constraints: min ${spec.minVolume} · max ${spec.maxVolume ?? "—"} · step ${spec.volumeStep}${spec.currency ? ` · ${spec.currency}` : ""}.`
                                    : spec?.reason ??
                                      "Volume constraints are read from the connected MT5 account. Final volume is computed and validated server-side at execution."}
                            </p>
                            {report ? <p className="mt-1 text-micro leading-4 text-muted-foreground">{report.sizing.note}</p> : null}
                        </div>
                        <div className="rounded-lg border border-dashed border-border px-2.5 py-2">
                            <p className="text-micro font-medium uppercase tracking-wide text-muted-foreground">
                                Fixed lot — unavailable
                            </p>
                            <p className="mt-1 text-micro leading-4 text-muted-foreground">
                                The backend sizes every entry from risk and validates the final volume server-side. No
                                fixed-lot control is exposed because the runtime does not enforce one.
                            </p>
                            <p className="mt-1 text-micro leading-4 text-muted-foreground">
                                {spec?.volumeStep
                                    ? `Lot volumes are displayed with the broker's step precision (e.g. ${formatVolume(0.1, spec.volumeStep)}).`
                                    : "Lot presets stay disabled until the broker reports a minimum volume and step."}
                            </p>
                        </div>
                    </div>
                ) : null}

                {tab === "risk" ? (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Field label="Stop (×ATR)" error={issues.find((i) => i.startsWith("Stop distance"))}>
                            {numberInput(
                                "stopAtrMultiple",
                                "0.1",
                                SCALPING_LIMITS.minStopAtrMultiple,
                                SCALPING_LIMITS.maxStopAtrMultiple,
                            )}
                        </Field>
                        <Field label="Target (R)" error={issues.find((i) => i.startsWith("Reward/risk"))}>
                            {numberInput("rewardRisk", "0.1", SCALPING_LIMITS.minRewardRisk, SCALPING_LIMITS.maxRewardRisk)}
                        </Field>
                        <Field label="Max trades / day" error={issues.find((i) => i.startsWith("Max trades"))}>
                            {numberInput(
                                "maxTradesPerDay",
                                "1",
                                SCALPING_LIMITS.minTradesPerDay,
                                SCALPING_LIMITS.maxTradesPerDay,
                            )}
                        </Field>
                        <Field label="Cooldown (s)" error={issues.find((i) => i.startsWith("Cooldown"))}>
                            {numberInput("cooldownSeconds", "5", 0, SCALPING_LIMITS.maxCooldownSeconds)}
                        </Field>
                        <Field label="Min confidence (0–1)" error={issues.find((i) => i.startsWith("Minimum confidence"))}>
                            {numberInput(
                                "minSignalConfidence",
                                "0.05",
                                SCALPING_LIMITS.minSignalConfidence,
                                SCALPING_LIMITS.maxSignalConfidence,
                            )}
                        </Field>
                        <Field
                            label="Bot notional cap"
                            hint="Blank = account limit only. The lower of bot/account applies."
                            error={issues.find((i) => i.startsWith("Bot notional cap"))}
                        >
                            <Input
                                type="number"
                                inputMode="decimal"
                                step="100"
                                disabled={disabled}
                                value={config.dailyNotionalBudget ?? ""}
                                onChange={(e) =>
                                    set("dailyNotionalBudget", e.target.value === "" ? null : Number(e.target.value))
                                }
                                className="h-8 text-xs font-numeric"
                                placeholder="account limit"
                            />
                        </Field>
                        <div className="col-span-2 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2 sm:col-span-2">
                            <p className="text-micro leading-4 text-muted-foreground">
                                These are bot-level limits. Account-level risk limits — exposure, daily loss, the
                                drawdown breaker and the notional ledger — are enforced independently and always take
                                precedence.
                            </p>
                        </div>
                    </div>
                ) : null}

                {tab === "execution" ? (
                    <div className="flex flex-col gap-2">
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <Field
                                label="Max spread (pips)"
                                hint={`Ceiling: ${SCALPING_LIMITS.maxSpreadPips} pips (gate policy).`}
                                error={issues.find((i) => i.startsWith("Max spread"))}
                            >
                                {numberInput("maxSpreadPips", "0.1", 0, SCALPING_LIMITS.maxSpreadPips)}
                            </Field>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-micro uppercase tracking-wide text-muted-foreground">Sessions</span>
                            {SESSIONS.map((session) => {
                                const active = config.sessions.includes(session);
                                return (
                                    <button
                                        key={session}
                                        type="button"
                                        disabled={disabled}
                                        aria-pressed={active}
                                        onClick={() =>
                                            set(
                                                "sessions",
                                                active
                                                    ? config.sessions.filter((s) => s !== session)
                                                    : [...config.sessions, session],
                                            )
                                        }
                                        className={cn(
                                            "rounded border px-1.5 py-0.5 text-micro transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
                                            active
                                                ? "border-primary/40 bg-primary/10 text-primary"
                                                : "border-border text-muted-foreground hover:bg-muted",
                                        )}
                                    >
                                        {session.replace("_", " ")}
                                    </button>
                                );
                            })}
                            <button
                                type="button"
                                disabled={disabled}
                                aria-pressed={config.requireStructureAlignment}
                                onClick={() => set("requireStructureAlignment", !config.requireStructureAlignment)}
                                className={cn(
                                    "ml-auto rounded border px-1.5 py-0.5 text-micro transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
                                    config.requireStructureAlignment
                                        ? "border-primary/40 bg-primary/10 text-primary"
                                        : "border-border text-muted-foreground hover:bg-muted",
                                )}
                            >
                                Require structure alignment
                            </button>
                        </div>
                        <p className="text-micro leading-4 text-muted-foreground">
                            Clearing every session removes the session filter. Execution still passes the AI Execution
                            Gate (quote freshness, spread, evidence, risk) and the Unified Trading Service before any
                            DEMO order is queued.
                        </p>
                    </div>
                ) : null}
            </div>

        </div>
    );
}

function PositionRows({ lane, step }: { lane: LaneReport; step: number | null }) {
    const volume = (value: number) => (step ? formatVolume(value, step) : String(value));

    return (
        <>
            {/* Desktop: dense table */}
            <div className="mt-2 hidden overflow-x-auto min-[1800px]:block">
                <table className="w-full text-micro">
                    <thead>
                        <tr className="border-b border-border/60 text-left uppercase tracking-wide text-muted-foreground">
                            <th className="px-1.5 py-1 font-normal">Ticket</th>
                            <th className="px-1.5 py-1 text-right font-normal">Volume</th>
                            <th className="px-1.5 py-1 text-right font-normal">Entry</th>
                            <th className="px-1.5 py-1 text-right font-normal">Current</th>
                            <th className="px-1.5 py-1 text-right font-normal">SL</th>
                            <th className="px-1.5 py-1 text-right font-normal">TP</th>
                            <th className="px-1.5 py-1 text-right font-normal">P/L</th>
                        </tr>
                    </thead>
                    <tbody>
                        {lane.positions.map((position) => (
                            <tr key={position.ticket} className="border-b border-border/40 last:border-0">
                                <td className="px-1.5 py-1 font-numeric">{position.ticket}</td>
                                <td className="px-1.5 py-1 text-right font-numeric">{volume(position.volume)}</td>
                                <td className="px-1.5 py-1 text-right font-numeric">{money(position.entryPrice)}</td>
                                <td className="px-1.5 py-1 text-right font-numeric">{money(position.currentPrice)}</td>
                                <td className="px-1.5 py-1 text-right font-numeric text-muted-foreground">
                                    {money(position.stopLoss)}
                                </td>
                                <td className="px-1.5 py-1 text-right font-numeric text-muted-foreground">
                                    {money(position.takeProfit)}
                                </td>
                                <td
                                    className={cn(
                                        "px-1.5 py-1 text-right font-numeric font-medium",
                                        (position.unrealizedPnl ?? 0) >= 0 ? "text-positive" : "text-negative",
                                    )}
                                >
                                    {money(position.unrealizedPnl)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Mobile: stacked cards, no horizontal overflow */}
            <ul className="mt-2 flex flex-col gap-1.5 min-[1800px]:hidden">
                {lane.positions.map((position) => (
                    <li key={position.ticket} className="rounded-lg border border-border/60 bg-background/40 p-2">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-micro text-muted-foreground">
                                Ticket <span className="font-numeric text-foreground">{position.ticket}</span>
                            </span>
                            <span
                                className={cn(
                                    "font-numeric text-xs font-medium",
                                    (position.unrealizedPnl ?? 0) >= 0 ? "text-positive" : "text-negative",
                                )}
                            >
                                {money(position.unrealizedPnl)}
                            </span>
                        </div>
                        <dl className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1">
                            {[
                                ["Volume", volume(position.volume)],
                                ["Entry", money(position.entryPrice)],
                                ["Current", money(position.currentPrice)],
                                ["Stop loss", money(position.stopLoss)],
                                ["Take profit", money(position.takeProfit)],
                                ["Opened", stamp(position.openedAt)],
                            ].map(([label, value]) => (
                                <div key={label} className="flex items-baseline justify-between gap-2">
                                    <dt className="text-micro text-muted-foreground">{label}</dt>
                                    <dd className="font-numeric text-micro text-foreground">{value}</dd>
                                </div>
                            ))}
                        </dl>
                    </li>
                ))}
            </ul>
        </>
    );
}

function LaneCard({ lane, step }: { lane: LaneReport; step: number | null }) {
    return (
        <section
            aria-label={`${lane.side === "long" ? "Long" : "Short"} lane`}
            className="rounded-xl border border-border bg-card p-2.5"
        >
            <div className="flex flex-wrap items-center gap-2">
                <span
                    className={cn(
                        "rounded border px-1 py-px text-micro font-semibold uppercase tracking-wide",
                        lane.side === "long"
                            ? "border-positive/40 bg-positive/10 text-positive"
                            : "border-negative/40 bg-negative/10 text-negative",
                    )}
                >
                    {lane.side === "long" ? "LONG" : "SHORT"}
                </span>
                <span className="text-micro text-muted-foreground">
                    {lane.enabled ? "enabled" : "disabled"}
                </span>
                <StatusPill status={lane.status} />
                <span className="ml-auto font-numeric text-micro text-muted-foreground">
                    {lane.openPositions} open
                </span>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-muted-foreground">
                <span>
                    Last signal{" "}
                    <span className="font-numeric text-foreground">{stamp(lane.lastSignalAt)}</span>
                </span>
                {lane.confidence !== null ? (
                    <span>
                        Confidence <span className="font-numeric text-foreground">{lane.confidence.toFixed(2)}</span>
                    </span>
                ) : (
                    <span>Confidence unavailable</span>
                )}
            </div>

            {lane.blockedReason && lane.status === "BLOCKED" ? (
                <p className="mt-1.5 flex items-start gap-1 rounded border border-negative/30 bg-negative/5 px-1.5 py-1 text-micro leading-4 text-negative">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                    {lane.blockedReason.replace(/_/g, " ")}
                </p>
            ) : null}

            {lane.positions.length === 0 ? (
                <p className="mt-2 rounded-lg border border-dashed border-border/60 px-2 py-2 text-micro text-muted-foreground">
                    No open {lane.side} positions.
                </p>
            ) : (
                <PositionRows lane={lane} step={step} />
            )}
        </section>
    );
}

function SignalList({ report }: { report: ScalpingBotReport }) {
    const executions = new Map<string, BotExecution>(report.recentExecutions.map((e) => [e.signalId, e]));
    const groups = [
        { label: "Long signals", tone: "text-positive", signals: report.recentSignals.filter((s) => s.direction === "BUY") },
        { label: "Short signals", tone: "text-negative", signals: report.recentSignals.filter((s) => s.direction === "SELL") },
    ];

    if (report.recentSignals.length === 0) {
        return (
            <p className="flex items-center gap-1.5 rounded-lg border border-dashed border-border/60 px-2 py-2 text-micro text-muted-foreground">
                <Inbox className="size-3.5" aria-hidden />
                No signals recorded yet. A signal is written only when a closed bar is evaluated.
            </p>
        );
    }

    return (
        <div className="grid gap-3 sm:grid-cols-2">
            {groups.map((group) => (
                <div key={group.label}>
                    <p className={cn("mb-1 text-micro font-semibold uppercase tracking-wide", group.tone)}>
                        {group.label}
                        <span className="ml-1 font-numeric font-normal text-muted-foreground">
                            ({group.signals.length})
                        </span>
                    </p>
                    {group.signals.length === 0 ? (
                        <p className="text-micro text-muted-foreground">None.</p>
                    ) : (
                        <ul className="flex flex-col gap-1.5">
                            {group.signals.slice(0, 4).map((signal) => {
                                const execution = executions.get(signal.id);
                                return (
                                    <li
                                        key={signal.id}
                                        className="rounded-lg border border-border/60 bg-background/40 px-2 py-1.5 text-micro"
                                    >
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <span className="font-numeric text-foreground">
                                                {stamp(signal.generatedAt)}
                                            </span>
                                            <OutcomeTag outcome={signal.outcome} />
                                            {execution ? (
                                                <span className="text-muted-foreground">
                                                    execution: <span className="text-foreground">{execution.status}</span>
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground">
                                                    {signal.executionId ? "execution recorded elsewhere" : "no execution"}
                                                </span>
                                            )}
                                        </div>
                                        {signal.proposedEntry !== undefined ? (
                                            <p className="mt-0.5 font-numeric text-muted-foreground">
                                                entry {money(signal.proposedEntry)} · SL {money(signal.proposedSl)} · TP{" "}
                                                {money(signal.proposedTp)}
                                            </p>
                                        ) : null}
                                        {signal.rejectionCode || signal.rejectionReason ? (
                                            <p className="mt-0.5 leading-4 text-warning">
                                                {signal.rejectionCode ? `${signal.rejectionCode}: ` : ""}
                                                {signal.rejectionReason ?? "rejected"}
                                            </p>
                                        ) : null}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            ))}
        </div>
    );
}

export function BotPanel() {
    const { token, account } = useTerminalData();
    const { state } = useTerminal();
    const now = useTerminalClock(1000);

    const [bots, setBots] = useState<BotSummary[] | null>(null);
    const [botsError, setBotsError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [report, setReport] = useState<ScalpingBotReport | null>(null);
    const [reportError, setReportError] = useState<string | null>(null);
    const [refreshNonce, setRefreshNonce] = useState(0);
    const [busy, setBusy] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [showConfig, setShowConfig] = useState(false);
    const [pendingStop, setPendingStop] = useState(false);

    const [draft, setDraft] = useState<ScalpingBotConfig>(() => defaultScalpingConfig("balanced"));
    const [name, setName] = useState("");
    const [editDraft, setEditDraft] = useState<ScalpingBotConfig | null>(null);

    const paperAccount = state.accountMode === "paper";
    const mt5Account = account?.mt5Account ?? null;

    useEffect(() => {
        if (!token) return;
        let cancelled = false;

        const run = async () => {
            const result = await callApi<{ bots: BotSummary[] }>("/api/bot-studio/scalping/bots", token);
            if (cancelled) return;
            if (!result.ok) {
                setBotsError(result.error);
                return;
            }
            const list = result.data.bots ?? [];
            setBots(list);
            setBotsError(null);
            setSelectedId((current) => current ?? list[0]?.deployment.id ?? null);
        };

        void run();
        const id = setInterval(() => void run(), 20_000);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [token]);

    useEffect(() => {
        if (!token || !selectedId) return;
        let cancelled = false;

        const run = async () => {
            const result = await callApi<{ report: ScalpingBotReport }>(
                `/api/bot-studio/scalping/bots/${selectedId}`,
                token,
            );
            if (cancelled) return;
            if (!result.ok) {
                setReportError(result.error);
                return;
            }
            setReport(result.data.report);
            setReportError(null);
        };

        void run();
        const id = setInterval(() => void run(), 15_000);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [token, selectedId, refreshNonce]);

    const refresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

    const visibleReport = report && report.botId === selectedId ? report : null;
    const selected = bots?.find((b) => b.deployment.id === selectedId) ?? null;
    const deployment = visibleReport
        ? ({ runtimeState: visibleReport.runtimeState, desiredState: visibleReport.desiredState } as const)
        : selected?.deployment;
    const running = deployment?.runtimeState === "running";
    const paused = deployment?.runtimeState === "paused";
    const modeSummary = visibleReport ? positionModeSummary(visibleReport.positionMode) : null;

    const create = useCallback(async () => {
        if (!token || !mt5Account) return;
        setBusy("create");
        setActionError(null);
        try {
            const result = await callApi<{ deployment: BotDeployment }>("/api/bot-studio/scalping/bots", token, {
                method: "POST",
                body: JSON.stringify({ name, mt5Account, config: draft }),
            });
            if (!result.ok) {
                setActionError(result.error);
                return;
            }
            setShowCreate(false);
            setName("");
            setSelectedId(result.data.deployment.id);
            refresh();
        } finally {
            setBusy(null);
        }
    }, [draft, mt5Account, name, refresh, token]);

    const lifecycle = useCallback(
        async (targetState: "running" | "paused" | "stopped") => {
            if (!token || !selectedId) return;
            setBusy(targetState);
            setActionError(null);
            setPendingStop(false);
            try {
                const result = await callApi(`/api/bot-studio/deployments/${selectedId}/lifecycle`, token, {
                    method: "POST",
                    body: JSON.stringify({ targetState }),
                });
                if (!result.ok) {
                    setActionError(result.error);
                    return;
                }
                refresh();
            } finally {
                setBusy(null);
            }
        },
        [refresh, selectedId, token],
    );

    const evaluate = useCallback(async () => {
        if (!token || !selectedId) return;
        setBusy("tick");
        setActionError(null);
        try {
            const result = await callApi<{
                tickResult?: { waited?: boolean; waitReason?: string; gateApproved?: boolean; gateCode?: string };
            }>(`/api/bot-studio/deployments/${selectedId}/tick`, token, { method: "POST" });
            if (!result.ok) {
                setActionError(result.error);
                return;
            }
            const tick = result.data.tickResult ?? {};
            if (tick.waited) {
                setActionError(`No entry — the strategy returned WAIT (${tick.waitReason ?? "no setup"}).`);
            } else if (tick.gateApproved === false) {
                setActionError(`Entry blocked by the execution gate: ${tick.gateCode ?? "rejected"}.`);
            }
            refresh();
        } finally {
            setBusy(null);
        }
    }, [refresh, selectedId, token]);

    const saveConfig = useCallback(async () => {
        if (!token || !selectedId || !editDraft) return;
        setBusy("save");
        setActionError(null);
        try {
            const result = await callApi<{ report: ScalpingBotReport }>(
                `/api/bot-studio/scalping/bots/${selectedId}`,
                token,
                { method: "PATCH", body: JSON.stringify({ config: editDraft }) },
            );
            if (!result.ok) {
                setActionError(result.error);
                return;
            }
            setReport(result.data.report);
            setShowConfig(false);
            setEditDraft(null);
            refresh();
        } finally {
            setBusy(null);
        }
    }, [editDraft, refresh, selectedId, token]);

    const selectBot = useCallback((botId: string) => {
        setSelectedId(botId);
        setShowConfig(false);
        setEditDraft(null);
        setReportError(null);
        setPendingStop(false);
        setActionError(null);
    }, []);

    const demo = visibleReport?.performance.demo ?? null;
    const step = visibleReport?.sizing.brokerSpec.volumeStep ?? null;
    return (
        <section className="rounded-xl border border-border bg-card p-3" aria-label="Bot Studio">
            <PanelErrorBoundary name="Bots" compact>
                <TooltipProvider delay={200}>
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-foreground">
                            <Bot className="size-3.5 text-primary" aria-hidden />
                            Bot Studio
                        </h2>
                        <span className="rounded border border-border px-1 py-px text-micro uppercase tracking-wide text-muted-foreground">
                            Demo only
                        </span>
                        <div className="ml-auto flex items-center gap-1.5">
                            <Button size="xs" variant="ghost" onClick={refresh} aria-label="Refresh bots">
                                <RefreshCw className="size-3" aria-hidden />
                            </Button>
                            <Button
                                size="xs"
                                variant="outline"
                                onClick={() => setShowCreate((v) => !v)}
                                aria-expanded={showCreate}
                            >
                                <Plus className="size-3" aria-hidden />
                                New bot
                            </Button>
                        </div>
                    </div>

                    {!token ? (
                        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Lock className="size-3.5" aria-hidden />
                            Sign in to manage scalping bots.
                        </p>
                    ) : !paperAccount || !mt5Account ? (
                        <div className="mt-2 rounded-lg border border-warning/30 bg-warning/5 px-2 py-1.5">
                            <p className="flex items-center gap-1.5 text-xs text-warning">
                                <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                                A connected DEMO/PAPER MT5 account is required.
                            </p>
                            <p className="mt-0.5 text-micro leading-4 text-muted-foreground">
                                The current terminal account is{" "}
                                <span className="text-foreground">
                                    {state.accountMode === "live" ? "LIVE" : "not connected"}
                                </span>
                                . Bots cannot be created or run against it.
                            </p>
                        </div>
                    ) : null}

                    {actionError ? (
                        <p
                            role="status"
                            className="mt-2 flex items-start gap-1 rounded-lg border border-warning/30 bg-warning/10 px-2 py-1 text-micro leading-4 text-warning"
                        >
                            <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                            {actionError}
                        </p>
                    ) : null}

                    {showCreate ? (
                        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 p-2">
                            <div className="flex flex-wrap items-end gap-2">
                                <Field label="Bot name" hint="Optional — a name is generated from the profile.">
                                    <Input
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="e.g. XAUUSD London scalper"
                                        className="h-8 w-full text-xs sm:w-56"
                                    />
                                </Field>
                                <span className="text-micro text-muted-foreground">
                                    Account{" "}
                                    <span className="font-numeric text-foreground">{mt5Account ?? "none"}</span> · DEMO
                                </span>
                            </div>
                            <ConfigEditor config={draft} onChange={setDraft} report={null} />
                            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
                                <Button
                                    size="xs"
                                    onClick={() => void create()}
                                    disabled={
                                        busy === "create" ||
                                        !mt5Account ||
                                        !paperAccount ||
                                        configIssues(draft).length > 0
                                    }
                                >
                                    {busy === "create" ? (
                                        <Loader2 className="size-3 animate-spin" aria-hidden />
                                    ) : (
                                        <Plus className="size-3" aria-hidden />
                                    )}
                                    {busy === "create" ? "Creating…" : "Create bot"}
                                </Button>
                                <Button size="xs" variant="ghost" onClick={() => setShowCreate(false)}>
                                    Cancel
                                </Button>
                                {configIssues(draft).length > 0 ? (
                                    <span className="text-micro text-negative">
                                        Fix the configuration before creating the bot.
                                    </span>
                                ) : null}
                            </div>
                        </div>
                    ) : null}

                    {botsError ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-negative/30 bg-negative/5 px-2 py-1.5">
                            <p className="text-xs text-negative">{botsError}</p>
                            <Button size="xs" variant="outline" onClick={refresh} className="ml-auto">
                                Retry
                            </Button>
                        </div>
                    ) : bots === null ? (
                        <div className="mt-3 grid gap-1.5 sm:grid-cols-2" aria-busy="true" aria-label="Loading bots">
                            {[0, 1].map((i) => (
                                <div key={i} className="rounded-lg border border-border/60 p-2">
                                    <Skeleton className="h-3 w-32" />
                                    <Skeleton className="mt-1.5 h-2.5 w-48" />
                                    <Skeleton className="mt-1.5 h-2.5 w-24" />
                                </div>
                            ))}
                        </div>
                    ) : bots.length === 0 ? (
                        <div className="mt-3 flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-5 text-center">
                            <Inbox className="size-5 text-muted-foreground" aria-hidden />
                            <p className="text-xs text-foreground">No scalping bots yet</p>
                            <p className="max-w-sm text-micro leading-4 text-muted-foreground">
                                Create a bot to evaluate LONG, SHORT or BOTH setups on a connected demo account. Nothing
                                runs until you start it.
                            </p>
                            <Button size="xs" variant="outline" className="mt-1" onClick={() => setShowCreate(true)}>
                                <Plus className="size-3" aria-hidden />
                                Create the first bot
                            </Button>
                        </div>
                    ) : (
                        <div
                            className="mt-3 grid gap-1.5 sm:grid-cols-2 2xl:grid-cols-3"
                            aria-label="Your scalping bots"
                        >
                            {bots.map((bot) => {
                                const lanes = bot.deployment.lanes;
                                const isSelected = bot.deployment.id === selectedId;
                                const blocked =
                                    lanes?.long.status === "BLOCKED" || lanes?.short.status === "BLOCKED";
                                return (
                                    <button
                                        key={bot.deployment.id}
                                        type="button"
                                        onClick={() => selectBot(bot.deployment.id)}
                                        aria-pressed={isSelected}
                                        title={`Account ${bot.deployment.mt5Account} · magic ${bot.strategy.magicNumber} · last signal ${stamp(
                                            bot.deployment.lastSignalAt,
                                        )} · last execution ${stamp(bot.deployment.lastExecutionAt)}`}
                                        className={cn(
                                            "min-w-0 rounded-lg border px-2.5 py-2 text-left transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                            isSelected
                                                ? "border-primary/50 bg-primary/10"
                                                : "border-border bg-background hover:bg-muted",
                                        )}
                                    >
                                        <span className="flex items-center gap-1.5">
                                            <span
                                                className={cn(
                                                    "size-1.5 shrink-0 rounded-full",
                                                    bot.deployment.runtimeState === "running"
                                                        ? "bg-positive"
                                                        : bot.deployment.runtimeState === "error"
                                                          ? "bg-negative"
                                                          : "bg-muted-foreground/50",
                                                )}
                                                aria-hidden
                                            />
                                            <span className="truncate text-xs font-medium text-foreground">
                                                {bot.strategy.name}
                                            </span>
                                            <span className="ml-auto shrink-0 rounded border border-border px-1 py-px text-micro uppercase tracking-wide text-muted-foreground">
                                                {bot.deployment.runtimeState}
                                            </span>
                                        </span>
                                        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-micro text-muted-foreground">
                                            <span className="font-numeric">
                                                {bot.strategy.symbol} · {bot.strategy.timeframe}
                                            </span>
                                            <span aria-hidden>·</span>
                                            <span className="font-numeric">#{bot.deployment.mt5Account}</span>
                                            <span className="uppercase">{bot.deployment.accountMode}</span>
                                        </span>
                                        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-micro text-muted-foreground">
                                            <span>{(bot.deployment.positionMode ?? "UNKNOWN").toLowerCase()}</span>
                                            <span aria-hidden>·</span>
                                            <span>dirs {directionShort(bot.strategy.direction)}</span>
                                            <span aria-hidden>·</span>
                                            <span className="font-numeric">
                                                L {lanes?.long.openPositions ?? 0} / S {lanes?.short.openPositions ?? 0}
                                            </span>
                                            {blocked ? <span className="text-negative">blocked</span> : null}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {selected ? (
                        <div className="mt-3 flex flex-col gap-3 border-t border-border/60 pt-3">
                            <div className="flex flex-wrap items-start gap-x-2 gap-y-1.5">
                                <div className="min-w-0">
                                    <h3 className="truncate text-sm font-semibold tracking-tight text-foreground">
                                        {selected.strategy.name}
                                    </h3>
                                    <p className="font-numeric text-micro text-muted-foreground">
                                        {selected.strategy.symbol} · {selected.strategy.timeframe} ·{" "}
                                        {directionLabel(selected.strategy.direction)} ·{" "}
                                        #{selected.strategy.magicNumber}
                                    </p>
                                </div>
                                <div
                                    className="ml-auto flex flex-wrap items-center gap-1.5"
                                    aria-busy={busy !== null}
                                >
                                    <Button
                                        size="xs"
                                        variant="secondary"
                                        onClick={() => void lifecycle("running")}
                                        disabled={busy !== null || running || !paperAccount}
                                        title={
                                            !paperAccount ? "A DEMO/PAPER account is required to start a bot." : undefined
                                        }
                                    >
                                        {busy === "running" ? (
                                            <Loader2 className="size-3 animate-spin" aria-hidden />
                                        ) : (
                                            <Play className="size-3" aria-hidden />
                                        )}
                                        {busy === "running" ? "Starting…" : paused ? "Resume" : "Start"}
                                    </Button>
                                    <Button
                                        size="xs"
                                        variant="outline"
                                        onClick={() => void lifecycle("paused")}
                                        disabled={busy !== null || !running}
                                    >
                                        {busy === "paused" ? (
                                            <Loader2 className="size-3 animate-spin" aria-hidden />
                                        ) : (
                                            <Pause className="size-3" aria-hidden />
                                        )}
                                        {busy === "paused" ? "Pausing…" : "Pause"}
                                    </Button>
                                    <Button
                                        size="xs"
                                        variant="destructive"
                                        onClick={() => setPendingStop(true)}
                                        disabled={busy !== null || deployment?.runtimeState === "stopped"}
                                    >
                                        <Square className="size-3" aria-hidden />
                                        Stop
                                    </Button>
                                    <Button
                                        size="xs"
                                        variant="outline"
                                        onClick={() => void evaluate()}
                                        disabled={busy !== null || !running}
                                        title={
                                            running
                                                ? "Runs the bot's next evaluation server-side through the execution gate."
                                                : "Start the bot to evaluate a bar."
                                        }
                                    >
                                        {busy === "tick" ? (
                                            <Loader2 className="size-3 animate-spin" aria-hidden />
                                        ) : (
                                            <Zap className="size-3" aria-hidden />
                                        )}
                                        {busy === "tick" ? "Evaluating…" : "Evaluate bar"}
                                    </Button>
                                    <Button
                                        size="xs"
                                        variant="ghost"
                                        onClick={() => {
                                            setEditDraft(visibleReport?.config ? { ...visibleReport.config } : null);
                                            setShowConfig((v) => !v);
                                        }}
                                        disabled={running || !visibleReport}
                                        aria-expanded={showConfig}
                                        title={
                                            running
                                                ? "Stop or pause the bot before editing its configuration."
                                                : !visibleReport
                                                  ? "Loading the persisted configuration…"
                                                  : "Edit configuration"
                                        }
                                    >
                                        <ChevronDown
                                            className={cn(
                                                "size-3 transition-transform duration-150 motion-reduce:transition-none",
                                                showConfig && "rotate-180",
                                            )}
                                            aria-hidden
                                        />
                                        Configure
                                    </Button>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                    className={cn(
                                        "rounded border px-1.5 py-0.5 text-micro uppercase tracking-wide",
                                        STATE_TONE[deployment?.runtimeState ?? "ready"] ?? STATE_TONE.ready,
                                    )}
                                >
                                    {deployment?.runtimeState ?? "unknown"}
                                </span>
                                <span className="text-micro text-muted-foreground">
                                    desired{" "}
                                    <span className="text-foreground">{deployment?.desiredState ?? "unknown"}</span>
                                </span>
                                <span className="text-micro text-muted-foreground">
                                    last tick{" "}
                                    <span className="font-numeric text-foreground">
                                        {stamp(visibleReport?.lastTickAt ?? selected.deployment.lastTickAt)}
                                    </span>
                                </span>
                            </div>

                            {visibleReport?.errorReason ? (
                                <p className="flex items-start gap-1 rounded-lg border border-negative/40 bg-negative/5 px-2 py-1.5 text-micro leading-4 text-negative">
                                    <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                                    {visibleReport.errorReason}
                                </p>
                            ) : null}

                            {pendingStop ? (
                                <div
                                    role="alertdialog"
                                    aria-label="Confirm stop"
                                    className="flex flex-wrap items-center gap-2 rounded-lg border border-negative/40 bg-negative/10 px-2 py-1.5"
                                >
                                    <AlertTriangle className="size-3.5 text-negative" aria-hidden />
                                    <span className="text-micro text-foreground">
                                        Stop this bot? It stops adding entries; open broker positions stay untouched.
                                    </span>
                                    <Button
                                        size="xs"
                                        variant="destructive"
                                        onClick={() => void lifecycle("stopped")}
                                        disabled={busy !== null}
                                    >
                                        {busy === "stopped" ? (
                                            <Loader2 className="size-3 animate-spin" aria-hidden />
                                        ) : null}
                                        {busy === "stopped" ? "Stopping…" : "Confirm stop"}
                                    </Button>
                                    <Button
                                        size="xs"
                                        variant="ghost"
                                        onClick={() => setPendingStop(false)}
                                        disabled={busy !== null}
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            ) : null}

                            {visibleReport ? (
                                <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/60 bg-muted/20 px-2 py-1.5">
                                    <ShieldCheck className="size-3.5 text-primary" aria-hidden />
                                    <span className="text-micro font-medium text-foreground">
                                        {modeSummary?.label ?? "Position mode unknown"}
                                    </span>
                                    <span className="min-w-0 flex-1 text-micro leading-4 text-muted-foreground">
                                        {modeSummary?.restriction}
                                    </span>
                                    <InfoTip label="How position mode affects bot lanes">
                                        HEDGING keeps LONG and SHORT independently; NETTING reduces or reverses existing
                                        exposure; EXCHANGE/UNKNOWN is restricted and fails closed.
                                    </InfoTip>
                                </div>
                            ) : null}

                            {showConfig && editDraft ? (
                                <div className="rounded-lg border border-border/60 bg-muted/20 p-2">
                                    <ConfigEditor
                                        config={editDraft}
                                        onChange={setEditDraft}
                                        disabled={running}
                                        report={visibleReport}
                                    />
                                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
                                        <Button
                                            size="xs"
                                            onClick={() => void saveConfig()}
                                            disabled={
                                                busy === "save" ||
                                                running ||
                                                configIssues(editDraft).length > 0
                                            }
                                        >
                                            {busy === "save" ? (
                                                <Loader2 className="size-3 animate-spin" aria-hidden />
                                            ) : (
                                                <Save className="size-3" aria-hidden />
                                            )}
                                            {busy === "save" ? "Saving…" : "Save configuration"}
                                        </Button>
                                        <Button
                                            size="xs"
                                            variant="ghost"
                                            onClick={() => {
                                                setShowConfig(false);
                                                setEditDraft(null);
                                            }}
                                            disabled={busy === "save" || running}
                                        >
                                            Cancel
                                        </Button>
                                        {configIssues(editDraft).length > 0 ? (
                                            <span className="text-micro text-negative">
                                                {configIssues(editDraft).length} field
                                                {configIssues(editDraft).length === 1 ? "" : "s"} need attention.
                                            </span>
                                        ) : null}
                                        <span className="text-micro text-muted-foreground">
                                            A stopped or paused bot keeps the new profile for its next run.
                                        </span>
                                    </div>
                                </div>
                            ) : null}

                            {reportError ? (
                                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-negative/30 bg-negative/5 px-2 py-1.5">
                                    <p className="text-xs text-negative">{reportError}</p>
                                    <Button size="xs" variant="outline" className="ml-auto" onClick={refresh}>
                                        Retry
                                    </Button>
                                </div>
                            ) : !visibleReport ? (
                                <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading bot report">
                                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                                        {[0, 1, 2, 3].map((i) => (
                                            <Skeleton key={i} className="h-12" />
                                        ))}
                                    </div>
                                    <div className="grid gap-2 lg:grid-cols-2">
                                        {[0, 1].map((i) => (
                                            <div key={i} className="rounded-xl border border-border/60 p-2.5">
                                                <Skeleton className="h-3 w-28" />
                                                <Skeleton className="mt-2 h-2.5 w-44" />
                                                <Skeleton className="mt-3 h-16 w-full" />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-3">
                                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                                        <Metric label="Symbol / TF" value={`${visibleReport.symbol} · ${visibleReport.timeframe}`} />
                                        <Metric
                                            label="Account"
                                            value={`#${visibleReport.account.key.replace(/^gateway_/, "")} · ${
                                                visibleReport.account.serverName ??
                                                visibleReport.account.brokerName ??
                                                "server unavailable"
                                            }`}
                                        />
                                        <Metric
                                            label="Equity"
                                            value={
                                                visibleReport.account.equity === null
                                                    ? "unavailable"
                                                    : `${money(visibleReport.account.equity)} ${visibleReport.account.currency ?? ""}`.trim()
                                            }
                                        />
                                        <Metric
                                            label="Signals / executions"
                                            value={`${count(visibleReport.counters.signals)} / ${count(visibleReport.counters.executions)}`}
                                        />
                                        <Metric label="Rejections" value={count(visibleReport.counters.rejections)} />
                                        <Metric label="Last signal" value={stamp(visibleReport.lastSignalAt)} />
                                        <Metric label="Last execution" value={stamp(visibleReport.lastExecutionAt)} />
                                        <Metric
                                            label="Daily notional"
                                            value={
                                                visibleReport.dailyNotional.budget === null
                                                    ? "account limit only"
                                                    : `${count(visibleReport.dailyNotional.used)} / ${count(
                                                          visibleReport.dailyNotional.budget,
                                                      )}`
                                            }
                                        />
                                    </div>

                                    <div className="grid gap-2 lg:grid-cols-2">
                                        <LaneCard lane={visibleReport.lanes.long} step={step} />
                                        <LaneCard lane={visibleReport.lanes.short} step={step} />
                                    </div>

                                    <div className="rounded-lg border border-border/60 bg-muted/20 px-2 py-1.5">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-micro uppercase tracking-wide text-muted-foreground">
                                                Current evaluation
                                            </span>
                                            {visibleReport.lastEvaluation ? (
                                                <>
                                                    <span
                                                        className={cn(
                                                            "rounded border px-1.5 py-0.5 text-micro",
                                                            visibleReport.lastEvaluation.decision === "WAIT"
                                                                ? "border-border text-muted-foreground"
                                                                : "border-primary/40 bg-primary/10 text-primary",
                                                        )}
                                                    >
                                                        {visibleReport.lastEvaluation.decision}
                                                    </span>
                                                    <span className="text-micro text-muted-foreground">
                                                        bar {stamp(visibleReport.lastEvaluation.barTimestamp)}
                                                    </span>
                                                    {visibleReport.lastEvaluation.detail ? (
                                                        <span className="text-micro text-muted-foreground">
                                                            {visibleReport.lastEvaluation.detail}
                                                        </span>
                                                    ) : null}
                                                </>
                                            ) : (
                                                <span className="text-micro text-muted-foreground">
                                                    No bar has been evaluated yet — start the bot to record a decision.
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div>
                                        <p className="mb-1 text-micro uppercase tracking-wide text-muted-foreground">
                                            Recent signals by direction
                                        </p>
                                        <SignalList report={visibleReport} />
                                    </div>

                                    <div>
                                        <p className="mb-1 text-micro uppercase tracking-wide text-muted-foreground">
                                            Demo performance — closed deals for this bot only
                                        </p>
                                        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                                            <Metric
                                                label="Realized P&L"
                                                value={money(demo?.realizedPnl, demo?.available === true)}
                                                tone={
                                                    demo?.available
                                                        ? (demo.realizedPnl ?? 0) >= 0
                                                            ? "positive"
                                                            : "negative"
                                                        : undefined
                                                }
                                            />
                                            <Metric
                                                label="Unrealized P&L"
                                                value={money(demo?.unrealizedPnl, demo?.available === true)}
                                            />
                                            <Metric
                                                label="Closed trades"
                                                value={`${count(demo?.closedTrades, demo?.available === true)} (${count(
                                                    demo?.wins,
                                                    demo?.available === true,
                                                )}W / ${count(demo?.losses, demo?.available === true)}L)`}
                                            />
                                            <Metric
                                                label="Win rate"
                                                value={pct(demo?.winRate, demo?.available === true)}
                                            />
                                            <Metric
                                                label="Max closed drawdown"
                                                value={money(demo?.maxClosedDrawdown, demo?.available === true)}
                                            />
                                            <Metric
                                                label="Open positions"
                                                value={count(demo?.openPositions, demo?.available === true)}
                                            />
                                            <Metric
                                                label="Backtest"
                                                value={
                                                    visibleReport.performance.backtest.available
                                                        ? `${money(visibleReport.performance.backtest.netPnl)} · ${visibleReport.performance.backtest.trades ?? "—"} trades`
                                                        : "not run"
                                                }
                                            />
                                            <Metric
                                                label="Paper trading"
                                                value="not available"
                                            />
                                        </div>
                                        {demo && !demo.available ? (
                                            <p className="mt-1 text-micro leading-4 text-muted-foreground">{demo.reason}</p>
                                        ) : null}
                                        <p className="mt-1 text-micro leading-4 text-muted-foreground">
                                            Sources stay separate: demo fills are reported by the gateway; paper results
                                            are unavailable because there is no paper fill engine for bots; backtesting
                                            is a historical simulation and never mixed into demo results.
                                        </p>
                                    </div>

                                    <div className="grid gap-2 lg:grid-cols-2">
                                        <div>
                                            <p className="mb-1 text-micro uppercase tracking-wide text-muted-foreground">
                                                Risk / gate decisions
                                            </p>
                                            {visibleReport.riskDecisions.length === 0 ? (
                                                <p className="text-micro text-muted-foreground">
                                                    No recorded rejections yet.
                                                </p>
                                            ) : (
                                                <ul className="flex flex-col gap-1">
                                                    {visibleReport.riskDecisions.slice(0, 5).map((decision) => (
                                                        <li key={decision.id} className="text-micro leading-4 text-muted-foreground">
                                                            <span className="font-numeric text-foreground">
                                                                {stamp(decision.at)}
                                                            </span>{" "}
                                                            <span className="text-warning">{decision.code}</span> —{" "}
                                                            {decision.reason}
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                        <div>
                                            <p className="mb-1 text-micro uppercase tracking-wide text-muted-foreground">
                                                Methodologies (Skills Registry)
                                            </p>
                                            <ul className="flex flex-col gap-1">
                                                {visibleReport.methodologies
                                                    .filter((m) => m.status === "active")
                                                    .map((m) => (
                                                        <li key={m.skillId} className="text-micro leading-4 text-muted-foreground">
                                                            <span className="rounded border border-positive/40 bg-positive/10 px-1 py-px text-positive">
                                                                active
                                                            </span>{" "}
                                                            <span className="text-foreground">{m.label}</span> — {m.implementation}
                                                        </li>
                                                    ))}
                                            </ul>
                                            <p className="mt-1 text-micro leading-4 text-muted-foreground">
                                                {
                                                    visibleReport.methodologies.filter((m) => m.status !== "active")
                                                        .length
                                                }{" "}
                                                further record(s) are registered but not applied — reported as unavailable,
                                                never claimed as active.
                                            </p>
                                        </div>
                                    </div>

                                    <p className="text-micro leading-4 text-muted-foreground">
                                        State, lane activity, signals and P&amp;L come from RTDB records written by the
                                        gateway. Nothing here is simulated. Last tick{" "}
                                        <span className="font-numeric text-foreground">
                                            {stamp(visibleReport.lastTickAt)}
                                        </span>{" "}
                                        · now <span className="font-numeric text-foreground">{stamp(now)}</span>.
                                    </p>
                                </div>
                            )}
                        </div>
                    ) : null}
                </TooltipProvider>
            </PanelErrorBoundary>
        </section>
    );
}
