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
import { Chip, Panel, PanelHeader, type ChipTone } from "./ProTerminalPanels";

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

const STATE_TONES: Record<string, ChipTone> = {
    CONNECTED: "positive",
    DISABLED: "neutral",
    NOT_CONNECTED: "neutral",
    RATE_LIMITED: "warning",
    REAUTH_REQUIRED: "warning",
    TOKEN_EXPIRED: "warning",
    UNAVAILABLE: "negative",
    ERROR: "negative",
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
    const tone = STATE_TONES[section.state] ?? "neutral";
    return (
        <div className="rounded-lg bg-muted/40 p-2.5">
            <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-micro font-medium text-foreground">
                    {icon}
                    {title}
                </span>
                <Chip tone={tone} className="font-medium uppercase tracking-wide">
                    {section.state}
                </Chip>
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
            <Panel>
                <PanelHeader
                    icon={<Zap size={14} />}
                    title="TradingView Context"
                    right={<Chip className="font-medium uppercase tracking-wide">OFF</Chip>}
                />
                <p className="px-3 py-3 text-micro text-muted-foreground">
                    Not loaded. Connect TradingView in Account → Settings → Integrations to add external context here.
                </p>
            </Panel>
        );
    }

    const allUnavailable = [context.technicals, context.news, context.economicCalendar].every((s) => !s?.available);

    return (
        <Panel>
            <PanelHeader
                icon={<Zap size={14} />}
                title="TradingView Context"
                meta={<Chip tone="info" className="font-medium uppercase tracking-wide">BETA</Chip>}
                right={<span className="text-micro text-muted-foreground">external · may be delayed</span>}
            />
            <div className="grid gap-2 p-2.5 sm:grid-cols-3">
                <SectionCard icon={<Zap size={11} className="text-info" />} title="Technicals" section={context.technicals} />
                <SectionCard icon={<Newspaper size={11} className="text-info" />} title="News" section={context.news} />
                <SectionCard icon={<CalendarClock size={11} className="text-info" />} title="Economic events" section={context.economicCalendar} />
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
        </Panel>
    );
}
