"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
    ArrowUpRight,
    BarChart3,
    Check,
    ChevronDown,
    CircleDollarSign,
    ExternalLink,
    Image as ImageIcon,
    Link2,
    Loader2,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    Star,
    Trash2,
    Upload,
    Users,
    X,
} from "lucide-react";

import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AdminShell from "@/components/admin/AdminShell";

type BrandingItem = {
    fileName?: string;
    path?: string;
    extension?: string;
    size?: number;
    uploadedAt?: number;
};

type AffiliateOffer = {
    id: string;
    name: string;
    provider?: string;
    description?: string;
    affiliateUrl: string;
    category?: string;
    status: "active" | "inactive";
    commissionType: "percentage" | "fixed";
    commissionValue: number;
    currency?: string;
    featured?: boolean;
    clicks?: number;
    conversions?: number;
    createdAt?: number;
    updatedAt?: number;
    branding?: {
        logo?: BrandingItem;
    };
};

type FormState = {
    name: string;
    provider: string;
    description: string;
    affiliateUrl: string;
    category: string;
    status: "active" | "inactive";
    commissionType: "percentage" | "fixed";
    commissionValue: string;
    currency: string;
    featured: boolean;
};

const emptyForm: FormState = {
    name: "",
    provider: "",
    description: "",
    affiliateUrl: "",
    category: "Broker",
    status: "active",
    commissionType: "percentage",
    commissionValue: "",
    currency: "USD",
    featured: false,
};

function formatDate(timestamp?: number) {
    if (!timestamp) return "—";

    return new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
    }).format(new Date(timestamp));
}

function formatCommission(offer: AffiliateOffer) {
    if (offer.commissionType === "percentage") {
        return `${offer.commissionValue}%`;
    }

    return `${offer.currency || "USD"} ${offer.commissionValue}`;
}

export default function AdminAffiliatesPage() {
    const [logoUrls, setLogoUrls] = useState<
        Record<string, string>
    >({});

    const [offers, setOffers] = useState<AffiliateOffer[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploadingLogo, setUploadingLogo] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(
        null
    );

    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] =
        useState<"all" | "active" | "inactive">("all");

    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(
        null
    );

    const [form, setForm] = useState<FormState>(emptyForm);

    const [logoFile, setLogoFile] = useState<File | null>(null);

    const [logoPreview, setLogoPreview] = useState<string | null>(
        null
    );

    const [logoError, setLogoError] = useState("");

    const fileInputRef =
        useRef<HTMLInputElement | null>(null);

    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const getToken = async () => {
        const user = auth.currentUser;

        if (!user) {
            throw new Error(
                "You are not authenticated."
            );
        }

        return user.getIdToken();
    };

    /*
     * Load an existing affiliate logo through the
     * authenticated Admin API.
     *
     * We cannot put the Admin API directly inside
     * <img src=""> because <img> cannot send the
     * Firebase Authorization header.
     */
    const loadAffiliateLogo = async (
        offerId: string
    ) => {
        try {
            const token = await getToken();

            const response = await fetch(
                `/api/admin/affiliates/branding?offerId=${encodeURIComponent(
                    offerId
                )}&type=logo`,
                {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                    cache: "no-store",
                }
            );

            if (!response.ok) {
                return null;
            }

            const blob = await response.blob();

            if (!blob.size) {
                return null;
            }

            const url =
                URL.createObjectURL(blob);

            setLogoUrls((current) => {
                const oldUrl = current[offerId];

                if (
                    oldUrl &&
                    oldUrl.startsWith("blob:")
                ) {
                    URL.revokeObjectURL(oldUrl);
                }

                return {
                    ...current,
                    [offerId]: url,
                };
            });

            return url;
        } catch (error) {
            console.error(
                "Failed to load affiliate logo:",
                error
            );

            return null;
        }
    };

    /*
     * Load the logo specifically for the Edit modal.
     *
     * This sets logoPreview to a blob URL instead of
     * an unauthenticated API URL.
     */
    const loadAffiliateLogoPreview = async (
        offerId: string
    ) => {
        try {
            setLogoError("");

            const url =
                await loadAffiliateLogo(
                    offerId
                );

            if (url) {
                setLogoPreview(url);
            } else {
                setLogoPreview(null);
            }
        } catch (error) {
            console.error(
                "Failed to load affiliate logo preview:",
                error
            );

            setLogoPreview(null);
        }
    };

    const loadOffers = async () => {
        try {
            setLoading(true);
            setError("");

            const token = await getToken();

            const response = await fetch(
                "/api/admin/affiliates",
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

            if (!response.ok) {
                throw new Error(
                    data?.error ||
                    "Failed to load affiliate offers."
                );
            }

            const loadedOffers: AffiliateOffer[] =
                data.offers || [];

            setOffers(loadedOffers);

            /*
             * Load logos for all offers.
             */
            await Promise.all(
                loadedOffers.map(async (offer) => {
                    if (
                        offer.branding?.logo
                            ?.fileName
                    ) {
                        await loadAffiliateLogo(
                            offer.id
                        );
                    }
                })
            );
        } catch (err) {
            console.error(err);

            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to load affiliate offers."
            );
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const unsubscribe =
            onAuthStateChanged(
                auth,
                async (user) => {
                    if (!user) {
                        setLoading(false);
                        setError(
                            "You must be logged in as an admin."
                        );
                        return;
                    }

                    await loadOffers();
                }
            );

        return () => unsubscribe();
    }, []);

    /*
     * Cleanup all table blob URLs on unmount.
     */
    useEffect(() => {
        return () => {
            Object.values(
                logoUrls
            ).forEach((url) => {
                if (
                    url?.startsWith("blob:")
                ) {
                    URL.revokeObjectURL(url);
                }
            });
        };
    }, []);

    /*
     * Cleanup the modal preview blob URL.
     *
     * We intentionally do not revoke remote URLs
     * because current previews are loaded as blobs.
     */
    useEffect(() => {
        return () => {
            if (
                logoPreview?.startsWith(
                    "blob:"
                )
            ) {
                URL.revokeObjectURL(
                    logoPreview
                );
            }
        };
    }, [logoPreview]);

    const filteredOffers = useMemo(() => {
        const query =
            search.trim().toLowerCase();

        return offers.filter((offer) => {
            const matchesSearch =
                !query ||
                offer.name
                    ?.toLowerCase()
                    .includes(query) ||
                offer.provider
                    ?.toLowerCase()
                    .includes(query) ||
                offer.category
                    ?.toLowerCase()
                    .includes(query);

            const matchesStatus =
                statusFilter === "all" ||
                offer.status === statusFilter;

            return (
                matchesSearch &&
                matchesStatus
            );
        });
    }, [
        offers,
        search,
        statusFilter,
    ]);

    const totalClicks =
        offers.reduce(
            (sum, offer) =>
                sum +
                Number(
                    offer.clicks || 0
                ),
            0
        );

    const totalConversions =
        offers.reduce(
            (sum, offer) =>
                sum +
                Number(
                    offer.conversions || 0
                ),
            0
        );

    const activeOffers =
        offers.filter(
            (offer) =>
                offer.status === "active"
        ).length;

    const openCreateModal = () => {
        if (
            logoPreview?.startsWith("blob:")
        ) {
            URL.revokeObjectURL(
                logoPreview
            );
        }

        setEditingId(null);
        setForm({
            ...emptyForm,
        });

        setLogoFile(null);
        setLogoPreview(null);
        setLogoError("");
        setError("");
        setSuccess("");

        if (fileInputRef.current) {
            fileInputRef.current.value =
                "";
        }

        setShowModal(true);
    };

    const openEditModal = async (
        offer: AffiliateOffer
    ) => {
        if (
            logoPreview?.startsWith("blob:")
        ) {
            URL.revokeObjectURL(
                logoPreview
            );
        }

        setEditingId(offer.id);

        setForm({
            name: offer.name || "",
            provider:
                offer.provider || "",
            description:
                offer.description || "",
            affiliateUrl:
                offer.affiliateUrl || "",
            category:
                offer.category ||
                "Other",
            status:
                offer.status ||
                "active",
            commissionType:
                offer.commissionType ||
                "percentage",
            commissionValue:
                String(
                    offer.commissionValue ??
                    ""
                ),
            currency:
                offer.currency || "USD",
            featured:
                Boolean(
                    offer.featured
                ),
        });

        setLogoFile(null);
        setLogoError("");
        setLogoPreview(null);

        if (fileInputRef.current) {
            fileInputRef.current.value =
                "";
        }

        setError("");
        setSuccess("");
        setShowModal(true);

        /*
         * Load existing logo only after
         * opening the modal.
         */
        if (
            offer.branding?.logo
                ?.fileName
        ) {
            await loadAffiliateLogoPreview(
                offer.id
            );
        }
    };

    const closeModal = () => {
        if (
            saving ||
            uploadingLogo
        ) {
            return;
        }

        if (
            logoPreview?.startsWith("blob:")
        ) {
            URL.revokeObjectURL(
                logoPreview
            );
        }

        setShowModal(false);
        setEditingId(null);
        setForm({
            ...emptyForm,
        });
        setLogoFile(null);
        setLogoPreview(null);
        setLogoError("");

        if (fileInputRef.current) {
            fileInputRef.current.value =
                "";
        }
    };

    const updateForm = <
        K extends keyof FormState
    >(
        key: K,
        value: FormState[K]
    ) => {
        setForm((current) => ({
            ...current,
            [key]: value,
        }));
    };

    const handleLogoChange = (
        event: React.ChangeEvent<HTMLInputElement>
    ) => {
        const file =
            event.target.files?.[0];

        if (!file) {
            return;
        }

        setLogoError("");

        const allowedTypes = [
            "image/png",
            "image/jpeg",
            "image/webp",
            "image/svg+xml",
        ];

        const extension =
            file.name
                .split(".")
                .pop()
                ?.toLowerCase();

        const allowedExtensions = [
            "png",
            "jpg",
            "jpeg",
            "webp",
            "svg",
        ];

        if (
            !allowedTypes.includes(
                file.type
            ) &&
            !(
                extension &&
                allowedExtensions.includes(
                    extension
                )
            )
        ) {
            setLogoError(
                "Unsupported logo format. Use PNG, JPG, JPEG, WEBP or SVG."
            );

            if (
                fileInputRef.current
            ) {
                fileInputRef.current.value =
                    "";
            }

            return;
        }

        if (
            file.size >
            5 * 1024 * 1024
        ) {
            setLogoError(
                "Logo must be smaller than 5 MB."
            );

            if (
                fileInputRef.current
            ) {
                fileInputRef.current.value =
                    "";
            }

            return;
        }

        if (
            logoPreview?.startsWith(
                "blob:"
            )
        ) {
            URL.revokeObjectURL(
                logoPreview
            );
        }

        const previewUrl =
            URL.createObjectURL(
                file
            );

        setLogoFile(file);
        setLogoPreview(
            previewUrl
        );
    };

    const removeSelectedLogo = () => {
        if (
            logoPreview?.startsWith(
                "blob:"
            )
        ) {
            URL.revokeObjectURL(
                logoPreview
            );
        }

        setLogoFile(null);
        setLogoPreview(null);
        setLogoError("");

        if (fileInputRef.current) {
            fileInputRef.current.value =
                "";
        }
    };

    const uploadLogo = async (
        offerId: string
    ) => {
        if (!logoFile) {
            return null;
        }

        try {
            setUploadingLogo(true);
            setLogoError("");
            setError("");

            const token =
                await getToken();

            const formData =
                new FormData();

            formData.append(
                "offerId",
                offerId
            );

            formData.append(
                "type",
                "logo"
            );

            formData.append(
                "file",
                logoFile
            );

            const response =
                await fetch(
                    "/api/admin/affiliates/upload-branding",
                    {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                        body: formData,
                    }
                );

            const data =
                await response.json();

            if (!response.ok) {
                throw new Error(
                    data?.error ||
                    "Failed to upload logo."
                );
            }

            /*
             * Clear old table blob URL
             * and reload the new logo.
             */
            setLogoUrls(
                (current) => {
                    const oldUrl =
                        current[
                        offerId
                        ];

                    if (
                        oldUrl?.startsWith(
                            "blob:"
                        )
                    ) {
                        URL.revokeObjectURL(
                            oldUrl
                        );
                    }

                    const copy = {
                        ...current,
                    };

                    delete copy[
                        offerId
                    ];

                    return copy;
                }
            );

            /*
             * Reload the freshly uploaded
             * logo from the server.
             */
            await loadAffiliateLogo(
                offerId
            );

            return data;
        } catch (err) {
            console.error(err);

            const message =
                err instanceof Error
                    ? err.message
                    : "Failed to upload logo.";

            setLogoError(message);

            throw new Error(
                message
            );
        } finally {
            setUploadingLogo(
                false
            );
        }
    };

    const saveOffer = async () => {
        try {
            setSaving(true);
            setError("");
            setSuccess("");

            if (
                !form.name.trim()
            ) {
                throw new Error(
                    "Please enter an affiliate name."
                );
            }

            if (
                !form.affiliateUrl.trim()
            ) {
                throw new Error(
                    "Please enter the affiliate URL."
                );
            }

            const commissionValue =
                Number(
                    form.commissionValue
                );

            if (
                !Number.isFinite(
                    commissionValue
                ) ||
                commissionValue < 0
            ) {
                throw new Error(
                    "Please enter a valid commission value."
                );
            }

            if (
                form.commissionType ===
                "percentage" &&
                commissionValue > 100
            ) {
                throw new Error(
                    "Percentage commission cannot exceed 100%."
                );
            }

            const token =
                await getToken();

            const payload = {
                name: form.name.trim(),
                provider:
                    form.provider.trim(),
                description:
                    form.description.trim(),
                affiliateUrl:
                    form.affiliateUrl.trim(),
                category:
                    form.category.trim() ||
                    "Other",
                status: form.status,
                commissionType:
                    form.commissionType,
                commissionValue,
                currency:
                    form.currency
                        .trim()
                        .toUpperCase() ||
                    "USD",
                featured:
                    form.featured,
            };

            const url = editingId
                ? `/api/admin/affiliates/${editingId}`
                : "/api/admin/affiliates";

            const method = editingId
                ? "PATCH"
                : "POST";

            const response =
                await fetch(url, {
                    method,
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type":
                            "application/json",
                    },
                    body: JSON.stringify(
                        payload
                    ),
                });

            const data =
                await response.json();

            if (!response.ok) {
                throw new Error(
                    data?.error ||
                    "Failed to save affiliate offer."
                );
            }

            /*
             * For a new offer, we need the ID
             * returned by POST before uploading
             * the logo.
             */
            const savedOfferId =
                editingId ||
                data?.offer?.id ||
                data?.offerId ||
                data?.id;

            if (!savedOfferId) {
                throw new Error(
                    "Affiliate was saved, but no offer ID was returned for logo upload."
                );
            }

            if (logoFile) {
                await uploadLogo(
                    savedOfferId
                );
            }

            await loadOffers();

            setSuccess(
                editingId
                    ? logoFile
                        ? "Affiliate offer and logo updated successfully."
                        : "Affiliate offer updated successfully."
                    : logoFile
                        ? "Affiliate offer and logo created successfully."
                        : "Affiliate offer created successfully."
            );

            if (
                logoPreview?.startsWith(
                    "blob:"
                )
            ) {
                URL.revokeObjectURL(
                    logoPreview
                );
            }

            setShowModal(false);
            setEditingId(null);
            setForm({
                ...emptyForm,
            });
            setLogoFile(null);
            setLogoPreview(null);
            setLogoError("");

            if (
                fileInputRef.current
            ) {
                fileInputRef.current.value =
                    "";
            }
        } catch (err) {
            console.error(err);

            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to save affiliate offer."
            );
        } finally {
            setSaving(false);
        }
    };

    const deleteOffer = async (
        offer: AffiliateOffer
    ) => {
        const confirmed =
            window.confirm(
                `Delete "${offer.name}"?\n\nThis action cannot be undone.`
            );

        if (!confirmed) {
            return;
        }

        try {
            setDeletingId(
                offer.id
            );
            setError("");
            setSuccess("");

            const token =
                await getToken();

            const response =
                await fetch(
                    `/api/admin/affiliates/${offer.id}`,
                    {
                        method: "DELETE",
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    }
                );

            const data =
                await response.json();

            if (!response.ok) {
                throw new Error(
                    data?.error ||
                    "Failed to delete affiliate offer."
                );
            }

            setOffers(
                (current) =>
                    current.filter(
                        (item) =>
                            item.id !==
                            offer.id
                    )
            );

            setLogoUrls(
                (current) => {
                    const oldUrl =
                        current[
                        offer.id
                        ];

                    if (
                        oldUrl?.startsWith(
                            "blob:"
                        )
                    ) {
                        URL.revokeObjectURL(
                            oldUrl
                        );
                    }

                    const copy = {
                        ...current,
                    };

                    delete copy[
                        offer.id
                    ];

                    return copy;
                }
            );

            setSuccess(
                "Affiliate offer deleted successfully."
            );
        } catch (err) {
            console.error(err);

            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to delete affiliate offer."
            );
        } finally {
            setDeletingId(
                null
            );
        }
    };

    const toggleStatus = async (
        offer: AffiliateOffer
    ) => {
        try {
            setError("");
            setSuccess("");

            const token =
                await getToken();

            const newStatus =
                offer.status ===
                    "active"
                    ? "inactive"
                    : "active";

            const response =
                await fetch(
                    `/api/admin/affiliates/${offer.id}`,
                    {
                        method: "PATCH",
                        headers: {
                            Authorization: `Bearer ${token}`,
                            "Content-Type":
                                "application/json",
                        },
                        body: JSON.stringify(
                            {
                                status:
                                    newStatus,
                            }
                        ),
                    }
                );

            const data =
                await response.json();

            if (!response.ok) {
                throw new Error(
                    data?.error ||
                    "Failed to update status."
                );
            }

            setOffers(
                (current) =>
                    current.map(
                        (item) =>
                            item.id ===
                                offer.id
                                ? {
                                    ...item,
                                    status:
                                        newStatus,
                                }
                                : item
                    )
            );

            setSuccess(
                newStatus ===
                    "active"
                    ? "Affiliate activated."
                    : "Affiliate deactivated."
            );
        } catch (err) {
            console.error(err);

            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to update status."
            );
        }
    };

    return (
        <AdminShell title="Affiliate Offers" subtitle="Manage recommended brokers, tools, and affiliate partnerships">
            <div className="mb-6 flex items-center justify-end gap-2">
                <button
                    onClick={loadOffers}
                    disabled={loading}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-muted/50 px-4 text-sm font-medium transition hover:bg-muted disabled:opacity-50"
                >
                    <RefreshCw
                        className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                    />
                    Refresh
                </button>

                <button
                    onClick={openCreateModal}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-background transition hover:bg-emerald-400"
                >
                    <Plus className="h-4 w-4" />
                    Add Affiliate
                </button>
            </div>

            {/* Alerts */}
            {error && (
                <div className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    <span>
                        {error}
                    </span>

                    <button
                        onClick={() =>
                            setError(
                                ""
                            )
                        }
                        className="text-red-200/60 hover:text-red-200"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            {success && (
                <div className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                    <span>
                        {success}
                    </span>

                    <button
                        onClick={() =>
                            setSuccess(
                                ""
                            )
                        }
                        className="text-emerald-200/60 hover:text-emerald-200"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            {/* Stats */}
            <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                    label="Total Offers"
                    value={
                        offers.length
                    }
                    icon={
                        <ExternalLink className="h-5 w-5" />
                    }
                />

                <StatCard
                    label="Active Offers"
                    value={
                        activeOffers
                    }
                    icon={
                        <Check className="h-5 w-5" />
                    }
                />

                <StatCard
                    label="Total Clicks"
                    value={totalClicks.toLocaleString()}
                    icon={
                        <ArrowUpRight className="h-5 w-5" />
                    }
                />

                <StatCard
                    label="Conversions"
                    value={totalConversions.toLocaleString()}
                    icon={
                        <CircleDollarSign className="h-5 w-5" />
                    }
                />
            </div>

            {/* Filters */}
            <div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-foreground/[0.025] p-3 md:flex-row md:items-center">
                <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/50" />

                    <input
                        value={
                            search
                        }
                        onChange={(
                            event
                        ) =>
                            setSearch(
                                event
                                    .target
                                    .value
                            )
                        }
                        placeholder="Search affiliates..."
                        className="h-10 w-full rounded-lg border border-border bg-muted pl-9 pr-3 text-sm outline-none placeholder:text-foreground/25 focus:border-foreground/30"
                    />
                </div>

                <div className="relative">
                    <select
                        value={
                            statusFilter
                        }
                        onChange={(
                            event
                        ) =>
                            setStatusFilter(
                                event
                                    .target
                                    .value as
                                | "all"
                                | "active"
                                | "inactive"
                            )
                        }
                        className="h-10 min-w-[150px] appearance-none rounded-lg border border-border bg-muted px-3 pr-9 text-sm outline-none focus:border-foreground/30"
                    >
                        <option
                            value="all"
                            className="bg-card"
                        >
                            All Status
                        </option>

                        <option
                            value="active"
                            className="bg-card"
                        >
                            Active
                        </option>

                        <option
                            value="inactive"
                            className="bg-card"
                        >
                            Inactive
                        </option>
                    </select>

                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/50" />
                </div>
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-2xl border border-border bg-muted/30">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[1050px] text-left">
                        <thead className="border-b border-border bg-foreground/[0.025]">
                            <tr className="text-xs uppercase tracking-wider text-foreground/35">
                                <th className="px-5 py-4 font-medium">
                                    Affiliate
                                </th>

                                <th className="px-5 py-4 font-medium">
                                    Category
                                </th>

                                <th className="px-5 py-4 font-medium">
                                    Commission
                                </th>

                                <th className="px-5 py-4 font-medium">
                                    Clicks
                                </th>

                                <th className="px-5 py-4 font-medium">
                                    Conversions
                                </th>

                                <th className="px-5 py-4 font-medium">
                                    Status
                                </th>

                                <th className="px-5 py-4 font-medium">
                                    Created
                                </th>

                                <th className="px-5 py-4 text-right font-medium">
                                    Actions
                                </th>
                            </tr>
                        </thead>

                        <tbody className="divide-y divide-white/5">
                            {loading ? (
                                <tr>
                                    <td
                                        colSpan={
                                            8
                                        }
                                        className="px-5 py-16 text-center"
                                    >
                                        <Loader2 className="mx-auto h-6 w-6 animate-spin text-foreground/50" />

                                        <p className="mt-3 text-sm text-foreground/50">
                                            Loading
                                            affiliates...
                                        </p>
                                    </td>
                                </tr>
                            ) : filteredOffers.length ===
                                0 ? (
                                <tr>
                                    <td
                                        colSpan={
                                            8
                                        }
                                        className="px-5 py-16 text-center"
                                    >
                                        <ExternalLink className="mx-auto h-8 w-8 text-foreground/40" />

                                        <p className="mt-3 text-sm font-medium text-foreground/60">
                                            No affiliate
                                            offers found
                                        </p>

                                        <p className="mt-1 text-xs text-foreground/50">
                                            Add your first
                                            affiliate
                                            partnership.
                                        </p>
                                    </td>
                                </tr>
                            ) : (
                                filteredOffers.map(
                                    (
                                        offer
                                    ) => (
                                        <tr
                                            key={
                                                offer.id
                                            }
                                            className="transition hover:bg-muted/40"
                                        >
                                            <td className="px-5 py-4">
                                                <div className="flex items-center gap-3">
                                                    {logoUrls[
                                                        offer
                                                            .id
                                                    ] ? (
                                                        <img
                                                            src={
                                                                logoUrls[
                                                                offer
                                                                    .id
                                                                ]
                                                            }
                                                            alt={`${offer.name} logo`}
                                                            className="h-11 w-11 shrink-0 rounded-xl border border-border bg-foreground object-contain p-1.5"
                                                        />
                                                    ) : (
                                                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/50">
                                                            <ExternalLink className="h-5 w-5 text-foreground/50" />
                                                        </div>
                                                    )}

                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="truncate font-medium">
                                                                {
                                                                    offer.name
                                                                }
                                                            </span>

                                                            {offer.featured && (
                                                                <Star className="h-3.5 w-3.5 shrink-0 fill-current text-yellow-600" />
                                                            )}
                                                        </div>

                                                        <div className="mt-0.5 text-xs text-foreground/35">
                                                            {offer.provider ||
                                                                "—"}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="px-5 py-4">
                                                <span className="rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs text-foreground/60">
                                                    {offer.category ||
                                                        "Other"}
                                                </span>
                                            </td>

                                            <td className="px-5 py-4">
                                                <div className="font-medium">
                                                    {formatCommission(
                                                        offer
                                                    )}
                                                </div>

                                                <div className="mt-0.5 text-xs text-foreground/50">
                                                    {
                                                        offer.commissionType
                                                    }
                                                </div>
                                            </td>

                                            <td className="px-5 py-4">
                                                <span className="font-medium">
                                                    {Number(
                                                        offer.clicks ||
                                                        0
                                                    ).toLocaleString()}
                                                </span>
                                            </td>

                                            <td className="px-5 py-4">
                                                <span className="font-medium">
                                                    {Number(
                                                        offer.conversions ||
                                                        0
                                                    ).toLocaleString()}
                                                </span>
                                            </td>

                                            <td className="px-5 py-4">
                                                <button
                                                    onClick={() =>
                                                        toggleStatus(
                                                            offer
                                                        )
                                                    }
                                                    className="inline-flex items-center gap-2"
                                                    title="Toggle status"
                                                >
                                                    <span
                                                        className={`h-2 w-2 rounded-full ${offer.status ===
                                                            "active"
                                                            ? "bg-emerald-400"
                                                            : "bg-foreground/25"
                                                            }`}
                                                    />

                                                    <span
                                                        className={`text-xs font-medium ${offer.status ===
                                                            "active"
                                                            ? "text-emerald-600"
                                                            : "text-foreground/50"
                                                            }`}
                                                    >
                                                        {offer.status ===
                                                            "active"
                                                            ? "Active"
                                                            : "Inactive"}
                                                    </span>
                                                </button>
                                            </td>

                                            <td className="px-5 py-4 text-sm text-foreground/45">
                                                {formatDate(
                                                    offer.createdAt
                                                )}
                                            </td>

                                            <td className="px-5 py-4">
                                                <div className="flex justify-end gap-2">
                                                    <a
                                                        href={
                                                            offer.affiliateUrl
                                                        }
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted/50 text-foreground/50 transition hover:bg-muted hover:text-foreground"
                                                        title="Open affiliate URL"
                                                    >
                                                        <ExternalLink className="h-3.5 w-3.5" />
                                                    </a>

                                                    <button
                                                        onClick={() =>
                                                            openEditModal(
                                                                offer
                                                            )
                                                        }
                                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted/50 text-foreground/50 transition hover:bg-muted hover:text-foreground"
                                                        title="Edit"
                                                    >
                                                        <Pencil className="h-3.5 w-3.5" />
                                                    </button>

                                                    <button
                                                        onClick={() =>
                                                            deleteOffer(
                                                                offer
                                                            )
                                                        }
                                                        disabled={
                                                            deletingId ===
                                                            offer.id
                                                        }
                                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/10 bg-red-500/5 text-red-600/60 transition hover:bg-red-500/10 hover:text-red-600 disabled:opacity-50"
                                                        title="Delete"
                                                    >
                                                        {deletingId ===
                                                            offer.id ? (
                                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                        ) : (
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        )}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                )
                            )}
                        </tbody>
                    </table>
                </div>

                {!loading &&
                    filteredOffers.length >
                    0 && (
                        <div className="border-t border-border px-5 py-3 text-xs text-foreground/35">
                            Showing{" "}
                            <span className="text-foreground/60">
                                {
                                    filteredOffers.length
                                }
                            </span>{" "}
                            of{" "}
                            <span className="text-foreground/60">
                                {
                                    offers.length
                                }
                            </span>{" "}
                            affiliate offers
                        </div>
                    )}
            </div>

            {/* Bottom note */}
            <div className="mt-5 rounded-xl border border-border bg-muted/30 p-4">
                <div className="flex gap-3">
                    <div className="mt-0.5 shrink-0">
                        <Link2 className="h-4 w-4 text-foreground/50" />
                    </div>

                    <div>
                        <p className="text-sm font-medium text-foreground/70">
                            Affiliate tracking
                        </p>

                        <p className="mt-1 text-xs leading-5 text-foreground/35">
                            Click and conversion
                            counters will be connected
                            to the secure server-side
                            tracking system next. Do not
                            manually edit these counters
                            in the database.
                        </p>
                    </div>
                </div>
            </div>

        {/* Modal */ }
    {
        showModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/75 p-4 backdrop-blur-sm">
                <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl">
                    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-6 py-5">
                        <div>
                            <h2 className="text-lg font-semibold">
                                {editingId
                                    ? "Edit Affiliate"
                                    : "Add Affiliate"}
                            </h2>

                            <p className="mt-1 text-xs text-foreground/50">
                                Configure the affiliate
                                partnership.
                            </p>
                        </div>

                        <button
                            onClick={
                                closeModal
                            }
                            disabled={
                                saving ||
                                uploadingLogo
                            }
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground/50 transition hover:bg-muted/70 hover:text-foreground disabled:opacity-50"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="space-y-5 p-6">
                        {error && (
                            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                                {
                                    error
                                }
                            </div>
                        )}

                        {/* Logo */}
                        <Field label="Broker Logo">
                            <div className="rounded-xl border border-border bg-muted/30 p-4">
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                                    <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted/50">
                                        {logoPreview ? (
                                            <img
                                                src={
                                                    logoPreview ?? undefined
                                                }
                                                alt="Broker logo preview"
                                                className="h-full w-full object-contain p-3"
                                            />
                                        ) : (
                                            <ImageIcon className="h-8 w-8 text-foreground/40" />
                                        )}
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    fileInputRef.current?.click()
                                                }
                                                disabled={
                                                    saving ||
                                                    uploadingLogo
                                                }
                                                className="inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-semibold text-background transition hover:bg-foreground/90 disabled:opacity-50"
                                            >
                                                {uploadingLogo ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : (
                                                    <Upload className="h-4 w-4" />
                                                )}

                                                {logoPreview
                                                    ? "Change Logo"
                                                    : "Upload Logo"}
                                            </button>

                                            {logoPreview && (
                                                <button
                                                    type="button"
                                                    onClick={
                                                        removeSelectedLogo
                                                    }
                                                    disabled={
                                                        saving ||
                                                        uploadingLogo
                                                    }
                                                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-muted/50 px-4 text-sm font-medium text-foreground/60 transition hover:bg-muted hover:text-foreground disabled:opacity-50"
                                                >
                                                    <X className="h-4 w-4" />
                                                    Remove
                                                </button>
                                            )}
                                        </div>

                                        <p className="mt-2 text-xs leading-5 text-foreground/35">
                                            PNG, JPG, JPEG,
                                            WEBP or SVG.
                                            Maximum 5 MB.
                                        </p>

                                        {logoFile && (
                                            <p className="mt-1 truncate text-xs text-foreground/50">
                                                Selected:{" "}
                                                {
                                                    logoFile.name
                                                }
                                            </p>
                                        )}

                                        {!logoFile &&
                                            editingId &&
                                            logoPreview && (
                                                <p className="mt-1 text-xs text-emerald-600/70">
                                                    Current logo
                                                </p>
                                            )}

                                        {logoError && (
                                            <p className="mt-2 text-xs text-red-600">
                                                {
                                                    logoError
                                                }
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <input
                                    ref={
                                        fileInputRef
                                    }
                                    type="file"
                                    accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
                                    onChange={
                                        handleLogoChange
                                    }
                                    className="hidden"
                                />
                            </div>
                        </Field>

                        <div className="grid gap-5 md:grid-cols-2">
                            <Field
                                label="Name"
                                required
                            >
                                <input
                                    value={
                                        form.name
                                    }
                                    onChange={(
                                        event
                                    ) =>
                                        updateForm(
                                            "name",
                                            event
                                                .target
                                                .value
                                        )
                                    }
                                    placeholder="Example Broker"
                                    className="input"
                                />
                            </Field>

                            <Field label="Provider">
                                <input
                                    value={
                                        form.provider
                                    }
                                    onChange={(
                                        event
                                    ) =>
                                        updateForm(
                                            "provider",
                                            event
                                                .target
                                                .value
                                        )
                                    }
                                    placeholder="Example Broker Ltd."
                                    className="input"
                                />
                            </Field>

                            <Field label="Category">
                                <input
                                    value={
                                        form.category
                                    }
                                    onChange={(
                                        event
                                    ) =>
                                        updateForm(
                                            "category",
                                            event
                                                .target
                                                .value
                                        )
                                    }
                                    placeholder="Broker"
                                    className="input"
                                />
                            </Field>

                            <Field label="Currency">
                                <input
                                    value={
                                        form.currency
                                    }
                                    onChange={(
                                        event
                                    ) =>
                                        updateForm(
                                            "currency",
                                            event
                                                .target
                                                .value
                                        )
                                    }
                                    placeholder="USD"
                                    maxLength={
                                        5
                                    }
                                    className="input uppercase"
                                />
                            </Field>
                        </div>

                        <Field
                            label="Affiliate URL"
                            required
                        >
                            <input
                                value={
                                    form.affiliateUrl
                                }
                                onChange={(
                                    event
                                ) =>
                                    updateForm(
                                        "affiliateUrl",
                                        event
                                            .target
                                            .value
                                    )
                                }
                                placeholder="https://example.com/ref/algovault"
                                className="input"
                            />

                            <p className="mt-1.5 text-xs text-foreground/50">
                                Must use HTTPS.
                            </p>
                        </Field>

                        <Field label="Description">
                            <textarea
                                value={
                                    form.description
                                }
                                onChange={(
                                    event
                                ) =>
                                    updateForm(
                                        "description",
                                        event
                                            .target
                                            .value
                                    )
                                }
                                placeholder="Short description of this affiliate offer..."
                                rows={
                                    4
                                }
                                className="input resize-none py-3"
                            />
                        </Field>

                        <div className="grid gap-5 md:grid-cols-2">
                            <Field label="Commission Type">
                                <select
                                    value={
                                        form.commissionType
                                    }
                                    onChange={(
                                        event
                                    ) =>
                                        updateForm(
                                            "commissionType",
                                            event
                                                .target
                                                .value as
                                            | "percentage"
                                            | "fixed"
                                        )
                                    }
                                    className="input appearance-none"
                                >
                                    <option
                                        value="percentage"
                                        className="bg-card"
                                    >
                                        Percentage
                                    </option>

                                    <option
                                        value="fixed"
                                        className="bg-card"
                                    >
                                        Fixed
                                    </option>
                                </select>
                            </Field>

                            <Field label="Commission Value">
                                <input
                                    type="number"
                                    min="0"
                                    max={
                                        form.commissionType ===
                                            "percentage"
                                            ? 100
                                            : undefined
                                    }
                                    step="0.01"
                                    value={
                                        form.commissionValue
                                    }
                                    onChange={(
                                        event
                                    ) =>
                                        updateForm(
                                            "commissionValue",
                                            event
                                                .target
                                                .value
                                        )
                                    }
                                    placeholder={
                                        form.commissionType ===
                                            "percentage"
                                            ? "30"
                                            : "50"
                                    }
                                    className="input"
                                />
                            </Field>
                        </div>

                        <div className="grid gap-5 md:grid-cols-2">
                            <Field label="Status">
                                <select
                                    value={
                                        form.status
                                    }
                                    onChange={(
                                        event
                                    ) =>
                                        updateForm(
                                            "status",
                                            event
                                                .target
                                                .value as
                                            | "active"
                                            | "inactive"
                                        )
                                    }
                                    className="input appearance-none"
                                >
                                    <option
                                        value="active"
                                        className="bg-card"
                                    >
                                        Active
                                    </option>

                                    <option
                                        value="inactive"
                                        className="bg-card"
                                    >
                                        Inactive
                                    </option>
                                </select>
                            </Field>

                            <div className="flex items-end">
                                <label className="flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-foreground/[0.025] px-3">
                                    <input
                                        type="checkbox"
                                        checked={
                                            form.featured
                                        }
                                        onChange={(
                                            event
                                        ) =>
                                            updateForm(
                                                "featured",
                                                event
                                                    .target
                                                    .checked
                                            )
                                        }
                                        className="h-4 w-4 rounded border-border bg-background"
                                    />

                                    <span className="flex items-center gap-2 text-sm text-foreground/70">
                                        <Star className="h-4 w-4 text-yellow-600" />
                                        Featured offer
                                    </span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
                        <button
                            onClick={
                                closeModal
                            }
                            disabled={
                                saving ||
                                uploadingLogo
                            }
                            className="h-10 rounded-lg border border-border px-4 text-sm font-medium text-foreground/60 transition hover:bg-muted/70 hover:text-foreground disabled:opacity-50"
                        >
                            Cancel
                        </button>

                        <button
                            onClick={
                                saveOffer
                            }
                            disabled={
                                saving ||
                                uploadingLogo
                            }
                            className="inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-5 text-sm font-semibold text-background transition hover:bg-foreground/90 disabled:opacity-50"
                        >
                            {saving ||
                                uploadingLogo ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />

                                    {uploadingLogo
                                        ? "Uploading Logo..."
                                        : "Saving..."}
                                </>
                            ) : (
                                <>
                                    <Check className="h-4 w-4" />

                                    {editingId
                                        ? "Save Changes"
                                        : "Create Affiliate"}
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        )
    }

        </AdminShell >
    );
}

function StatCard({
    label,
    value,
    icon,
}: {
    label: string;
    value: string | number;
    icon: React.ReactNode;
}) {
    return (
        <div className="rounded-2xl border border-border bg-foreground/[0.025] p-5">
            <div className="mb-4 flex items-center justify-between">
                <span className="text-sm text-foreground/45">
                    {label}
                </span>

                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted/50 text-foreground/50">
                    {icon}
                </div>
            </div>

            <div className="text-2xl font-semibold tracking-tight">
                {value}
            </div>
        </div>
    );
}

function Field({
    label,
    required,
    children,
}: {
    label: string;
    required?: boolean;
    children: React.ReactNode;
}) {
    return (
        <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-foreground/50">
                {label}

                {required && (
                    <span className="ml-1 text-red-500">
                        *
                    </span>
                )}
            </label>

            {children}
        </div>
    );
}