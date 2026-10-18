"use client";

// Open positions and recent simulated trades. All numbers are server
// computed marks; the close button submits intent only.

import { useState } from "react";
import { Loader2, XCircle, Pencil, Check, X, Scissors } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
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
    const [slError, setSlError] = useState<string | null>(null);
    const [tpError, setTpError] = useState<string | null>(null);

    const close = async (tradeId: string) => {
        setClosing(tradeId);
        try {
            await onClose(tradeId);
        } finally {
            setClosing(null);
        }
    };

    /** Validates a stop-loss or take-profit price against the entry and side.
     * A stop must sit on the loss side of entry; a target on the profit side. */
    const validateLevel = (
        value: string,
        entry: number,
        isStopLoss: boolean,
        side: "long" | "short",
    ): string | null => {
        const trimmed = value.trim();
        if (trimmed === "") return null;
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed)) return "Enter a valid price.";
        if (entry <= 0) return null;
        // For a short, the loss side is above entry (price rising against you).
        // For a long, the loss side is below entry (price falling against you).
        const onLossSide = side === "short" ? parsed > entry : parsed < entry;
        const onProfitSide = side === "short" ? parsed < entry : parsed > entry;
        if (isStopLoss && !onLossSide) {
            return side === "short"
                ? "Stop-loss must remain above the entry (loss side)."
                : "Stop-loss must remain below the entry (loss side).";
        }
        if (!isStopLoss && !onProfitSide) {
            return side === "short"
                ? "Take profit must sit above the entry (profit side)."
                : "Take profit must sit below the entry (profit side).";
        }
        return null;
    };

    const saveStops = async (tradeId: string, entry: number, side: "long" | "short") => {
        if (!onModifyStops) return;
        const slErr = validateLevel(stopLoss, entry, true, side);
        const tpErr = validateLevel(takeProfit, entry, false, side);
        setSlError(slErr);
        setTpError(tpErr);
        if (slErr || tpErr) return;
        setSavingStops(true);
        setActionError(null);
        try {
            await onModifyStops(tradeId, {
                stopLoss: stopLoss.trim() === "" ? null : Number(stopLoss),
                takeProfit: takeProfit.trim() === "" ? null : Number(takeProfit),
            });
            setEditingId(null);
            setSlError(null);
            setTpError(null);
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
                        <TableHead className="text-right">Size</TableHead>
                        <TableHead className="text-right">Entry</TableHead>
                        <TableHead className="text-right">Mark</TableHead>
                        <TableHead className="text-right">Unrealized</TableHead>
                        <TableHead className="text-right">Risk</TableHead>
                        <TableHead>Protection</TableHead>
                        <TableHead className="text-right" />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {positions.map((marked) => {
                        const { trade, markPriceMicros, unrealizedPnLCents, stale } = marked;
                        const entry = priceMicrosToNumber(trade.entryPriceMicros);
                        return (
                        <TableRow key={trade.tradeId}>
                            <TableCell className="font-numeric text-xs">{trade.symbol}</TableCell>
                            <TableCell><SideBadge side={trade.side} /></TableCell>
                            <TableCell className="font-numeric text-xs">{centiLotsToNumber(trade.sizeCentiLots).toFixed(2)}</TableCell>
                            <TableCell className="text-right font-numeric text-xs">{priceMicrosToNumber(trade.entryPriceMicros)}</TableCell>
                            <TableCell className="text-right font-numeric text-xs">
                                {markPriceMicros !== null ? priceMicrosToNumber(markPriceMicros) : <span className="text-warning">stale</span>}
                            </TableCell>
                            <TableCell className="text-right">
                                <Money cents={unrealizedPnLCents} signed />
                                {stale ? <span className="ml-1 text-micro text-warning">·</span> : null}
                            </TableCell>
                            <TableCell className="text-right font-numeric text-xs text-muted-foreground">
                                {Number.isFinite(trade.riskCents ?? NaN) ? `$${((trade.riskCents as number) / 100).toFixed(2)}` : "no stop"}
                            </TableCell>
                            <TableCell className="font-numeric text-xs">
                                {editingId === trade.tradeId ? (
                                    <div className="flex flex-col gap-1">
                                        <div className="flex min-w-48 items-center gap-1.5">
                                            <input aria-label={`Stop loss for ${trade.symbol}`} value={stopLoss} onChange={(event) => { setStopLoss(event.target.value); setSlError(null); }} placeholder={trade.stopLossMicros !== null && Number.isFinite(trade.stopLossMicros) ? priceMicrosToNumber(trade.stopLossMicros).toString() : "no SL"} className={`w-24 rounded border bg-background px-1.5 py-1 font-numeric text-xs ${slError ? "border-destructive" : "border-border"}`} />
                                            <input aria-label={`Take profit for ${trade.symbol}`} value={takeProfit} onChange={(event) => { setTakeProfit(event.target.value); setTpError(null); }} placeholder={trade.takeProfitMicros !== null && Number.isFinite(trade.takeProfitMicros) ? priceMicrosToNumber(trade.takeProfitMicros).toString() : "no TP"} className={`w-24 rounded border bg-background px-1.5 py-1 font-numeric text-xs ${tpError ? "border-destructive" : "border-border"}`} />
                                            <Button type="button" aria-label="Save protection levels" disabled={savingStops} onClick={() => void saveStops(trade.tradeId, entry, trade.side)} size="icon-xs" className="text-positive disabled:opacity-50">{savingStops ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}</Button>
                                            <Button type="button" aria-label="Cancel edit" disabled={savingStops} onClick={() => { setEditingId(null); setSlError(null); setTpError(null); }} variant="ghost" size="icon-xs"><X className="h-3 w-3" /></Button>
                                        </div>
                                        {slError ? <p role="alert" className="pl-1 text-micro text-destructive">{slError}</p> : null}
                                        {tpError ? <p role="alert" className="pl-1 text-micro text-destructive">{tpError}</p> : null}
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 text-muted-foreground">
                                        <span>SL {trade.stopLossMicros !== null && Number.isFinite(trade.stopLossMicros) ? priceMicrosToNumber(trade.stopLossMicros) : "no SL"}</span>
                                        <span>TP {trade.takeProfitMicros !== null && Number.isFinite(trade.takeProfitMicros) ? priceMicrosToNumber(trade.takeProfitMicros) : "no TP"}</span>
                                        {canModifyStops && onModifyStops ? <Button type="button" aria-label={`Edit protection for ${trade.symbol}`} onClick={() => { setStopLoss(trade.stopLossMicros !== null && Number.isFinite(trade.stopLossMicros) ? priceMicrosToNumber(trade.stopLossMicros).toString() : ""); setTakeProfit(trade.takeProfitMicros !== null && Number.isFinite(trade.takeProfitMicros) ? priceMicrosToNumber(trade.takeProfitMicros).toString() : ""); setEditingId(trade.tradeId); setActionError(null); setSlError(null); setTpError(null); }} variant="ghost" size="icon-xs"><Pencil className="h-3 w-3" /></Button> : null}
                                    </div>
                                )}
                            </TableCell>
                            <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                    {onPartialClose ? (
                                        <>
                                            {[25, 50, 75].map((pct) => (
                                                <Button
                                                    key={pct}
                                                    type="button"
                                                    aria-label={`Close ${pct}% of the volume of the ${trade.symbol} position`}
                                                    disabled={!canClose}
                                                    onClick={() => onPartialClose(marked, "VOLUME", pct)}
                                                    title={`Close ${pct}% of the position volume`}
                                                    variant="outline"
                                                    size="xs"
                                                    data-partial-mode="VOLUME"
                                                    data-partial-percent={pct}
                                                >
                                                    <Scissors className="h-3 w-3" />
                                                    <span className="hidden sm:inline">{pct}%</span>
                                                </Button>
                                            ))}
                                        </>
                                    ) : null}
                                    <Button
                                        type="button"
                                        aria-label={`Close ${trade.side === "long" ? "buy" : "sell"} position in ${trade.symbol}`}
                                        disabled={!canClose || closing === trade.tradeId}
                                        onClick={() => void close(trade.tradeId)}
                                        variant="destructive"
                                        size="xs"
                                    >
                                        {closing === trade.tradeId ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                                        <span className="hidden sm:inline">Close</span>
                                    </Button>
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
                    <TableCell className="font-numeric">{order.symbol}</TableCell><TableCell className="capitalize">{order.orderType}</TableCell><TableCell><SideBadge side={order.side} /></TableCell><TableCell className="text-right font-numeric">{centiLotsToNumber(order.sizeCentiLots).toFixed(2)}</TableCell><TableCell className="text-right font-numeric">{priceMicrosToNumber(order.entryPriceMicros)}</TableCell><TableCell>{new Date(order.expiresAt).toLocaleDateString()}</TableCell><TableCell className="text-right"><button type="button" disabled={!canCancel || cancelling === order.orderId} onClick={() => void cancel(order.orderId)} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50">{cancelling === order.orderId ? "Cancelling…" : "Cancel"}</button></TableCell>
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
                            <TableCell className="font-numeric text-xs">{trade.symbol}</TableCell>
                            <TableCell><SideBadge side={trade.side} /></TableCell>
                            <TableCell className="text-right font-numeric text-xs">{centiLotsToNumber(trade.sizeCentiLots).toFixed(2)}</TableCell>
                            <TableCell className="text-right">
                                {trade.status === "closed" && trade.realizedPnLCents !== null ? (
                                    <Money cents={trade.realizedPnLCents} signed />
                                ) : (
                                    <span className="text-xs text-muted-foreground">open</span>
                                )}
                            </TableCell>
                            <TableCell className="text-right font-numeric text-xs text-muted-foreground">
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
