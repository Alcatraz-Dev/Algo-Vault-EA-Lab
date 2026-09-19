"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ref, push, set, update } from "firebase/database";
import {
    onAuthStateChanged,
    User,
} from "firebase/auth";
import { database, auth } from "@/lib/firebase";
import {
    ArrowLeft,
    Bot,
    CheckCircle2,
    DollarSign,
    FileText,
    Gauge,
    Save,
    Shield,
    Upload,
    X,
    Wand2,

} from "lucide-react";
import Link from "next/link";
import { formatProductFileExtensions, getProductFileRule, isAllowedProductFileName } from "@/lib/product-files";
import ProductMediaUpload from "@/components/products/ProductMediaUpload";

export default function NewBotPage() {
    const router = useRouter();

    const [user, setUser] = useState<User | null>(null);

    const [pricing, setPricing] = useState("free");
    const [saving, setSaving] = useState(false);
    const [uploadingFile, setUploadingFile] =
        useState(false);

    const [risk, setRisk] = useState("medium");
    const [status, setStatus] = useState("draft");

    const [selectedFile, setSelectedFile] =
        useState<File | null>(null);

    const [uploadedFile, setUploadedFile] =
        useState<{
            fileName: string;
            version: string;
            size: number;
        } | null>(null);

    const [form, setForm] = useState({
        name: "",
        slug: "",
        description: "",
        developer: "Our Team",
        version: "1.0.0",

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

        imageUrl: "",
        images: "",
        videoUrl: "",

        licenseRequired: true,
        licenseDays: "30",
        maxAccounts: "1",
    });

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(
            auth,
            (currentUser) => {
                setUser(currentUser);
            }
        );

        return () => unsubscribe();
    }, []);

    function generateSlug(name: string) {
        return name
            .toLowerCase()
            .trim()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

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
            setUploadedFile(null);
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
            setUploadedFile(null);
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

        const MAX_FILE_SIZE =
            50 * 1024 * 1024;

        if (file.size > MAX_FILE_SIZE) {
            alert(
                "File is too large. Maximum size is 50 MB."
            );

            event.target.value = "";
            return;
        }

        setSelectedFile(file);
        setUploadedFile(null);
    }

    function removeSelectedFile() {
        setSelectedFile(null);
        setUploadedFile(null);
    }

    async function handleUploadFile(
        productId: string
    ) {
        if (!user) {
            throw new Error(
                "You must be logged in."
            );
        }

        if (!selectedFile) {
            throw new Error(
                `Please select a ${getProductFileRule(form.productType, form.platform).label}.`
            );
        }

        const fileRule = getProductFileRule(form.productType, form.platform);

        if (!isAllowedProductFileName(selectedFile.name, form.productType, form.platform)) {
            throw new Error(
                `Only ${fileRule.description} uploads are allowed (${formatProductFileExtensions(form.productType, form.platform)}).`
            );
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
                    `${fileRule.label} upload failed.`
                );
            }

            setUploadedFile({
                fileName:
                    data.file.fileName,
                version:
                    data.file.version,
                size:
                    data.file.size,
            });

            return true;
        } catch (error) {
            console.error(
                "PRODUCT FILE UPLOAD ERROR:",
                error
            );

            throw error;
        } finally {
            setUploadingFile(false);
        }
    }

    async function createBot() {
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
            alert("Please enter a slug.");
            return;
        }

        if (!form.description.trim()) {
            alert(
                "Please enter a description."
            );
            return;
        }

        /*
         * Published products need a downloadable file.
         */
        if (
            status === "published" &&
            !selectedFile
        ) {
            alert(
                `Upload a ${getProductFileRule(form.productType, form.platform).label} before publishing.`
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

        setSaving(true);

        try {
            const botsRef =
                ref(database, "bots");

            const newBotRef =
                push(botsRef);

            const productId =
                newBotRef.key;

            if (!productId) {
                throw new Error(
                    "Failed to generate product ID."
                );
            }

            const now =
                Date.now();

            /*
             * Create product as draft first.
             *
             * This is safer because the product file
             * upload happens after the RTDB
             * product is created.
             */
            const bot = {
                id: productId,

                ownerUid: user?.uid || null,

                name: form.name.trim(),

                slug:
                    form.slug
                        .trim()
                        .toLowerCase(),

                description:
                    form.description.trim(),

                developer:
                    form.developer.trim(),

                version:
                    form.version.trim() ||
                    "1.0.0",

                productType:
                    form.productType,

                platform:
                    form.platform,

                symbol:
                    form.symbol,

                timeframe:
                    form.timeframe,

                imageUrl:
                    form.imageUrl.trim(),

                images:
                    form.images
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),

                videoUrl:
                    form.videoUrl.trim(),

                sellerType: "admin",

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

                /*
                 * Always start as draft.
                 * We publish only after file upload.
                 */
                status: "draft",

                file: {
                    uploaded: false,
                    storagePath: "",
                    fileName: "",
                },

                createdAt: now,
                updatedAt: now,
            };

            await set(
                newBotRef,
                bot
            );

            /*
             * Upload the product file if one was selected.
             */
            if (selectedFile) {
                await handleUploadFile(
                    productId
                );
            }

            /*
             * If the admin selected Published,
             * publish only after successful file upload.
             */
            if (
                status ===
                "published"
            ) {
                if (!selectedFile) {
                    throw new Error(
                        `Upload a ${getProductFileRule(form.productType, form.platform).label} before publishing.`
                    );
                }

                await update(
                    newBotRef,
                    {
                        status: "published",
                        updatedAt:
                            Date.now(),
                    }
                );
            }

            /*
             * If private was selected,
             * leave it private as requested.
             */
            if (
                status === "private"
            ) {
                await update(
                    newBotRef,
                    {
                        status: "private",
                        updatedAt:
                            Date.now(),
                    }
                );
            }

            alert(
                selectedFile
                    ? "Product created and file uploaded successfully!"
                    : "Product created successfully!"
            );

            router.push(
                "/admin/bots"
            );
        } catch (error: unknown) {
            console.error(
                "CREATE PRODUCT ERROR:",
                error
            );

            alert(
                error instanceof Error ? error.message :
                "Failed to create product. Check Firebase configuration and database rules."
            );
        } finally {
            setSaving(false);
        }
    }

    const productFileRule = getProductFileRule(form.productType, form.platform);
    const productFileExtensions = formatProductFileExtensions(form.productType, form.platform);

    return (
        <main className="min-h-screen bg-background text-foreground">
            <div className="mx-auto max-w-5xl px-6 py-8">

                {/* Header */}
                <div data-guide="page-header" className="mb-8 flex items-center gap-4">

                    <Link
                        href="/admin"
                        className="flex h-10 w-10 items-center justify-center rounded-xl border border-border hover:bg-muted/70"
                    >
                        <ArrowLeft size={18} />
                    </Link>

                    <div>
                        <p className="text-sm text-muted-foreground">
                            ADMIN / PRODUCTS
                        </p>

                        <h1 className="mt-1 text-3xl font-semibold">
                            Add New Product
                        </h1>
                    </div>

                </div>

                <div className="space-y-6">

                    {/* Basic */}
                    <Section
                        icon={
                            <Bot size={18} />
                        }
                        title="Basic Information"
                        description="General information about the trading product."
                    >

                        <div className="grid gap-5 md:grid-cols-2">

                            <div>
                                <label className="mb-2 block text-sm text-muted-foreground">
                                    Product Name
                                </label>

                                <input
                                    value={form.name}
                                    placeholder="Gold Scalper"
                                    onChange={(e) => {
                                        const name = e.target.value;

                                        updateField("name", name);

                                        /*
                                         * Automatically generate slug
                                         * while creating the product.
                                         */
                                        updateField(
                                            "slug",
                                            generateSlug(name)
                                        );
                                    }}
                                    className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/40"
                                />
                            </div>
                            <div>
                                <label className="mb-2 block text-sm text-muted-foreground">
                                    Slug
                                </label>

                                <div className="flex gap-2">
                                    <input
                                        value={form.slug}
                                        placeholder="gold-scalper"
                                        readOnly
                                        className="flex-1 rounded-xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground outline-none"
                                    />

                                    <button
                                        type="button"
                                        onClick={() => {
                                            const newSlug = generateSlug(
                                                form.name
                                            );

                                            setForm((current) => ({
                                                ...current,
                                                slug: newSlug,
                                            }));
                                        }}
                                        title="Regenerate slug"
                                        className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground transition hover:border-muted-foreground/60 hover:bg-muted hover:text-foreground"
                                    >
                                        <Wand2 size={18} />
                                    </button>
                                </div>

                                <p className="mt-2 text-xs text-muted-foreground">
                                    Generated automatically from the product name.
                                </p>
                            </div>

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
                                value={
                                    form.version
                                }
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
                                placeholder="Describe the strategy..."
                                rows={5}
                                className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/40"
                            />

                        </div>

                        <div className="mt-6">
                            <ProductMediaUpload
                                imageUrl={form.imageUrl}
                                videoUrl={form.videoUrl}
                                images={form.images ? form.images.split("\n").filter(Boolean) : []}
                                onImageUrlChange={(url) => updateField("imageUrl", url)}
                                onVideoUrlChange={(url) => updateField("videoUrl", url)}
                                onImagesChange={(imgs) => updateField("images", imgs.join("\n"))}
                            />
                        </div>

                    </Section>

                    {/* Platform */}
                    <Section
                        icon={
                            <Gauge size={18} />
                        }
                        title="Trading Configuration"
                        description="Trading environment used by this product."
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
                        description="Enter verified results from your backtest."
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
                        description="Choose how customers can access this product."
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
                        description="Help users understand the strategy risk."
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
                        description="Optional external affiliate offer."
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
                        description="Control how customers activate the EA."
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
                        description={`Upload the ${productFileRule.description} that customers will receive after purchase.`}
                    >

                        <div className="rounded-xl border border-dashed border-border bg-muted p-8">

                            {!selectedFile &&
                                !uploadedFile && (
                                    <div className="text-center">

                                        <Upload
                                            size={
                                                30
                                            }
                                            className="mx-auto text-muted-foreground"
                                        />

                                        <p className="mt-4 text-sm text-muted-foreground">
                                            Select your {productFileRule.label}
                                        </p>

                                        <p className="mt-1 text-xs text-muted-foreground">
                                            Only {productFileExtensions} files • Maximum 50 MB
                                        </p>

                                        <label className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm hover:bg-muted/70">

                                            <Upload
                                                size={
                                                    16
                                                }
                                            />

                                            Select File

                                            <input
                                                type="file"
                                                accept={`${productFileExtensions},application/octet-stream,text/plain`}
                                                onChange={
                                                    handleFileSelect
                                                }
                                                className="hidden"
                                            />

                                        </label>

                                    </div>
                                )}

                            {selectedFile && (
                                <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 p-4">

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
                                                    selectedFile.name
                                                }
                                            </p>

                                            <p className="mt-1 text-xs text-muted-foreground">
                                                {formatBytes(
                                                    selectedFile.size
                                                )}{" "}
                                                • Version{" "}
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
                                        disabled={
                                            saving ||
                                            uploadingFile
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

                            {uploadedFile && (
                                <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">

                                    <div className="flex items-center gap-3">

                                        <CheckCircle2
                                            size={
                                                20
                                            }
                                            className="text-emerald-600"
                                        />

                                        <div>

                                            <p className="text-sm font-medium text-emerald-600">
                                                File uploaded successfully
                                            </p>

                                            <p className="mt-1 text-xs text-muted-foreground">
                                                {
                                                    uploadedFile.fileName
                                                }{" "}
                                                •{" "}
                                                {
                                                    uploadedFile.version
                                                }{" "}
                                                •{" "}
                                                {formatBytes(
                                                    uploadedFile.size
                                                )}
                                            </p>

                                        </div>

                                    </div>

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
                        description="Control whether the product is visible in the marketplace."
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
                            !selectedFile && (
                                <div className="mt-4 rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 text-xs text-yellow-600">
                                    Upload a {productFileRule.label} before publishing this product.
                                </div>
                            )}

                    </Section>

                    {/* Submit */}
                    <div className="flex justify-end gap-3 pb-10">

                        <Link
                            href="/admin"
                            className="rounded-xl border border-border px-5 py-3 text-sm hover:bg-muted/70"
                        >
                            Cancel
                        </Link>

                        <button
                            onClick={
                                createBot
                            }
                            disabled={
                                saving ||
                                uploadingFile
                            }
                            className="flex items-center gap-2 rounded-xl bg-foreground px-6 py-3 text-sm font-medium text-background hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                        >

                            <Save
                                size={17}
                            />

                            {uploadingFile
                                ? "Uploading file..."
                                : saving
                                    ? "Creating..."
                                    : "Create Product"}

                        </button>

                    </div>

                </div>
            </div>
        </main>
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
                placeholder={placeholder}
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
                ? "border-foreground/30 bg-muted"
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
