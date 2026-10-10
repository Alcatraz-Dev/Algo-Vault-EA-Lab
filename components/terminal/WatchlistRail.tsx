"use client";

/**
 * WatchlistRail — Phase 5 §7 / §8 / §9.
 *
 * One rail, one quote subscription (shared through TerminalData), grouped the
 * way traders actually organise symbols. Rows only carry values a real engine
 * produced: price and day change come from the quote feed, the signal column
 * is populated only when the deterministic scanner produced a signal for that
 * symbol. There is no synthetic trend, volatility or volume anywhere in here.
 */

import { useMemo, useState } from "react";
import {
    Star,
    Plus,
    Trash2,
    Search,
    ChevronUp,
    ChevronDown,
    Loader2,
    WifiOff,
    LayoutGrid,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SUPPORTED_SYMBOLS } from "@/lib/market-data/types";
import {
    WATCHLIST_GROUP_IDS,
    groupOfSymbol,
    searchSymbols,
    symbolsOfGroup,
} from "@/lib/terminal/state";
import { sessionFor } from "@/lib/terminal/chat-context";
import { useTerminal } from "./TerminalContext";
import { useTerminalData } from "./TerminalData";

type Chip = "All" | (typeof WATCHLIST_GROUP_IDS)[number];

const CHIPS: Chip[] = ["All", ...WATCHLIST_GROUP_IDS];

function fmtPrice(v: number | null | undefined): string {
    if (v === null || v === undefined || !Number.isFinite(v)) return "—";
    return v >= 100 ? v.toFixed(2) : v >= 1 ? v.toFixed(5) : v.toFixed(6);
}

export function WatchlistRail({ now }: { now: number }) {
    const {
        state,
        setSymbol,
        addToWatchlist,
        removeFromWatchlist,
        reorderWatchlist,
        toggleFavorite,
    } = useTerminal();
    const { quotes, signals, quotesLoading, quotesError } = useTerminalData();

    const [chip, setChip] = useState<Chip>("All");
    const [query, setQuery] = useState("");
    const [adding, setAdding] = useState(false);

    const visible = useMemo(() => {
        if (chip === "All") return state.watchlist;
        const group = symbolsOfGroup(state, chip === "Favorites" ? "Favorites" : chip);
        const set = new Set(group);
        return state.watchlist.filter((s) => set.has(s));
    }, [chip, state]);

    const matches = useMemo(() => (query ? searchSymbols(query, state.watchlistGroups) : []), [query, state.watchlistGroups]);
    const signalBySymbol = useMemo(() => {
        const map = new Map<string, string>();
        for (const s of signals) {
            if (!map.has(s.symbol)) map.set(s.symbol, `${s.direction === "long" ? "LONG" : "SHORT"} ${s.confidenceLabel}`);
        }
        return map;
    }, [signals]);

    const move = (symbol: string, delta: number) => {
        const idx = state.watchlist.indexOf(symbol);
        if (idx < 0) return;
        reorderWatchlist(symbol, idx + delta);
    };

    return (
        <section className="flex min-w-0 flex-col gap-2" aria-label="Watchlist">
            <div className="rounded-lg border border-border bg-card p-2.5">
                <div className="flex items-center justify-between gap-2">
                    <h2 className="flex items-center gap-1.5 text-micro font-semibold uppercase tracking-wide text-foreground">
                        <LayoutGrid className="size-3 text-primary" />
                        Watchlist
                        <span className="font-numeric text-muted-foreground">({state.watchlist.length})</span>
                    </h2>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setAdding((a) => !a)}
                            aria-expanded={adding}
                            aria-label="Add symbol"
                            className="rounded-md border border-border bg-background p-1 text-muted-foreground transition hover:bg-muted"
                        >
                            <Plus className="size-3.5" />
                        </button>
                    </div>
                </div>

                {adding ? (
                    <div className="mt-2">
                        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
                            <Search className="size-3 text-muted-foreground" />
                            <input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search symbols…"
                                aria-label="Search symbols to add"
                                className="w-full bg-transparent font-numeric text-xs uppercase text-foreground outline-none placeholder:text-muted-foreground placeholder:normal-case"
                            />
                        </div>
                        {query ? (
                            <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-background p-1">
                                {matches.length === 0 ? (
                                    <li className="px-2 py-1.5 text-micro text-muted-foreground">No supported symbol matches.</li>
                                ) : (
                                    matches.map((s) => {
                                        const already = state.watchlist.includes(s);
                                        return (
                                            <li key={s}>
                                                <button
                                                    type="button"
                                                    disabled={already}
                                                    onClick={() => {
                                                        addToWatchlist(s, groupOfSymbol(s));
                                                        setQuery("");
                                                        setAdding(false);
                                                    }}
                                                    className="flex w-full items-center justify-between rounded px-2 py-1 text-left font-numeric text-xs text-foreground transition hover:bg-muted disabled:opacity-50"
                                                >
                                                    {s}
                                                    <span className="text-micro text-muted-foreground">
                                                        {already ? "in list" : groupOfSymbol(s)}
                                                    </span>
                                                </button>
                                            </li>
                                        );
                                    })
                                )}
                            </ul>
                        ) : null}
                    </div>
                ) : null}

                <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Watchlist groups">
                    {CHIPS.map((c) => (
                        <button
                            key={c}
                            type="button"
                            onClick={() => setChip(c)}
                            aria-pressed={chip === c}
                            className={cn(
                                "rounded border px-1.5 py-0.5 text-micro font-medium transition",
                                chip === c
                                    ? "border-primary/40 bg-primary/10 text-primary"
                                    : "border-border text-muted-foreground hover:bg-muted"
                            )}
                        >
                            {c}
                            {c === "Favorites" && state.favorites.length > 0 ? ` ${state.favorites.length}` : ""}
                        </button>
                    ))}
                </div>

                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-2 border-b border-border pb-1 text-micro uppercase tracking-wider text-muted-foreground">
                    <span>Symbol</span>
                    <span className="text-right">Price</span>
                    <span className="text-right">Day</span>
                </div>

                <ul className="mt-1 max-h-[46vh] overflow-y-auto">
                    {visible.length === 0 ? (
                        <li className="px-1 py-3 text-micro leading-4 text-muted-foreground">
                            {chip === "All"
                                ? "Your watchlist is empty. Use + to add a symbol."
                                : `No watchlist symbol in ${chip}.`}
                        </li>
                    ) : null}

                    {visible.map((s) => {
                        const q = quotes[s];
                        const price = typeof q?.bid === "number" ? q.bid : null;
                        const change = typeof q?.changePercent === "number" ? q.changePercent : null;
                        const active = s === state.symbol;
                        const fav = state.favorites.includes(s);
                        const sig = signalBySymbol.get(s);
                        const idx = state.watchlist.indexOf(s);

                        return (
                            <li key={s}>
                                <div
                                    className={cn(
                                        "group grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 rounded-md px-1 py-1.5 transition",
                                        active ? "bg-primary/10" : "hover:bg-muted/60"
                                    )}
                                >
                                    <button
                                        type="button"
                                        onClick={() => setSymbol(s)}
                                        className="min-w-0 text-left"
                                        aria-pressed={active}
                                    >
                                        <span className="flex items-center gap-1">
                                            <span
                                                className={cn(
                                                    "font-numeric text-micro font-semibold",
                                                    active ? "text-primary" : "text-foreground"
                                                )}
                                            >
                                                {s}
                                            </span>
                                            {sig ? (
                                                <span
                                                    className={cn(
                                                        "rounded border px-1 text-[8px] font-bold tracking-wide",
                                                        sig.startsWith("LONG")
                                                            ? "border-positive/40 text-positive"
                                                            : "border-negative/40 text-negative"
                                                    )}
                                                    title="Deterministic scanner signal for this symbol"
                                                >
                                                    {sig}
                                                </span>
                                            ) : null}
                                        </span>
                                    </button>

                                    <span className="text-right font-numeric text-micro tabular-nums text-foreground">
                                        {price !== null ? fmtPrice(price) : quotesLoading ? "…" : "—"}
                                    </span>

                                    <span
                                        className={cn(
                                            "w-14 text-right font-numeric text-micro tabular-nums",
                                            change === null
                                                ? "text-muted-foreground"
                                                : change >= 0
                                                  ? "text-positive"
                                                  : "text-negative"
                                        )}
                                    >
                                        {change !== null ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "—"}
                                    </span>

                                    <span className="col-span-3 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                                        <button
                                            type="button"
                                            onClick={() => toggleFavorite(s)}
                                            aria-label={fav ? `Remove ${s} from favourites` : `Add ${s} to favourites`}
                                            aria-pressed={fav}
                                            className="rounded p-0.5 text-muted-foreground transition hover:text-foreground"
                                        >
                                            <Star className={cn("size-3", fav && "fill-warning text-warning")} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => move(s, -1)}
                                            disabled={idx <= 0}
                                            aria-label={`Move ${s} up`}
                                            className="rounded p-0.5 text-muted-foreground transition hover:text-foreground disabled:opacity-30"
                                        >
                                            <ChevronUp className="size-3" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => move(s, 1)}
                                            disabled={idx >= state.watchlist.length - 1}
                                            aria-label={`Move ${s} down`}
                                            className="rounded p-0.5 text-muted-foreground transition hover:text-foreground disabled:opacity-30"
                                        >
                                            <ChevronDown className="size-3" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => removeFromWatchlist(s)}
                                            aria-label={`Remove ${s} from watchlist`}
                                            className="rounded p-0.5 text-muted-foreground transition hover:text-negative"
                                        >
                                            <Trash2 className="size-3" />
                                        </button>
                                    </span>
                                </div>
                            </li>
                        );
                    })}
                </ul>

                <div className="mt-1.5 flex items-center justify-between border-t border-border pt-1.5 text-micro text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                        {quotesLoading ? <Loader2 className="size-2.5 animate-spin" /> : quotesError ? <WifiOff className="size-2.5 text-warning" /> : null}
                        {quotesError ? "Quote feed unavailable" : "Quotes · 1h change"}
                    </span>
                    <span className="font-numeric">{SUPPORTED_SYMBOLS.length} supported</span>
                </div>
            </div>

            <MarketOverview now={now} />
        </section>
    );
}

/* ── market overview (Phase 5 §9) ────────────────────────────────────────── */

function MarketOverview({ now }: { now: number }) {
    const { state } = useTerminal();
    const { analysis, lastPrice, changePct, analysisError, analysisLoading } = useTerminalData();

    const session = sessionFor(now);
    const trend = analysis?.structure.trend.value ?? null;
    const regime = analysis?.regime.label.value ?? null;
    // Volatility must be a real measurement: the ATR metrics the deterministic
    // volatility evidence section computed. The raw regime id (e.g.
    // "trending_bearish") is regime data, never volatility, so it is not
    // re-used here under a label it does not answer to.
    const volSection = analysis?.evidence.find((s) => s.id === "volatility") ?? null;
    const volPct = volSection?.metrics.find((m) => m.label === "ATR %")?.value ?? null;
    const volAtr = volSection?.metrics.find((m) => m.label === "ATR(14)")?.value ?? null;
    const volatility =
        volPct !== null && Number.isFinite(volPct) ? `${volPct.toFixed(2)}%`
        : volAtr !== null && Number.isFinite(volAtr) ? `ATR ${fmtPrice(volAtr)}`
        : null;
    const asOf = analysis?.asOf ?? null;

    const rows: Array<{ label: string; value: string; tone?: "up" | "down" | "muted" }> = [
        { label: "Price", value: lastPrice !== null ? fmtPrice(lastPrice) : "unavailable", tone: lastPrice !== null ? undefined : "muted" },
        { label: "Day", value: changePct !== null ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%` : "unavailable", tone: changePct === null ? "muted" : changePct >= 0 ? "up" : "down" },
        { label: "Trend", value: trend ?? "unavailable", tone: trend === null ? "muted" : trend === "bullish" ? "up" : trend === "bearish" ? "down" : "muted" },
        { label: "Regime", value: regime ?? "unavailable", tone: regime === null ? "muted" : undefined },
        { label: "Volatility", value: volatility ?? "unavailable", tone: volatility === null ? "muted" : undefined },
        { label: "Session", value: session.label },
    ];

    return (
        <section className="rounded-lg border border-border bg-card p-2.5" aria-label="Market overview">
            <h2 className="flex items-center justify-between text-micro font-semibold uppercase tracking-wide text-foreground">
                <span>{state.symbol} overview</span>
                <span className="font-numeric text-micro text-muted-foreground">{state.timeframe}</span>
            </h2>
            <dl className="mt-2 space-y-1">
                {rows.map((r) => (
                    <div key={r.label} className="flex items-center justify-between gap-2 text-micro">
                        <dt className="text-muted-foreground">{r.label}</dt>
                        <dd
                            className={cn(
                                "truncate font-numeric tabular-nums",
                                r.tone === "up" && "text-positive",
                                r.tone === "down" && "text-negative",
                                r.tone === "muted" && "text-muted-foreground italic",
                                !r.tone && "text-foreground"
                            )}
                        >
                            {r.value}
                        </dd>
                    </div>
                ))}
            </dl>
            <p className="mt-2 border-t border-border pt-1.5 text-micro leading-4 text-muted-foreground">
                {analysisError
                    ? "Analysis feed unavailable — trend/regime not measured."
                    : analysisLoading && !analysis
                      ? "Loading market data…"
                      : asOf
                        ? `Measured from engine output at ${new Date(asOf).toISOString().slice(11, 19)} UTC.`
                        : "No analysis yet for this symbol/timeframe."}
            </p>
        </section>
    );
}
