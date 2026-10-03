"use client";

// Open positions and recent simulated trades. All numbers are server
// computed marks; the close button submits intent only.

import { useState } from "react";
import { Loader2, XCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Money } from "./primitives";
import { centiLotsToNumber, priceMicrosToNumber } from "@/lib/performance-arena/money";
import type { ChallengeTrade, MarkedTrade } from "@/lib/performance-arena/types";

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
    onClose,
}: {
    positions: MarkedTrade[];
    canClose: boolean;
    onClose: (tradeId: string) => Promise<void>;
}) {
    const [closing, setClosing] = useState<string | null>(null);

    const close = async (tradeId: string) => {
        setClosing(tradeId);
        try {
            await onClose(tradeId);
        } finally {
            setClosing(null);
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
        <div className="rounded-lg border border-border bg-card">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead className="text-right">Entry</TableHead>
                        <TableHead className="text-right">Mark</TableHead>
                        <TableHead className="text-right">Unrealized</TableHead>
                        <TableHead className="text-right">Risk</TableHead>
                        <TableHead />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {positions.map(({ trade, markPriceMicros, unrealizedPnLCents, stale }) => (
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
                                {stale ? <span className="ml-1 text-[10px] text-amber-500">·</span> : null}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">
                                {trade.riskCents !== null ? `$${(trade.riskCents / 100).toFixed(2)}` : "no stop"}
                            </TableCell>
                            <TableCell className="text-right">
                                <button
                                    type="button"
                                    disabled={!canClose || closing === trade.tradeId}
                                    onClick={() => void close(trade.tradeId)}
                                    className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                                >
                                    {closing === trade.tradeId ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                                </button>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

export function RecentTradesTable({ trades }: { trades: ChallengeTrade[] }) {
    if (trades.length === 0) {
        return <p className="text-xs text-muted-foreground">No trades yet.</p>;
    }
    return (
        <div className="rounded-lg border border-border bg-card">
            <Table>
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
                                {trade.exitPriceMicros !== null ? priceMicrosToNumber(trade.exitPriceMicros) : "—"}
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
