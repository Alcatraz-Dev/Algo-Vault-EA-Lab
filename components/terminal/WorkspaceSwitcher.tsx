"use client";

/**
 * WorkspaceSwitcher — Phase 5 §4.
 *
 * One-click switch between the terminal's view presets. A workspace only
 * redefines which panels are visible, how the rails are sized and the default
 * timeframe/mode — panels stay mounted, so no subscription is torn down.
 */

import { useState } from "react";
import { LayoutTemplate, Check, Crown, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { WORKSPACE_PRESETS } from "@/lib/terminal/workspaces";
import type { WorkspaceId } from "@/lib/terminal/types";
import { useTerminal } from "./TerminalContext";

export function WorkspaceSwitcher({ isPro }: { isPro: boolean }) {
    const { state, setWorkspace } = useTerminal();
    const [open, setOpen] = useState(false);
    const [upsell, setUpsell] = useState<string | null>(null);
    const active = WORKSPACE_PRESETS.find((p) => p.id === state.workspace) ?? WORKSPACE_PRESETS[0];

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                aria-haspopup="listbox"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition hover:bg-muted"
            >
                <LayoutTemplate className="size-3.5 text-primary" />
                <span className="max-w-[9rem] truncate">{active.label}</span>
                <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
            </button>

            {open ? (
                <>
                    <button
                        type="button"
                        aria-label="Close workspace menu"
                        className="fixed inset-0 z-30 cursor-default"
                        onClick={() => setOpen(false)}
                    />
                    <ul
                        role="listbox"
                        className="absolute left-0 z-40 mt-1 max-h-[70vh] w-72 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-xl"
                    >
                        {WORKSPACE_PRESETS.map((p) => {
                            const selected = p.id === state.workspace;
                            const locked = p.pro && !isPro;
                            return (
                                <li key={p.id}>
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={selected}
                                        onClick={() => {
                                            if (p.pro && !isPro) {
                                                setUpsell(p.label);
                                                return;
                                            }
                                            setWorkspace(p.id as WorkspaceId);
                                            setOpen(false);
                                        }}
                                        className={cn(
                                            "w-full rounded-lg px-2.5 py-2 text-left transition",
                                            selected ? "bg-primary/10" : "hover:bg-muted"
                                        )}
                                    >
                                        <span className="flex items-center gap-1.5">
                                            <span
                                                className={cn(
                                                    "text-xs font-semibold",
                                                    selected ? "text-primary" : "text-foreground"
                                                )}
                                            >
                                                {p.label}
                                            </span>
                                            {p.pro ? (
                                                <span className="inline-flex items-center gap-0.5 rounded border border-primary/30 px-1 py-px text-[9px] font-bold tracking-wider text-primary">
                                                    <Crown className="size-2.5" />
                                                    PRO
                                                </span>
                                            ) : null}
                                            {locked ? (
                                                <span className="rounded border border-border px-1 py-px text-[9px] uppercase tracking-wide text-muted-foreground">
                                                    limited
                                                </span>
                                            ) : null}
                                            {selected ? <Check className="ml-auto size-3 text-primary" /> : null}
                                        </span>
                                        <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                                            {p.description}
                                        </span>
                                        <span className="mt-1 block font-mono text-[10px] text-muted-foreground/80">
                                            {p.defaultTimeframe} · {p.defaultIntelligenceMode} ·{" "}
                                            {Object.values(p.panels).filter((x) => x.visible).length} panels
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    {upsell ? (
                        <div className="absolute left-0 z-40 mt-1 w-72 rounded-xl border border-primary/40 bg-card p-2.5 shadow-xl">
                            <p className="text-[11px] leading-4 text-foreground">
                                <span className="font-semibold">{upsell}</span> is a Pro workspace.
                            </p>
                            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                                Free keeps the terminal, watchlist, chart, basic Smart Money, basic chat and paper
                                trading.
                            </p>
                            <div className="mt-2 flex gap-1.5">
                                <a
                                    href="/pricing"
                                    className="rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground transition hover:bg-primary/90"
                                >
                                    View plans
                                </a>
                                <button
                                    type="button"
                                    onClick={() => setUpsell(null)}
                                    className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted"
                                >
                                    Not now
                                </button>
                            </div>
                        </div>
                    ) : null}
                </>
            ) : null}
        </div>
    );
}
