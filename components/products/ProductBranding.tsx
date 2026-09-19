"use client";

import { useEffect, useState } from "react";
import {
    Bot,
    Image as ImageIcon,
    Sparkles,
} from "lucide-react";

type BrandingItem = {
    type?: string;
    fileName?: string;
    originalFileName?: string;
    mimeType?: string;
    size?: number;
    path?: string;
    url?: string;
    src?: string;
    updatedAt?: number;
};

type Product = {
    id?: string;
    name?: string;

    branding?: {
        icon?: BrandingItem | string;
        logo?: BrandingItem | string;
        banner?: BrandingItem | string;
    };
};

type BrandingType =
    | "icon"
    | "logo"
    | "banner";

interface ProductBrandingProps {
    product: Product;
    type: BrandingType;
    size?: "xs" | "sm" | "md" | "lg" | "xl";
    className?: string;
    showFallback?: boolean;
}

const sizeClasses = {
    xs: {
        container: "h-8 w-8",
        icon: "h-4 w-4",
    },
    sm: {
        container: "h-10 w-10",
        icon: "h-5 w-5",
    },
    md: {
        container: "h-14 w-14",
        icon: "h-7 w-7",
    },
    lg: {
        container: "h-20 w-20",
        icon: "h-9 w-9",
    },
    xl: {
        container: "h-28 w-28",
        icon: "h-12 w-12",
    },
};

function getBrandingUrl(
    product: Product,
    type: BrandingType
) {
    if (!product?.id) {
        return "";
    }

    const branding =
        product.branding?.[type] as any;

    if (!branding) {
        return "";
    }

    if (typeof branding === "string") {
        return branding;
    }

    if (branding.url && typeof branding.url === "string") {
        return branding.url;
    }

    if (branding.src && typeof branding.src === "string") {
        return branding.src;
    }

    if (typeof branding.path === "string") {
        if (
            branding.path.startsWith("http://") ||
            branding.path.startsWith("https://") ||
            branding.path.startsWith("/api/")
        ) {
            return branding.path;
        }
    }

    if (
        branding?.fileName ||
        branding?.path
    ) {
        return `/api/products/branding?productId=${encodeURIComponent(
            product.id
        )}&type=${type}`;
    }

    return "";
}

export default function ProductBranding({
    product,
    type,
    size = "md",
    className = "",
    showFallback = true,
}: ProductBrandingProps) {
    const [imageError, setImageError] =
        useState(false);

    /*
     * Reset image error when the product/type
     * changes.
     */
    useEffect(() => {
        setImageError(false);
    }, [
        product.id,
        type,
        typeof product.branding?.[type] === "object"
            ? (product.branding?.[type] as BrandingItem)?.updatedAt
            : product.branding?.[type],
    ]);

    const branding =
        product.branding?.[type];

    const imageUrl =
        getBrandingUrl(
            product,
            type
        );

    const classes =
        sizeClasses[size];

    const productName =
        product.name || "Product";

    /*
     * ---------------------------------------------------------
     * BANNER
     * ---------------------------------------------------------
     */

    if (type === "banner") {
        if (!imageUrl || imageError) {
            if (!showFallback) {
                return null;
            }

            return (
                <div
                    className={`relative flex min-h-[180px] w-full items-center justify-center overflow-hidden rounded-2xl border border-border/20 bg-gradient-to-br from-background via-muted to-background ${className}`}
                >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent_35%)]" />

                    <div className="relative flex flex-col items-center gap-2 text-foreground/70">
                        <ImageIcon
                            className="h-10 w-10"
                        />

                        <span className="text-sm">
                            {productName}
                        </span>
                    </div>
                </div>
            );
        }

        return (
            <div
                className={`overflow-hidden ${className}`}
            >
                <img
                    src={imageUrl}
                    alt={`${productName} banner`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    onError={() =>
                        setImageError(true)
                    }
                />

                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
            </div>
        );
    }

    /*
     * ---------------------------------------------------------
     * ICON / LOGO FALLBACK
     * ---------------------------------------------------------
     */

    if (!imageUrl || imageError) {
        if (!showFallback) {
            return null;
        }

        return (
            <div
                className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/20 bg-background ${classes.container} ${className}`}
                title={productName}
            >
                {type === "logo" ? (
                    <Sparkles
                        className={`${classes.icon} text-muted-foreground`}
                    />
                ) : (
                    <Bot
                        className={`${classes.icon} text-muted-foreground`}
                    />
                )}
            </div>
        );
    }

    /*
     * ---------------------------------------------------------
     * ICON / LOGO IMAGE
     * ---------------------------------------------------------
     */

    return (
        <div
            className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/20 bg-background ${classes.container} ${className}`}
            title={productName}
        >
            <img
                src={imageUrl}
                alt={`${productName} ${type}`}
                className={
                    type === "logo"
                        ? "h-full w-full object-contain p-1.5"
                        : "h-full w-full object-cover"
                }
                loading="lazy"
                onError={() =>
                    setImageError(true)
                }
            />
        </div>
    );
}