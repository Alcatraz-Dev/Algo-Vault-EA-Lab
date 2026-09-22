"use client";

import ProductVersionHistory from "@/components/admin/ProductVersionHistory";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
    onAuthStateChanged,
    User,
} from "firebase/auth";
import {
    ref,
    get,
    update,
} from "firebase/database";
import {
    ArrowLeft,
    Bot,
    CheckCircle2,
    DollarSign,
    FileText,
    Gauge,
    Image as ImageIcon,
    Save,
    Shield,
    Upload,
    X,
} from "lucide-react";
import Link from "next/link";

import { auth, database } from "@/lib/firebase";
import { formatProductFileExtensions, getProductFileRule, isAllowedProductFileName } from "@/lib/product-files";

type BrandingItem = {
    type?: string;
    fileName?: string;
    originalFileName?: string;
    mimeType?: string;
    size?: number;
    path?: string;
    updatedAt?: number;
};

type Product = {
    id?: string;
    name?: string;
    slug?: string;
    description?: string;
    developer?: string;
    version?: string;

    productType?: string;
    platform?: string;
    symbol?: string;
    timeframe?: string;

    branding?: {
        icon?: BrandingItem;
        logo?: BrandingItem;
        banner?: BrandingItem;
    };

    pricing?: {
        type?: string;
        price?: number;
        currency?: string;
    };

    risk?: {
        level?: string;
        maxDrawdown?: number;
    };

    performance?: {
        initialDeposit?: number;
        finalBalance?: number;
        profit?: number;
        winRate?: number;
        profitFactor?: number;
        maxDrawdown?: number;
        totalTrades?: number;
        backtestPeriod?: string;
    };

    affiliate?: {
        enabled?: boolean;
        url?: string;
    };

    license?: {
        required?: boolean;
        durationDays?: number;
        maxAccounts?: number;
    };

    status?: string;

    file?: {
        uploaded?: boolean;
        storagePath?: string;
        fileName?: string;
        originalFileName?: string;
        version?: string;
        size?: number;
        contentType?: string;
        downloadEnabled?: boolean;
        uploadedAt?: number;
        uploadedBy?: string;
    };

    createdAt?: number;
    updatedAt?: number;
};

type BrandingType =
    | "icon"
    | "logo"
    | "banner";

type BrandingSelection = {
    file: File | null;
    preview: string;
};

type ProductFileUploadResult = {
    success: boolean;
    alreadyExists?: boolean;
    version?: string;
    currentVersion?: string;
};

export default function EditBotPage() {
    const params = useParams();
    const router = useRouter();

    const productId =
        typeof params.id === "string"
            ? params.id
            : "";

    const [user, setUser] =
        useState<User | null>(null);

    const [loading, setLoading] =
        useState(true);

    const [saving, setSaving] =
        useState(false);

    const [product, setProduct] =
        useState<Product | null>(null);

    const [pricing, setPricing] =
        useState("free");

    const [risk, setRisk] =
        useState("medium");

    const [status, setStatus] =
        useState("draft");

    const [selectedFile, setSelectedFile] =
        useState<File | null>(null);

    const [uploadingFile, setUploadingFile] =
        useState(false);

    const [branding, setBranding] =
        useState<
            Record<
                BrandingType,
                BrandingSelection
            >
        >({
            icon: {
                file: null,
                preview: "",
            },
            logo: {
                file: null,
                preview: "",
            },
            banner: {
                file: null,
                preview: "",
            },
        });

    const [uploadingBranding, setUploadingBranding] =
        useState<BrandingType | null>(null);

    const [form, setForm] = useState({
        name: "",
        slug: "",
        description: "",
        developer: "",
        version: "",

        productType: "expert_advisor",
        platform: "MT5",
        symbol: "XAUUSD",
        timeframe: "M5",

        initialDeposit: "",
        finalBalance: "",
        profit: "",
        winRate: "",
        profitFactor: "",
        maxDrawdown: "",
        totalTrades: "",
        backtestPeriod: "",

        price: "",
        currency: "USD",

        affiliateEnabled: false,
        affiliateUrl: "",

        licenseRequired: true,
        licenseDays: "30",
        maxAccounts: "1",
    });

    useEffect(() => {
        const unsubscribe =
            onAuthStateChanged(
                auth,
                (currentUser) => {
                    setUser(currentUser);
                }
            );

        return () => unsubscribe();
    }, []);

    async function loadProduct() {
        try {
            setLoading(true);

            const snapshot =
                await get(
                    ref(
                        database,
                        `bots/${productId}`
                    )
                );

            if (!snapshot.exists()) {
                alert(
                    "Product not found."
                );

                router.push(
                    "/admin/bots"
                );

                return;
            }

            const data =
                snapshot.val() as Product;

            setProduct(data);

            setPricing(
                data.pricing?.type ||
                "free"
            );

            setRisk(
                data.risk?.level ||
                "medium"
            );

            setStatus(
                data.status ||
                "draft"
            );

            setForm({
                name:
                    data.name || "",

                slug:
                    data.slug || "",

                description:
                    data.description ||
                    "",

                developer:
                    data.developer ||
                    "Our Team",

                version:
                    data.version ||
                    data.file?.version ||
                    "1.0.0",

                productType:
                    data.productType ||
                    "expert_advisor",

                platform:
                    data.platform ||
                    "MT5",

                symbol:
                    data.symbol ||
                    "XAUUSD",

                timeframe:
                    data.timeframe ||
                    "M5",

                initialDeposit:
                    String(
                        data.performance
                            ?.initialDeposit ??
                        ""
                    ),

                finalBalance:
                    String(
                        data.performance
                            ?.finalBalance ??
                        ""
                    ),

                profit:
                    String(
                        data.performance
                            ?.profit ??
                        ""
                    ),

                winRate:
                    String(
                        data.performance
                            ?.winRate ??
                        ""
                    ),

                profitFactor:
                    String(
                        data.performance
                            ?.profitFactor ??
                        ""
                    ),

                maxDrawdown:
                    String(
                        data.risk
                            ?.maxDrawdown ??
                        ""
                    ),

                totalTrades:
                    String(
                        data.performance
                            ?.totalTrades ??
                        ""
                    ),

                backtestPeriod:
                    data.performance
                        ?.backtestPeriod ||
                    "",

                price:
                    String(
                        data.pricing
                            ?.price ??
                        ""
                    ),

                currency:
                    data.pricing
                        ?.currency ||
                    "USD",

                affiliateEnabled:
                    Boolean(
                        data.affiliate
                            ?.enabled
                    ),

                affiliateUrl:
                    data.affiliate
                        ?.url || "",

                licenseRequired:
                    data.license
                        ?.required ??
                    true,

                licenseDays:
                    String(
                        data.license
                            ?.durationDays ??
                        30
                    ),

                maxAccounts:
                    String(
                        data.license
                            ?.maxAccounts ??
                        1
                    ),
            });
        } catch (error) {
            console.error(
                "LOAD PRODUCT ERROR:",
                error
            );

            alert(
                "Failed to load product."
            );
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (!productId) {
            return;
        }

        void Promise.resolve().then(() => loadProduct());
    }, [productId]);

    function updateField(
        field: string,
        value: string | boolean
    ) {
        if (field === "productType") {
            setForm((current) => {
                const isPineProduct =
                    value === "pine_indicator" || value === "pine_strategy";
                const nextPlatform = isPineProduct ? "TradingView" : current.platform;
                const nextProductType =
                    value === "expert_advisor" && current.platform === "TradingView"
                        ? "indicator"
                        : value;

                return {
                    ...current,
                    productType: String(nextProductType),
                    platform: nextPlatform,
                };
            });
            setSelectedFile(null);
            return;
        }

        if (field === "platform") {
            setForm((current) => {
                const nextProductType =
                    value === "TradingView" && current.productType === "expert_advisor"
                        ? "pine_indicator"
                        : (current.productType === "pine_indicator" ||
                              current.productType === "pine_strategy") &&
                          value !== "TradingView"
                          ? "indicator"
                          : current.productType;

                return {
                    ...current,
                    platform: String(value),
                    productType: nextProductType,
                };
            });
            setSelectedFile(null);
            return;
        }

        setForm((current) => ({
            ...current,
            [field]: value,
        }));
    }

    function handleFileSelect(
        event: React.ChangeEvent<HTMLInputElement>
    ) {
        const file =
            event.target.files?.[0];

        if (!file) {
            return;
        }

        const fileRule = getProductFileRule(form.productType, form.platform);

        if (!isAllowedProductFileName(file.name, form.productType, form.platform)) {
            alert(
                `Only ${fileRule.description} uploads are allowed (${formatProductFileExtensions(form.productType, form.platform)}).`
            );

            event.target.value = "";

            return;
        }

        const maxSize =
            50 * 1024 * 1024;

        if (file.size > maxSize) {
            alert(
                "File is too large. Maximum size is 50 MB."
            );

            event.target.value = "";

            return;
        }

        setSelectedFile(file);
    }

    function removeSelectedFile() {
        setSelectedFile(null);
    }

    async function replaceProductFile(): Promise<ProductFileUploadResult> {
        if (!user) {
            alert("You must be logged in.");

            return {
                success: false,
            };
        }

        if (!selectedFile) {
            return {
                success: true,
            };
        }

        try {
            setUploadingFile(true);

            const token =
                await user.getIdToken();

            const formData =
                new FormData();

            formData.append(
                "productId",
                productId
            );

            formData.append(
                "file",
                selectedFile
            );

            formData.append(
                "version",
                form.version.trim() ||
                "1.0.0"
            );

            const response =
                await fetch(
                    "/api/admin/products/upload-file",
                    {
                        method: "POST",
                        headers: {
                            Authorization:
                                `Bearer ${token}`,
                        },
                        body: formData,
                    }
                );

            const data =
                await response.json();

            if (!response.ok) {
                throw new Error(
                    data.error ||
                    `${getProductFileRule(form.productType, form.platform).label} upload failed.`
                );
            }

            if (
                data.alreadyExists
            ) {
                return {
                    success: true,
                    alreadyExists: true,
                    version:
                        data.version,
                    currentVersion:
                        data.currentVersion,
                };
            }

            return {
                success: true,
                alreadyExists: false,
                version:
                    data.version,
                currentVersion:
                    data.currentVersion,
            };
        } catch (error: unknown) {
            console.error(
                "REPLACE PRODUCT FILE ERROR:",
                error
            );

            alert(
                error instanceof Error
                    ? error.message
                    : "Failed to replace product file."
            );

            return {
                success: false,
            };
        } finally {
            setUploadingFile(false);
        }
    }

    function handleBrandingSelect(
        type: BrandingType,
        event: React.ChangeEvent<HTMLInputElement>
    ) {
        const file =
            event.target.files?.[0];

        if (!file) {
            return;
        }

        const allowedTypes = [
            "image/png",
            "image/jpeg",
            "image/webp",
        ];

        if (
            !allowedTypes.includes(
                file.type
            )
        ) {
            alert(
                "Only PNG, JPG/JPEG and WEBP images are allowed."
            );

            event.target.value = "";

            return;
        }

        const maxSize =
            type === "banner"
                ? 10 * 1024 * 1024
                : 5 * 1024 * 1024;

        if (file.size > maxSize) {
            alert(
                type === "banner"
                    ? "Banner is too large. Maximum size is 10 MB."
                    : "Image is too large. Maximum size is 5 MB."
            );

            event.target.value = "";

            return;
        }

        const preview =
            URL.createObjectURL(file);

        setBranding(
            (current) => {
                if (
                    current[type]
                        .preview
                ) {
                    URL.revokeObjectURL(
                        current[type]
                            .preview
                    );
                }

                return {
                    ...current,
                    [type]: {
                        file,
                        preview,
                    },
                };
            }
        );

        event.target.value = "";
    }

    function removeSelectedBranding(
        type: BrandingType
    ) {
        setBranding(
            (current) => {
                if (
                    current[type]
                        .preview
                ) {
                    URL.revokeObjectURL(
                        current[type]
                            .preview
                    );
                }

                return {
                    ...current,
                    [type]: {
                        file: null,
                        preview: "",
                    },
                };
            }
        );
    }

    async function uploadBranding(
        type: BrandingType
    ) {
        if (!user) {
            alert(
                "You must be logged in."
            );

            return false;
        }

        const selected =
            branding[type].file;

        if (!selected) {
            return true;
        }

        try {
            setUploadingBranding(type);

            const token =
                await user.getIdToken();

            const formData =
                new FormData();

            formData.append(
                "productId",
                productId
            );

            formData.append(
                "type",
                type
            );

            formData.append(
                "file",
                selected
            );

            const response =
                await fetch(
                    "/api/admin/products/upload-branding",
                    {
                        method: "POST",
                        headers: {
                            Authorization:
                                `Bearer ${token}`,
                        },
                        body: formData,
                    }
                );

            const text =
                await response.text();

            let data:
                Partial<Record<string, unknown>> | null;

            try {
                data = JSON.parse(text);
            } catch {
                console.error(
                    "UPLOAD BRANDING NON-JSON RESPONSE:",
                    text
                );

                throw new Error(
                    `Server returned an invalid response (${response.status}).`
                );
            }

            if (!response.ok) {
                throw new Error(
                    typeof data?.error === "string"
                        ? data.error
                        : "Branding upload failed."
                );
            }

            return true;
        } catch (error: unknown) {
            console.error(
                `UPLOAD ${type.toUpperCase()} ERROR:`,
                error
            );

            alert(
                error instanceof Error
                    ? error.message
                    : `Failed to upload ${type}.`
            );

            return false;
        } finally {
            setUploadingBranding(null);
        }
    }

    async function uploadAllBranding() {
        const types: BrandingType[] = [
            "icon",
            "logo",
            "banner",
        ];

        for (const type of types) {
            if (
                branding[type].file
            ) {
                const success =
                    await uploadBranding(
                        type
                    );

                if (!success) {
                    return false;
                }
            }
        }

        return true;
    }

    async function saveProduct() {
        if (!productId) {
            return;
        }

        if (!user) {
            alert(
                "You must be logged in as an admin."
            );

            return;
        }

        if (!form.name.trim()) {
            alert(
                "Please enter a product name."
            );

            return;
        }

        if (!form.slug.trim()) {
            alert(
                "Please enter a slug."
            );

            return;
        }

        if (!form.description.trim()) {
            alert(
                "Please enter a description."
            );

            return;
        }

        if (
            pricing !== "free" &&
            Number(form.price || 0) <= 0
        ) {
            alert(
                "Please enter a valid product price."
            );

            return;
        }

        if (
            status === "published" &&
            !product?.file?.fileName &&
            !selectedFile
        ) {
            alert(
                `Upload a ${getProductFileRule(form.productType, form.platform).label} before publishing this product.`
            );

            return;
        }

        try {
            setSaving(true);

            let uploadResult:
                | ProductFileUploadResult
                | null = null;

            /*
             * Upload the product file first.
             */
            if (selectedFile) {
                uploadResult =
                    await replaceProductFile();

                if (
                    !uploadResult.success
                ) {
                    return;
                }
            }

            /*
             * Upload branding before
             * saving the product.
             */
            const brandingUploaded =
                await uploadAllBranding();

            if (!brandingUploaded) {
                return;
            }

            /*
             * IMPORTANT:
             *
             * If the selected file version
             * already exists, do not overwrite
             * the current product.version.
             */
            const versionToSave =
                uploadResult?.alreadyExists
                    ? product?.version ||
                    product?.file?.version ||
                    form.version.trim() ||
                    "1.0.0"
                    : form.version.trim() ||
                    "1.0.0";

            const updates = {
                name:
                    form.name.trim(),

                slug:
                    form.slug
                        .trim()
                        .toLowerCase(),

                description:
                    form.description.trim(),

                developer:
                    form.developer.trim(),

                version:
                    versionToSave,

                productType:
                    form.productType,

                platform:
                    form.platform,

                symbol:
                    form.symbol,

                timeframe:
                    form.timeframe,

                pricing: {
                    type: pricing,

                    price:
                        pricing === "free"
                            ? 0
                            : Number(
                                form.price ||
                                0
                            ),

                    currency:
                        form.currency,
                },

                risk: {
                    level: risk,

                    maxDrawdown:
                        Number(
                            form.maxDrawdown ||
                            0
                        ),
                },

                performance: {
                    initialDeposit:
                        Number(
                            form.initialDeposit ||
                            0
                        ),

                    finalBalance:
                        Number(
                            form.finalBalance ||
                            0
                        ),

                    profit:
                        Number(
                            form.profit || 0
                        ),

                    winRate:
                        Number(
                            form.winRate || 0
                        ),

                    profitFactor:
                        Number(
                            form.profitFactor ||
                            0
                        ),

                    totalTrades:
                        Number(
                            form.totalTrades ||
                            0
                        ),

                    backtestPeriod:
                        form.backtestPeriod.trim(),
                },

                affiliate: {
                    enabled:
                        form.affiliateEnabled,

                    url:
                        form.affiliateUrl.trim(),
                },

                license: {
                    required:
                        form.licenseRequired,

                    durationDays:
                        Number(
                            form.licenseDays ||
                            30
                        ),

                    maxAccounts:
                        Number(
                            form.maxAccounts ||
                            1
                        ),
                },

                status,

                updatedAt:
                    Date.now(),
            };

            await update(
                ref(
                    database,
                    `bots/${productId}`
                ),
                updates
            );

            alert(
                selectedFile
                    ? "Product updated and file replaced successfully!"
                    : "Product updated successfully!"
            );

            router.push(
                "/admin/bots"
            );
        } catch (error) {
            console.error(
                "SAVE PRODUCT ERROR:",
                error
            );

            alert(
                "Failed to update product."
            );
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
                <div className="text-center">
                    <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-border border-t-white" />

                    <p className="mt-4 text-sm text-muted-foreground">
                        Loading product...
                    </p>
                </div>
            </main>
        );
    }

    if (!product) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
                <div className="text-center">
                    <p className="text-muted-foreground">
                        Product not found.
                    </p>

                    <Link
                        href="/admin/bots"
                        className="mt-4 inline-block rounded-xl border border-border px-4 py-2 text-sm hover:bg-muted/70"
                    >
                        Back to Products
                    </Link>
                </div>
            </main>
        );
    }

    const iconUrl =
        product.branding?.icon?.path
            ? product.branding.icon.path
            : "";

    const logoUrl =
        product.branding?.logo?.path
            ? product.branding.logo.path
            : "";

    const productFileRule = getProductFileRule(form.productType, form.platform);
    const productFileExtensions = formatProductFileExtensions(form.productType, form.platform);

    const bannerUrl =
        product.branding?.banner?.path
            ? product.branding.banner.path
            : "";

    return (
        <main className="min-h-screen bg-background text-foreground">
            <div className="mx-auto max-w-5xl px-6 py-8">

                {/* Header */}
                <div data-guide="page-header" className="mb-8 flex items-center justify-between">

                    <div className="flex items-center gap-4">

                        <Link
                            href="/admin/bots"
                            className="flex h-10 w-10 items-center justify-center rounded-xl border border-border hover:bg-muted/70"
                        >
                            <ArrowLeft size={18} />
                        </Link>

                        <div>
                            <p className="text-sm text-muted-foreground">
                                ADMIN / PRODUCTS / EDIT
                            </p>

                            <h1 className="mt-1 text-3xl font-semibold">
                                Edit Product
                            </h1>
                        </div>

                    </div>

                    <div className="hidden rounded-xl border border-border bg-muted/40 px-4 py-2 md:block">

                        <p className="text-xs text-muted-foreground">
                            Product ID
                        </p>

                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                            {productId}
                        </p>

                    </div>

                </div>

                <div className="space-y-6">

                    {/* Basic */}
                    <Section
                        icon={<Bot size={18} />}
                        title="Basic Information"
                        description="Edit the general information of this product."
                    >

                        <div className="grid gap-5 md:grid-cols-2">

                            <Field
                                label="Product Name"
                                placeholder="Gold Scalper"
                                value={form.name}
                                onChange={(value) =>
                                    updateField(
                                        "name",
                                        value
                                    )
                                }
                            />

                            <Field
                                label="Slug"
                                placeholder="gold-scalper"
                                value={form.slug}
                                onChange={(value) =>
                                    updateField(
                                        "slug",
                                        value
                                    )
                                }
                            />

                            <Field
                                label="Developer"
                                placeholder="Our Team"
                                value={
                                    form.developer
                                }
                                onChange={(value) =>
                                    updateField(
                                        "developer",
                                        value
                                    )
                                }
                            />

                            <Field
                                label="Version"
                                placeholder="1.0.0"
                                value={form.version}
                                onChange={(value) =>
                                    updateField(
                                        "version",
                                        value
                                    )
                                }
                            />

                        </div>

                        <div className="mt-5">

                            <label className="mb-2 block text-sm text-muted-foreground">
                                Description
                            </label>

                            <textarea
                                value={
                                    form.description
                                }
                                onChange={(e) =>
                                    updateField(
                                        "description",
                                        e.target.value
                                    )
                                }
                                rows={5}
                                className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/40"
                            />

                        </div>

                        <ProductVersionHistory
                            productId={
                                productId
                            }
                            productType={
                                form.productType
                            }
                            platform={
                                form.platform
                            }
                        />
                    </Section>

                    {/* Branding */}
                    <Section
                        icon={
                            <ImageIcon size={18} />
                        }
                        title="Product Branding"
                        description="Optional icon, logo and banner used throughout the marketplace."
                    >

                        <div className="grid gap-5 lg:grid-cols-3">

                            <BrandingCard
                                type="icon"
                                title="Product Icon"
                                description="Used on marketplace cards."
                                currentUrl={
                                    iconUrl
                                }
                                currentFileName={
                                    product
                                        .branding
                                        ?.icon
                                        ?.fileName
                                }
                                selection={
                                    branding.icon
                                }
                                uploading={
                                    uploadingBranding ===
                                    "icon"
                                }
                                onSelect={(
                                    event
                                ) =>
                                    handleBrandingSelect(
                                        "icon",
                                        event
                                    )
                                }
                                onRemove={() =>
                                    removeSelectedBranding(
                                        "icon"
                                    )
                                }
                            />

                            <BrandingCard
                                type="logo"
                                title="Product Logo"
                                description="Used on the product details page."
                                currentUrl={
                                    logoUrl
                                }
                                currentFileName={
                                    product
                                        .branding
                                        ?.logo
                                        ?.fileName
                                }
                                selection={
                                    branding.logo
                                }
                                uploading={
                                    uploadingBranding ===
                                    "logo"
                                }
                                onSelect={(
                                    event
                                ) =>
                                    handleBrandingSelect(
                                        "logo",
                                        event
                                    )
                                }
                                onRemove={() =>
                                    removeSelectedBranding(
                                        "logo"
                                    )
                                }
                            />

                            <BrandingCard
                                type="banner"
                                title="Product Banner"
                                description="Used as the hero visual."
                                currentUrl={
                                    bannerUrl
                                }
                                currentFileName={
                                    product
                                        .branding
                                        ?.banner
                                        ?.fileName
                                }
                                selection={
                                    branding.banner
                                }
                                uploading={
                                    uploadingBranding ===
                                    "banner"
                                }
                                onSelect={(
                                    event
                                ) =>
                                    handleBrandingSelect(
                                        "banner",
                                        event
                                    )
                                }
                                onRemove={() =>
                                    removeSelectedBranding(
                                        "banner"
                                    )
                                }
                            />

                        </div>

                        <div className="mt-5 rounded-xl border border-border bg-muted p-4">

                            <p className="text-xs font-medium text-muted-foreground">
                                Supported formats
                            </p>

                            <p className="mt-1 text-xs text-muted-foreground">
                                PNG, JPG/JPEG and WEBP. Icon and Logo max 5 MB. Banner max 10 MB.
                            </p>

                        </div>

                    </Section>

                    {/* Configuration */}
                    <Section
                        icon={
                            <Gauge size={18} />
                        }
                        title="Trading Configuration"
                        description="Edit the trading environment."
                    >

                        <div className="grid gap-5 md:grid-cols-3">

                            <SelectField
                                label="Product Type"
                                value={
                                    form.productType
                                }
                                options={[
                                    "expert_advisor",
                                    "indicator",
                                    "pine_indicator",
                                    "pine_strategy",
                                ]}
                                onChange={(value) =>
                                    updateField(
                                        "productType",
                                        value
                                    )
                                }
                            />

                            <SelectField
                                label="Platform"
                                value={
                                    form.platform
                                }
                                options={[
                                    "MT5",
                                    "MT4",
                                    "TradingView",
                                ]}
                                onChange={(value) =>
                                    updateField(
                                        "platform",
                                        value
                                    )
                                }
                            />

                            <SelectField
                                label="Symbol"
                                value={
                                    form.symbol
                                }
                                options={[
                                    "XAUUSD",
                                    "EURUSD",
                                    "GBPUSD",
                                    "USDJPY",
                                    "BTCUSD",
                                    "Other",
                                ]}
                                onChange={(value) =>
                                    updateField(
                                        "symbol",
                                        value
                                    )
                                }
                            />

                            <SelectField
                                label="Timeframe"
                                value={
                                    form.timeframe
                                }
                                options={[
                                    "M1",
                                    "M3",
                                    "M5",
                                    "M15",
                                    "M30",
                                    "H1",
                                    "H4",
                                    "D1",
                                ]}
                                onChange={(value) =>
                                    updateField(
                                        "timeframe",
                                        value
                                    )
                                }
                            />

                        </div>

                    </Section>

                    {/* Backtest */}
                    <Section
                        icon={
                            <FileText size={18} />
                        }
                        title="Backtest Performance"
                        description="Update verified historical backtest results."
                    >

                        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">

                            <Field
                                label="Initial Deposit"
                                placeholder="500"
                                value={
                                    form.initialDeposit
                                }
                                onChange={(value) =>
                                    updateField(
                                        "initialDeposit",
                                        value
                                    )
                                }
                            />

                            <Field
                                label="Final Balance"
                                placeholder="1284"
                                value={
                                    form.finalBalance
                                }
                                onChange={(value) =>
                                    updateField(
                                        "finalBalance",
                                        value
                                    )
                                }
                            />

                            <Field
                                label="Profit %"
                                placeholder="156.8"
                                value={
                                    form.profit
                                }
                                onChange={(value) =>
                                    updateField(
                                        "profit",
                                        value
                                    )
                                }
                            />

                            <Field
                                label="Win Rate %"
                                placeholder="72.4"
                                value={
                                    form.winRate
                                }
                                onChange={(value) =>
                                    updateField(
                                        "winRate",
                                        value
                                    )
                                }
                            />

                            <Field
                                label="Profit Factor"
                                placeholder="1.82"
                                value={
                                    form.profitFactor
                                }
                                onChange={(value) =>
                                    updateField(
                                        "profitFactor",
                                        value
                                    )
                                }
                            />

                            <Field
                                label="Max Drawdown %"
                                placeholder="18.2"
                                value={
                                    form.maxDrawdown
                                }
                                onChange={(value) =>
                                    updateField(
                                        "maxDrawdown",
                                        value
                                    )
                                }
                            />

                            <Field
                                label="Total Trades"
                                placeholder="1482"
                                value={
                                    form.totalTrades
                                }
                                onChange={(value) =>
                                    updateField(
                                        "totalTrades",
                                        value
                                    )
                                }
                            />

                            <Field
                                label="Backtest Period"
                                placeholder="2024 - 2026"
                                value={
                                    form.backtestPeriod
                                }
                                onChange={(value) =>
                                    updateField(
                                        "backtestPeriod",
                                        value
                                    )
                                }
                            />

                        </div>

                    </Section>

                    {/* Pricing */}
                    <Section
                        icon={
                            <DollarSign size={18} />
                        }
                        title="Pricing"
                        description="Manage product pricing."
                    >

                        <div className="grid gap-3 md:grid-cols-3">

                            <Choice
                                selected={
                                    pricing ===
                                    "free"
                                }
                                title="Free"
                                description="No payment required"
                                onClick={() =>
                                    setPricing(
                                        "free"
                                    )
                                }
                            />

                            <Choice
                                selected={
                                    pricing ===
                                    "one_time"
                                }
                                title="One-time"
                                description="Single purchase"
                                onClick={() =>
                                    setPricing(
                                        "one_time"
                                    )
                                }
                            />

                            <Choice
                                selected={
                                    pricing ===
                                    "subscription"
                                }
                                title="Subscription"
                                description="Recurring payment"
                                onClick={() =>
                                    setPricing(
                                        "subscription"
                                    )
                                }
                            />

                        </div>

                        {pricing !==
                            "free" && (
                                <div className="mt-5 max-w-sm">

                                    <Field
                                        label="Price"
                                        placeholder="49"
                                        value={
                                            form.price
                                        }
                                        onChange={(
                                            value
                                        ) =>
                                            updateField(
                                                "price",
                                                value
                                            )
                                        }
                                    />

                                </div>
                            )}

                    </Section>

                    {/* Risk */}
                    <Section
                        icon={
                            <Shield size={18} />
                        }
                        title="Risk Profile"
                        description="Manage the displayed risk level."
                    >

                        <div className="grid gap-3 md:grid-cols-4">

                            {[
                                "low",
                                "medium",
                                "high",
                                "extreme",
                            ].map(
                                (level) => (
                                    <Choice
                                        key={
                                            level
                                        }
                                        selected={
                                            risk ===
                                            level
                                        }
                                        title={
                                            level
                                                .charAt(
                                                    0
                                                )
                                                .toUpperCase() +
                                            level.slice(
                                                1
                                            )
                                        }
                                        description=""
                                        onClick={() =>
                                            setRisk(
                                                level
                                            )
                                        }
                                    />
                                )
                            )}

                        </div>

                    </Section>

                    {/* Affiliate */}
                    <Section
                        icon={
                            <DollarSign size={18} />
                        }
                        title="Affiliate"
                        description="Manage the optional affiliate offer."
                    >

                        <label className="flex cursor-pointer items-center gap-3">

                            <input
                                type="checkbox"
                                checked={
                                    form.affiliateEnabled
                                }
                                onChange={(e) =>
                                    updateField(
                                        "affiliateEnabled",
                                        e.target
                                            .checked
                                    )
                                }
                                className="h-4 w-4"
                            />

                            <span className="text-sm">
                                Enable affiliate offer
                            </span>

                        </label>

                        {form.affiliateEnabled && (
                            <div className="mt-5">

                                <Field
                                    label="Affiliate URL"
                                    placeholder="https://..."
                                    value={
                                        form.affiliateUrl
                                    }
                                    onChange={(
                                        value
                                    ) =>
                                        updateField(
                                            "affiliateUrl",
                                            value
                                        )
                                    }
                                />

                            </div>
                        )}

                    </Section>

                    {/* License */}
                    <Section
                        icon={
                            <CheckCircle2 size={18} />
                        }
                        title="License"
                        description="Manage customer license settings."
                    >

                        <label className="flex cursor-pointer items-center gap-3">

                            <input
                                type="checkbox"
                                checked={
                                    form.licenseRequired
                                }
                                onChange={(e) =>
                                    updateField(
                                        "licenseRequired",
                                        e.target
                                            .checked
                                    )
                                }
                                className="h-4 w-4"
                            />

                            <span className="text-sm">
                                License required
                            </span>

                        </label>

                        {form.licenseRequired && (
                            <div className="mt-5 grid gap-5 md:grid-cols-2">

                                <Field
                                    label="License Duration (days)"
                                    placeholder="30"
                                    value={
                                        form.licenseDays
                                    }
                                    onChange={(
                                        value
                                    ) =>
                                        updateField(
                                            "licenseDays",
                                            value
                                        )
                                    }
                                />

                                <Field
                                    label="Maximum MT5 Accounts"
                                    placeholder="1"
                                    value={
                                        form.maxAccounts
                                    }
                                    onChange={(
                                        value
                                    ) =>
                                        updateField(
                                            "maxAccounts",
                                            value
                                        )
                                    }
                                />

                            </div>
                        )}

                    </Section>

                    {/* Product File */}
                    <Section
                        icon={
                            <Upload size={18} />
                        }
                        title="Product File"
                        description={`Replace the ${productFileRule.description} without creating a new product.`}
                    >

                        <div className="rounded-xl border border-border bg-muted p-6">

                            <div className="rounded-xl border border-border bg-muted/30 p-4">

                                <p className="text-xs text-muted-foreground">
                                    CURRENT FILE
                                </p>

                                {product.file
                                    ?.fileName ? (
                                    <div className="mt-3 flex items-center justify-between">

                                        <div className="flex items-center gap-3">

                                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                                                <FileText
                                                    size={
                                                        18
                                                    }
                                                />
                                            </div>

                                            <div>

                                                <p className="text-sm font-medium">
                                                    {
                                                        product
                                                            .file
                                                            .fileName
                                                    }
                                                </p>

                                                <p className="mt-1 text-xs text-muted-foreground">
                                                    Version{" "}
                                                    {
                                                        product
                                                            .file
                                                            .version
                                                    }

                                                    {product
                                                        .file
                                                        .size
                                                        ? ` • ${formatBytes(
                                                            product
                                                                .file
                                                                .size
                                                        )}`
                                                        : ""}
                                                </p>

                                            </div>

                                        </div>

                                        <div className="rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1 text-xs text-emerald-600">
                                            Available
                                        </div>

                                    </div>
                                ) : (
                                    <p className="mt-3 text-sm text-yellow-600">
                                        No product file uploaded.
                                    </p>
                                )}

                            </div>

                            <div className="mt-5">

                                <p className="mb-2 text-xs text-muted-foreground">
                                    REPLACE FILE
                                </p>

                                {!selectedFile ? (
                                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground transition hover:bg-muted/70">

                                        <Upload
                                            size={
                                                18
                                            }
                                        />

                                        Select New File

                                        <input
                                            type="file"
                                            accept={`${productFileExtensions},application/octet-stream,text/plain`}
                                            onChange={
                                                handleFileSelect
                                            }
                                            className="hidden"
                                        />

                                    </label>
                                ) : (
                                    <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 p-4">

                                        <div className="flex items-center gap-3">

                                            <FileText
                                                size={
                                                    18
                                                }
                                            />

                                            <div>

                                                <p className="text-sm font-medium">
                                                    {
                                                        selectedFile.name
                                                    }
                                                </p>

                                                <p className="mt-1 text-xs text-muted-foreground">
                                                    {formatBytes(
                                                        selectedFile.size
                                                    )}{" "}
                                                    • Will use version{" "}
                                                    {
                                                        form.version
                                                    }
                                                </p>

                                            </div>

                                        </div>

                                        <button
                                            type="button"
                                            onClick={
                                                removeSelectedFile
                                            }
                                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border hover:bg-muted/70"
                                        >
                                            <X
                                                size={
                                                    16
                                                }
                                            />
                                        </button>

                                    </div>
                                )}

                            </div>

                            {selectedFile && (
                                <div className="mt-4 rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">

                                    <p className="text-xs text-yellow-600">
                                        The new file will replace the current file after you click Save Changes.
                                    </p>

                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Make sure the Version field above contains the new version number.
                                    </p>

                                </div>
                            )}

                        </div>

                    </Section>

                    {/* Publishing */}
                    <Section
                        icon={
                            <Save size={18} />
                        }
                        title="Publishing"
                        description="Control product visibility."
                    >

                        <div className="grid gap-3 md:grid-cols-3">

                            <Choice
                                selected={
                                    status ===
                                    "draft"
                                }
                                title="Draft"
                                description="Only visible to admins"
                                onClick={() =>
                                    setStatus(
                                        "draft"
                                    )
                                }
                            />

                            <Choice
                                selected={
                                    status ===
                                    "published"
                                }
                                title="Published"
                                description="Visible in marketplace"
                                onClick={() =>
                                    setStatus(
                                        "published"
                                    )
                                }
                            />

                            <Choice
                                selected={
                                    status ===
                                    "private"
                                }
                                title="Private"
                                description="Hidden from marketplace"
                                onClick={() =>
                                    setStatus(
                                        "private"
                                    )
                                }
                            />

                        </div>

                        {status ===
                            "published" &&
                            !product.file
                                ?.fileName &&
                            !selectedFile && (
                                <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-xs text-red-600">
                                    Upload a {productFileRule.label} before publishing this product.
                                </div>
                            )}

                    </Section>

                    {/* Actions */}
                    <div className="flex justify-between gap-3 pb-10">

                        <Link
                            href="/admin/bots"
                            className="rounded-xl border border-border px-5 py-3 text-sm hover:bg-muted/70"
                        >
                            Cancel
                        </Link>

                        <button
                            type="button"
                            onClick={
                                saveProduct
                            }
                            disabled={
                                saving ||
                                uploadingFile ||
                                uploadingBranding !==
                                null
                            }
                            className="flex items-center gap-2 rounded-xl bg-foreground px-6 py-3 text-sm font-medium text-background hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                        >

                            <Save
                                size={17}
                            />

                            {uploadingFile
                                ? "Uploading file..."
                                : uploadingBranding
                                    ? `Uploading ${uploadingBranding}...`
                                    : saving
                                        ? "Saving..."
                                        : "Save Changes"}

                        </button>

                    </div>

                </div>
            </div>
        </main>
    );
}

function BrandingCard({
    type,
    title,
    description,
    currentUrl,
    currentFileName,
    selection,
    uploading,
    onSelect,
    onRemove,
}: {
    type: BrandingType;
    title: string;
    description: string;
    currentUrl: string;
    currentFileName?: string;
    selection: BrandingSelection;
    uploading: boolean;
    onSelect: (
        event: React.ChangeEvent<HTMLInputElement>
    ) => void;
    onRemove: () => void;
}) {
    const preview =
        selection.preview ||
        currentUrl;

    return (
        <div className="rounded-2xl border border-border bg-muted p-4">

            <div className="mb-4">
                <p className="text-sm font-medium">
                    {title}
                </p>

                <p className="mt-1 text-xs text-muted-foreground">
                    {description}
                </p>
            </div>

            <div
                className={`mb-4 flex items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40 ${type === "banner"
                    ? "aspect-[16/6]"
                    : "aspect-square"
                    }`}
            >
                {preview ? (
                    <img
                        src={preview}
                        alt={`${title} preview`}
                        className={
                            type === "banner"
                                ? "h-full w-full object-cover"
                                : "h-full w-full object-contain p-4"
                        }
                    />
                ) : (
                    <div className="text-center text-muted-foreground">
                        <ImageIcon
                            size={30}
                            className="mx-auto"
                        />

                        <p className="mt-2 text-xs">
                            No image
                        </p>
                    </div>
                )}
            </div>

            {currentFileName &&
                !selection.file && (
                    <p className="mb-3 truncate text-[11px] text-muted-foreground">
                        Current:{" "}
                        {currentFileName}
                    </p>
                )}

            {selection.file && (
                <div className="mb-3 flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">

                    <p className="truncate text-xs text-muted-foreground">
                        {selection.file.name}
                    </p>

                    <button
                        type="button"
                        onClick={
                            onRemove
                        }
                        className="ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg hover:bg-muted/70"
                    >
                        <X size={14} />
                    </button>

                </div>
            )}

            <label
                className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-xs text-muted-foreground transition hover:bg-muted/70 hover:text-foreground ${uploading
                    ? "pointer-events-none opacity-50"
                    : ""
                    }`}
            >
                {uploading ? (
                    <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-white" />
                        Uploading...
                    </>
                ) : (
                    <>
                        <Upload size={15} />
                        {selection.file
                            ? "Choose Different"
                            : "Upload Image"}
                    </>
                )}

                <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={
                        onSelect
                    }
                    className="hidden"
                />
            </label>

        </div>
    );
}

function formatBytes(
    bytes: number
) {
    if (!bytes) {
        return "0 Bytes";
    }

    const units = [
        "Bytes",
        "KB",
        "MB",
        "GB",
    ];

    const index =
        Math.floor(
            Math.log(bytes) /
            Math.log(1024)
        );

    return `${(
        bytes /
        Math.pow(1024, index)
    ).toFixed(
        index === 0 ? 0 : 2
    )} ${units[index]}`;
}

function Section({
    icon,
    title,
    description,
    children,
}: {
    icon: React.ReactNode;
    title: string;
    description: string;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-2xl border border-border bg-muted/30 p-6 md:p-7">

            <div className="mb-6 flex items-start gap-3">

                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/50">
                    {icon}
                </div>

                <div>
                    <h2 className="font-medium">
                        {title}
                    </h2>

                    <p className="mt-1 text-xs text-muted-foreground">
                        {description}
                    </p>
                </div>

            </div>

            {children}

        </section>
    );
}

function Field({
    label,
    placeholder,
    value,
    onChange,
}: {
    label: string;
    placeholder: string;
    value: string;
    onChange: (
        value: string
    ) => void;
}) {
    return (
        <div>

            <label className="mb-2 block text-sm text-muted-foreground">
                {label}
            </label>

            <input
                value={value}
                placeholder={
                    placeholder
                }
                onChange={(e) =>
                    onChange(
                        e.target.value
                    )
                }
                className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/40"
            />

        </div>
    );
}

function SelectField({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: string[];
    onChange: (
        value: string
    ) => void;
}) {
    return (
        <div>

            <label className="mb-2 block text-sm text-muted-foreground">
                {label}
            </label>

            <select
                value={value}
                onChange={(e) =>
                    onChange(
                        e.target.value
                    )
                }
                className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-sm outline-none"
            >

                {options.map(
                    (option) => (
                        <option
                            key={
                                option
                            }
                            value={
                                option
                            }
                            className="bg-card"
                        >
                            {formatSelectOption(option)}
                        </option>
                    )
                )}

            </select>

        </div>
    );
}

function formatSelectOption(option: string) {
    return option
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function Choice({
    selected,
    title,
    description,
    onClick,
}: {
    selected: boolean;
    title: string;
    description: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`rounded-xl border p-4 text-left transition ${selected
                ? "border-border/60 bg-muted"
                : "border-border bg-foreground/10 hover:bg-muted/70"
                }`}
        >

            <p className="text-sm font-medium">
                {title}
            </p>

            {description && (
                <p className="mt-1 text-xs text-muted-foreground">
                    {description}
                </p>
            )}

        </button>
    );
}
