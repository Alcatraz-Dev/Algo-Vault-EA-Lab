"use client";

/**
 * TradingChat — Phase 5 §22–§29.
 *
 * AlgoVault Market Intelligence Copilot. It is not a general chatbot: every
 * message is issued with a structured context assembled from the SAME engine
 * payloads the rest of the terminal is rendering, so the answer can only ever
 * be about this symbol, this timeframe, these indicators, these positions and
 * this risk state.
 *
 * Safety properties:
 *  • No execution actions. Actions are declared in `ACTIONS`; anything that
 *    would move money is present as a disabled stub pointing at the order
 *    ticket — the terminal fails closed rather than exposing a control with
 *    no live adapter behind it (§27, §18).
 *  • Missing context is shown to the user, not hidden (§25).
 *  • The context travels with every turn, so "what changed?" is answered from
 *    the same facts, not from a model memory.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
    Bot,
    SendHorizonal,
    Loader2,
    Sparkles,
    ShieldAlert,
    ListPlus,
    CircleSlash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buildTradingChatContext } from "@/lib/terminal/chat-context";
import type { TradingChatContext } from "@/lib/terminal/types";
import { useTerminal } from "./TerminalContext";
import { useTerminalData } from "./TerminalData";
import { PanelErrorBoundary } from "./PanelErrorBoundary";

interface Turn {
    id: string;
    role: "user" | "assistant";
    content: string;
    /** Sections the model could not be told about for this turn. */
    missing?: string[];
    pending?: boolean;
    error?: string;
}

/* ── action registry (Phase 5 §27) ───────────────────────────────────────── */

interface ChatAction {
    id: string;
    label: string;
    kind: "analysis" | "execution";
    /** Builds the structured request from the live terminal context. */
    build: (symbol: string, timeframe: string) => string;
    /** Why an execution action is unavailable right now. */
    blocked?: string;
}

export const ACTIONS: ChatAction[] = [
    { id: "analyze_setup", label: "Analyze setup", kind: "analysis", build: (s, t) => `Analyze the current setup on ${s} ${t}. Cover signal, evidence, market context, confirmation, invalidation, risk, scenarios and limitations.` },
    { id: "explain_structure", label: "Explain structure", kind: "analysis", build: (s, t) => `Explain the current market structure on ${s} ${t} from the facts provided.` },
    { id: "find_liquidity", label: "Find liquidity", kind: "analysis", build: (s, t) => `Which liquidity levels matter most on ${s} ${t} right now, and which side is intact or swept?` },
    { id: "find_fvg", label: "Find FVG", kind: "analysis", build: (s, t) => `List the active fair value gaps on ${s} ${t} and what would invalidate each.` },
    { id: "find_ob", label: "Find order blocks", kind: "analysis", build: (s, t) => `List the active order blocks on ${s} ${t} and their status.` },
    { id: "htf_bias", label: "Check HTF bias", kind: "analysis", build: (s, t) => `What is the higher-timeframe bias for ${s}, and does it agree with ${t}?` },
    { id: "check_risk", label: "Check risk", kind: "analysis", build: (s) => `Assess my current risk for ${s}: account status, open risk, exposure and what would breach a limit.` },
    { id: "explain_signal", label: "Explain signal", kind: "analysis", build: (s, t) => `Explain the most recent signal on ${s} ${t} using only the evidence in the facts block.` },
    { id: "review_strategy", label: "Review strategy", kind: "analysis", build: (s, t) => `Review the active strategy decision for ${s} ${t} and list the reasons it fired or did not fire.` },
    {
        id: "open_paper_position",
        label: "Open paper position",
        kind: "execution",
        build: () => "",
        blocked: "Not wired to an execution adapter in the terminal — use the order ticket with explicit confirmation.",
    },
    {
        id: "create_alert",
        label: "Create alert",
        kind: "execution",
        build: () => "",
        blocked: "Alert creation is not yet exposed as a chat action — use Alert Center.",
    },
];

/* ── component ───────────────────────────────────────────────────────────── */

export function TradingChat({ now }: { now: number }) {
    const { state, setChatOpen } = useTerminal();
    const data = useTerminalData();

    const [input, setInput] = useState("");
    const [turns, setTurns] = useState<Turn[]>([]);
    const [sending, setSending] = useState(false);
    const [showActions, setShowActions] = useState(false);
    const listRef = useRef<HTMLDivElement>(null);
    const idRef = useRef(0);

    const lastContext = useMemo(
        () => buildChatContextFor(input || "…", state, data, now),
        [input, state, data, now]
    );

    useEffect(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [turns, sending]);

    const send = useCallback(
        async (raw: string) => {
            const question = raw.trim();
            if (!question || sending) return;
            setInput("");
            setSending(true);

            const userTurn: Turn = { id: `u${++idRef.current}`, role: "user", content: question };
            const assistantId = `a${++idRef.current}`;
            setTurns((t) => [...t, userTurn, { id: assistantId, role: "assistant", content: "", pending: true }]);

            try {
                // Rebuild with the exact question so the payload the server
                // receives carries this turn's subject.
                const ctx = buildChatContextFor(question, state, data, now);
                const history = turns.slice(-8).map((t) => ({ role: t.role, content: t.content }));
                const res = await fetch("/api/terminal/chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...(data.token ? { Authorization: `Bearer ${data.token}` } : {}) },
                    body: JSON.stringify({ question, context: ctx, history }),
                });
                const payload = (await res.json()) as { answer?: string; missing?: string[]; error?: string; detail?: string };
                if (!res.ok || !payload.answer) {
                    throw new Error(payload.error ?? payload.detail ?? `Request failed (${res.status})`);
                }
                setTurns((t) =>
                    t.map((x) => (x.id === assistantId ? { ...x, content: payload.answer as string, missing: payload.missing, pending: false } : x))
                );
            } catch (err) {
                setTurns((t) =>
                    t.map((x) =>
                        x.id === assistantId
                            ? {
                                  ...x,
                                  pending: false,
                                  error: err instanceof Error ? err.message : "Chat request failed.",
                              }
                            : x
                    )
                );
            } finally {
                setSending(false);
            }
        },
        [sending, state, data, now, turns]
    );


    return (
        <section className="flex min-h-0 flex-col rounded-xl border border-border bg-card" aria-label="Trading chat">
            <PanelErrorBoundary name="Trading Chat">
                <header className="flex items-center gap-2 border-b border-border px-3 py-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Bot className="size-3.5" />
                    </div>
                    <div className="min-w-0 leading-none">
                        <div className="flex items-center gap-1.5">
                            <span className="text-micro font-semibold uppercase tracking-wide text-foreground">
                                Trading Chat
                            </span>
                            <span className="rounded border border-primary/30 px-1 py-px text-micro font-bold tracking-wider text-primary">
                                CONTEXT-AWARE
                            </span>
                        </div>
                        <p className="mt-0.5 font-mono text-micro text-muted-foreground">
                            {state.symbol} {state.timeframe} · {state.accountMode}
                        </p>
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setShowActions((s) => !s)}
                            aria-expanded={showActions}
                            aria-label="Quick actions"
                            className="rounded-md border border-border bg-background p-1 text-muted-foreground transition hover:bg-muted"
                        >
                            <ListPlus className="size-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setChatOpen(false)}
                            aria-label="Hide chat"
                            className="rounded-md border border-border bg-background px-1.5 py-1 text-micro text-muted-foreground transition hover:bg-muted"
                        >
                            Hide
                        </button>
                    </div>
                </header>

                {showActions ? (
                    <div className="border-b border-border p-2">
                        <p className="mb-1.5 flex items-center gap-1 text-micro uppercase tracking-wide text-muted-foreground">
                            <Sparkles className="size-2.5" />
                            Quick actions
                        </p>
                        <div className="flex flex-wrap gap-1">
                            {ACTIONS.map((a) => {
                                const blocked = a.kind === "execution";
                                return (
                                    <button
                                        key={a.id}
                                        type="button"
                                        disabled={blocked || sending}
                                        title={blocked ? a.blocked : a.build(state.symbol, state.timeframe)}
                                        onClick={() => {
                                            if (blocked) return;
                                            void send(a.build(state.symbol, state.timeframe));
                                            setShowActions(false);
                                        }}
                                        className={cn(
                                            "rounded border px-1.5 py-1 text-micro font-medium transition",
                                            blocked
                                                ? "cursor-not-allowed border-border text-muted-foreground/60"
                                                : "border-border text-foreground hover:border-primary/40 hover:bg-primary/5"
                                        )}
                                    >
                                        {blocked ? <CircleSlash2 className="mr-1 inline size-2.5" /> : null}
                                        {a.label}
                                    </button>
                                );
                            })}
                        </div>
                        <p className="mt-1.5 text-micro leading-4 text-muted-foreground">
                            Analysis actions send the current terminal context. Execution actions stay disabled until an
                            execution adapter is wired — the chat never places orders.
                        </p>
                    </div>
                ) : null}

                <div ref={listRef} className="min-h-[8rem] flex-1 space-y-3 overflow-y-auto p-3">
                    {turns.length === 0 ? (
                        <div className="space-y-2 text-micro leading-4 text-muted-foreground">
                            <p>
                                Ask about the current chart, structure, liquidity, risk or your positions. The reply is
                                built from deterministic AlgoVault facts first, interpretation second.
                            </p>
                            <p className="text-micro">
                                Context attached right now:{" "}
                                {lastContext.missing.length === 0 ? "everything available." : `${lastContext.missing.length} section(s) unavailable.`}
                            </p>
                        </div>
                    ) : null}

                    {turns.map((t) => (
                        <article key={t.id} className={cn("flex", t.role === "user" ? "justify-end" : "justify-start")}>
                            <div
                                className={cn(
                                    "max-w-[95%] rounded-lg px-2.5 py-2 text-[12px] leading-5",
                                    t.role === "user"
                                        ? "bg-primary/15 text-foreground"
                                        : "border border-border bg-background text-foreground"
                                )}
                            >
                                {t.role === "assistant" ? (
                                    t.pending ? (
                                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                                            <Loader2 className="size-3 animate-spin" />
                                            Reading terminal context…
                                        </span>
                                    ) : t.error ? (
                                        <span className="flex items-start gap-1.5 text-warning">
                                            <ShieldAlert className="mt-0.5 size-3 shrink-0" />
                                            {t.error}
                                        </span>
                                    ) : (
                                        <>
                                            {t.missing && t.missing.length > 0 ? (
                                                <span className="mb-1.5 flex items-start gap-1.5 rounded border border-warning/40 bg-warning/10 px-1.5 py-1 text-micro leading-4 text-warning">
                                                    <ShieldAlert className="mt-0.5 size-3 shrink-0 text-warning" />
                                                    <span>
                                                        Unavailable in context: {t.missing.slice(0, 6).join(", ")}
                                                        {t.missing.length > 6 ? "…" : ""} — the model was told not to
                                                        speculate about these.
                                                    </span>
                                                </span>
                                            ) : null}
                                            <div className="[&_a]:text-primary [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-micro [&_h1]:text-xs [&_h1]:font-semibold [&_h1]:uppercase [&_h1]:tracking-wide [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:mt-2 [&_h3]:text-micro [&_h3]:font-semibold [&_li]:text-[12px] [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1 [&_p]:leading-5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:text-micro [&_strong]:font-semibold [&_table]:w-full [&_table]:text-micro [&_td]:border [&_td]:border-border [&_td]:px-1 [&_th]:border [&_th]:border-border [&_th]:px-1 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-4">
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{t.content}</ReactMarkdown>
                                            </div>
                                        </>
                                    )
                                ) : (
                                    <span className="whitespace-pre-wrap">{t.content}</span>
                                )}
                            </div>
                        </article>
                    ))}
                </div>

                <form
                    className="border-t border-border p-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void send(input);
                    }}
                >
                    <div className="flex items-end gap-1.5">
                        <label className="min-w-0 flex-1">
                            <span className="sr-only">Ask the trading chat</span>
                            <textarea
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        void send(input);
                                    }
                                }}
                                rows={2}
                                placeholder={`Ask about ${state.symbol} ${state.timeframe}…`}
                                className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
                            />
                        </label>
                        <button
                            type="submit"
                            disabled={sending || input.trim().length === 0}
                            aria-label="Send message"
                            className="rounded-md bg-primary px-2.5 py-2 text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                        >
                            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <SendHorizonal className="size-3.5" />}
                        </button>
                    </div>
                    <p className="mt-1 text-micro leading-4 text-muted-foreground">
                        Deterministic facts are supplied by AlgoVault engines; interpretation is the model&rsquo;s own
                        and is labelled as such. Not financial advice.
                    </p>
                </form>
            </PanelErrorBoundary>
        </section>
    );
}

/* ── helper: rebuild context for an exact question ───────────────────────── */

function buildChatContextFor(
    question: string,
    state: ReturnType<typeof useTerminal>["state"],
    data: ReturnType<typeof useTerminalData>,
    now: number
): TradingChatContext {
    const hasAccount = !!data.account;
    const risk = data.risk;
    return buildTradingChatContext({
        question,
        workspace: state.workspace,
        accountMode: state.accountMode,
        symbol: state.symbol,
        timeframe: state.timeframe,
        now,
        marketTimestamp: data.analysis?.asOf ?? data.quotes[state.symbol]?.timestamp ?? null,
        lastPrice: data.lastPrice,
        changePct: data.changePct,
        regime: data.analysis?.regime.label.value ?? null,
        // Volatility is derived from the analysis volatility evidence (ATR)
        // inside the context builder — the regime id is not volatility and is
        // never passed off as such in a FACTS block.
        chart: { chartType: null, activeLayers: null, drawings: null },
        // Indicator rows are derived from the analysis evidence inside the
        // context builder — one derivation, one source of truth.
        analysis: data.analysis,
        strategy: null,
        positions: hasAccount
            ? data.positions.map((p) => ({
                  ticket: p.ticket,
                  symbol: p.symbol,
                  side: p.type,
                  size: p.volume,
                  entry: p.openPrice,
                  current: p.currentPrice,
                  sl: p.sl || null,
                  tp: p.tp || null,
                  pnl: p.profit,
                  openedAt: p.openedAt,
              }))
            : null,
        orders: hasAccount
            ? data.orders.map((o) => ({
                  ticket: o.ticket,
                  symbol: o.symbol,
                  type: o.type,
                  size: o.volume,
                  price: o.price,
                  sl: o.sl || null,
                  tp: o.tp || null,
                  status: o.status,
              }))
            : null,
        risk: risk?.status
            ? {
                  status: risk.status,
                  dailyLossPct: risk.metrics?.dailyLossPct ?? null,
                  equity: risk.metrics?.equity ?? null,
                  balance: risk.metrics?.balance ?? null,
                  availableMargin: risk.metrics?.availableMargin ?? null,
                  usedMargin: risk.metrics?.usedMargin ?? null,
                  reasons: risk.reasons ?? null,
                  openRiskPct: risk.limits?.riskPercent ?? null,
                  exposurePct: null,
              }
            : null,
        setups: null,
        recentTrades: null,
        backtest: null,
        replay: null,
        alerts: null,
    });
}
