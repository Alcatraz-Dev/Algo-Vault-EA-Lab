"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    ArrowRight,
    Bot,
    ChevronRight,
    Copy,
    Gauge,
    Loader2,
    MapPin,
    Plus,
    RefreshCw,
    Settings2,
    ShieldCheck,
    Wallet,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { ref, onValue } from "firebase/database";
import { auth, database } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";

type ProductLicense = {
    id: string;
    productId?: string;
    productName?: string;
    status?: string;
    expiresAt?: number;
    mt5Account?: string | number;
};

type BotStats = {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    grossProfit: number;
    grossLoss: number;
    profitFactor: number;
    totalPnl: number;
    todayPnl: number;
    avgWin: number;
    avgLoss: number;
    bestTrade: number;
    worstTrade: number;
    maxDrawdown: number;
    avgHoldingTimeMs: number;
};

type UserBot = {
    id: string;
    ownerId: string;
    type: "marketplace" | "custom";
    name: string;
    platform: string;
    symbol: string | null;
    timeframe: string | null;
    magicNumber: string | null;
    commentFilter: string | null;
    productId: string | null;
    licenseId: string | null;
    mt5Account: string | null;
    gatewayInstallationId: string | null;
    mapping: Record<string, unknown> | null;
    status: string;
    online: boolean;
    lastHeartbeatAt: number | null;
    description?: string;
    createdAt: number;
    updatedAt: number;
    stats?: BotStats;
    openPositions?: Array<Record<string, unknown>>;
};

type ApiError = {
    error?: string;
    success?: boolean;
    botId?: string;
    conflicts?: Array<{ botId: string; name: string; mt5Account: string }>;
};

function formatPnl(value: number | undefined) {
    const n = Number(value || 0);
    return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTime(ts: number | null | undefined) {
    if (!ts) return "Never";
    const d = new Date(ts);
    const diff = Date.now() - ts;
    if (diff < 60_000) return "Just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return d.toLocaleDateString();
}

export default function MyBotsPage() {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [bots, setBots] = useState<UserBot[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    // Add custom bot form
    const [showAdd, setShowAdd] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        name: "",
        magicNumber: "",
        mt5Account: "",
        symbol: "",
        timeframe: "",
        commentFilter: "",
        description: "",
    });

    // Mapping panel
    const [mappingBotId, setMappingBotId] = useState("");
    const [mapping, setMapping] = useState({ mt5Account: "", magicNumber: "", symbol: "", comment: "" });
    const [mappingSaving, setMappingSaving] = useState(false);
    const [mappingError, setMappingError] = useState("");

    // Connect a marketplace license to a bot record
    const [licenses, setLicenses] = useState<ProductLicense[]>([]);
    const [showConnect, setShowConnect] = useState(false);
    const [connectLicenseId, setConnectLicenseId] = useState("");
    const [connectMagic, setConnectMagic] = useState("");
    const [connectAccount, setConnectAccount] = useState("");
    const [connectSaving, setConnectSaving] = useState(false);
    const [connectError, setConnectError] = useState("");

    useEffect(() => {
        if (!user) return;
        const licensesRef = ref(database, `licenses/${user.uid}`);
        const unsub = onValue(
            licensesRef,
            (snap) => {
                const data = snap.val();
                if (!data || typeof data !== "object") {
                    setLicenses([]);
                    return;
                }
                const list: ProductLicense[] = Object.entries(data)
                    .filter(
                        ([, raw]) =>
                            raw &&
                            typeof raw === "object" &&
                            String((raw as Record<string, unknown>).type ?? "") !== "custom_bot"
                    )
                    .map(([id, raw]) => ({
                        id,
                        ...(raw as Omit<ProductLicense, "id">),
                    }));
                setLicenses(list);
            },
            (e) => console.error("LICENSES ERROR:", e)
        );
        return () => unsub();
    }, [user]);

    const loadBots = useCallback(async (uid: string, silent = false) => {
        if (!silent) setLoading(true);
        setError("");
        try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) return;
            const res = await fetch("/api/bots", { headers: { Authorization: `Bearer ${token}` } });
            const data = (await res.json()) as { success?: boolean; bots?: UserBot[]; error?: string };
            if (!res.ok) throw new Error(data.error || "Failed to load bots.");
            setBots(data.bots || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load bots.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            if (!u) {
                setLoading(false);
                return;
            }
            void loadBots(u.uid);
        });
        return () => unsub();
    }, [loadBots]);

    const handleRefresh = async () => {
        if (!user) return;
        setRefreshing(true);
        await loadBots(user.uid, true);
        setRefreshing(false);
    };

    const handleCreateBot = async () => {
        if (!user) return;
        if (!form.name.trim() || !form.magicNumber.trim()) {
            setError("Bot name and magic number are required.");
            return;
        }
        setSaving(true);
        setError("");
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/bots/custom", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(form),
            });
            const data = (await res.json()) as ApiError;
            if (!res.ok) throw new Error(data.error || "Failed to register bot.");
            setShowAdd(false);
            setForm({ name: "", magicNumber: "", mt5Account: "", symbol: "", timeframe: "", commentFilter: "", description: "" });
            setNotice(`Custom bot ${data.botId} registered. Add the magic number to your EA inputs and it will appear automatically via the MT5 Gateway.`);
            await loadBots(user.uid, true);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to register bot.");
        } finally {
            setSaving(false);
        }
    };

    const handleDisconnect = async (bot: UserBot) => {
        if (!user) return;
        if (!window.confirm(`Disconnect ${bot.name}? Its positions/trades will no longer update.`)) return;
        setError("");
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/bots/disconnect", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ botId: bot.id }),
            });
            const data = (await res.json()) as ApiError;
            if (!res.ok) throw new Error(data.error || "Failed to disconnect.");
            await loadBots(user.uid, true);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to disconnect.");
        }
    };

    const openMapping = (bot: UserBot) => {
        setMappingBotId(bot.id);
        setMapping({
            mt5Account: bot.mt5Account || "",
            magicNumber: bot.magicNumber || "",
            symbol: bot.symbol || "",
            comment: bot.commentFilter || "",
        });
        setMappingError("");
    };

    const handleSaveMapping = async (botId: string) => {
        if (!user) return;
        setMappingSaving(true);
        setMappingError("");
        try {
            const token = await user.getIdToken();
            const res = await fetch(`/api/bots/${botId}/mapping`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(mapping),
            });
            const data = (await res.json()) as ApiError;
            if (!res.ok) throw new Error(data.error || "Failed to update mapping.");
            setMappingBotId("");
            setNotice(`Mapping for ${botId} updated.`);
            await loadBots(user.uid, true);
        } catch (err) {
            if (err instanceof Error) {
                setMappingError(err.message);
            } else {
                setMappingError("Failed to update mapping.");
            }
        } finally {
            setMappingSaving(false);
        }
    };

    const handleConnectMarketplace = async () => {
        if (!user) return;
        const license = licenses.find((l) => l.id === connectLicenseId);
        if (!license || !license.productId) {
            setConnectError("Select a license to connect.");
            return;
        }
        setConnectSaving(true);
        setConnectError("");
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/bots/connect", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    productId: license.productId,
                    licenseId: license.id,
                    mt5Account: connectAccount,
                    magicNumber: connectMagic,
                }),
            });
            const data = (await res.json()) as ApiError;
            if (!res.ok) throw new Error(data.error || "Failed to connect.");
            setShowConnect(false);
            setConnectLicenseId("");
            setConnectMagic("");
            setConnectAccount("");
            setNotice(`Marketplace bot ${data.botId} connected.`);
            await loadBots(user.uid, true);
        } catch (err) {
            setConnectError(err instanceof Error ? err.message : "Failed to connect.");
        } finally {
            setConnectSaving(false);
        }
    };

    const copy = (text: string) => {
        void navigator.clipboard?.writeText(text);
        setNotice(`Copied ${text}`);
    };

    const marketplaceBots = bots.filter((b) => b.type === "marketplace");
    const customBots = bots.filter((b) => b.type === "custom");

    return (
        <AccountShell title="My Bots" subtitle="Monitor every MT5 bot — Marketplace or your own Custom/Legacy EA — through the existing AlgoVault Gateway.">
            <div className="space-y-6" data-guide="page-header">
                {/* Alerts */}
                {error && (
                    <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                        {error}
                    </div>
                )}
                {notice && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-500">
                        {notice}
                    </div>
                )}

                {/* Header actions */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="text-sm text-muted-foreground">
                            Custom bots power the same monitoring, statistics, alerts and AI as Marketplace products — identified by MT5 Magic Number.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                setShowConnect((v) => !v);
                                setConnectError("");
                            }}
                            className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted"
                        >
                            <Wallet size={15} />
                            Connect Marketplace Bot
                        </button>
                        <button
                            type="button"
                            onClick={handleRefresh}
                            className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted"
                        >
                            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
                            Refresh
                        </button>
                        <Link
                            href="/pricing"
                            className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted"
                        >
                            <ShieldCheck size={15} />
                            Upgrade
                        </Link>
                        <button
                            type="button"
                            onClick={() => {
                                setShowAdd((v) => !v);
                                setError("");
                            }}
                            className="flex items-center gap-2 rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background transition hover:opacity-90"
                        >
                            <Plus size={15} />
                            Add Custom Bot
                        </button>
                    </div>
                </div>

                {/* Add custom bot form */}
                {showAdd && (
                    <div className="rounded-2xl border border-border bg-card p-6">
                        <div className="mb-4 flex items-center gap-2">
                            <Bot size={18} />
                            <h2 className="text-lg font-bold">Register a Custom / Legacy MT5 EA</h2>
                        </div>
                        <p className="mb-5 text-sm text-muted-foreground">
                            No .EX5 upload needed. Keep running your existing EA on MT5 — the AlgoVault MT5 Gateway detects its activity via the magic number and streams it here.
                        </p>
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="md:col-span-2">
                                <input
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    placeholder="Bot name (e.g. Gold Scalper)"
                                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                            </div>
                            <div>
                                <input
                                    value={form.magicNumber}
                                    onChange={(e) => setForm({ ...form, magicNumber: e.target.value.replace(/[^\d]/g, "") })}
                                    placeholder="Magic number (e.g. 10001)"
                                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                            </div>
                            <div>
                                <input
                                    value={form.mt5Account}
                                    onChange={(e) => setForm({ ...form, mt5Account: e.target.value.replace(/[^\d]/g, "") })}
                                    placeholder="MT5 account (optional)"
                                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                            </div>
                            <div>
                                <input
                                    value={form.symbol}
                                    onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                                    placeholder="Symbol (e.g. XAUUSD)"
                                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                            </div>
                            <div>
                                <input
                                    value={form.timeframe}
                                    onChange={(e) => setForm({ ...form, timeframe: e.target.value })}
                                    placeholder="Timeframe (e.g. M15)"
                                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                            </div>
                            <div className="md:col-span-2">
                                <input
                                    value={form.commentFilter}
                                    onChange={(e) => setForm({ ...form, commentFilter: e.target.value })}
                                    placeholder="MT5 comment filter (optional — extra safety when several EAs share an account)"
                                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                            </div>
                            <div className="md:col-span-2">
                                <textarea
                                    value={form.description}
                                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                                    placeholder="Description (optional)"
                                    rows={2}
                                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                            </div>
                        </div>
                        <div className="mt-5 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setShowAdd(false)}
                                className="rounded-xl border border-border px-4 py-2 text-sm transition hover:bg-muted"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleCreateBot}
                                disabled={saving}
                                className="flex items-center gap-2 rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background transition hover:opacity-90 disabled:opacity-50"
                            >
                                {saving && <Loader2 size={15} className="animate-spin" />}
                                Register Bot
                            </button>
                        </div>
                    </div>
                )}

                {/* Connect marketplace bot */}
                {showConnect && (
                    <div className="rounded-2xl border border-border bg-card p-6">
                        <div className="mb-4 flex items-center gap-2">
                            <Wallet size={18} />
                            <h2 className="text-lg font-bold">Connect a Marketplace Bot</h2>
                        </div>
                        <p className="mb-5 text-sm text-muted-foreground">
                            Pick a product you have an active license for, then assign the MT5 account + magic number
                            that EA is running on. Mapping conflicts are detected before saving.
                        </p>

                        {licenses.length === 0 ? (
                            <p className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                                No marketplace licenses found. Purchase a bot on the Marketplace to connect it here.
                            </p>
                        ) : (
                            <div className="grid gap-3">
                                <select
                                    value={connectLicenseId}
                                    onChange={(e) => setConnectLicenseId(e.target.value)}
                                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                >
                                    <option value="">Select a product license…</option>
                                    {licenses
                                        .filter((l) => l.status === "active")
                                        .map((l) => (
                                            <option key={l.id} value={l.id}>
                                                {l.productName || l.productId || l.id} {l.expiresAt ? "· expires " + new Date(l.expiresAt).toLocaleDateString() : ""}
                                            </option>
                                        ))}
                                </select>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <input
                                        value={connectAccount}
                                        onChange={(e) => setConnectAccount(e.target.value.replace(/[^\d]/g, ""))}
                                        placeholder="MT5 account number"
                                        className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                    />
                                    <input
                                        value={connectMagic}
                                        onChange={(e) => setConnectMagic(e.target.value.replace(/[^\d]/g, ""))}
                                        placeholder="Magic number (EA input)"
                                        className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                    />
                                </div>
                                {connectError && (
                                    <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                        {connectError}
                                    </div>
                                )}
                                <div className="mt-1 flex items-center justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowConnect(false)}
                                        className="rounded-xl border border-border px-4 py-2 text-sm transition hover:bg-muted"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleConnectMarketplace}
                                        disabled={connectSaving || !connectLicenseId}
                                        className="flex items-center gap-2 rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background transition hover:opacity-90 disabled:opacity-50"
                                    >
                                        {connectSaving && <Loader2 size={15} className="animate-spin" />}
                                        Connect
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center justify-center py-24 text-muted-foreground">
                        <Loader2 size={22} className="animate-spin" />
                    </div>
                ) : bots.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
                        <Bot size={32} className="mx-auto mb-3 text-muted-foreground" />
                        <h3 className="text-lg font-bold">No bots connected yet</h3>
                        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                            Connect a Marketplace product you already own from your Licenses, or register your own
                            custom MT5 EA with a magic number. Both are monitored through the same gateway.
                        </p>
                    </div>
                ) : (
                    <>
                        {customBots.length > 0 && (
                            <section>
                                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                                    <Bot size={14} /> Custom Bots
                                </h2>
                                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                    {customBots.map((bot) => (
                                        <BotCard
                                            key={bot.id}
                                            bot={bot}
                                            onDisconnect={handleDisconnect}
                                            onMap={openMapping}
                                            onCopy={copy}
                                            onOpen={() => router.push(`/account/bots/${bot.id}`)}
                                        />
                                    ))}
                                </div>
                            </section>
                        )}

                        {marketplaceBots.length > 0 && (
                            <section>
                                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                                    <Wallet size={14} /> Marketplace Bots
                                </h2>
                                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                    {marketplaceBots.map((bot) => (
                                        <BotCard
                                            key={bot.id}
                                            bot={bot}
                                            onDisconnect={handleDisconnect}
                                            onMap={openMapping}
                                            onCopy={copy}
                                            onOpen={() => router.push(`/account/bots/${bot.id}`)}
                                        />
                                    ))}
                                </div>
                            </section>
                        )}
                    </>
                )}

                {/* Mapping panel */}
                {mappingBotId && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
                        <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl">
                            <div className="mb-4 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <MapPin size={18} />
                                    <h3 className="text-lg font-bold">Map MT5 Activity</h3>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setMappingBotId("")}
                                    className="rounded-lg border border-border px-3 py-1 text-sm text-muted-foreground hover:bg-muted"
                                >
                                    Close
                                </button>
                            </div>
                            <p className="mb-4 text-sm text-muted-foreground">
                                Tell AlgoVault which MT5 account + magic number this EA trades on. The gateway matches
                                reported positions and trades to this bot.
                            </p>
                            <div className="grid gap-3">
                                <input
                                    value={mapping.mt5Account}
                                    onChange={(e) => setMapping({ ...mapping, mt5Account: e.target.value.replace(/[^\d]/g, "") })}
                                    placeholder="MT5 account number"
                                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                                <input
                                    value={mapping.magicNumber}
                                    onChange={(e) => setMapping({ ...mapping, magicNumber: e.target.value.replace(/[^\d]/g, "") })}
                                    placeholder="Magic number"
                                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                                <div className="grid grid-cols-2 gap-3">
                                    <input
                                        value={mapping.symbol}
                                        onChange={(e) => setMapping({ ...mapping, symbol: e.target.value })}
                                        placeholder="Symbol (optional)"
                                        className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                    />
                                    <input
                                        value={mapping.comment}
                                        onChange={(e) => setMapping({ ...mapping, comment: e.target.value })}
                                        placeholder="Comment (optional)"
                                        className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                    />
                                </div>
                            </div>
                            {mappingError && (
                                <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                    {mappingError}
                                </div>
                            )}
                            <div className="mt-5 flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setMappingBotId("")}
                                    className="rounded-xl border border-border px-4 py-2 text-sm transition hover:bg-muted"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleSaveMapping(mappingBotId)}
                                    disabled={mappingSaving || !mapping.mt5Account}
                                    className="flex items-center gap-2 rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background transition hover:opacity-90 disabled:opacity-50"
                                >
                                    {mappingSaving && <Loader2 size={15} className="animate-spin" />}
                                    Save Mapping
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Free/Pro note */}
                <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
                    <p className="flex items-center gap-2 font-medium text-foreground">
                        <ShieldCheck size={16} /> How custom bot monitoring works
                    </p>
                    <ul className="mt-3 list-inside list-disc space-y-1.5">
                        <li>Your .EX5 file is never modified — it keeps running untouched on MT5.</li>
                        <li>The existing AlgoVault MT5 Gateway reads every open position (all magic numbers) and attributes activity to the right bot.</li>
                        <li>Free accounts connect basic bot statistics; Pro adds full trade history, advanced analytics, alerts and AI insights.</li>
                        <li>Account equity stays account-level; each bot&apos;s P/L is computed from its own realized + floating trades.</li>
                    </ul>
                </div>
            </div>
        </AccountShell>
    );
}

function BotCard({
    bot,
    onDisconnect,
    onMap,
    onCopy,
    onOpen,
}: {
    bot: UserBot;
    onDisconnect: (bot: UserBot) => void;
    onMap: (bot: UserBot) => void;
    onCopy: (text: string) => void;
    onOpen: () => void;
}) {
    const online = bot.online && bot.status !== "disconnected";
    const isMarketplace = bot.type === "marketplace";
    const openCount = bot.openPositions?.length || 0;
    const lastHeartbeat = bot.lastHeartbeatAt;

    return (
        <div className="flex flex-col rounded-2xl border border-border bg-card p-5 transition hover:border-primary/40">
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                    <span className={`relative flex h-2.5 w-2.5 ${online ? "" : ""}`}>
                        {online && (
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                        )}
                        <span
                            className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                                online ? "bg-emerald-500" : "bg-slate-400"
                            }`}
                        />
                    </span>
                    <h3 className="truncate text-base font-bold">{bot.name}</h3>
                </div>
                <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                        isMarketplace
                            ? "bg-primary/15 text-primary"
                            : "bg-violet-500/15 text-violet-500"
                    }`}
                >
                    {isMarketplace ? "Marketplace" : "Custom"}
                </span>
            </div>

            <button
                type="button"
                onClick={() => onCopy(bot.id)}
                className="mt-1 flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
            >
                <Copy size={11} />
                {bot.id}
            </button>

            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Info label="Symbol" value={bot.symbol || "—"} />
                <Info label="Timeframe" value={bot.timeframe || "—"} />
                <Info label="MT5 Account" value={bot.mt5Account || "Not mapped"} />
                <Info label="Magic" value={bot.magicNumber || "—"} />
            </div>

                            <div className="mt-4 space-y-1.5 rounded-xl bg-muted/60 p-3 text-sm" data-guide="stats">
                <Row label="Total P/L">
                    <span className={Number(bot.stats?.totalPnl || 0) >= 0 ? "font-semibold text-emerald-500" : "font-semibold text-destructive"}>
                        {formatPnl(bot.stats?.totalPnl)}
                    </span>
                </Row>
                <Row label="Today P/L">
                    <span className={Number(bot.stats?.todayPnl || 0) >= 0 ? "font-semibold text-emerald-500" : "font-semibold text-destructive"}>
                        {formatPnl(bot.stats?.todayPnl)}
                    </span>
                </Row>
                <Row label="Win rate">
                    <span>{bot.stats ? `${bot.stats.winRate}%` : "—"}</span>
                </Row>
                <Row label="Trades">
                    <span>{bot.stats?.totalTrades ?? 0} closed · {openCount} open</span>
                </Row>
            </div>

            <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                    <Gauge size={12} />
                    {online ? "Online" : "Offline"} · {formatTime(lastHeartbeat)}
                </span>
            </div>

            <div className="mt-3 flex gap-2 border-t border-border pt-3">
                <button
                    type="button"
                    onClick={onOpen}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-foreground px-3 py-2 text-xs font-semibold text-background transition hover:opacity-90"
                >
                    Details <ChevronRight size={13} />
                </button>
                <button
                    type="button"
                    onClick={() => onMap(bot)}
                    className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-medium transition hover:bg-muted"
                >
                    <Settings2 size={13} /> Map
                </button>
                {bot.status !== "disconnected" && (
                    <button
                        type="button"
                        onClick={() => onDisconnect(bot)}
                        className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition hover:border-destructive/40 hover:text-destructive"
                    >
                        <ArrowRight size={13} className="rotate-180" />
                    </button>
                )}
            </div>
        </div>
    );
}

function Info({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="truncate font-medium">{value}</p>
        </div>
    );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{label}</span>
            {children}
        </div>
    );
}