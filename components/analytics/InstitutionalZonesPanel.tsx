"use client";

import { AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { Zone, ZoneScore } from "@/lib/market-data/types";
import { cn } from "@/lib/utils";

type Props = {
    zones: Zone[];
    scores: ZoneScore[];
};

function getZoneTypeLabel(type: string): string {
    switch (type) {
        case "order_block": return "Order Block";
        case "fvg": return "Fair Value Gap";
        case "liquidity": return "Liquidity Zone";
        case "vwap": return "VWAP Zone";
        case "prev_high_low": return "Prev High/Low";
        default: return type;
    }
}

function getStatusIcon(status: string) {
    switch (status) {
        case "active": return <CheckCircle size={11} className="text-positive" />;
        case "mitigated": return <AlertTriangle size={11} className="text-warning" />;
        case "invalidated": return <XCircle size={11} className="text-negative" />;
        default: return null;
    }
}

function getStatusColor(status: string): string {
    switch (status) {
        case "active": return "border-positive/20 bg-positive/[0.04]";
        case "mitigated": return "border-warning/20 bg-warning/[0.04]";
        case "invalidated": return "border-negative/20 bg-negative/[0.04] opacity-50";
        default: return "border-border/12 bg-foreground/4";
    }
}

export default function InstitutionalZonesPanel({ zones, scores }: Props) {
    const activeZones = zones.filter((z) => z.status === "active");
    const mitigated = zones.filter((z) => z.status === "mitigated");
    const invalidated = zones.filter((z) => z.status === "invalidated");

    const getScoreForZone = (zoneId: string) => scores.find((s) => s.zoneId === zoneId);

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-3 text-micro text-foreground/70">
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-positive" /> {activeZones.length} Active</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-warning" /> {mitigated.length} Mitigated</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-negative" /> {invalidated.length} Invalidated</span>
            </div>

            <div className="space-y-1.5">
                {activeZones.length === 0 && mitigated.length === 0 && (
                    <p className="py-4 text-center text-xs text-foreground/50">No zones detected</p>
                )}
                {activeZones.slice(0, 5).map((zone) => {
                    const score = getScoreForZone(zone.id);
                    return (
                        <div key={zone.id} className={cn("rounded-lg border px-2.5 py-2", getStatusColor(zone.status))}>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    {getStatusIcon(zone.status)}
                                    <span className="text-xs font-medium text-foreground/70">{getZoneTypeLabel(zone.type)}</span>
                                    <span className={cn("text-micro font-medium", zone.direction === "bullish" ? "text-positive" : zone.direction === "bearish" ? "text-negative" : "text-muted-foreground")}>
                                        {zone.direction}
                                    </span>
                                </div>
                                {score && (
                                    <span className={cn("font-mono text-micro font-bold", score.strength >= 70 ? "text-positive" : score.strength >= 40 ? "text-warning" : "text-foreground/70")}>
                                        {score.strength}/100
                                    </span>
                                )}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-micro text-foreground/70">
                                <span className="font-mono">{zone.low.toFixed(zone.low >= 100 ? 2 : 5)} — {zone.high.toFixed(zone.high >= 100 ? 2 : 5)}</span>
                                <span>{zone.timeframe}</span>
                            </div>
                            {score && score.reasons.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                    {score.reasons.slice(0, 3).map((reason, i) => (
                                        <span key={i} className="rounded bg-foreground/8 px-1.5 py-0.5 text-micro text-foreground/70">{reason}</span>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}

                {mitigated.slice(0, 3).map((zone) => (
                    <div key={zone.id} className={cn("rounded-lg border px-2.5 py-2", getStatusColor(zone.status))}>
                        <div className="flex items-center gap-2">
                            {getStatusIcon(zone.status)}
                            <span className="text-xs text-muted-foreground">{getZoneTypeLabel(zone.type)}</span>
                            <span className="font-mono text-micro text-foreground/50">{zone.low.toFixed(zone.low >= 100 ? 2 : 5)} — {zone.high.toFixed(zone.high >= 100 ? 2 : 5)}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
