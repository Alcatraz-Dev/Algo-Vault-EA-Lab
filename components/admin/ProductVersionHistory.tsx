"use client";

import {
    useCallback,
    useEffect,
    useState,
} from "react";

import {
    Check,
    Download,
    FileCode2,
    Loader2,
    RefreshCw,
    Star,
    Trash2,
} from "lucide-react";

import { auth } from "@/lib/firebase";
import { getProductFileRule } from "@/lib/product-files";

type ProductVersion = {
    id: string;
    version: string;
    fileName?: string;
    originalFileName?: string;
    size?: number;
    contentType?: string;
    downloadEnabled?: boolean;
    uploadedAt?: number;
    uploadedBy?: string;
    isCurrent?: boolean;
};

type ProductVersionHistoryProps = {
    productId: string;
    productType?: string;
    platform?: string;
};

function formatBytes(bytes?: number) {
    if (!bytes || bytes <= 0) return "0 Bytes";

    const units = [
        "Bytes",
        "KB",
        "MB",
        "GB",
    ];

    const index = Math.min(
        Math.floor(
            Math.log(bytes) / Math.log(1024)
        ),
        units.length - 1
    );

    return `${(
        bytes /
        Math.pow(1024, index)
    ).toFixed(
        index === 0 ? 0 : 2
    )} ${units[index]}`;
}

function formatDate(timestamp?: number) {
    if (!timestamp) {
        return "Unknown date";
    }

    return new Intl.DateTimeFormat(
        "en-GB",
        {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        }
    ).format(new Date(timestamp));
}

export default function ProductVersionHistory({
    productId,
    productType,
    platform,
}: ProductVersionHistoryProps) {
    const productFileRule = getProductFileRule(productType, platform);
    const [versions, setVersions] =
        useState<ProductVersion[]>([]);

    const [currentVersion, setCurrentVersion] =
        useState("");

    const [loading, setLoading] =
        useState(true);

    const [actionVersion, setActionVersion] =
        useState<string | null>(null);

    const [settingCurrent, setSettingCurrent] =
        useState<string | null>(null);

    const [error, setError] =
        useState("");

    const [message, setMessage] =
        useState("");

    // --------------------------------------------------
    // Load versions
    // --------------------------------------------------

    const loadVersions = useCallback(
        async () => {
            try {
                setLoading(true);
                setError("");

                const user =
                    auth.currentUser;

                if (!user) {
                    throw new Error(
                        "You must be logged in."
                    );
                }

                const token =
                    await user.getIdToken();

                const response =
                    await fetch(
                        `/api/admin/products/versions?productId=${encodeURIComponent(
                            productId
                        )}`,
                        {
                            method: "GET",
                            headers: {
                                Authorization: `Bearer ${token}`,
                            },
                            cache: "no-store",
                        }
                    );

                const data =
                    await response.json();

                if (
                    !response.ok ||
                    !data.success
                ) {
                    throw new Error(
                        data.error ||
                        "Failed to load versions."
                    );
                }

                setVersions(
                    data.versions || []
                );

                setCurrentVersion(
                    data.currentVersion || ""
                );
            } catch (error: any) {
                console.error(
                    "VERSION HISTORY LOAD ERROR:",
                    error
                );

                setError(
                    error?.message ||
                    "Failed to load versions."
                );
            } finally {
                setLoading(false);
            }
        },
        [productId]
    );

    useEffect(() => {
        if (!productId) return;

        void Promise.resolve().then(() => loadVersions());
    }, [
        productId,
        loadVersions,
    ]);

    // --------------------------------------------------
    // Set version as current
    // --------------------------------------------------

    async function setAsCurrent(
        version: string
    ) {
        if (
            version === currentVersion
        ) {
            return;
        }

        const confirmed =
            window.confirm(
                `Set version ${version} as the current version?\n\nThe existing current version will be kept in version history.`
            );

        if (!confirmed) {
            return;
        }

        try {
            setSettingCurrent(version);
            setError("");
            setMessage("");

            const user =
                auth.currentUser;

            if (!user) {
                throw new Error(
                    "You must be logged in."
                );
            }

            const token =
                await user.getIdToken();

            const response =
                await fetch(
                    "/api/admin/products/versions/set-current",
                    {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${token}`,
                            "Content-Type":
                                "application/json",
                        },
                        body: JSON.stringify({
                            productId,
                            version,
                        }),
                    }
                );

            const data =
                await response.json();

            if (
                !response.ok ||
                !data.success
            ) {
                throw new Error(
                    data.error ||
                    "Failed to set current version."
                );
            }

            setMessage(
                `Version ${version} is now the current version.`
            );

            await loadVersions();
        } catch (error: any) {
            console.error(
                "SET CURRENT VERSION ERROR:",
                error
            );

            setError(
                error?.message ||
                "Failed to set current version."
            );
        } finally {
            setSettingCurrent(null);
        }
    }

    // --------------------------------------------------
    // Download version
    // --------------------------------------------------

    async function downloadVersion(
        version: string
    ) {
        try {
            setActionVersion(version);
            setError("");
            setMessage("");

            const user =
                auth.currentUser;

            if (!user) {
                throw new Error(
                    "You must be logged in."
                );
            }

            const token =
                await user.getIdToken();

            const response =
                await fetch(
                    `/api/admin/products/versions/download?productId=${encodeURIComponent(
                        productId
                    )}&version=${encodeURIComponent(
                        version
                    )}`,
                    {
                        method: "GET",
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    }
                );

            if (!response.ok) {
                let data: any = null;

                try {
                    data =
                        await response.json();
                } catch { }

                throw new Error(
                    data?.error ||
                    "Download failed."
                );
            }

            const blob =
                await response.blob();

            const contentDisposition =
                response.headers.get(
                    "Content-Disposition"
                );

            let fileName =
                `product-v${version}`;

            if (contentDisposition) {
                const match =
                    contentDisposition.match(
                        /filename="([^"]+)"/
                    );

                if (match?.[1]) {
                    fileName =
                        match[1];
                }
            }

            const url =
                URL.createObjectURL(
                    blob
                );

            const link =
                document.createElement(
                    "a"
                );

            link.href = url;
            link.download = fileName;

            document.body.appendChild(
                link
            );

            link.click();
            link.remove();

            URL.revokeObjectURL(
                url
            );

            setMessage(
                `Version ${version} downloaded successfully.`
            );
        } catch (error: any) {
            console.error(
                "VERSION DOWNLOAD ERROR:",
                error
            );

            setError(
                error?.message ||
                "Download failed."
            );
        } finally {
            setActionVersion(null);
        }
    }

    // --------------------------------------------------
    // Delete version
    // --------------------------------------------------

    async function deleteVersion(
        version: string
    ) {
        if (
            version === currentVersion
        ) {
            setError(
                "The current version cannot be deleted."
            );

            return;
        }

        const confirmed =
            window.confirm(
                `Delete version ${version}?\n\nThis will permanently remove this version and its product file.`
            );

        if (!confirmed) {
            return;
        }

        try {
            setActionVersion(version);
            setError("");
            setMessage("");

            const user =
                auth.currentUser;

            if (!user) {
                throw new Error(
                    "You must be logged in."
                );
            }

            const token =
                await user.getIdToken();

            const response =
                await fetch(
                    "/api/admin/products/versions",
                    {
                        method: "DELETE",
                        headers: {
                            Authorization: `Bearer ${token}`,
                            "Content-Type":
                                "application/json",
                        },
                        body: JSON.stringify({
                            productId,
                            version,
                        }),
                    }
                );

            const data =
                await response.json();

            if (
                !response.ok ||
                !data.success
            ) {
                throw new Error(
                    data.error ||
                    "Failed to delete version."
                );
            }

            setMessage(
                `Version ${version} deleted successfully.`
            );

            await loadVersions();
        } catch (error: any) {
            console.error(
                "VERSION DELETE ERROR:",
                error
            );

            setError(
                error?.message ||
                "Failed to delete version."
            );
        } finally {
            setActionVersion(null);
        }
    }

    // --------------------------------------------------
    // Loading
    // --------------------------------------------------

    if (loading) {
        return (
            <section className="rounded-2xl border border-border/20 bg-foreground/4 p-6 md:p-7">
                <div className="mb-6 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/20 bg-foreground/10">
                            <FileCode2 size={18} />
                        </div>

                        <div>
                            <h2 className="font-medium">
                                Version History
                            </h2>

                            <p className="mt-1 text-xs text-foreground/50">
                                Manage uploaded file versions for this product.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 text-sm text-foreground/70">
                    <Loader2
                        size={16}
                        className="animate-spin"
                    />

                    Loading versions...
                </div>
            </section>
        );
    }

    // --------------------------------------------------
    // Main UI
    // --------------------------------------------------

    return (
        <section className="rounded-2xl border border-border/20 bg-foreground/4 p-6 md:p-7">
            <div className="mb-6 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/20 bg-foreground/10">
                        <FileCode2 size={18} />
                    </div>

                    <div>
                        <h2 className="font-medium">
                            Version History
                        </h2>

                        <p className="mt-1 text-xs text-foreground/50">
                            Manage uploaded file versions for this product.
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={loadVersions}
                    disabled={
                        loading ||
                        actionVersion !== null ||
                        settingCurrent !== null
                    }
                    className="flex items-center gap-2 rounded-xl border border-border/20 px-3 py-2 text-xs text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <RefreshCw size={14} />

                    Refresh
                </button>
            </div>

            {error && (
                <div className="mb-5 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-300">
                    {error}
                </div>
            )}

            {message && (
                <div className="mb-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-xs text-emerald-300">
                    {message}
                </div>
            )}

            {versions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/20 bg-foreground/10 p-8 text-center">
                    <FileCode2
                        size={24}
                        className="mx-auto text-foreground/50"
                    />

                    <p className="mt-3 text-sm text-muted-foreground">
                        No versions uploaded yet.
                    </p>

                    <p className="mt-1 text-xs text-foreground/50">
                        Upload a {productFileRule.label} to create the first version.
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {versions.map(
                        (item) => {
                            const isCurrent =
                                item.version ===
                                currentVersion ||
                                item.isCurrent ===
                                true;

                            const isBusy =
                                actionVersion ===
                                item.version;

                            const isSettingCurrent =
                                settingCurrent ===
                                item.version;

                            return (
                                <div
                                    key={
                                        item.id
                                    }
                                    className={`rounded-xl border p-4 transition ${isCurrent
                                            ? "border-border/40 bg-foreground/8"
                                            : "border-border/20 bg-foreground/10 hover:bg-foreground/6"
                                        }`}
                                >
                                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-base font-medium">
                                                    v
                                                    {
                                                        item.version
                                                    }
                                                </span>

                                                {isCurrent && (
                                                    <span className="inline-flex items-center gap-1 rounded-full border border-border/20 bg-foreground/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-foreground/70">
                                                        <Star
                                                            size={
                                                                10
                                                            }
                                                        />

                                                        Current
                                                    </span>
                                                )}
                                            </div>

                                            <div className="mt-2 flex items-center gap-2">
                                                <FileCode2
                                                    size={
                                                        14
                                                    }
                                                    className="shrink-0 text-foreground/50"
                                                />

                                                <p className="truncate text-sm text-foreground/70">
                                                    {item.fileName ||
                                                        item.originalFileName ||
                                                        "Product file"}
                                                </p>
                                            </div>

                                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/50">
                                                <span>
                                                    {formatBytes(
                                                        item.size
                                                    )}
                                                </span>

                                                <span>
                                                    Uploaded{" "}
                                                    {formatDate(
                                                        item.uploadedAt
                                                    )}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                                            {!isCurrent && (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setAsCurrent(
                                                            item.version
                                                        )
                                                    }
                                                    disabled={
                                                        isBusy ||
                                                        settingCurrent !==
                                                        null
                                                    }
                                                    className="flex items-center gap-2 rounded-xl border border-border/20 px-3 py-2 text-xs text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    {isSettingCurrent ? (
                                                        <Loader2
                                                            size={
                                                                14
                                                            }
                                                            className="animate-spin"
                                                        />
                                                    ) : (
                                                        <Check
                                                            size={
                                                                14
                                                            }
                                                        />
                                                    )}

                                                    {isSettingCurrent
                                                        ? "Setting..."
                                                        : "Set as Current"}
                                                </button>
                                            )}

                                            <button
                                                type="button"
                                                onClick={() =>
                                                    downloadVersion(
                                                        item.version
                                                    )
                                                }
                                                disabled={
                                                    isBusy ||
                                                    settingCurrent !==
                                                    null
                                                }
                                                className="flex items-center gap-2 rounded-xl border border-border/20 px-3 py-2 text-xs text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {isBusy ? (
                                                    <Loader2
                                                        size={
                                                            14
                                                        }
                                                        className="animate-spin"
                                                    />
                                                ) : (
                                                    <Download
                                                        size={
                                                            14
                                                        }
                                                    />
                                                )}

                                                Download
                                            </button>

                                            {!isCurrent && (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        deleteVersion(
                                                            item.version
                                                        )
                                                    }
                                                    disabled={
                                                        isBusy ||
                                                        settingCurrent !==
                                                        null
                                                    }
                                                    title="Delete version"
                                                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/20 text-foreground/70 transition hover:border-red-500/20 hover:bg-red-500/5 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    {isBusy ? (
                                                        <Loader2
                                                            size={
                                                                14
                                                            }
                                                            className="animate-spin"
                                                        />
                                                    ) : (
                                                        <Trash2
                                                            size={
                                                                14
                                                            }
                                                        />
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        }
                    )}
                </div>
            )}

            <div className="mt-6 border-t border-border/20 pt-4">
                <p className="text-xs text-foreground/50">
                    The current version cannot be deleted.
                    Previous versions are kept separately
                    for release history and rollback management.
                </p>
            </div>
        </section>
    );
}
