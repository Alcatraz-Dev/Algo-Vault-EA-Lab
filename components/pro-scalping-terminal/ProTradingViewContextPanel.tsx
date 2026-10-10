"use client";

/**
 * Pro Scalping Terminal — TRADINGVIEW CONTEXT panel (PHASE 6).
 *
 * Pure presentation: fetches nothing itself — the terminal owns polling and
 * passes the payload in. Shows optional external context (technical snapshot,
 * news, economic events, freshness) with the mandatory delayed-data notice.
 * Every state renders honestly: connected / not connected / disabled / error.
 * This panel NEVER supplies the live chart price and never gates signals.
 */
import { Info, Newspaper, Zap, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TradingViewContextSection {
    available: boolean;
    state: string;
    message?: string;
    items: Array<{ label: string; value: string; freshnessLabel: string }>;
}

export interface TradingViewContextPayload {
    technicals: TradingViewContextSection;
    news: TradingViewContextSection;
    economicCalendar: TradingViewContextSection;
}

const STATE_STYLES: Record<string, string> = {
    CONNECTED: "bg-emerald-500/10 text-emerald-400",
    DISABLED: "bg-muted text-muted-foreground",
    NOT_CONNECTED: "bg-muted text-muted-foreground",
    RATE_LIMITED: "bg-amber-500/10 text-amber-400",
    REAUTH_REQUIRED: "bg-amber-500/10 text-amber-400",
    TOKEN_EXPIRED: "bg-amber-500/10 text-amber-400",
    UNAVAILABLE: "bg-rose-500/10 text-rose-400",
    ERROR: "bg-rose-500/10 text-rose-400",
};

function SectionCard({
    icon,
    title,
    section,
}: {
    icon: React.ReactNode;
    title: string;
    section: TradingViewContextSection | undefined;
}) {
    if (!section) return null;
    const stateStyle = STATE_STYLES[section.state] ?? "bg-muted text-muted-foreground";
    return (
        <div className="rounded-lg bg-muted/40 p-2.5">
            <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-micro font-semibold text-foreground">
                    {icon}
                    {title}
                </span>
                <span className={cn("rounded px-1.5 py-0.5 text-micro font-medium", stateStyle)}>{section.state}</span>
            </div>
            {section.available ? (
                <ul className="mt-1.5 space-y-1">
                    {section.items.map((item, i) => (
                        <li key={i} className="text-micro leading-4 text-muted-foreground">
                            <span className="text-micro uppercase tracking-wide text-muted-foreground/70">{item.freshnessLabel}</span>
                            <p className="mt-0.5 whitespace-pre-line">{item.value}</p>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="mt-1 text-micro text-muted-foreground">{section.message || "Not available."}</p>
            )}
        </div>
    );
}

export function ProTradingViewContextPanel({ context }: { context: TradingViewContextPayload | null }) {
    if (!context) {
        return (
            <section className="rounded-lg border border-border bg-card">
                <div className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2">
                    <Zap size={14} className="text-muted-foreground" />
                    <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-foreground">TradingView Context</h2>
                    <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-micro text-muted-foreground">OFF</span>
                </div>
                <p className="px-3 py-3 text-micro text-muted-foreground">
                    Not loaded. Connect TradingView in Account → Settings → Integrations to add external context here.
                </p>
            </section>
        );
    }

    const allUnavailable = [context.technicals, context.news, context.economicCalendar].every((s) => !s?.available);

    return (
        <section className="rounded-lg border border-border bg-card">
            <div className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2">
                <Zap size={14} className="text-blue-400" />
                <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-foreground">TradingView Context</h2>
                <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-micro font-medium text-blue-400">BETA</span>
                <span className="ml-auto text-micro text-muted-foreground">external · may be delayed</span>
            </div>

            <div className="grid gap-2 p-2.5 sm:grid-cols-3">
                <SectionCard icon={<Zap size={11} className="text-blue-400" />} title="Technicals" section={context.technicals} />
                <SectionCard icon={<Newspaper size={11} className="text-blue-400" />} title="News" section={context.news} />
                <SectionCard icon={<CalendarClock size={11} className="text-blue-400" />} title="Economic events" section={context.economicCalendar} />
            </div>

            {allUnavailable ? (
                <p className="px-3 pb-2 text-micro text-muted-foreground">
                    TradingView context is unavailable — the terminal continues to operate on AlgoVault data only.
                </p>
            ) : null}

            <p className="flex items-start gap-1.5 border-t border-border px-3 py-2 text-micro leading-4 text-muted-foreground">
                <Info size={10} className="mt-0.5 shrink-0" />
                <span>
                    TradingView MCP data may be delayed and is not intended for latency-sensitive execution. This panel is
                    context only — it never drives the live chart price or the deterministic signal scanner.
                </span>
            </p>
        </section>
    );
}
