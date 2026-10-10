"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
    Activity,
    BarChart3,
    BookOpen,
    Calculator,
    Eye,
    LineChart,
    Loader2,
    Plus,
    StickyNote,
    Target,
    TrendingUp,
    Trash2,
    Zap,
    Shield,
    Sparkles,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { onValue, push, ref, remove, set } from "firebase/database";
import { auth, database } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import ProGate from "@/components/subscription/ProGate";
import AdvancedAnalysis from "@/components/tools/AdvancedAnalysis";
import OrderFlow from "@/components/tools/OrderFlow";
import Journal from "@/components/tools/Journal";
import BacktestTool from "@/components/tools/BacktestTool";
import PerformanceReports from "@/components/tools/PerformanceReports";
import TradeTracker from "@/components/tools/TradeTracker";
import RichTextEditor from "@/components/tools/RichTextEditor";
import VisualAnalysis from "@/components/tools/VisualAnalysis";
import { StrategyOptimizer, RiskManager } from "@/components/tools/ProTools";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Tab = "notebook" | "journal" | "calculators" | "backtest" | "analysis" | "reports" | "tracking" | "orderflow" | "optimizer" | "risk" | "visual";

const TABS: { key: Tab; label: string; icon: React.ElementType; pro?: boolean }[] = [
    { key: "notebook", label: "Notebook", icon: BookOpen },
    { key: "journal", label: "Journal", icon: StickyNote, pro: true },
    { key: "calculators", label: "Calculators", icon: Calculator },
    { key: "visual", label: "Visual Analysis", icon: Eye },
    { key: "backtest", label: "Backtest", icon: BarChart3, pro: true },
    { key: "analysis", label: "Advanced Analysis", icon: LineChart, pro: true },
    { key: "reports", label: "Reports", icon: Target, pro: true },
    { key: "tracking", label: "Trade Tracker", icon: TrendingUp, pro: true },
    { key: "orderflow", label: "Order Flow", icon: Activity, pro: true },
    { key: "optimizer", label: "Strategy Optimizer", icon: Sparkles },
    { key: "risk", label: "Risk Manager", icon: Shield },
];

function num(value: string): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

// ─── Position size / risk calculators ────────────────────────────────────────

function CalculatorGrid() {
    const [accountBalance, setAccountBalance] = useState("10000");
    const [riskPercent, setRiskPercent] = useState("1");
    const [stopLossPips, setStopLossPips] = useState("20");
    const [pipValuePerLot, setPipValuePerLot] = useState("10");

    const positionSize = useMemo(() => {
        const riskMoney = num(accountBalance) * (num(riskPercent) / 100);
        const riskPerLot = num(stopLossPips) * num(pipValuePerLot) || 1;
        return Math.max(0, riskMoney / riskPerLot);
    }, [accountBalance, riskPercent, stopLossPips, pipValuePerLot]);

    const pipValue = useMemo(() => num(pipValuePerLot) * positionSize, [pipValuePerLot, positionSize]);
    const riskMoney = useMemo(() => num(accountBalance) * (num(riskPercent) / 100), [accountBalance, riskPercent]);

    const inputClass = "w-full rounded-lg border border-border bg-muted px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none";

    return (
        <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-lg border border-border bg-card p-5">
                <h3 className="flex items-center gap-2 font-semibold">
                    <Calculator size={16} className="text-primary" /> Risk Calculator
                </h3>
                <div className="mt-4 space-y-3">
                    <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">Account Balance ($)</label>
                        <input type="number" value={accountBalance} onChange={(e) => setAccountBalance(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">Risk %</label>
                        <input type="number" step="0.1" value={riskPercent} onChange={(e) => setRiskPercent(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">Stop Loss (pips)</label>
                        <input type="number" value={stopLossPips} onChange={(e) => setStopLossPips(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">Pip value per 1.00 lot ($)</label>
                        <input type="number" value={pipValuePerLot} onChange={(e) => setPipValuePerLot(e.target.value)} className={inputClass} />
                        <p className="mt-1 text-micro text-muted-foreground">
                            Defaults: $10 (XAUUSD / 100k USD quote)
                        </p>
                    </div>
                </div>
            </div>
            <div className="rounded-lg border border-chart-3/20 bg-chart-3/4 p-5 lg:col-span-2">
                <h3 className="font-semibold">Results</h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-border bg-muted p-4 text-center">
                        <p className="text-micro uppercase tracking-wider text-muted-foreground font-semibold">Risk Amount</p>
                        <p className="mt-2 text-2xl font-bold text-foreground">${riskMoney.toFixed(2)}</p>
                    </div>
                    <div className="rounded-lg border border-chart-3/25 bg-chart-3/10 p-4 text-center">
                        <p className="text-micro uppercase tracking-wider text-chart-3 font-semibold">Position Size</p>
                        <p className="mt-2 text-2xl font-bold text-chart-3">{positionSize.toFixed(2)} lots</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted p-4 text-center">
                        <p className="text-micro uppercase tracking-wider text-muted-foreground font-semibold">Pip Value</p>
                        <p className="mt-2 text-2xl font-bold text-foreground">${pipValue.toFixed(2)}/pip</p>
                    </div>
                </div>
                <div className="mt-5 rounded-lg border border-border bg-muted/50 p-4 text-xs leading-6 text-muted-foreground">
                    <p><span className="font-semibold text-foreground">Formula:</span> Position size = (Balance &times; Risk%) &divide; (Stop loss pips &times; Pip value per lot)</p>
                </div>
            </div>
        </div>
    );
}

// ─── Profit Split Calculator ────────────────────────────────

function ProfitSplitCalculator() {
    const [totalProfit, setTotalProfit] = useState("1000");
    const [investorAmount, setInvestorAmount] = useState("7000");
    const [managerAmount, setManagerAmount] = useState("3000");

    const investorShare = useMemo(() => {
        const total = num(investorAmount) + num(managerAmount) || 1;
        return (num(investorAmount) / total) * num(totalProfit);
    }, [totalProfit, investorAmount, managerAmount]);

    const managerShare = useMemo(() => {
        const total = num(investorAmount) + num(managerAmount) || 1;
        return (num(managerAmount) / total) * num(totalProfit);
    }, [totalProfit, investorAmount, managerAmount]);

    const investorPct = useMemo(() => {
        const total = num(investorAmount) + num(managerAmount) || 1;
        return (num(investorAmount) / total) * 100;
    }, [investorAmount, managerAmount]);

    const managerPct = useMemo(() => {
        const total = num(investorAmount) + num(managerAmount) || 1;
        return (num(managerAmount) / total) * 100;
    }, [investorAmount, managerAmount]);

    const inputClass = "w-full rounded-lg border border-border bg-muted px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none";

    return (
        <div className="rounded-lg border border-border bg-card p-5">
            <h3 className="flex items-center gap-2 font-semibold">
                <Zap size={16} className="text-primary" /> Profit Split Calculator
            </h3>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Total Profit ($)</label>
                    <input type="number" value={totalProfit} onChange={(e) => setTotalProfit(e.target.value)} className={inputClass} />
                </div>
                <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Investor Contribution ($)</label>
                    <input type="number" value={investorAmount} onChange={(e) => setInvestorAmount(e.target.value)} className={inputClass} />
                </div>
                <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Manager Contribution ($)</label>
                    <input type="number" value={managerAmount} onChange={(e) => setManagerAmount(e.target.value)} className={inputClass} />
                </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-border bg-muted p-3 text-center">
                    <p className="text-micro uppercase tracking-wider text-muted-foreground font-semibold">Investor %</p>
                    <p className="mt-1 text-lg font-bold text-foreground">{investorPct.toFixed(1)}%</p>
                </div>
                <div className="rounded-lg border border-border bg-muted p-3 text-center">
                    <p className="text-micro uppercase tracking-wider text-muted-foreground font-semibold">Manager %</p>
                    <p className="mt-1 text-lg font-bold text-foreground">{managerPct.toFixed(1)}%</p>
                </div>
                <div className="rounded-lg border border-chart-3/25 bg-chart-3/10 p-3 text-center">
                    <p className="text-micro uppercase tracking-wider text-chart-3 font-semibold">Investor Share</p>
                    <p className="mt-1 text-lg font-bold text-chart-3">${investorShare.toFixed(2)}</p>
                </div>
                <div className="rounded-lg border border-chart-3/25 bg-chart-3/10 p-3 text-center">
                    <p className="text-micro uppercase tracking-wider text-chart-3 font-semibold">Manager Share</p>
                    <p className="mt-1 text-lg font-bold text-chart-3">${managerShare.toFixed(2)}</p>
                </div>
            </div>
        </div>
    );
}

// ─── Swap Calculator ────────────────────────────────────────

function SwapCalculator() {
    const [positionSize, setPositionSize] = useState("1.00");
    const [pipValue, setPipValue] = useState("10");
    const [swapRateBuy, setSwapRateBuy] = useState("-1.5");
    const [swapRateSell, setSwapRateSell] = useState("-0.8");
    const [days, setDays] = useState("1");

    const swapBuy = useMemo(() => Math.abs(num(swapRateBuy)) * num(positionSize) * num(pipValue) * num(days), [positionSize, pipValue, swapRateBuy, days]);
    const swapSell = useMemo(() => Math.abs(num(swapRateSell)) * num(positionSize) * num(pipValue) * num(days), [positionSize, pipValue, swapRateSell, days]);

    const inputClass = "w-full rounded-lg border border-border bg-muted px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none";

    return (
        <div className="rounded-lg border border-border bg-card p-5">
            <h3 className="flex items-center gap-2 font-semibold">
                <Activity size={16} className="text-primary" /> Swap Calculator
            </h3>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Position Size (lots)</label>
                    <input type="number" step="0.01" value={positionSize} onChange={(e) => setPositionSize(e.target.value)} className={inputClass} />
                </div>
                <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Pip Value ($)</label>
                    <input type="number" value={pipValue} onChange={(e) => setPipValue(e.target.value)} className={inputClass} />
                </div>
                <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Buy Swap Rate</label>
                    <input type="number" step="0.1" value={swapRateBuy} onChange={(e) => setSwapRateBuy(e.target.value)} className={inputClass} />
                </div>
                <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Sell Swap Rate</label>
                    <input type="number" step="0.1" value={swapRateSell} onChange={(e) => setSwapRateSell(e.target.value)} className={inputClass} />
                </div>
                <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Days</label>
                    <input type="number" value={days} onChange={(e) => setDays(e.target.value)} className={inputClass} />
                </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-warning/25 bg-warning/10 p-4 text-center">
                    <p className="text-micro uppercase tracking-wider text-warning font-semibold">Buy Swap Cost</p>
                    <p className="mt-1 text-xl font-bold text-warning">${swapBuy.toFixed(2)}</p>
                </div>
                <div className="rounded-lg border border-info/25 bg-info/10 p-4 text-center">
                    <p className="text-micro uppercase tracking-wider text-info font-semibold">Sell Swap Cost</p>
                    <p className="mt-1 text-xl font-bold text-info">${swapSell.toFixed(2)}</p>
                </div>
            </div>
        </div>
    );
}

// ─── Spread Analyzer ────────────────────────────────────────

function SpreadAnalyzer() {
    const [askPrice, setAskPrice] = useState("1.08550");
    const [bidPrice, setBidPrice] = useState("1.08540");
    const [lotSize, setLotSize] = useState("1.00");
    const [pipValue, setPipValue] = useState("10");

    const spreadPips = useMemo(() => Math.abs(num(askPrice) - num(bidPrice)) * 10000, [askPrice, bidPrice]);
    const spreadCost = useMemo(() => spreadPips * num(lotSize) * num(pipValue), [spreadPips, lotSize, pipValue]);
    const spreadPercent = useMemo(() => {
        const avg = (num(askPrice) + num(bidPrice)) / 2 || 1;
        return (spreadPips / (avg * 10000)) * 100;
    }, [askPrice, bidPrice, spreadPips]);

    const inputClass = "w-full rounded-lg border border-border bg-muted px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none";

    return (
        <div className="rounded-lg border border-border bg-card p-5">
            <h3 className="flex items-center gap-2 font-semibold">
                <LineChart size={16} className="text-primary" /> Spread Analyzer
            </h3>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Ask Price</label>
                    <input type="text" value={askPrice} onChange={(e) => setAskPrice(e.target.value)} className={inputClass} />
                </div>
                <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Bid Price</label>
                    <input type="text" value={bidPrice} onChange={(e) => setBidPrice(e.target.value)} className={inputClass} />
                </div>
                <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Lot Size</label>
                    <input type="number" step="0.01" value={lotSize} onChange={(e) => setLotSize(e.target.value)} className={inputClass} />
                </div>
                <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Pip Value ($)</label>
                    <input type="number" value={pipValue} onChange={(e) => setPipValue(e.target.value)} className={inputClass} />
                </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-border bg-muted p-4 text-center">
                    <p className="text-micro uppercase tracking-wider text-muted-foreground font-semibold">Spread (pips)</p>
                    <p className="mt-1 text-xl font-bold text-foreground">{spreadPips.toFixed(1)}</p>
                </div>
                <div className="rounded-lg border border-warning/25 bg-warning/10 p-4 text-center">
                    <p className="text-micro uppercase tracking-wider text-warning font-semibold">Spread Cost</p>
                    <p className="mt-1 text-xl font-bold text-warning">${spreadCost.toFixed(2)}</p>
                </div>
                <div className="rounded-lg border border-chart-3/25 bg-chart-3/10 p-4 text-center">
                    <p className="text-micro uppercase tracking-wider text-chart-3 font-semibold">Spread %</p>
                    <p className="mt-1 text-xl font-bold text-chart-3">{spreadPercent.toFixed(4)}%</p>
                </div>
            </div>
        </div>
    );
}

// ─── Notebook ────────────────────────────────────────

type JournalEntry = {
    id: string;
    title?: string;
    symbol?: string;
    body?: string;
    tags?: string[];
    tradeOutcome?: "win" | "loss" | "breakeven" | undefined;
    pnl?: number;
    createdAt?: number;
    updatedAt?: number;
};

function NotebookView() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [tab, setTab] = useState<"entries" | "journal">("entries");
    const [notes, setNotes] = useState<JournalEntry[]>([]);
    const [notesLoading, setNotesLoading] = useState(true);

    const [title, setTitle] = useState("");
    const [symbol, setSymbol] = useState("");
    const [body, setBody] = useState("");
    const [tags, setTags] = useState("");
    const [tradeOutcome, setTradeOutcome] = useState<"win" | "loss" | "breakeven" | "">("");
    const [pnl, setPnl] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!user) return;
        const notesRef = ref(database, `users/${user.uid}/notes`);
        return onValue(notesRef, (snap) => {
            const data = snap.val() || {};
            const list: JournalEntry[] = Object.entries(data).map(([id, val]) => ({ id, ...(val as Partial<JournalEntry>) }));
            setNotes(list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
            setNotesLoading(false);
        });
    }, [user]);

    async function saveNote(e: FormEvent) {
        e.preventDefault();
        if (!user || !title.trim()) return;
        setSaving(true);
        try {
            const now = Date.now();
            const notesRef = ref(database, `users/${user.uid}/notes`);
            const newRef = push(notesRef);
            await set(newRef, {
                title: title.trim(), symbol: symbol.trim().toUpperCase(), body: body.trim(),
                tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
                tradeOutcome: tradeOutcome || null, pnl: pnl ? Number(pnl) : null,
                createdAt: now, updatedAt: now,
            });
            setTitle(""); setSymbol(""); setBody(""); setTags(""); setTradeOutcome(""); setPnl("");
        } finally { setSaving(false); }
    }

    async function deleteNote(id: string) {
        if (!user) return;
        if (!confirm("Delete this entry?")) return;
        await remove(ref(database, `users/${user.uid}/notes/${id}`));
    }

    if (authLoading) {
        return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
    }

    const inputClass = "w-full rounded-lg border border-border bg-muted px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none";

    return (
        <div className="mx-auto max-w-5xl">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-1.5 w-fit">
                <button type="button" onClick={() => setTab("entries")}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${tab === "entries" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
                    <BookOpen size={15} /> Entries
                </button>
                <button type="button" onClick={() => setTab("journal")}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${tab === "journal" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
                    <StickyNote size={15} /> Journal View
                </button>
            </div>

            {tab === "entries" ? (
                <div className="mt-6 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-lg border border-border bg-card p-5">
                        <h3 className="flex items-center gap-2 font-semibold"><Plus size={16} className="text-primary" /> New Entry</h3>
                        <form onSubmit={saveNote} className="mt-4 space-y-3">
                            <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Title</label><input type="text" required placeholder="e.g. GBPUSD London breakout setup" value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} /></div>
                            <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Symbol (optional)</label><input type="text" placeholder="e.g. XAUUSD" value={symbol} onChange={(e) => setSymbol(e.target.value)} className={inputClass} /></div>
                            <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Tags (comma separated)</label><input type="text" placeholder="e.g. breakout, london, scalping" value={tags} onChange={(e) => setTags(e.target.value)} className={inputClass} /></div>
                            <div className="grid grid-cols-2 gap-3">
                                <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Outcome</label>
                                    <select value={tradeOutcome} onChange={(e) => setTradeOutcome(e.target.value as typeof tradeOutcome)} className={inputClass}>
                                        <option value="">None</option><option value="win">Win</option><option value="loss">Loss</option><option value="breakeven">Breakeven</option>
                                    </select></div>
                                <div><label className="mb-1 block text-xs font-medium text-muted-foreground">P&amp;L ($)</label><input type="number" step="0.01" placeholder="0.00" value={pnl} onChange={(e) => setPnl(e.target.value)} className={inputClass} /></div>
                            </div>
                            <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Notes (Markdown supported)</label>
                                <RichTextEditor value={body} onChange={setBody} placeholder="Write your trade idea, analysis, or lessons learned..." className="min-h-50" /></div>
                            <button type="submit" disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-primary disabled:opacity-50">
                                {saving ? <Loader2 size={15} className="animate-spin" /> : <StickyNote size={15} />} Save Entry
                            </button>
                        </form>
                    </div>
                    <div className="rounded-lg border border-border bg-card p-5">
                        <h3 className="flex items-center gap-2 font-semibold"><BookOpen size={16} className="text-primary" /> Your Entries <span className="ml-auto rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">{notes.length}</span></h3>
                        {notesLoading ? (
                            <div className="flex items-center gap-3 py-10 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading your notebook...</div>
                        ) : notes.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-border py-12 text-center"><BookOpen className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 text-sm text-muted-foreground">No entries yet.</p></div>
                        ) : (
                            <div className="mt-4 max-h-140 space-y-3 overflow-y-auto pr-1">
                                {notes.map((note) => (
                                    <div key={note.id} className="rounded-lg border border-border bg-muted/40 p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="font-medium text-foreground">{note.title}</p>
                                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                                    {note.symbol && <span className="rounded-full border border-chart-3/25 bg-chart-3/10 px-2 py-0.5 text-micro font-numeric text-chart-3">{note.symbol}</span>}
                                                    {note.tradeOutcome && <span className={`rounded-full px-2 py-0.5 text-micro font-medium ${note.tradeOutcome === "win" ? "bg-positive/10 text-positive" : note.tradeOutcome === "loss" ? "bg-negative/10 text-negative" : "bg-warning/10 text-warning"}`}>{note.tradeOutcome === "win" ? "Win" : note.tradeOutcome === "loss" ? "Loss" : "Breakeven"}</span>}
                                                    {note.pnl !== null && note.pnl !== undefined && <span className={`rounded-full px-2 py-0.5 text-micro font-medium ${note.pnl >= 0 ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative"}`}>{note.pnl >= 0 ? "+" : ""}${note.pnl.toFixed(2)}</span>}
                                                    {note.tags?.map((tag) => <span key={tag} className="rounded-full border border-border bg-muted px-2 py-0.5 text-micro text-muted-foreground">{tag}</span>)}
                                                    <span className="text-micro text-muted-foreground">{note.updatedAt ? new Date(note.updatedAt).toLocaleString() : "—"}</span>
                                                </div>
                                            </div>
                                            <button type="button" onClick={() => deleteNote(note.id)} className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:text-destructive"><Trash2 size={15} /></button>
                                        </div>
                                        {note.body && <div className="mt-2 prose prose-invert prose-sm max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]}>{note.body}</ReactMarkdown></div>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <div className="mt-6"><JournalView notes={notes} /></div>
            )}
        </div>
    );
}

function JournalView({ notes }: { notes: JournalEntry[] }) {
    const wins = notes.filter((n) => n.tradeOutcome === "win").length;
    const losses = notes.filter((n) => n.tradeOutcome === "loss").length;
    const totalPnl = notes.reduce((sum, n) => sum + (n.pnl || 0), 0);

    const outcomeColor = (outcome?: string) => {
        switch (outcome) { case "win": return "border-positive/30 bg-positive/10"; case "loss": return "border-negative/30 bg-negative/10"; case "breakeven": return "border-warning/30 bg-warning/10"; default: return "border-border bg-muted/30"; }
    };
    const outcomeIcon = (outcome?: string) => { switch (outcome) { case "win": return "+"; case "loss": return "\u2212"; case "breakeven": return "\u00B1"; default: return "\u25CB"; } };

    if (notes.length === 0) {
        return <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-20 text-center"><StickyNote className="mx-auto h-12 w-12 text-muted-foreground" /><h3 className="mt-4 text-lg font-semibold">No journal entries yet</h3><p className="mt-2 text-sm text-muted-foreground">Start logging your trades to track performance over time.</p></div>;
    }

    return (
        <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-4">
                <div className="rounded-lg border border-positive/20 bg-positive/10 p-4 text-center"><p className="text-micro uppercase tracking-wider text-positive font-semibold">Wins</p><p className="mt-1 text-2xl font-bold text-positive">{wins}</p></div>
                <div className="rounded-lg border border-negative/20 bg-negative/10 p-4 text-center"><p className="text-micro uppercase tracking-wider text-negative font-semibold">Losses</p><p className="mt-1 text-2xl font-bold text-negative">{losses}</p></div>
                <div className="rounded-lg border border-border bg-muted/30 p-4 text-center"><p className="text-micro uppercase tracking-wider text-muted-foreground font-semibold">Win Rate</p><p className="mt-1 text-2xl font-bold text-foreground">{wins + losses > 0 ? `${((wins / (wins + losses)) * 100).toFixed(0)}%` : "\u2014"}</p></div>
                <div className={`rounded-lg border p-4 text-center ${totalPnl >= 0 ? "border-positive/20 bg-positive/10" : "border-negative/20 bg-negative/10"}`}><p className="text-micro uppercase tracking-wider font-semibold">Total P&amp;L</p><p className={`mt-1 text-2xl font-bold ${totalPnl >= 0 ? "text-positive" : "text-negative"}`}>{totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}</p></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {notes.map((note) => (
                    <div key={note.id} className={`rounded-lg border p-4 ${outcomeColor(note.tradeOutcome)}`}>
                        <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">{note.symbol || "\u2014"}</span><span className="text-lg font-bold">{outcomeIcon(note.tradeOutcome)}</span></div>
                        <h4 className="mt-2 font-semibold text-sm">{note.title || "Untitled"}</h4>
                        <div className="mt-2 flex flex-wrap gap-1.5">{note.tags?.map((tag) => <span key={tag} className="rounded-full border border-border bg-background px-2 py-0.5 text-micro text-muted-foreground">{tag}</span>)}</div>
                        {note.pnl !== null && note.pnl !== undefined && <p className={`mt-3 text-lg font-bold ${note.pnl >= 0 ? "text-positive" : "text-negative"}`}>{note.pnl >= 0 ? "+" : ""}${note.pnl.toFixed(2)}</p>}
                        <p className="mt-1 text-micro text-muted-foreground">{note.updatedAt ? new Date(note.updatedAt).toLocaleString() : "\u2014"}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────

export default function ToolsPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [tab, setTab] = useState<Tab>("notebook");

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsubscribe();
    }, []);

    if (authLoading) {
        return (
            <AccountShell title="Tools" subtitle="Notebook & trading calculators">
                <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            </AccountShell>
        );
    }

    const activeTab = TABS.find((t) => t.key === tab);

    const renderContent = () => {
        switch (tab) {
            case "notebook": return <NotebookView />;
            case "journal": return <div className="mt-6"><ProGate><Journal /></ProGate></div>;
            case "calculators": return <div className="space-y-4"><CalculatorGrid /><ProfitSplitCalculator /><SwapCalculator /><SpreadAnalyzer /></div>;
            case "visual": return <VisualAnalysis />;
            case "backtest": return <div className="mt-6"><ProGate><BacktestTool userId={user?.uid ?? ""} /></ProGate></div>;
            case "analysis": return <div className="mt-6"><ProGate><AdvancedAnalysis userId={user?.uid ?? ""} /></ProGate></div>;
            case "reports": return <div className="mt-6"><ProGate><PerformanceReports userId={user?.uid ?? ""} /></ProGate></div>;
            case "tracking": return <div className="mt-6"><ProGate><TradeTracker userId={user?.uid ?? ""} /></ProGate></div>;
            case "orderflow": return <div className="mt-6"><ProGate><OrderFlow userId={user?.uid ?? ""} /></ProGate></div>;
            case "optimizer": return <div className="mt-6"><StrategyOptimizer /></div>;
            case "risk": return <div className="mt-6"><RiskManager /></div>;
            default: return null;
        }
    };

    return (
        <AccountShell title="Tools" subtitle="Trading calculators, journal, and analysis">
            {/* Mobile: scrollable tab bar */}
            <div className="lg:hidden mb-6 -mx-2">
                <div className="flex gap-1.5 overflow-x-auto px-2 pb-2 scrollbar-hide">
                    {TABS.map((t) => {
                        const Icon = t.icon;
                        return (
                            <button
                                key={t.key}
                                type="button"
                                onClick={() => setTab(t.key)}
                                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition ${
                                    tab === t.key ? "bg-foreground text-background" : "bg-card border border-border text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                <Icon size={13} />
                                {t.label}
                                {t.pro && <span className="rounded bg-chart-3/20 px-1 py-0.5 text-micro font-bold text-chart-3">PRO</span>}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Desktop: sidebar + content */}
            <div className="flex gap-6" data-guide="page-header">
                {/* Sidebar tabs — desktop only */}
                <aside className="hidden lg:block w-56 shrink-0">
                    <div className="sticky top-24 space-y-1">
                        {TABS.map((t) => {
                            const Icon = t.icon;
                            const isActive = tab === t.key;
                            return (
                                <button
                                    key={t.key}
                                    type="button"
                                    onClick={() => setTab(t.key)}
                                    className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition ${
                                        isActive
                                            ? "bg-foreground text-background"
                                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                    }`}
                                >
                                    <Icon size={16} className={isActive ? "" : "text-muted-foreground"} />
                                    <span className="flex-1 text-left">{t.label}</span>
                                    {t.pro && (
                                        <span className={`rounded px-1.5 py-0.5 text-micro font-bold ${
                                            isActive ? "bg-background/20 text-background" : "bg-chart-3/15 text-chart-3"
                                        }`}>
                                            PRO
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </aside>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    {renderContent()}
                </div>
            </div>
        </AccountShell>
    );
}
