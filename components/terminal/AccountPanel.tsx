"use client";

/**
 * AccountPanel — Phase 5 §17 / §18 / §19.
 *
 * Positions, pending orders and the account read-out, all fed by the same
 * RTDB records the live trading page uses. There is a second source in play —
 * the canonical Risk HUD endpoint — but it only reports guard status; it never
 * re-computes what this panel already shows.
 *
 * Paper and live are never blurred: the mode badge comes from the terminal
 * context and execution controls are disabled outright when there is no
 * established account (fail closed, §27).
 */

import { useState } from "react";
import { ListOrdered, TrendingUp, Wallet, Loader2, Lock, ExternalLink } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import OpenPositions from "@/components/trading/OpenPositions";
import PendingOrders from "@/components/trading/PendingOrders";
import AccountHeader from "@/components/trading/AccountHeader";
import { useTerminal } from "./TerminalContext";
import { useTerminalData } from "./TerminalData";
import { PanelErrorBoundary } from "./PanelErrorBoundary";

type Tab = "positions" | "orders" | "account";

const TABS: Array<{ id: Tab; label: string; icon: typeof TrendingUp }> = [
    { id: "positions", label: "Positions", icon: TrendingUp },
    { id: "orders", label: "Orders", icon: ListOrdered },
    { id: "account", label: "Account", icon: Wallet },
];

export function AccountPanel() {
    const [tab, setTab] = useState<Tab>("positions");
    const { state } = useTerminal();
    const data = useTerminalData();
    const token = data.token;
    const hasAccount = !!data.account;

    const mutate = async (init: RequestInit) => {
        if (!token || !hasAccount) return;
        try {
            await fetch("/api/trading/orders", {
                ...init,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                    ...(init.headers ?? {}),
                },
            });
        } catch {
            // The gateway is the only source of truth for fills; a failed
            // call changes nothing on screen.
        }
    };

    const handleClose = (ticket: string) =>
        mutate({ method: "DELETE", body: JSON.stringify({ ticket, action: "close" }) });

    const handlePartialClose = (ticket: string, volume: number) =>
        mutate({ method: "DELETE", body: JSON.stringify({ ticket, action: "partial_close", volume }) });

    const handleModify = (ticket: string, sl: number, tp: number) =>
        mutate({ method: "PATCH", body: JSON.stringify({ ticket, sl, tp }) });

    const handleCancel = (ticket: string) =>
        mutate({ method: "DELETE", body: JSON.stringify({ ticket, action: "cancel_order" }) });

    const counts = { positions: data.positions.length, orders: data.orders.length };

    return (
        <section className="flex min-w-0 flex-col rounded-xl border border-border bg-card" aria-label="Account">
            <header className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
                {TABS.map((t) => {
                    const Icon = t.icon;
                    const active = tab === t.id;
                    return (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => setTab(t.id)}
                            aria-pressed={active}
                            className={cn(
                                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition",
                                active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                            )}
                        >
                            <Icon className="size-3" />
                            {t.label}
                            {t.id !== "account" ? (
                                <span className="font-mono text-[10px] text-muted-foreground">
                                    {counts[t.id as "positions" | "orders"]}
                                </span>
                            ) : null}
                        </button>
                    );
                })}

                <span className="ml-auto flex items-center gap-1.5">
                    <span
                        className={cn(
                            "rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-wider",
                            state.accountMode === "live"
                                ? "border-rose-500/50 bg-rose-500/10 text-rose-400"
                                : state.accountMode === "paper"
                                  ? "border-sky-500/50 bg-sky-500/10 text-sky-400"
                                  : "border-border text-muted-foreground"
                        )}
                    >
                        {state.accountMode === "live" ? "LIVE" : state.accountMode === "paper" ? "PAPER" : "NO ACCOUNT"}
                    </span>
                    {!hasAccount && !data.accountLoading ? (
                        <Link
                            href="/account/trading-access"
                            className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition hover:bg-muted"
                        >
                            Connect account <ExternalLink className="size-2.5" />
                        </Link>
                    ) : null}
                </span>
            </header>

            <div className="min-h-[9rem] p-3">
                <PanelErrorBoundary name="Account">
                    {data.accountLoading ? (
                        <p className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                            <Loader2 className="size-3.5 animate-spin" />
                            Loading account state…
                        </p>
                    ) : !hasAccount ? (
                        <p className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                            <Lock className="size-3.5" />
                            No connected account. Positions and orders are unavailable — nothing is simulated here.
                        </p>
                    ) : (
                        <>
                            {tab === "positions" ? (
                                <OpenPositions
                                    positions={data.positions}
                                    onClose={handleClose}
                                    onPartialClose={handlePartialClose}
                                    onModify={handleModify}
                                />
                            ) : null}
                            {tab === "orders" ? <PendingOrders orders={data.orders} onCancel={handleCancel} /> : null}
                            {tab === "account" ? <AccountHeader account={data.account} loading={false} /> : null}
                        </>
                    )}
                </PanelErrorBoundary>
            </div>
        </section>
    );
}
