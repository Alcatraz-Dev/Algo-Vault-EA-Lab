"use client";

import { ArrowLeft, Copy, Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

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
        <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>
            <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition">
                    <ArrowLeft size={12} /> Back to Account
                </Link>

                <div className="mb-6" data-guide="page-header">
                    <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Pip Value Reference</h1>
                    <p className="mt-1.5 text-sm text-muted-foreground">Quick reference for pip values across all instruments (per 1 standard lot)</p>
                </div>

                <div className="mb-4 flex flex-wrap gap-2">
                    {categories.map((c) => (
                        <button
                            key={c}
                            type="button"
                            onClick={() => setFilter(c)}
                            className={`rounded-xl px-3 py-1.5 text-[10px] font-medium transition-all ${
                                filter === c ? "bg-violet-600 text-foreground" : "text-muted-foreground hover:text-muted-foreground bg-muted"
                            }`}
                        >
                            {c}
                        </button>
                    ))}
                </div>

                <div className="rounded-2xl border border-border/30 bg-muted/50 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="border-b border-border/30">
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
                                        className={`border-b border-border/15 transition-colors hover:bg-muted ${
                                            i % 2 === 0 ? "bg-muted/10" : ""
                                        }`}
                                    >
                                        <td className="px-4 py-3 font-mono text-sm font-bold text-foreground">{inst.symbol}</td>
                                        <td className="px-4 py-3 text-[10px] text-muted-foreground">{inst.category}</td>
                                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{inst.pipSize}</td>
                                        <td className="px-4 py-3">
                                            <span className="font-mono text-sm font-bold text-emerald-400">${inst.pipValue}</span>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{inst.contractSize}</td>
                                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{inst.digits}</td>
                                        <td className="px-4 py-3">
                                            <button
                                                type="button"
                                                onClick={() => copyRow(inst)}
                                                className="rounded-md p-1 text-muted-foreground hover:text-violet-400 hover:bg-violet-500/10 transition"
                                            >
                                                {copied === inst.symbol ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="mt-4 rounded-xl border border-border/30 bg-muted/50 p-4">
                    <h3 className="mb-2 text-xs font-semibold text-foreground">Formula</h3>
                    <p className="text-[11px] text-muted-foreground font-mono">
                        Pip Value = Contract Size × Pip Size × Lots
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                        Values shown are for 1 standard lot with USD account currency. Actual value may vary based on account currency and broker.
                    </p>
                </div>
            </div>
        </div>
    );
}
