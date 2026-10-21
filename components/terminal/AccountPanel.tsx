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

import { useEffect, useReducer, useState } from "react";
import { ListOrdered, TrendingUp, Wallet, Loader2, Lock, ExternalLink } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import OpenPositions from "@/components/trading/OpenPositions";
import PendingOrders from "@/components/trading/PendingOrders";
import AccountHeader from "@/components/trading/AccountHeader";
import { TradingProviderStatus } from "./TradingProviderStatus";
import {
    ExecutionOutcomeTracker,
    isUnknownOutcome,
    targetKeyFor,
    type UnifiedExecutePayload,
} from "@/lib/trading/unified/client";
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
    const [actionError, setActionError] = useState<string | null>(null);
    const [, bumpOutcomes] = useReducer((n: number) => n + 1, 0);
    const [outcomes] = useState(() => new ExecutionOutcomeTracker({ onChange: () => bumpOutcomes() }));
    useEffect(() => () => outcomes.dispose(), [outcomes]);
    const { state } = useTerminal();
    const data = useTerminalData();
    const token = data.token;
    const accountId = data.account?.accountId ?? null;
    const hasAccount = !!data.account;

    /**
     * All mutations go through the Unified Trading API — the same canonical
     * pipeline as every other Pro Terminal surface. Percentage partial close
     * is % of CURRENT position volume, computed server-side.
     */
    const runUnified = async (
        payload: Omit<UnifiedExecutePayload, "clientRequestId">,
        describe: string
    ): Promise<void> => {
        if (!token || !accountId) return;
        setActionError(null);
        // One SHARED lock per target: close and modify on the same position
        // block each other. A repeat click replays the SAME clientRequestId.
        const key = targetKeyFor(payload);
        try {
            // run(): an identical action replays the owner's request; a different
            // action on the same position is blocked, never sent.
            const result = await outcomes.run(key, payload, token);
            if (result.status === "EXECUTED_PENDING_SYNC") {
                setActionError(`${describe}: executed — syncing on the next snapshot.`);
            }
            if (result.status === "ACCEPTED") {
                setActionError(`${describe}: queued on the broker, still unconfirmed. Click again to check the same request.`);
            }
        } catch (error) {
            const suffix = isUnknownOutcome(error)
                ? " Outcome unconfirmed — nothing was resent. Click again to confirm the same request."
                : "";
            setActionError(
                `${describe}: ${error instanceof Error ? error.message : "execution failed."}${suffix}`
            );
        }
    };

    const handleClose = (ticket: string) =>
        runUnified({ accountId: accountId!, executionType: "CLOSE_POSITION", positionId: ticket }, `Close ${ticket}`);

    const handlePartialClose = (ticket: string, percentage: number) =>
        runUnified(
            { accountId: accountId!, executionType: "PARTIAL_CLOSE", positionId: ticket, percentage },
            `Partial close ${percentage}% of ${ticket}`
        );

    const handleModify = (ticket: string, sl: number | null, tp: number | null) =>
        runUnified(
            {
                accountId: accountId!,
                executionType: "MODIFY_POSITION",
                positionId: ticket,
                stopLoss: sl,
                takeProfit: tp,
            },
            `Modify ${ticket}`
        );

    const handleCancel = (ticket: string) =>
        runUnified({ accountId: accountId!, executionType: "CANCEL_ORDER", orderId: ticket }, `Cancel ${ticket}`);

    const counts = { positions: data.positions.length, orders: data.orders.length };

    return (
        <section className="flex min-w-0 flex-col rounded-lg border border-border bg-card" aria-label="Account">
            <header className="flex flex-wrap items-center gap-1 border-b border-border px-1 py-0.5.5">
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
                                "inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[12px] font-normal transition",
                                active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                            )}
                        >
                            <Icon className="size-3" />
                            {t.label}
                            {t.id !== "account" ? (
                                <span className="font-numeric text-micro text-muted-foreground">
                                    {counts[t.id as "positions" | "orders"]}
                                </span>
                            ) : null}
                        </button>
                    );
                })}

                <span className="ml-auto flex items-center gap-1">
                    <span
                        className={cn(
                            "rounded-full border px-1 py-0.5 text-micro font-normal text-[8px] tracking-wider",
                            state.accountMode === "live"
                                ? "border-negative/40 bg-negative-muted text-negative-foreground"
                                : state.accountMode === "paper"
                                  ? "border-info/40 bg-info-muted text-info-foreground"
                                  : "border-border text-muted-foreground"
                        )}
                    >
                        {state.accountMode === "live" ? "LIVE" : state.accountMode === "paper" ? "PAPER" : "NO ACCOUNT"}
                    </span>
                    {!hasAccount && !data.accountLoading ? (
                        <Link
                            href="/account/trading-access"
                            className="inline-flex items-center gap-1 rounded-full border border-border px-1 py-0.5 text-micro text-muted-foreground transition hover:bg-muted"
                        >
                            Connect account <ExternalLink className="size-2.5" />
                        </Link>
                    ) : null}
                </span>
            </header>

            <div className="min-h-[9rem] p-3">
                <PanelErrorBoundary name="Account">
                    {data.accountLoading ? (
                        <p className="flex items-center gap-2 py-6 text-[12px] text-muted-foreground">
                            <Loader2 className="size-3.5 animate-spin" />
                            Loading account state…
                        </p>
                    ) : !hasAccount ? (
                        <p className="flex items-center gap-2 py-6 text-[12px] text-muted-foreground">
                            <Lock className="size-3.5" />
                            No connected account. Positions and orders are unavailable — nothing is simulated here.
                        </p>
                    ) : (
                        <>
                            {actionError ? (
                                <div className="mb-3 flex items-start justify-between gap-2 rounded-lg border border-warning/30 bg-warning-muted px-3 py-1 text-[12px] text-warning-foreground">
                                    <span>{actionError}</span>
                                    <button
                                        type="button"
                                        onClick={() => setActionError(null)}
                                        className="shrink-0 rounded px-1 opacity-70 transition hover:opacity-100"
                                        aria-label="Dismiss"
                                    >
                                        ×
                                    </button>
                                </div>
                            ) : null}
                            {tab === "positions" ? (
                                <OpenPositions
                                    positions={data.positions}
                                    onClose={handleClose}
                                    onPartialClose={handlePartialClose}
                                    onModify={handleModify}
                                    onActionError={setActionError}
                                />
                            ) : null}
                            {tab === "orders" ? <PendingOrders orders={data.orders} onCancel={handleCancel} /> : null}
                            {tab === "account" ? (
                                <div className="space-y-3">
                                    <AccountHeader account={data.account} loading={false} />
                                    <TradingProviderStatus />
                                </div>
                            ) : null}
                        </>
                    )}
                </PanelErrorBoundary>
            </div>
        </section>
    );
}
