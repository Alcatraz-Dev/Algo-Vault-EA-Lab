"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import {
    FileKey2,
    Plus,
    Search,
    Copy,
    Check,
    Ban,
    X,
} from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { onValue, ref } from "firebase/database";
import { auth, database } from "@/lib/firebase";

type License = {
    id: string;
    licenseKey: string;
    userId?: string;
    userEmail?: string;
    productName: string;
    productId: string;
    status: "active" | "expired" | "revoked";
    createdAt: number;
    expiresAt?: number | null; // null for lifetime
    maxAccounts?: number;
};

type Bot = { id: string; name?: string; slug?: string; symbol?: string };

export default function AdminLicensesPage() {
    const [licenses, setLicenses] = useState<License[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<"all" | "active" | "expired" | "revoked">("all");
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [bots, setBots] = useState<Bot[]>([]);

    // Modal state for manual license generation
    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [userEmail, setUserEmail] = useState("");
    const [selectedBotId, setSelectedBotId] = useState("");
    const [durationDays, setDurationDays] = useState<number>(365); // 0 = Lifetime

    async function getToken() {
        const user = auth.currentUser;
        if (!user) {
            throw new Error("Authentication required.");
        }
        return user.getIdToken();
    }

    const fetchLicenses = async () => {
        setLoading(true);
        try {
            const token = await getToken();
            const response = await fetch("/api/admin/licenses", {
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
            });
            if (!response.ok) {
                throw new Error(
                    (await response.json())?.error ?? "Unable to load licenses."
                );
            }
            const data = await response.json();
            setLicenses(Array.isArray(data?.licenses) ? data.licenses : []);
        } catch (err) {
            console.error("Error loading licenses:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const botsRef = ref(database, "bots");
        const unsub = onValue(botsRef, (snap) => {
            const data = snap.val() || {};
            const list: Bot[] = Object.entries(data).map(([id, val]) => ({
                id,
                ...(val as Record<string, unknown>),
            })) as Bot[];
            setBots(list);
        });
        return unsub;
    }, []);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                fetchLicenses();
            } else {
                setLoading(false);
            }
        });
        return unsubscribe;
    }, []);

    const handleCopy = (key: string, id: string) => {
        navigator.clipboard.writeText(key);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const handleRevoke = async (item: License) => {
        if (!confirm("Are you sure you want to revoke this license key? The user will no longer be able to use the EA.")) return;
        try {
            const token = await getToken();
            const response = await fetch("/api/admin/licenses", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ id: item.id, userId: item.userId, status: "revoked" }),
            });
            if (!response.ok) {
                throw new Error(
                    (await response.json())?.error ?? "Failed to revoke license."
                );
            }
            setLicenses((prev) =>
                prev.map((l) => (l.id === item.id ? { ...l, status: "revoked" } : l))
            );
        } catch (err) {
            console.error("Failed to revoke license:", err);
        }
    };

    const handleGenerateManual = async (e: React.FormEvent) => {
        e.preventDefault();
        const selectedBot = bots.find((b) => b.id === selectedBotId);
        if (!userEmail || !selectedBot) return;
        setSaving(true);
        try {
            const token = await getToken();
            const response = await fetch("/api/admin/licenses", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    userEmail,
                    productName: selectedBot.name || selectedBot.slug || "Product",
                    productId: selectedBot.id,
                    durationDays,
                }),
            });
            if (!response.ok) {
                throw new Error(
                    (await response.json())?.error ?? "Failed to generate license."
                );
            }
            setShowModal(false);
            setUserEmail("");
            setSelectedBotId("");
            fetchLicenses();
        } catch (err) {
            console.error("Failed to generate manual license:", err);
        } finally {
            setSaving(false);
        }
    };

    const filtered = licenses.filter((l) => {
        const matchesSearch =
            l.licenseKey?.toLowerCase().includes(search.toLowerCase()) ||
            l.userEmail?.toLowerCase().includes(search.toLowerCase()) ||
            l.productName?.toLowerCase().includes(search.toLowerCase());
        const matchesStatus = statusFilter === "all" || l.status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    return (
        <AdminShell
            title="License Keys"
            subtitle="Manage, issue, and inspect software licenses for EA products"
        >
            {/* Header controls */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
                <div className="flex flex-1 items-center gap-3 max-w-xl">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                        <input
                            type="text"
                            placeholder="Search key, email, or product..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full rounded-xl border border-border bg-muted pl-10 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-emerald-500 focus:outline-none"
                        />
                    </div>
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "expired" | "revoked")}
                        className="rounded-xl border border-border bg-muted px-3 py-2 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
                    >
                        <option value="all">All Statuses</option>
                        <option value="active">Active Only</option>
                        <option value="expired">Expired Only</option>
                        <option value="revoked">Revoked Only</option>
                    </select>
                </div>

                <button
                    onClick={() => setShowModal(true)}
                    className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-background transition hover:bg-emerald-400"
                >
                    <Plus size={16} /> Generate License
                </button>
            </div>

            {/* List Table */}
            {loading ? (
                <div className="flex justify-center py-20">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent"></div>
                </div>
            ) : filtered.length === 0 ? (
                <div className="rounded-2xl border border-border bg-card p-12 text-center">
                    <FileKey2 size={40} className="mx-auto text-muted-foreground mb-3" />
                    <h3 className="text-lg font-bold text-foreground">No License Keys Found</h3>
                    <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                        License keys are automatically generated upon customer purchase or can be manually issued here.
                    </p>
                    <button
                        onClick={() => setShowModal(true)}
                        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-muted px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted transition"
                    >
                        <Plus size={16} /> Issue License Key
                    </button>
                </div>
            ) : (
                <div className="overflow-hidden rounded-2xl border border-border bg-card">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-foreground">
                            <thead className="border-b border-border bg-muted text-xs uppercase font-semibold text-muted-foreground">
                                <tr>
                                    <th className="px-6 py-4">License Key</th>
                                    <th className="px-6 py-4">Customer Email</th>
                                    <th className="px-6 py-4">Product</th>
                                    <th className="px-6 py-4">Status</th>
                                    <th className="px-6 py-4">Expiration</th>
                                    <th className="px-6 py-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {filtered.map((item) => (
                                    <tr key={item.id} className="hover:bg-muted/30">
                                        <td className="px-6 py-4 font-mono font-bold text-foreground">
                                            <div className="flex items-center gap-2">
                                                <span>{item.licenseKey}</span>
                                                <button
                                                    onClick={() => handleCopy(item.licenseKey, item.id)}
                                                    className="text-muted-foreground hover:text-foreground transition"
                                                    title="Copy key"
                                                >
                                                    {copiedId === item.id ? (
                                                        <Check size={14} className="text-emerald-600" />
                                                    ) : (
                                                        <Copy size={14} />
                                                    )}
                                                </button>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-foreground">{item.userEmail || "N/A"}</td>
                                        <td className="px-6 py-4 font-medium text-foreground">{item.productName}</td>
                                        <td className="px-6 py-4">
                                            <span
                                                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                                                    item.status === "active"
                                                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                                                        : item.status === "expired"
                                                        ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                                                        : "border-rose-500/30 bg-rose-500/10 text-rose-400"
                                                }`}
                                            >
                                                {item.status.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-xs text-muted-foreground">
                                            {item.expiresAt
                                                ? new Date(item.expiresAt).toLocaleDateString()
                                                : "Lifetime"}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            {item.status === "active" && (
                                                <button
                                                    onClick={() => handleRevoke(item)}
                                                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-400 hover:bg-rose-500/20 transition"
                                                >
                                                    <Ban size={13} /> Revoke
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
                        <div className="flex items-center justify-between border-b border-border pb-4">
                            <h3 className="text-lg font-bold text-foreground">Generate Manual License</h3>
                            <button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground">
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleGenerateManual} className="mt-5 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1">Customer Email</label>
                                <input
                                    type="email"
                                    required
                                    placeholder="user@example.com"
                                    value={userEmail}
                                    onChange={(e) => setUserEmail(e.target.value)}
                                    suppressHydrationWarning
                                    className="w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1">Product</label>
                                <select
                                    required
                                    value={selectedBotId}
                                    onChange={(e) => setSelectedBotId(e.target.value)}
                                    className="w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
                                >
                                    <option value="">Select a product...</option>
                                    {bots.map((bot) => (
                                        <option key={bot.id} value={bot.id}>
                                            {bot.name || bot.slug || bot.id}
                                            {bot.symbol ? ` (${bot.symbol})` : ""}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1">Duration</label>
                                <select
                                    value={durationDays}
                                    onChange={(e) => setDurationDays(Number(e.target.value))}
                                    className="w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
                                >
                                    <option value={30}>1 Month (30 Days)</option>
                                    <option value={90}>3 Months (90 Days)</option>
                                    <option value={365}>1 Year (365 Days)</option>
                                    <option value={0}>Lifetime (No expiration)</option>
                                </select>
                            </div>

                            <div className="mt-6 flex justify-end gap-3 border-t border-border pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-background hover:bg-emerald-400 disabled:opacity-50"
                                >
                                    {saving ? "Generating..." : "Generate Key"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </AdminShell>
    );
}
