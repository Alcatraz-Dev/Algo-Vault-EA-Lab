"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import {
    FileCode2,
    Plus,
    Search,
    Trash2,
    Download,
    Upload,
    X,
} from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { onValue, ref } from "firebase/database";
import { auth, database } from "@/lib/firebase";

type SetFile = {
    id: string;
    name: string;
    productId?: string;
    productSlug: string;
    pair: string;
    timeframe: string;
    riskLevel: "Low" | "Medium" | "High" | "Aggressive";
    downloadUrl?: string;
    description?: string;
    fileName?: string;
    createdAt: number;
};

type Bot = { id: string; name?: string; slug?: string };

function getAuth() {
    const user = auth.currentUser;
    if (!user) throw new Error("Authentication required.");
    return user.getIdToken();
}

export default function AdminSetFilesPage() {
    const [setFiles, setSetFiles] = useState<SetFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [bots, setBots] = useState<Bot[]>([]);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);

    const [name, setName] = useState("");
    const [selectedBotId, setSelectedBotId] = useState("");
    const [pair, setPair] = useState("EURUSD");
    const [timeframe, setTimeframe] = useState("M15");
    const [riskLevel, setRiskLevel] = useState<"Low" | "Medium" | "High" | "Aggressive">("Medium");
    const [file, setFile] = useState<File | null>(null);
    const [description, setDescription] = useState("");

    const fetchSetFiles = async () => {
        setLoading(true);
        try {
            const token = await getAuth();
            const res = await fetch("/api/admin/setfiles", {
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
            });
            if (!res.ok) throw new Error((await res.json())?.error ?? "Unable to load set files.");
            const data = await res.json();
            setSetFiles(Array.isArray(data?.setFiles) ? data.setFiles : []);
        } catch (err) {
            console.error("Error loading set files:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) fetchSetFiles();
            else setLoading(false);
        });
        return unsubscribe;
    }, []);

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

    const resetForm = () => {
        setName("");
        setSelectedBotId("");
        setPair("EURUSD");
        setTimeframe("M15");
        setFile(null);
        setDescription("");
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name || !file || !selectedBotId) return;
        setSaving(true);
        try {
            const token = await getAuth();
            const selectedBot = bots.find((b) => b.id === selectedBotId);
            const formData = new FormData();
            formData.set("file", file);
            formData.set("name", name);
            formData.set("productId", selectedBotId);
            formData.set("productSlug", selectedBot?.slug || selectedBotId);
            formData.set("pair", pair);
            formData.set("timeframe", timeframe);
            formData.set("riskLevel", riskLevel);
            formData.set("description", description);

            const res = await fetch("/api/admin/setfiles", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
            });
            if (!res.ok) throw new Error((await res.json())?.error ?? "Upload failed.");
            setShowModal(false);
            resetForm();
            fetchSetFiles();
        } catch (err) {
            console.error("Failed to create .set file:", err);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (item: SetFile) => {
        if (!confirm("Are you sure you want to delete this .set file?")) return;
        try {
            const token = await getAuth();
            const res = await fetch("/api/admin/setfiles", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ id: item.id, productId: item.productId, fileName: item.fileName }),
            });
            if (!res.ok) throw new Error("Delete failed.");
            setSetFiles((prev) => prev.filter((s) => s.id !== item.id));
        } catch (err) {
            console.error("Failed to delete .set file:", err);
        }
    };

    const handleDownload = async (item: SetFile) => {
        if (!item.productId || !item.fileName) {
            if (item.downloadUrl) {
                window.open(item.downloadUrl, "_blank", "noopener,noreferrer");
            } else {
                alert("No file available for this preset.");
            }
            return;
        }
        setDownloadingId(item.id);
        try {
            const token = await getAuth();
            const params = new URLSearchParams({ productId: item.productId, file: item.fileName });
            const res = await fetch(`/api/admin/setfiles/download?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: "Download failed." }));
                alert(err.error || "Download failed.");
                return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = item.fileName;
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            alert("Download error.");
        } finally {
            setDownloadingId(null);
        }
    };

    const filtered = setFiles.filter(
        (f) =>
            f.name.toLowerCase().includes(search.toLowerCase()) ||
            f.pair.toLowerCase().includes(search.toLowerCase()) ||
            f.productSlug.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <AdminShell
            title=".set Preset Files"
            subtitle="Manage optimized MT4/MT5 EA setting presets for users to download"
        >
            {/* Header actions */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                    <input
                        type="text"
                        placeholder="Search by name, pair, or bot..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full rounded-xl border border-border bg-muted pl-10 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-emerald-500 focus:outline-none"
                    />
                </div>
                <button
                    onClick={() => setShowModal(true)}
                    className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-background transition hover:bg-emerald-400"
                >
                    <Plus size={16} /> Add .set Preset
                </button>
            </div>

            {/* List */}
            {loading ? (
                <div className="flex justify-center py-20">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent"></div>
                </div>
            ) : filtered.length === 0 ? (
                <div className="rounded-2xl border border-border bg-card p-12 text-center">
                    <FileCode2 size={40} className="mx-auto text-muted-foreground mb-3" />
                    <h3 className="text-lg font-bold text-foreground">No Preset Files Found</h3>
                    <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                        Add optimized .set configuration files that users can download for different currency pairs and risk settings.
                    </p>
                    <button
                        onClick={() => setShowModal(true)}
                        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-muted px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted transition"
                    >
                        <Plus size={16} /> Create First Preset
                    </button>
                </div>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {filtered.map((item) => (
                        <div
                            key={item.id}
                            className="rounded-2xl border border-border bg-card p-5 transition hover:border-border flex flex-col justify-between"
                        >
                            <div>
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-2.5">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                                            <FileCode2 size={20} />
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-foreground text-base leading-snug">{item.name}</h4>
                                            <p className="text-xs text-muted-foreground uppercase font-mono mt-0.5">
                                                {item.pair} • {item.timeframe}
                                            </p>
                                        </div>
                                    </div>
                                    <span
                                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                                            item.riskLevel === "Low"
                                                ? "border-blue-500/30 bg-blue-500/10 text-blue-400"
                                                : item.riskLevel === "Medium"
                                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                                                : item.riskLevel === "High"
                                                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                                                : "border-rose-500/30 bg-rose-500/10 text-rose-400"
                                        }`}
                                    >
                                        {item.riskLevel} Risk
                                    </span>
                                </div>

                                {item.description && (
                                    <p className="text-xs text-muted-foreground mt-3 line-clamp-2">{item.description}</p>
                                )}

                                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground border-t border-border/60 pt-3">
                                    <span>Bot: <strong className="text-foreground">{item.productSlug}</strong></span>
                                    <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                                </div>
                            </div>

                            <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
                                <button
                                    onClick={() => handleDownload(item)}
                                    disabled={downloadingId === item.id}
                                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-muted/50 py-2 text-xs font-semibold text-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
                                >
                                    <Download size={14} /> {downloadingId === item.id ? "Downloading..." : "Download File"}
                                </button>
                                <button
                                    onClick={() => handleDelete(item)}
                                    className="rounded-lg p-2 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400 transition"
                                    title="Delete .set file"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
                        <div className="flex items-center justify-between border-b border-border pb-4">
                            <h3 className="text-lg font-bold text-foreground">Upload .set Preset File</h3>
                            <button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground">
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleCreate} className="mt-5 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1">Preset Name</label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. Scalper Gold Conservative 2026"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1">Currency Pair / Asset</label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="e.g. XAUUSD or EURUSD"
                                        value={pair}
                                        onChange={(e) => setPair(e.target.value)}
                                        className="w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1">Timeframe</label>
                                    <select
                                        value={timeframe}
                                        onChange={(e) => setTimeframe(e.target.value)}
                                        className="w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
                                    >
                                        {["M1", "M5", "M15", "M30", "H1", "H4", "D1"].map((tf) => (
                                            <option key={tf} value={tf}>{tf}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1">Product / Bot</label>
                                    <select
                                        required
                                        value={selectedBotId}
                                        onChange={(e) => setSelectedBotId(e.target.value)}
                                        className="w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
                                    >
                                        <option value="">Select a bot...</option>
                                        {bots.map((bot) => (
                                            <option key={bot.id} value={bot.id}>
                                                {bot.name || bot.slug || bot.id}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1">Risk Profile</label>
                                    <select
                                        value={riskLevel}
                                        onChange={(e) => setRiskLevel(e.target.value as "Low" | "Medium" | "High" | "Aggressive")}
                                        className="w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
                                    >
                                        <option value="Low">Low Risk</option>
                                        <option value="Medium">Medium Risk</option>
                                        <option value="High">High Risk</option>
                                        <option value="Aggressive">Aggressive</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1">.set File</label>
                                <label className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted p-6 transition hover:border-emerald-500/50 hover:bg-card">
                                    <Upload size={20} className="text-muted-foreground" />
                                    <span className="text-xs text-muted-foreground">
                                        {file ? (
                                            <span className="font-medium text-emerald-600">{file.name}</span>
                                        ) : (
                                            "Click to upload .set file (max 5 MB)"
                                        )}
                                    </span>
                                    <input
                                        type="file"
                                        required
                                        accept=".set"
                                        className="hidden"
                                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                                    />
                                </label>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold uppercase text-muted-foreground mb-1">Description / Notes</label>
                                <textarea
                                    rows={2}
                                    placeholder="Recommended initial deposit: $500, Max Spread: 15..."
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    className="w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
                                />
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
                                    {saving ? "Uploading..." : "Upload Preset File"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </AdminShell>
    );
}