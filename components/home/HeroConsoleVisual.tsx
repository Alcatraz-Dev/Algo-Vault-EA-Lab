"use client";

import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import HomeCandleChart from "./HomeCandleChart";

const LIFECYCLE = ["NEW", "PENDING_ENTRY", "ENTRY_TRIGGERED", "TP_REACHED", "CLOSED"] as const;
const TERMINAL = ["STOPPED_OUT", "EXPIRED", "CANCELLED", "INVALIDATED"] as const;

const RISK_CHECKS = [
    { label: "Daily loss limit", detail: "2% of balance" },
    { label: "Drawdown guard", detail: "Armed" },
    { label: "Position sizing", detail: "1% risk" },
    { label: "Gateway heartbeat", detail: "Checked pre-trade" },
] as const;

export default function HeroConsoleVisual() {
    return (
        <Tabs defaultValue="overview" className="gap-0">
            <div className="border-b border-border px-3 pt-3">
                <TabsList className="h-8 w-full rounded-lg">
                    <TabsTrigger value="overview" className="text-xs">
                        Overview
                    </TabsTrigger>
                    <TabsTrigger value="lifecycle" className="text-xs">
                        Signals
                    </TabsTrigger>
                    <TabsTrigger value="risk" className="text-xs">
                        Risk
                    </TabsTrigger>
                </TabsList>
            </div>

            <TabsContent value="overview" className="px-4 py-4">
                <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground">
                        XAUUSD <span className="font-normal text-muted-foreground">· M15 sample</span>
                    </span>
                    <Badge variant="outline" className="font-numeric text-[11px] normal-case">
                        Illustrative
                    </Badge>
                </div>
                <div className="mt-2 overflow-hidden rounded-lg border border-border">
                    <HomeCandleChart seed={7} basePrice={2650} precision={2} height={210} label="XAUUSD M15 illustrative sample" />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
                    {[
                        { label: "Engines", value: "8" },
                        { label: "Timeframes", value: "M1–D1" },
                        { label: "Costs modeled", value: "Spread+Slip" },
                    ].map((cell) => (
                        <div key={cell.label} className="bg-card px-3 py-2.5 text-center">
                            <p className="font-numeric text-sm font-semibold text-foreground">{cell.value}</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">{cell.label}</p>
                        </div>
                    ))}
                </div>
                <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                    Sample price action — shows the terminal layout, not live market data.
                </p>
            </TabsContent>

            <TabsContent value="lifecycle" className="px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-positive">Active path</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {LIFECYCLE.map((state) => (
                        <Badge key={state} variant="success" className="font-numeric text-[11px]">
                            {state}
                        </Badge>
                    ))}
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-warning">Terminal states</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {TERMINAL.map((state) => (
                        <Badge key={state} variant="warning" className="font-numeric text-[11px]">
                            {state}
                        </Badge>
                    ))}
                </div>
                <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                    <ShieldCheck size={14} className="mt-0.5 shrink-0 text-positive" aria-hidden />
                    Outcomes are decided deterministically — TP/SL hits, never AI narrative.
                </p>
                <Link
                    href="/signals"
                    className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                    How signals work <ArrowRight size={13} aria-hidden />
                </Link>
            </TabsContent>

            <TabsContent value="risk" className="px-4 py-4">
                <ul className="divide-y divide-border rounded-lg border border-border">
                    {RISK_CHECKS.map(({ label, detail }) => (
                        <li key={label} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                            <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                                <ShieldCheck size={14} className="shrink-0 text-positive" aria-hidden />
                                {label}
                            </span>
                            <span className="font-numeric text-xs text-muted-foreground">{detail}</span>
                        </li>
                    ))}
                </ul>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    Rejected intents carry a decision code — surfaced in the console, never silently dropped.
                </p>
                <Link
                    href="/risk"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                    Open risk controls <ArrowRight size={13} aria-hidden />
                </Link>
            </TabsContent>
        </Tabs>
    );
}
