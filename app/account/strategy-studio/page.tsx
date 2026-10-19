"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    Bot,
    Plus,
    Code2,
    Layers,
    Clock,
    Shield,
    Terminal,
    ArrowUpRight,
    RefreshCw,
    Trash2,
    CheckCircle2,
    AlertTriangle,
    BarChart3,
    X,
    Pencil,
    Copy,
} from "lucide-react";
import AccountShell from "@/components/account/AccountShell";
import { auth } from "@/lib/firebase";
import type { BotStrategy, BotDeployment } from "@/lib/bot-studio/types";
import { STATE_LABELS } from "@/lib/bot-studio/lifecycle";

export default function AccountBotStudioPage() {
    const router = useRouter();
    const [strategies, setStrategies] = useState<BotStrategy[]>([]);
    const [deployments, setDeployments] = useState<BotDeployment[]>([]);
    const [activeTab, setActiveTab] = useState<"deployments" | "strategies">("deployments");
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [deployModalOpen, setDeployModalOpen] = useState(false);
    const [selectedStrategyId, setSelectedStrategyId] = useState<string>("");
    const [accountMode, setAccountMode] = useState<"demo" | "live">("demo");
    const [mt5Account, setMt5Account] = useState("default");

    const [backtestResult, setBacktestResult] = useState<any>(null);
    const [backtestModalOpen, setBacktestModalOpen] = useState(false);

    const getAuthHeaders = async (): Promise<Record<string, string>> => {
        const user = auth.currentUser;
        if (!user) return {};
        const token = await user.getIdToken();
        return {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        };
    };

    const loadData = async () => {
        setLoading(true);
        setError(null);
        try {
            const headers = await getAuthHeaders();
            const [stratRes, depRes] = await Promise.all([
                fetch("/api/bot-studio/strategies", { headers }),
                fetch("/api/bot-studio/deployments", { headers }),
            ]);

            if (stratRes.ok) {
                const sData = await stratRes.json();
                if (sData.ok) setStrategies(sData.strategies || []);
            }
            if (depRes.ok) {
                const dData = await depRes.json();
                if (dData.ok) setDeployments(dData.deployments || []);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load Bot Studio data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleRename = async (strategyId: string, currentName: string) => {
        const name = prompt("Rename strategy", currentName);
        if (!name || name.trim() === currentName) return;
        setActionLoading(`rename-${strategyId}`);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`/api/bot-studio/strategies/${strategyId}`, {
                method: "PATCH",
                headers,
                body: JSON.stringify({ name: name.trim() }),
            });
            if (!res.ok) {
                const err = await res.json();
                alert(`Rename failed: ${err.error}`);
            }
            await loadData();
        } catch (e) {
            alert(`Rename failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setActionLoading(null);
        }
    };

    const handleDuplicate = async (strategyId: string) => {
        setActionLoading(`dup-${strategyId}`);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`/api/bot-studio/strategies/${strategyId}`, {
                method: "POST",
                headers,
                body: JSON.stringify({}),
            });
            if (!res.ok) {
                const err = await res.json();
                alert(`Duplicate failed: ${err.error}`);
            }
            await loadData();
        } catch (e) {
            alert(`Duplicate failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setActionLoading(null);
        }
    };

    const formatDate = (ts: number) => new Date(ts).toLocaleString();

    const renderStrategies = () => (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">My Strategies</h2>
                <div className="flex gap-2">
                    <Link href="/account/strategy-studio/editor" className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90">
                        <Code2 className="h-4 w-4" />
                        New AvScript
                    </Link>
                    <Link href="/account/strategy-studio/builder" className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card text-sm font-semibold hover:bg-muted">
                        <Layers className="h-4 w-4" />
                        Visual Builder
                    </Link>
                </div>
            </div>
            {strategies.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                    No strategies yet. Create one to get started.
                </div>
            ) : (
                strategies.map((strat) => (
                    <div key={strat.id} className="border border-border rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="font-semibold">{strat.name}</h3>
                                <p className="text-xs text-muted-foreground">Updated {formatDate(strat.updatedAt)}</p>
                            </div>
                            <div className="flex gap-2">
                                <Link href={`/account/strategy-studio/editor?id=${strat.id}`} className="px-2 py-1 text-xs border border-border rounded hover:bg-muted">Edit</Link>
                                <Link href={`/account/strategy-studio/builder?id=${strat.id}`} className="px-2 py-1 text-xs border border-border rounded hover:bg-muted">Builder</Link>
                                <button onClick={() => handleRename(strat.id, strat.name)} className="px-2 py-1 text-xs border border-border rounded hover:bg-muted">Rename</button>
                                <button onClick={() => handleDuplicate(strat.id)} className="px-2 py-1 text-xs border border-border rounded hover:bg-muted">Duplicate</button>
                            </div>
                        </div>
                    </div>
                ))
            )}
        </div>
    );

    const renderDeployments = () => (
        <div className="space-y-4">
            <h2 className="text-lg font-semibold">Deployments</h2>
            {deployments.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                    No deployments yet.
                </div>
            ) : (
                deployments.map((d) => (
                    <div key={d.id} className="border border-border rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="font-semibold">{d.id}</h3>
                                <p className="text-xs text-muted-foreground">State: {STATE_LABELS[d.runtimeState]}</p>
                            </div>
                        </div>
                    </div>
                ))
            )}
        </div>
    );

    return (
        <AccountShell title="AlgoVault Bot Studio" subtitle="Create, test, and deploy trading strategies.">
            <div className="p-6 space-y-6">
                <div className="flex gap-4">
                    <button onClick={() => setActiveTab("deployments")} className={`px-4 py-2 rounded-lg ${activeTab === "deployments" ? "bg-primary text-white" : "border border-border"}`}>Deployments</button>
                    <button onClick={() => setActiveTab("strategies")} className={`px-4 py-2 rounded-lg ${activeTab === "strategies" ? "bg-primary text-white" : "border border-border"}`}>Strategies</button>
                </div>
                {error && <div className="text-red-500">{error}</div>}
                {loading ? <div>Loading...</div> : activeTab === "strategies" ? renderStrategies() : renderDeployments()}
            </div>
        </AccountShell>
    );
}
