"use client";

import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Loader2, Shield, RefreshCw, Grid3x3, AlertTriangle } from "lucide-react";
import SiteNavbar from "@/components/navbar/SiteNavbar";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { cn } from "@/lib/utils";

type MatrixData = {
    symbols: string[];
    matrix: Record<string, Record<string, number>>;
};

function getCorrelationColor(value: number): string {
    if (value >= 0.7) return "bg-positive/80 text-background";
    if (value >= 0.4) return "bg-positive/30 text-positive";
    if (value >= 0.1) return "bg-positive/10 text-positive";
    if (value > -0.1) return "bg-muted text-muted-foreground";
    if (value > -0.4) return "bg-negative/10 text-negative";
    if (value > -0.7) return "bg-negative/30 text-negative";
    return "bg-negative/80 text-background";
}

export default function CorrelationPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [data, setData] = useState<MatrixData | null>(null);
    const [loading, setLoading] = useState(true);
    const [hoveredCell, setHoveredCell] = useState<{ sym1: string; sym2: string; val: number } | null>(null);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/analytics/correlation", { headers: { Authorization: `Bearer ${token}` } });
            const json = await res.json();
            if (json.success) setData({ symbols: json.symbols, matrix: json.matrix });
        } catch {
            // silent
        } finally { setLoading(false); }
    }, [user]);

    useEffect(() => { if (user) void Promise.resolve().then(() => fetchData()); }, [user, fetchData]);

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background"><SiteNavbar /><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></div>);
    }

    if (!user) {
        return (<div className="flex min-h-screen flex-col bg-background"><SiteNavbar /><div className="flex flex-1 flex-col items-center justify-center gap-4"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1><a href="/login" className="rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90">Sign In</a></div></div>);
    }

    const strongCorrelations: { sym1: string; sym2: string; val: number }[] = [];
    if (data) {
        for (const sym1 of data.symbols) {
            for (const sym2 of data.symbols) {
                if (sym1 < sym2) {
                    const val = data.matrix[sym1]?.[sym2] || 0;
                    if (Math.abs(val) >= 0.7) strongCorrelations.push({ sym1, sym2, val: Number(val.toFixed(3)) });
                }
            }
        }
    }

    return (
        <ToolPageShell
            title="Correlation Matrix"
            description="30-day daily-return correlation across the radar watchlist. Pro adds rolling windows, save snapshots, CSV export, and heatmap refresh."
            badge="lite"
            icon={Grid3x3}
            backHref="/tools"
            showProCTA={false}
            proHeadline="Pro lets you change the window (7d / 30d / 90d), save snapshots, and export the data."
            proFeatures={[
                "Rolling window selector (7d / 30d / 90d)",
                "Save correlation snapshots to your account",
                "Export to CSV",
                "Heatmap & intraday refresh",
            ]}
        >
            <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-3 text-xs">
                    <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-muted-foreground">
                        Window: 30d daily
                    </span>
                    <span className="text-muted-foreground">Fixed in Lite. Pro adds 7d / 30d / 90d.</span>
                </div>
                <button
                    type="button"
                    onClick={fetchData}
                    disabled={loading}
                    className="flex items-center gap-2 rounded-md border border-border bg-muted px-4 py-2 text-xs text-muted-foreground transition hover:bg-muted/60 disabled:opacity-50"
                >
                    <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
                </button>
            </div>

            {loading && !data ? (
                <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : data ? (
                <>
                    <div className="flex items-center gap-4 text-micro text-muted-foreground">
                        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-positive/80" /> Strong Positive</span>
                        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-positive/30" /> Positive</span>
                        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-muted" /> Neutral</span>
                        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-negative/30" /> Negative</span>
                        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-negative/80" /> Strong Negative</span>
                    </div>

                    <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
                        <table className="w-full text-center">
                            <thead>
                                <tr>
                                    <th className="p-2" />
                                    {data.symbols.map((sym) => <th key={sym} className="p-2 text-micro font-semibold text-muted-foreground">{sym}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {data.symbols.map((sym1) => (
                                    <tr key={sym1}>
                                        <td className="p-2 text-micro font-semibold text-muted-foreground text-right">{sym1}</td>
                                        {data.symbols.map((sym2) => {
                                            const val = data.matrix[sym1]?.[sym2] || 0;
                                            const isDiagonal = sym1 === sym2;
                                            return (
                                                <td key={sym2}
                                                    onMouseEnter={() => !isDiagonal && setHoveredCell({ sym1, sym2, val })}
                                                    onMouseLeave={() => setHoveredCell(null)}
                                                    className={cn("p-1 transition", isDiagonal ? "" : "cursor-pointer hover:ring-1 hover:ring-primary/40")}>
                                                    <div className={cn("flex h-12 w-16 items-center justify-center rounded-md font-mono text-xs font-bold", getCorrelationColor(val))}>
                                                        {isDiagonal ? "1.0" : val.toFixed(2)}
                                                    </div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {hoveredCell && (
                        <div className="rounded-md border border-border bg-card px-4 py-2 text-xs text-muted-foreground">
                            <span className="font-mono text-foreground">{hoveredCell.sym1}</span> / <span className="font-mono text-foreground">{hoveredCell.sym2}</span>: <span className={cn("font-bold", hoveredCell.val > 0 ? "text-positive" : hoveredCell.val < 0 ? "text-negative" : "text-muted-foreground")}>{hoveredCell.val.toFixed(4)}</span>
                            <span className="ml-2 text-muted-foreground">({Math.abs(hoveredCell.val) >= 0.7 ? "Strong" : Math.abs(hoveredCell.val) >= 0.4 ? "Moderate" : Math.abs(hoveredCell.val) >= 0.1 ? "Weak" : "No"} correlation)</span>
                        </div>
                    )}

                    {strongCorrelations.length > 0 && (
                        <div className="rounded-lg border border-warning/10 bg-warning/[0.03] p-4">
                            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-warning"><AlertTriangle size={13} /> Strong Correlations Detected</h3>
                            <div className="flex flex-wrap gap-2">
                                {strongCorrelations.map((c) => (
                                    <span key={`${c.sym1}-${c.sym2}`} className="rounded-md bg-muted px-2.5 py-1 font-mono text-micro text-muted-foreground">
                                        {c.sym1}/{c.sym2}: <span className={cn("font-bold", c.val > 0 ? "text-positive" : "text-negative")}>{c.val}</span>
                                    </span>
                                ))}
                            </div>
                            <p className="mt-2 text-micro text-muted-foreground">Consider reducing exposure to highly correlated pairs to diversify risk.</p>
                        </div>
                    )}
                </>
            ) : (
                <div className="rounded-lg border border-dashed border-border p-16 text-center">
                    <Grid3x3 size={32} className="mx-auto text-muted-foreground" />
                    <p className="mt-3 text-sm text-muted-foreground">No correlation data available</p>
                </div>
            )}
        </ToolPageShell>
    );
}