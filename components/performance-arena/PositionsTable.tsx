"use client";

// Open positions and recent simulated trades. All numbers are server
// computed marks; the close button submits intent only.

import { useState } from "react";
import { Loader2, XCircle, Pencil, Check, X, Scissors, Lock } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Money } from "./primitives";
import { centiLotsToNumber, priceMicrosToNumber } from "@/lib/performance-arena/money";
import type { ChallengePendingOrder, ChallengeTrade, MarkedTrade } from "@/lib/performance-arena/types";

function SideBadge({ side }: { side: "long" | "short" }) {
    return side === "long" ? (
        <Badge variant="success">Long</Badge>
    ) : (
        <Badge variant="destructive">Short</Badge>
    );
}

export function PositionsTable({
    positions,
    canClose,
    canModifyStops = canClose,
    onClose,
    onPartialClose,
    onModifyStops,
}: {
    positions: MarkedTrade[];
    canClose: boolean;
    canModifyStops?: boolean;
    onClose: (tradeId: string) => Promise<void>;
    /** Opens the two-mode partial-close dialog (volume % vs profit %). */
    onPartialClose?: (trade: MarkedTrade, mode: "VOLUME" | "PROFIT_PRESERVATION", percent: number) => void;
    onModifyStops?: (tradeId: string, stops: { stopLoss?: number | null; takeProfit?: number | null }) => Promise<void>;
}) {
    const [closing, setClosing] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [stopLoss, setStopLoss] = useState("");
    const [takeProfit, setTakeProfit] = useState("");
    const [savingStops, setSavingStops] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);

    const close = async (tradeId: string) => {
        setClosing(tradeId);
        try {
            await onClose(tradeId);
        } finally {
            setClosing(null);
        }
    };

    const saveStops = async (tradeId: string) => {
        if (!onModifyStops) return;
        setSavingStops(true);
        setActionError(null);
        try {
            await onModifyStops(tradeId, {
                stopLoss: stopLoss.trim() === "" ? null : Number(stopLoss),
                takeProfit: takeProfit.trim() === "" ? null : Number(takeProfit),
            });
            setEditingId(null);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Could not update protection levels.");
        } finally {
            setSavingStops(false);
        }
    };

    if (positions.length === 0) {
        return (
            <p className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
                No open positions — you are flat.
            </p>
        );
    }

    return (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <Table className="min-w-[920px]">
                <TableHeader>
                    <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead className="text-right">Entry</TableHead>
                        <TableHead className="text-right">Mark</TableHead>
                        <TableHead className="text-right">Unrealized</TableHead>
                        <TableHead className="text-right">Risk</TableHead>
                        <TableHead>Protection</TableHead>
                        <TableHead />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {positions.map((marked) => {
                        const { trade, markPriceMicros, unrealizedPnLCents, stale } = marked;
                        return (
                        <TableRow key={trade.tradeId}>
                            <TableCell className="font-mono text-xs">{trade.symbol}</TableCell>
                            <TableCell><SideBadge side={trade.side} /></TableCell>
                            <TableCell className="font-mono text-xs">{centiLotsToNumber(trade.sizeCentiLots).toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{priceMicrosToNumber(trade.entryPriceMicros)}</TableCell>
                            <TableCell className="text-right font-mono text-xs">
                                {markPriceMicros !== null ? priceMicrosToNumber(markPriceMicros) : <span className="text-amber-500">stale</span>}
                            </TableCell>
                            <TableCell className="text-right">
                                <Money cents={unrealizedPnLCents} signed />
                                {stale ? <span className="ml-1 text-micro text-amber-500">·</span> : null}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">
                                {trade.riskCents !== null ? `$${(trade.riskCents / 100).toFixed(2)}` : "no stop"}
                            </TableCell>
                            <TableCell>
                                {editingId === trade.tradeId ? (
                                    <div className="flex min-w-48 items-center gap-1">
                                        <input aria-label={`Stop loss for ${trade.symbol}`} value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} placeholder={trade.stopLossMicros === null ? "SL" : priceMicrosToNumber(trade.stopLossMicros).toString()} className="w-20 rounded border border-border bg-background px-1.5 py-1 font-mono text-micro" />
                                        <input aria-label={`Take profit for ${trade.symbol}`} value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} placeholder={trade.takeProfitMicros === null ? "TP" : priceMicrosToNumber(trade.takeProfitMicros).toString()} className="w-20 rounded border border-border bg-background px-1.5 py-1 font-mono text-micro" />
                                        <button type="button" aria-label="Save protection levels" disabled={savingStops} onClick={() => void saveStops(trade.tradeId)} className="rounded p-1 text-emerald-600 disabled:opacity-50">{savingStops ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}</button>
                                        <button type="button" aria-label="Cancel edit" disabled={savingStops} onClick={() => setEditingId(null)} className="rounded p-1 text-muted-foreground"><X className="h-3 w-3" /></button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-1.5 font-mono text-micro text-muted-foreground">
                                        <span>SL {trade.stopLossMicros === null ? "—" : priceMicrosToNumber(trade.stopLossMicros)}</span>
                                        <span>TP {trade.takeProfitMicros === null ? "—" : priceMicrosToNumber(trade.takeProfitMicros)}</span>
                                        {canModifyStops && onModifyStops ? <button type="button" aria-label={`Edit protection for ${trade.symbol}`} onClick={() => { setStopLoss(trade.stopLossMicros === null ? "" : priceMicrosToNumber(trade.stopLossMicros).toString()); setTakeProfit(trade.takeProfitMicros === null ? "" : priceMicrosToNumber(trade.takeProfitMicros).toString()); setEditingId(trade.tradeId); setActionError(null); }} className="rounded p-1 hover:bg-muted"><Pencil className="h-3 w-3" /></button> : null}
                                    </div>
                                )}
                            </TableCell>
                            <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                    {onPartialClose ? (
                                        <>
                                            {/* Shortcuts that name the MODE, so a 50% is never ambiguous. */}
                                            <button
                                                type="button"
                                                aria-label={`Lock 50% of the profit on the ${trade.symbol} position`}
                                                disabled={!canClose}
                                                onClick={() => onPartialClose(marked, "PROFIT_PRESERVATION", 50)}
                                                title="Lock 50% of the current profit"
                                                className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border px-2 py-1 text-micro text-muted-foreground hover:bg-muted disabled:opacity-50"
                                                data-partial-mode="PROFIT_PRESERVATION"
                                                data-partial-percent="50"
                                            >
                                                <Lock className="h-3 w-3" />
                                                <span className="hidden md:inline">Lock 50%</span>
                                            </button>
                                            <button
                                                type="button"
                                                aria-label={`Close 50% of the volume of the ${trade.symbol} position`}
                                                disabled={!canClose}
                                                onClick={() => onPartialClose(marked, "VOLUME", 50)}
                                                title="Close 50% of the position volume"
                                                className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border px-2 py-1 text-micro text-muted-foreground hover:bg-muted disabled:opacity-50"
                                                data-partial-mode="VOLUME"
                                                data-partial-percent="50"
                                            >
                                                <Scissors className="h-3 w-3" />
                                                <span className="hidden md:inline">Half size</span>
                                            </button>
                                        </>
                                    ) : null}
                                    <button
                                        type="button"
                                        aria-label={`Close ${trade.side === "long" ? "buy" : "sell"} position in ${trade.symbol}`}
                                        disabled={!canClose || closing === trade.tradeId}
                                        onClick={() => void close(trade.tradeId)}
                                        className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                                    >
                                        {closing === trade.tradeId ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                                        <span className="hidden sm:inline">Close</span>
                                    </button>
                                </div>
                            </TableCell>
                        </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
            {actionError ? <p role="alert" className="border-t border-destructive/30 px-3 py-2 text-xs text-destructive">{actionError}</p> : null}
        </div>
    );
}

export function PendingOrdersTable({ orders, canCancel, onCancel }: { orders: ChallengePendingOrder[]; canCancel: boolean; onCancel: (orderId: string) => Promise<void> }) {
    const [cancelling, setCancelling] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const cancel = async (orderId: string) => {
        setCancelling(orderId);
        setError(null);
        try { await onCancel(orderId); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not cancel order."); }
        finally { setCancelling(null); }
    };
    const pending = orders.filter((order) => order.status === "pending" || order.status === "processing");
    if (pending.length === 0) return <p className="rounded-md border border-border bg-card p-4 text-xs text-muted-foreground">No pending orders.</p>;
    return (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <Table className="min-w-[680px]">
                <TableHeader><TableRow><TableHead>Symbol</TableHead><TableHead>Type</TableHead><TableHead>Side</TableHead><TableHead className="text-right">Size</TableHead><TableHead className="text-right">Trigger price</TableHead><TableHead>Expires</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>{pending.map((order) => <TableRow key={order.orderId}>
                    <TableCell className="font-mono">{order.symbol}</TableCell><TableCell className="capitalize">{order.orderType}</TableCell><TableCell><SideBadge side={order.side} /></TableCell><TableCell className="text-right font-mono">{centiLotsToNumber(order.sizeCentiLots).toFixed(2)}</TableCell><TableCell className="text-right font-mono">{priceMicrosToNumber(order.entryPriceMicros)}</TableCell><TableCell>{new Date(order.expiresAt).toLocaleDateString()}</TableCell><TableCell className="text-right"><button type="button" disabled={!canCancel || cancelling === order.orderId} onClick={() => void cancel(order.orderId)} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50">{cancelling === order.orderId ? "Cancelling…" : "Cancel"}</button></TableCell>
                </TableRow>)}</TableBody>
            </Table>
            {error ? <p role="alert" className="border-t border-destructive/30 p-2 text-xs text-destructive">{error}</p> : null}
        </div>
    );
}

export function RecentTradesTable({ trades }: { trades: ChallengeTrade[] }) {
    if (trades.length === 0) {
        return <p className="text-xs text-muted-foreground">No trades yet.</p>;
    }
    return (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <Table className="min-w-[620px]">
                <TableHeader>
                    <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead className="text-right">Size</TableHead>
                        <TableHead className="text-right">Net PnL</TableHead>
                        <TableHead className="text-right">Exit</TableHead>
                        <TableHead>Status</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {trades.slice(0, 20).map((trade) => (
                        <TableRow key={trade.tradeId}>
                            <TableCell className="font-mono text-xs">{trade.symbol}</TableCell>
                            <TableCell><SideBadge side={trade.side} /></TableCell>
                            <TableCell className="text-right font-mono text-xs">{centiLotsToNumber(trade.sizeCentiLots).toFixed(2)}</TableCell>
                            <TableCell className="text-right">
                                {trade.status === "closed" && trade.realizedPnLCents !== null ? (
                                    <Money cents={trade.realizedPnLCents} signed />
                                ) : (
                                    <span className="text-xs text-muted-foreground">open</span>
                                )}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">
                                {trade.exitPriceMicros !== null && Number.isFinite(trade.exitPriceMicros) ? priceMicrosToNumber(trade.exitPriceMicros) : "—"}
                            </TableCell>
                            <TableCell>
                                <Badge variant={trade.status === "closed" ? "secondary" : "outline"}>{trade.status}</Badge>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
