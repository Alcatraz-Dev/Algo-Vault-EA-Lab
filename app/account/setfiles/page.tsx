"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
    AlertTriangle,
    Bot,
    CheckCircle2,
    Download,
    FileCode2,
    FileText,
    Loader2,
    Lock,
    Package,
    ShieldCheck,
    Sparkles,
    Trash2,
    Upload,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { onValue, ref } from "firebase/database";
import { auth, database } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";

type License = {
    id?: string;
    productId?: string;
    productName?: string;
    licenseKey?: string;
    status?: string;
    mt5Account?: string | number;
    expiresAt?: number;
};

type PaidOrder = {
    id?: string;
    productId?: string;
    productName?: string;
    status?: string;
    createdAt?: number;
};

type SetFile = {
    name: string;
    size: number;
    description: string;
};

type ProductSetFiles = {
    productId: string;
    productName: string;
    license: License;
    files: SetFile[];
    loading: boolean;
    error?: string;
};

type OwnedProduct = {
    id: string;
    name?: string;
    slug?: string;
    ownerUid?: string;
};

type PublishedSetFile = {
    id: string;
    productId: string;
    name?: string;
    fileName: string;
    pair?: string;
    timeframe?: string;
    riskLevel?: string;
    createdAt?: number;
};

export default function SetFilesPage() {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [licenses, setLicenses] = useState<License[]>([]);
    const [paidOrders, setPaidOrders] = useState<PaidOrder[]>([]);
    const [productSetFiles, setProductSetFiles] = useState<ProductSetFiles[]>([]);
    const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

    // Owner / admin publishing state
    const [role, setRole] = useState("");
    const [ownedProducts, setOwnedProducts] = useState<OwnedProduct[]>([]);
    const [allProducts, setAllProducts] = useState<OwnedProduct[]>([]);
    const [ownPublished, setOwnPublished] = useState<PublishedSetFile[]>([]);
    const [pubProductId, setPubProductId] = useState("");
    const [pubName, setPubName] = useState("");
    const [pubPair, setPubPair] = useState("");
    const [pubTimeframe, setPubTimeframe] = useState("");
    const [pubRisk, setPubRisk] = useState("Medium");
    const [pubDescription, setPubDescription] = useState("");
    const [pubFile, setPubFile] = useState<File | null>(null);
    const [pubSaving, setPubSaving] = useState(false);
    const [pubDeletingId, setPubDeletingId] = useState<string | null>(null);
    const [pubMsg, setPubMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            if (!currentUser) {
                router.replace("/login");
                return;
            }
            setUser(currentUser);
            setAuthLoading(false);
        });
        return () => unsubscribe();
    }, [router]);

    // Load user licenses
    useEffect(() => {
        if (!user) return;

        const licensesRef = ref(database, `licenses/${user.uid}`);
        const unsubscribe = onValue(licensesRef, (snapshot) => {
            const data = snapshot.val() || {};
            const list: License[] = Object.entries(data).map(([id, val]) => ({
                id,
                ...(val as Partial<License>),
            })) as License[];

            // Only active licenses
            const activeLicenses = list.filter(
                (l) => l.status === "active" && Number(l.expiresAt || 0) > Date.now()
            );

            setLicenses(activeLicenses);
        });
        return () => unsubscribe();
    }, [user]);

    // Load set files for each licensed product
    useEffect(() => {
        if (!user) return;

        const ordersRef = ref(database, `orders/${user.uid}`);
        const unsubscribe = onValue(ordersRef, (snapshot) => {
            const data = snapshot.val() || {};
            const list: PaidOrder[] = Object.entries(data).map(([id, val]) => ({
                id,
                ...(val as Partial<PaidOrder>),
            })) as PaidOrder[];
            setPaidOrders(list.filter((o) => o.status === "paid"));
        });
        return () => unsubscribe();
    }, [user]);

    // Load set files for each product the user can access (active license OR paid order)
    useEffect(() => {
        if (!user || (licenses.length === 0 && paidOrders.length === 0)) {
            const t = setTimeout(() => setProductSetFiles([]), 0);
            return () => clearTimeout(t);
        }

        let cancelled = false;

        const fetchSetFiles = async () => {
            const uniqueProducts = new Map<string, License>();
            for (const lic of licenses) {
                if (lic.productId && !uniqueProducts.has(lic.productId)) {
                    uniqueProducts.set(lic.productId, lic);
                }
            }
            // Paid orders grant access even without an active license record
            for (const order of paidOrders) {
                if (order.productId && !uniqueProducts.has(order.productId)) {
                    uniqueProducts.set(order.productId, {
                        productId: order.productId,
                        productName: order.productName,
                    });
                }
            }

            const initialList: ProductSetFiles[] = Array.from(uniqueProducts.entries()).map(
                ([productId, lic]) => ({
                    productId,
                    productName: lic.productName || productId,
                    license: lic,
                    files: [],
                    loading: true,
                })
            );

            // Fetch set files for each product
            const idToken = await user.getIdToken();

            const updated = await Promise.all(
                initialList.map(async (item) => {
                    try {
                        const res = await fetch("/api/download/setfile", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                Authorization: `Bearer ${idToken}`,
                            },
                            body: JSON.stringify({ productId: item.productId }),
                        });

                        const data = await res.json();
                        return {
                            ...item,
                            files: data.success ? (data.files as SetFile[]) : [],
                            loading: false,
                            error: data.success ? undefined : data.error,
                        };
                    } catch {
                        return { ...item, loading: false, error: "Failed to load" };
                    }
                })
            );

            if (!cancelled) setProductSetFiles(updated);
        };

        fetchSetFiles();

        return () => {
            cancelled = true;
        };
    }, [user, licenses, paidOrders]);

    // Load products this user can publish set files for (owns them, or is admin)
    useEffect(() => {
        if (!user) return;
        const botsRef = ref(database, "bots");
        return onValue(botsRef, (snap) => {
            const data = snap.val() || {};
            const list: OwnedProduct[] = Object.entries(data)
                .map(([id, val]) => ({ id, ...(val as Partial<OwnedProduct>) }) as OwnedProduct)
                .filter((b) => b && b.id);
            setAllProducts(list);
            setOwnedProducts(list.filter((b) => String(b.ownerUid ?? "") === user.uid));
        });
    }, [user]);

    // User role (admins can publish for every product)
    useEffect(() => {
        if (!user) return;
        const roleRef = ref(database, `users/${user.uid}/role`);
        return onValue(roleRef, (snap) => setRole(String(snap.val() || "")));
    }, [user]);

    // Load the set files the user may manage (their own published files, or all for admins)
    useEffect(() => {
        if (!user) return;
        const sfRef = ref(database, "set_files");
        return onValue(sfRef, (snap) => {
            const data = snap.val() || {};
            const list: PublishedSetFile[] = Object.entries(data).map(
                ([id, val]) => ({ id, ...(val as Partial<PublishedSetFile>) }) as PublishedSetFile
            );
            if (role === "admin") {
                setOwnPublished(list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
                return;
            }
            if (ownedProducts.length === 0) {
                setOwnPublished([]);
                return;
            }
            const ownedIds = new Set(ownedProducts.map((p) => p.id));
            setOwnPublished(
                list
                    .filter((f) => ownedIds.has(f.productId))
                    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            );
        });
    }, [user, ownedProducts, role]);

    async function handlePublishSetFile(e: FormEvent) {
        e.preventDefault();
        if (!user || !pubProductId || !pubFile) return;

        setPubSaving(true);
        setPubMsg(null);
        try {
            const token = await user.getIdToken();
            const formData = new FormData();
            formData.append("name", pubName.trim());
            formData.append("productId", pubProductId);
            formData.append("pair", pubPair.trim());
            formData.append("timeframe", pubTimeframe.trim());
            formData.append("riskLevel", pubRisk);
            formData.append("description", pubDescription.trim());
            formData.append("file", pubFile);

            const res = await fetch("/api/admin/setfiles", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || "Upload failed.");

            setPubMsg({ type: "success", text: "Set file published to your product." });
            setPubName("");
            setPubPair("");
            setPubTimeframe("");
            setPubDescription("");
            setPubFile(null);
        } catch (err) {
            setPubMsg({ type: "error", text: err instanceof Error ? err.message : "Upload failed." });
        } finally {
            setPubSaving(false);
        }
    }

    async function handleDeletePublished(f: PublishedSetFile) {
        if (!user) return;
        if (!confirm(`Delete ${f.fileName} from your product?`)) return;

        setPubDeletingId(f.id);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/admin/setfiles", {
                method: "DELETE",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ id: f.id, productId: f.productId, fileName: f.fileName }),
            });
            if (!res.ok) throw new Error("Delete failed.");
            setPubMsg({ type: "success", text: "Set file deleted." });
        } catch (err) {
            setPubMsg({ type: "error", text: err instanceof Error ? err.message : "Delete failed." });
        } finally {
            setPubDeletingId(null);
        }
    }

    async function handleDownload(productId: string, fileName: string) {
        if (!user) return;

        const key = `${productId}/${fileName}`;
        setDownloadingFile(key);

        try {
            const idToken = await user.getIdToken();
            const params = new URLSearchParams({ productId, file: fileName });

            const res = await fetch(`/api/download/setfile?${params.toString()}`, {
                method: "GET",
                headers: { Authorization: `Bearer ${idToken}` },
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: "Download failed" }));
                alert(err.error || "Download failed.");
                return;
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = fileName;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : "Download error.");
        } finally {
            setDownloadingFile(null);
        }
    }

    if (authLoading) {
        return (
            <AccountShell title="Set Files" subtitle="Download pre-configured .set files for your licensed EAs">
                <div className="flex min-h-[50vh] items-center justify-center">
                    <div className="text-center">
                        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-border border-t-foreground" />
                        <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
                    </div>
                </div>
            </AccountShell>
        );
    }

    const totalFiles = productSetFiles.reduce((sum, p) => sum + p.files.length, 0);

    return (
        <AccountShell title="Set Files" subtitle="Download pre-configured .set files for your licensed EAs">
            {/* Background Blurs */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute left-1/2 top-[-250px] h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-violet-600/10 blur-[130px]" />
                <div className="absolute bottom-[-200px] right-[-100px] h-[450px] w-[450px] rounded-full bg-blue-600/10 blur-[130px]" />
            </div>

            <div className="relative mx-auto max-w-5xl" data-guide="page-header">
                {/* Count */}
                {totalFiles > 0 && (
                    <div className="mb-6 flex justify-end">
                        <div className="shrink-0 rounded-2xl border border-border bg-muted/50 px-5 py-3 text-center">
                            <p className="text-2xl font-bold text-foreground">{totalFiles}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Set Files Available</p>
                        </div>
                    </div>
                )}

                {/* How To Use Card */}
                <div className="mt-8 rounded-2xl border border-violet-500/20 bg-violet-500/[0.05] p-5">
                    <div className="flex items-start gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10">
                            <Sparkles size={16} className="text-violet-400" />
                        </div>
                        <div className="text-xs leading-6 text-muted-foreground">
                            <p className="font-semibold text-foreground mb-1">How to load a .set file in MT5</p>
                            <ol className="list-decimal ml-4 space-y-0.5">
                                <li>Open MetaTrader 5 and attach the EA to your chart</li>
                                <li>In the EA inputs window, click <span className="text-foreground font-medium">Load</span></li>
                                <li>Select the downloaded <code className="text-violet-400">.set</code> file</li>
                                <li>Click <span className="text-foreground font-medium">OK</span> to apply the settings</li>
                            </ol>
                        </div>
                    </div>
                </div>

                {/* Product Sections */}
                <div className="mt-8 space-y-6">
                    {licenses.length === 0 && paidOrders.length === 0 ? (
                        <div className="rounded-2xl border border-border bg-muted/30 p-14 text-center">
                            <Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                            <h3 className="text-base font-semibold text-foreground">No Active Licenses or Purchases</h3>
                            <p className="mt-2 text-sm text-muted-foreground">
                                You need an active license or a paid order to access set files.
                            </p>
                            <Link
                                href="/marketplace"
                                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-muted px-5 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
                            >
                                <Package size={16} />
                                Browse Marketplace
                            </Link>
                        </div>
                    ) : productSetFiles.length === 0 ? (
                        <div className="rounded-2xl border border-border bg-muted/30 p-14 text-center">
                            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground mb-3" />
                            <p className="text-sm text-muted-foreground">Loading set files...</p>
                        </div>
                    ) : (
                        productSetFiles.map((product) => (
                            <div
                                key={product.productId}
                                className="rounded-2xl border border-border bg-muted/40 overflow-hidden"
                            >
                                {/* Product Header */}
                                <div className="flex items-center gap-4 border-b border-border p-5">
                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted/50 border border-border">
                                        <Bot size={20} className="text-violet-400" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h2 className="font-semibold text-foreground truncate">
                                            {product.productName}
                                        </h2>
                                        <div className="mt-1 flex flex-wrap items-center gap-2">
                                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-600">
                                                <ShieldCheck size={10} />
                                                Active License
                                            </span>
                                            {product.license.mt5Account && (
                                                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-[11px] font-mono text-muted-foreground">
                                                    MT5 #{product.license.mt5Account}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    {product.license.expiresAt && (
                                        <div className="text-right shrink-0 hidden sm:block">
                                            <p className="text-[11px] text-muted-foreground">Expires</p>
                                            <p className="text-xs font-medium text-foreground">
                                                {new Date(product.license.expiresAt).toLocaleDateString("en-US", {
                                                    month: "short",
                                                    day: "numeric",
                                                    year: "numeric",
                                                })}
                                            </p>
                                        </div>
                                    )}
                                </div>

                                {/* Set Files */}
                                <div className="p-5">
                                    {product.loading ? (
                                        <div className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
                                            <Loader2 size={16} className="animate-spin" />
                                            Loading available set files...
                                        </div>
                                    ) : product.files.length === 0 ? (
                                        <div className="rounded-xl border border-dashed border-border p-8 text-center">
                                            <FileText className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                                            <p className="text-sm text-muted-foreground font-medium">No set files yet</p>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                Set files for this EA will appear here when available.
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {product.files.map((file) => {
                                                const downloadKey = `${product.productId}/${file.name}`;
                                                const isDownloading = downloadingFile === downloadKey;

                                                return (
                                                    <div
                                                        key={file.name}
                                                        className="flex items-center gap-4 rounded-xl border border-border bg-muted/40 px-4 py-3.5 transition hover:border-border hover:bg-background/70"
                                                    >
                                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 border border-violet-500/20">
                                                            <FileCode2 size={16} className="text-violet-400" />
                                                        </div>

                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-sm font-medium text-foreground font-mono truncate">
                                                                {file.name}
                                                            </p>
                                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                                                {file.description} • {(file.size / 1024).toFixed(1)} KB
                                                            </p>
                                                        </div>

                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                handleDownload(product.productId, file.name)
                                                            }
                                                            disabled={isDownloading}
                                                            className="flex shrink-0 items-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-xs font-semibold text-violet-300 transition hover:bg-violet-500/20 hover:text-foreground disabled:opacity-50"
                                                        >
                                                            {isDownloading ? (
                                                                <>
                                                                    <Loader2 size={13} className="animate-spin" />
                                                                    <span>Downloading...</span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <Download size={13} />
                                                                    <span>Download</span>
                                                                </>
                                                            )}
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Owner/Admin publish panel */}
                {(role === "admin" || ownedProducts.length > 0) && (
                    <div className="mt-8 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-6">
                        <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10">
                                <Upload size={17} className="text-emerald-400" />
                            </div>
                            <div>
                                <h2 className="text-base font-semibold text-foreground">Publish Set Files</h2>
                                <p className="text-xs text-muted-foreground">
                                    {role === "admin"
                                        ? "You are an admin — publish .set files for any product."
                                        : `As the owner of ${ownedProducts.length} product${ownedProducts.length === 1 ? "" : "s"}, you can publish .set files for your buyers.`}
                                </p>
                            </div>
                        </div>

                        {pubMsg && (
                            <div
                                className={`mt-4 flex items-center gap-2 rounded-xl border px-4 py-3 text-xs font-medium ${
                                    pubMsg.type === "success"
                                        ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-500"
                                        : "border-rose-500/25 bg-rose-500/10 text-rose-400"
                                }`}
                            >
                                {pubMsg.type === "success" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                                {pubMsg.text}
                            </div>
                        )}

                        <div className="mt-5 grid gap-6 lg:grid-cols-2">
                            {/* Published files for owned products */}
                            <div>
                                <h3 className="text-sm font-semibold text-foreground mb-3">Published set files</h3>
                                {ownPublished.length === 0 ? (
                                    <div className="rounded-xl border border-dashed border-emerald-500/20 p-6 text-center text-sm text-muted-foreground">
                                        Nothing published yet — upload your first .set file.
                                    </div>
                                ) : (
                                    <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                                        {ownPublished.map((f) => (
                                            <div key={f.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5">
                                                <FileCode2 size={15} className="shrink-0 text-emerald-400" />
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate font-mono text-xs font-medium text-foreground">{f.fileName}</p>
                                                    <p className="text-[11px] text-muted-foreground">
                                                        {f.name} {f.pair && `• ${f.pair}`} {f.timeframe && `/ ${f.timeframe}`}
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeletePublished(f)}
                                                    disabled={pubDeletingId === f.id}
                                                    className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:text-rose-400 disabled:opacity-40"
                                                    aria-label="Delete set file"
                                                >
                                                    {pubDeletingId === f.id ? (
                                                        <Loader2 size={14} className="animate-spin" />
                                                    ) : (
                                                        <Trash2 size={14} />
                                                    )}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Upload form */}
                            <form onSubmit={handlePublishSetFile} className="space-y-3">
                                <div>
                                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Product</label>
                                    <select
                                        value={pubProductId}
                                        onChange={(e) => setPubProductId(e.target.value)}
                                        className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm text-foreground focus:border-foreground/40 focus:outline-none"
                                    >
                                        <option value="">Select your product</option>
                                        {(role === "admin" ? allProducts : ownedProducts).map((p) => (
                                            <option key={p.id} value={p.id}>
                                                {p.name || p.id}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Preset name</label>
                                    <input
                                        type="text"
                                        required
                                        value={pubName}
                                        onChange={(e) => setPubName(e.target.value)}
                                        placeholder="e.g. Gold Scalper V3 — Aggressive"
                                        className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/40 focus:outline-none"
                                    />
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-muted-foreground">Pair</label>
                                        <input
                                            type="text"
                                            value={pubPair}
                                            onChange={(e) => setPubPair(e.target.value)}
                                            placeholder="XAUUSD"
                                            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/40 focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-muted-foreground">Timeframe</label>
                                        <input
                                            type="text"
                                            value={pubTimeframe}
                                            onChange={(e) => setPubTimeframe(e.target.value)}
                                            placeholder="M15"
                                            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/40 focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-medium text-muted-foreground">Risk</label>
                                        <select
                                            value={pubRisk}
                                            onChange={(e) => setPubRisk(e.target.value)}
                                            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-foreground/40 focus:outline-none"
                                        >
                                            {["Low", "Medium", "High", "Aggressive"].map((r) => (
                                                <option key={r} value={r}>
                                                    {r}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Description (optional)</label>
                                    <input
                                        type="text"
                                        value={pubDescription}
                                        onChange={(e) => setPubDescription(e.target.value)}
                                        placeholder="Short description of the preset"
                                        className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/40 focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-medium text-muted-foreground">.set file</label>
                                    <input
                                        type="file"
                                        required
                                        accept=".set"
                                        onChange={(e) => setPubFile(e.target.files?.[0] ?? null)}
                                        className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm text-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-500/15 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-emerald-400"
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={pubSaving || !pubProductId || !pubFile}
                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-emerald-500 disabled:opacity-50"
                                >
                                    {pubSaving ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                                    Publish Set File
                                </button>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </AccountShell>
    );
}
