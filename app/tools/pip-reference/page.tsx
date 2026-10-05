"use client";

import { Copy, Check, Crown, Sparkles, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { cn } from "@/lib/utils";

const INSTRUMENTS = [
    { symbol: "EURUSD", pipValue: 10, pipSize: "0.0001", contractSize: "100,000", digits: 5, category: "Forex Major" },
    { symbol: "GBPUSD", pipValue: 10, pipSize: "0.0001", contractSize: "100,000", digits: 5, category: "Forex Major" },
    { symbol: "USDJPY", pipValue: 6.67, pipSize: "0.01", contractSize: "100,000", digits: 3, category: "Forex Major" },
    { symbol: "USDCHF", pipValue: 10, pipSize: "0.0001", contractSize: "100,000", digits: 5, category: "Forex Major" },
    { symbol: "USDCAD", pipValue: 7.5, pipSize: "0.0001", contractSize: "100,000", digits: 5, category: "Forex Major" },
    { symbol: "AUDUSD", pipValue: 10, pipSize: "0.0001", contractSize: "100,000", digits: 5, category: "Forex Minor" },
    { symbol: "NZDUSD", pipValue: 10, pipSize: "0.0001", contractSize: "100,000", digits: 5, category: "Forex Minor" },
    { symbol: "EURGBP", pipValue: 12.5, pipSize: "0.0001", contractSize: "100,000", digits: 5, category: "Forex Cross" },
    { symbol: "EURJPY", pipValue: 6.67, pipSize: "0.01", contractSize: "100,000", digits: 3, category: "Forex Cross" },
    { symbol: "GBPJPY", pipValue: 6.67, pipSize: "0.01", contractSize: "100,000", digits: 3, category: "Forex Cross" },
    { symbol: "XAUUSD", pipValue: 1, pipSize: "0.01", contractSize: "100", digits: 2, category: "Metals" },
    { symbol: "XAGUSD", pipValue: 5, pipSize: "0.01", contractSize: "5,000", digits: 2, category: "Metals" },
    { symbol: "BTCUSD", pipValue: 0.01, pipSize: "0.01", contractSize: "1", digits: 2, category: "Crypto" },
    { symbol: "ETHUSD", pipValue: 0.01, pipSize: "0.01", contractSize: "1", digits: 2, category: "Crypto" },
    { symbol: "US30", pipValue: 1, pipSize: "0.01", contractSize: "1", digits: 1, category: "Indices" },
    { symbol: "NAS100", pipValue: 0.1, pipSize: "0.01", contractSize: "1", digits: 2, category: "Indices" },
    { symbol: "SPX500", pipValue: 0.1, pipSize: "0.01", contractSize: "1", digits: 1, category: "Indices" },
    { symbol: "DE40", pipValue: 1, pipSize: "0.01", contractSize: "1", digits: 1, category: "Indices" },
];

export default function PipReferencePage() {
    const [copied, setCopied] = useState<string | null>(null);
    const [filter, setFilter] = useState("All");

    const categories = ["All", ...new Set(INSTRUMENTS.map((i) => i.category))];
    const filtered = filter === "All" ? INSTRUMENTS : INSTRUMENTS.filter((i) => i.category === filter);

    const copyRow = (inst: typeof INSTRUMENTS[0]) => {
        const text = `${inst.symbol}\tPip: ${inst.pipSize}\tValue/lot: $${inst.pipValue}\tContract: ${inst.contractSize}\tDigits: ${inst.digits}`;
        navigator.clipboard.writeText(text);
        setCopied(inst.symbol);
        setTimeout(() => setCopied(null), 1500);
    };

    return (
        <ToolPageShell
            title="Pip Value Reference"
            description="Pip size, value per lot and contract size for 18 instruments. Pro adds a custom-pair calculator for any quote / base combination."
            badge="lite"
            icon={Copy}
            backHref="/tools"
            proHeadline="Pro adds a custom-pair calculator (any base / quote) and a cross-pair pip matrix."
            proFeatures={[
                "Custom pair calculator (any quote / base)",
                "Cross-pair pip matrix",
                "Save favorites",
                "Per-instrument lot conversion",
            ]}
        >
            <div className="flex flex-wrap gap-2">
                {categories.map((c) => (
                    <button
                        key={c}
                        type="button"
                        onClick={() => setFilter(c)}
                        className={cn(
                            "rounded-md px-3 py-1.5 text-[10px] font-medium transition-all",
                            filter === c
                                ? "bg-foreground text-background"
                                : "bg-muted text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {c}
                    </button>
                ))}
            </div>

            <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b border-border">
                                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Symbol</th>
                                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Category</th>
                                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Pip Size</th>
                                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Pip Value (1 lot)</th>
                                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Contract Size</th>
                                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Digits</th>
                                <th className="px-4 py-3 w-10"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((inst, i) => (
                                <tr
                                    key={inst.symbol}
                                    className={cn(
                                        "border-b border-border/15 transition-colors hover:bg-muted",
                                        i % 2 === 0 ? "bg-muted/10" : "",
                                    )}
                                >
                                    <td className="px-4 py-3 font-mono text-sm font-bold text-foreground">{inst.symbol}</td>
                                    <td className="px-4 py-3 text-[10px] text-muted-foreground">{inst.category}</td>
                                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{inst.pipSize}</td>
                                    <td className="px-4 py-3">
                                        <span className="font-mono text-sm font-bold text-positive">${inst.pipValue}</span>
                                    </td>
                                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{inst.contractSize}</td>
                                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{inst.digits}</td>
                                    <td className="px-4 py-3">
                                        <button
                                            type="button"
                                            onClick={() => copyRow(inst)}
                                            className="rounded-md p-1 text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
                                        >
                                            {copied === inst.symbol ? <Check size={12} className="text-positive" /> : <Copy size={12} />}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-4">
                <h3 className="mb-2 text-xs font-semibold text-foreground">Formula</h3>
                <p className="font-mono text-[11px] text-muted-foreground">
                    Pip Value = Contract Size × Pip Size × Lots
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                    Values shown are for 1 standard lot with USD account currency. Actual value may vary based on account currency and broker.
                </p>
            </div>

            {/* Pro upsell row */}
            <div className="grid gap-3 md:grid-cols-3">
                <ProTile
                    title="Custom Pair Calculator"
                    description="Compute pip value for any quote / base pair the curated list doesn't cover."
                />
                <ProTile
                    title="Cross-Pair Matrix"
                    description="A pip-cost matrix across all 18 instruments for portfolio comparison."
                />
                <ProTile
                    title="Save Favorites"
                    description="Pin the instruments you trade most and surface them at the top."
                />
            </div>
        </ToolPageShell>
    );
}

function ProTile({ title, description }: { title: string; description: string }) {
    return (
        <Link
            href="/pricing"
            className="group flex flex-col gap-2 rounded-2xl border border-dashed border-primary/25 bg-primary/[0.03] p-4 transition hover:border-primary/40 hover:bg-primary/[0.05]"
        >
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground">{title}</h4>
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                    <Crown className="size-2.5" />
                    Pro
                </span>
            </div>
            <p className="text-xs text-muted-foreground">{description}</p>
            <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary transition group-hover:gap-1.5">
                <Sparkles className="size-3" />
                Unlock
                <ArrowUpRight className="size-3" />
            </span>
        </Link>
    );
}