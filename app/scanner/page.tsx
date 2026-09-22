"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import AccountShell from "@/components/account/AccountShell";
import {
    Zap,
    Loader2, Crown, Upload,
    Shield, Lock, Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ScannerResultRow {
    symbol: string;
    error?: string;
    direction?: "BUY" | "SELL" | "NEUTRAL";
    strength?: number;
    trend?: string;
    momentum?: number;
    volatility?: string;
    regime?: string;
    liquidity?: string;
}

interface ImageScanResult {
    success: boolean;
    symbol?: string;
    timeframe?: string;
    imageSize?: number;
    detectedMarketData?: {
        regime?: string;
        confidence?: number;
        volatility?: string;
        score?: number;
    };
    analysis?: string;
    message?: string;
}

export default function ScannerPage() {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [results, setResults] = useState<ScannerResultRow[]>([]);
    const [filtered, setFiltered] = useState<ScannerResultRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [isPro, setIsPro] = useState(false);
    const [filters] = useState({
        symbol: "", direction: "", strength: "", regime: "", timeframe: "H1", minStrength: "0",
    });
    const [imageUploading, setImageUploading] = useState(false);
    const [imageResult, setImageResult] = useState<ImageScanResult | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const scan = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const params = new URLSearchParams();
            if (filters.symbol) params.set("symbols", filters.symbol);
            params.set("timeframe", filters.timeframe);
            params.set("minStrength", filters.minStrength);
            const res = await fetch(`/api/scanner?${params}`, { headers: { Authorization: `Bearer ${token}` } });
            const data = await res.json();
            if (data.success) {
                setResults(data.results);
                setFiltered(data.filtered || data.results);
                setIsPro(data.isPro);
            }
        } catch {}
        finally { setLoading(false); }
    }, [user, filters]);

    useEffect(() => {
        if (authLoading || !user) return;
        void Promise.resolve().then(() => scan());
    }, [authLoading, user, scan]);

    const applyFilters = () => {
        let f = results;
        if (filters.symbol) f = f.filter((r) => r.symbol === filters.symbol);
        if (filters.direction) f = f.filter((r) => r.direction === filters.direction);
        if (filters.strength) f = f.filter((r) => (r.strength ?? 0) >= parseFloat(filters.strength));
        if (filters.regime) f = f.filter((r) => r.regime === filters.regime);
        setFiltered(f);
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!isPro || !user) { alert("Pro subscription required for image scanning"); return; }

        const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
        if (!allowedTypes.includes(file.type)) { alert("Invalid image type. Use PNG, JPEG, WebP, or GIF."); return; }
        if (file.size > 10 * 1024 * 1024) { alert("Image too large. Max 10MB."); return; }

        const previewUrl = URL.createObjectURL(file);
        setImagePreview(previewUrl);
        setImageUploading(true);
        setImageResult(null);

        try {
            const token = await user.getIdToken();
            const formData = new FormData();
            formData.append("image", file);
            formData.append("symbol", filters.symbol || "XAUUSD");
            formData.append("timeframe", filters.timeframe);
            const res = await fetch("/api/scanner/upload", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
            });
            const data = await res.json();
            if (data.success) setImageResult(data);
        } catch {}
        finally { setImageUploading(false); }
    };

    const filteredResults = filters.symbol || filters.direction || filters.regime ? filtered : results;

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="Market Scanner"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></AccountShell></div>);
    }
    if (!user) {
        return (<div className="flex min-h-screen flex-col bg-background text-foreground"><AccountShell title="Market Scanner"><div className="flex flex-1 flex-col items-center justify-center gap-4"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1></div></AccountShell></div>);
    }

    return (
        <AccountShell title="Professional Market Scanner" subtitle="Multi-asset market scanner with real-time signals" onBack={() => router.push("/account")}>
            <div className="space-y-4" data-guide="scanner">
                <div className="flex flex-wrap items-center gap-3" data-guide="controls">
                    <button type="button" onClick={scan} disabled={loading} className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition disabled:opacity-50">
                        {loading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Scan Markets
                    </button>
                    <span className="text-xs text-muted-foreground">{filteredResults.length} symbols scanned</span>
                    {isPro && <Crown size={14} className="text-amber-400" />}
                </div>

                {isPro && (
                    <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.03] p-4" data-guide="image-scan">
                        <div className="flex items-center gap-3 mb-3">
                            <Upload className="h-5 w-5 text-violet-400" />
                            <span className="text-sm font-semibold text-foreground">Chart Image Scanner (Pro)</span>
                            <span className="text-xs text-muted-foreground">Upload a chart screenshot for AI analysis</span>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp,image/gif"
                                    onChange={handleImageUpload}
                                    className="hidden"
                                    id="chart-upload"
                                />
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={imageUploading}
                                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-violet-500/30 bg-violet-500/5 px-4 py-3 text-sm text-violet-400 hover:bg-violet-500/10 transition disabled:opacity-50"
                                >
                                    {imageUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                                    {imageUploading ? "Analyzing..." : "Upload Chart Image"}
                                </button>
                            </div>
                            {imagePreview && (
                                <div className="rounded-xl border border-border/30 bg-muted/50 overflow-hidden">
                                    <img src={imagePreview} alt="Chart preview" className="h-32 w-full object-contain" />
                                </div>
                            )}
                        </div>
                        {imageResult && (
                            <div className="mt-3 rounded-lg border border-border/30 bg-muted/30 p-3 text-xs text-muted-foreground">
                                <div className="flex items-center gap-2 text-emerald-400"><Eye className="h-4 w-4" /> Image Analysis Results</div>
                                <p className="mt-1">Detected: {imageResult.detectedMarketData?.regime} ({imageResult.detectedMarketData?.confidence}%) | Volatility: {imageResult.detectedMarketData?.volatility} | Score: {imageResult.detectedMarketData?.score}/100</p>
                                <p className="mt-1">{imageResult.analysis}</p>
                            </div>
                        )}
                    </div>
                )}

                {!isPro && (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] p-3 text-xs text-amber-400/60">
                        <Lock size={14} className="inline mr-1" /> Chart image scanning requires a Pro subscription. Upgrade at <a href="/pricing" className="underline">/pricing</a>
                    </div>
                )}

                <div className="overflow-x-auto rounded-xl border border-border/30 bg-muted/50" data-guide="results">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-border/20 text-[10px] uppercase text-muted-foreground">
                                <th className="px-4 py-3 text-left">Symbol</th>
                                <th className="px-4 py-3 text-left">Direction</th>
                                <th className="px-4 py-3 text-right">Strength</th>
                                <th className="px-4 py-3 text-right">Trend</th>
                                <th className="px-4 py-3 text-right">Momentum</th>
                                <th className="px-4 py-3 text-left">Volatility</th>
                                <th className="px-4 py-3 text-left">Regime</th>
                                <th className="px-4 py-3 text-left">Liquidity</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={8} className="py-8 text-center text-muted-foreground"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></td></tr>
                            ) : filteredResults.length === 0 ? (
                                <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">No data available. Click scan to load markets.</td></tr>
                            ) : (
                                filteredResults.map((r) => (
                                    <tr key={r.symbol} className="border-b border-border/50 hover:bg-muted/50">
                                        <td className="px-4 py-3 font-mono font-bold text-foreground">{r.symbol}</td>
                                        <td className={cn("px-4 py-3 font-medium", r.direction === "BUY" ? "text-emerald-400" : r.direction === "SELL" ? "text-rose-400" : "text-muted-foreground")}>
                                            {r.direction}
                                            {(r.strength ?? 0) >= 80 && <span className="ml-1 text-[10px] text-amber-400">●</span>}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono font-bold" style={{ color: (r.strength ?? 0) >= 80 ? "#10b981" : (r.strength ?? 0) >= 60 ? "#f59e0b" : "#ef4444" }}>{r.strength}</td>
                                        <td className="px-4 py-3 text-right text-muted-foreground">{r.trend}</td>
                                        <td className="px-4 py-3 text-right font-mono text-muted-foreground">{r.momentum}</td>
                                        <td className="px-4 py-3 text-left"><span className={cn("rounded px-1.5 py-0.5 text-[10px]", r.volatility === "high" ? "bg-rose-500/10 text-rose-400" : r.volatility === "low" ? "bg-emerald-500/10 text-emerald-400" : "bg-muted/10 text-muted-foreground")}>{r.volatility}</span></td>
                                        <td className="px-4 py-3 text-left text-muted-foreground">{r.regime}</td>
                                        <td className="px-4 py-3 text-left text-muted-foreground">{r.liquidity}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="rounded-xl border border-amber-500/10 bg-amber-500/[0.03] p-3 text-[11px] text-amber-400/60">
                    Market Scanner uses real-time data from connected market sources. Pro subscribers can upload chart screenshots for AI-powered analysis combined with real market data. Strength scores reflect current market conditions based on trend, structure, liquidity, momentum, and volume analysis. Not financial advice.
                </div>
            </div>
        </AccountShell>
    );
}
