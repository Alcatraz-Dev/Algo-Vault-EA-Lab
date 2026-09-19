"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import AccountShell from "@/components/account/AccountShell";
import {
    FileText, Download, Loader2, BarChart3, Activity,
    Shield, Clock, Target, RefreshCw,
} from "lucide-react";

interface Report {
    id: string;
    generatedAt: string;
    symbol: string;
    reportType: string;
    marketAnalysis: { regime: string; confidence: number; volatility: string; score: number };
    tradeSummary: { totalTrades: number; wins: number; losses: number; winRate: string; totalPnl: string };
    aiReport: string;
}

export default function ReportGeneratorPage() {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [loading, setLoading] = useState(false);
    const [reports, setReports] = useState<Report[]>([]);
    const [symbol, setSymbol] = useState("XAUUSD");
    const [timeframe, setTimeframe] = useState("H1");
    const [selectedReport, setSelectedReport] = useState<Report | null>(null);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const loadReports = async () => {
        if (!user) return;
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/report-generator", { headers: { Authorization: `Bearer ${token}` } });
            const json = await res.json();
            if (json.success) setReports(json.reports);
        } catch {}
    };

    const generateReport = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/report-generator", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ symbol, timeframe }),
            });
            const json = await res.json();
            if (json.success) { setSelectedReport(json.report); loadReports(); }
        } catch {} finally { setLoading(false); }
    };

    useEffect(() => { if (!authLoading && user) loadReports(); }, [authLoading, user]);

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="Report Generator"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></AccountShell></div>);
    }

    return (
        <AccountShell title="Report Generator" subtitle="Generate AI-powered trading performance reports" onBack={() => router.push("/account")}>
            <div className="space-y-6" data-guide="page-header">
                <div className="flex flex-wrap gap-3">
                    <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="rounded-lg border border-border/30 bg-muted px-3 py-2 text-sm text-foreground focus:border-violet-500 focus:outline-none">
                        <option value="XAUUSD">XAUUSD</option>
                        <option value="EURUSD">EURUSD</option>
                        <option value="BTCUSD">BTCUSD</option>
                    </select>
                    <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} className="rounded-lg border border-border/30 bg-muted px-3 py-2 text-sm text-foreground focus:border-violet-500 focus:outline-none">
                        <option value="H1">H1</option>
                        <option value="H4">H4</option>
                        <option value="D1">D1</option>
                    </select>
                    <button type="button" onClick={generateReport} disabled={loading} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-foreground hover:bg-violet-500 transition disabled:opacity-50">
                        {loading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Generate Report"}
                    </button>
                </div>

                {selectedReport && (
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-6" data-guide="stats">
                        <h3 className="mb-3 text-sm font-semibold text-emerald-400">Generated Report</h3>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <div><p className="text-xs text-muted-foreground">Symbol</p><p className="text-foreground font-medium">{selectedReport.symbol}</p></div>
                            <div><p className="text-xs text-muted-foreground">Regime</p><p className="text-foreground font-medium">{selectedReport.marketAnalysis.regime}</p></div>
                            <div><p className="text-xs text-muted-foreground">Score</p><p className="text-foreground font-medium">{selectedReport.marketAnalysis.score}/100</p></div>
                            <div><p className="text-xs text-muted-foreground">Win Rate</p><p className="text-foreground font-medium">{selectedReport.tradeSummary.winRate}</p></div>
                        </div>
                        <div className="mt-4 rounded-lg bg-background p-4 text-sm text-muted-foreground whitespace-pre-line">{selectedReport.aiReport}</div>
                    </div>
                )}

                {reports.length > 0 && (
                    <div className="space-y-4" data-guide="stats">
                        <h3 className="text-sm font-semibold text-foreground">Previous Reports</h3>
                        {reports.map((r) => (
                            <div key={r.id} className="rounded-xl border border-border/30 bg-muted/50 p-4 cursor-pointer hover:bg-muted" onClick={() => setSelectedReport(r)}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <FileText className="h-5 w-5 text-violet-400" />
                                        <div><p className="text-sm font-medium text-foreground">{r.symbol} {r.reportType}</p><p className="text-xs text-muted-foreground">{r.generatedAt}</p></div>
                                    </div>
                                    <Download size={14} className="text-muted-foreground" />
                                </div>
                                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                                    <span className="text-xs text-muted-foreground">Regime: <span className="text-foreground">{r.marketAnalysis.regime}</span></span>
                                    <span className="text-xs text-muted-foreground">Trades: <span className="text-foreground">{r.tradeSummary.totalTrades}</span></span>
                                    <span className="text-xs text-muted-foreground">P/L: <span className="text-foreground">{r.tradeSummary.totalPnl}</span></span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </AccountShell>
    );
}
