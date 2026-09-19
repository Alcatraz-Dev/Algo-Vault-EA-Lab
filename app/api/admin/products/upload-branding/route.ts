import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import fs from "fs/promises";
import path from "path";

const MAX_ICON_LOGO_SIZE = 5 * 1024 * 1024;
const MAX_BANNER_SIZE = 10 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/svg+xml",
]);

const ALLOWED_EXTENSIONS = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".svg",
]);

const ALLOWED_BRANDING_TYPES = new Set([
    "icon",
    "logo",
    "banner",
]);

type BrandingType =
    | "icon"
    | "logo"
    | "banner";

function sanitizeFileName(name: string) {
    return name
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/\.{2,}/g, ".")
        .slice(0, 150);
}

function getExtension(fileName: string) {
    return path.extname(fileName).toLowerCase();
}

function isBrandingType(
    value: string
): value is BrandingType {
    return ALLOWED_BRANDING_TYPES.has(value);
}

async function verifyAdmin(
    request: NextRequest
) {
    const authorization =
        request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
        throw new Error("Unauthorized.");
    }

    const token =
        authorization.substring("Bearer ".length);

    const decodedToken =
        await adminAuth.verifyIdToken(token);

    const userSnapshot =
        await adminDatabase
            .ref(`users/${decodedToken.uid}`)
            .get();

    if (!userSnapshot.exists()) {
        throw new Error(
            "User profile not found."
        );
    }

    const user =
        userSnapshot.val();

    if (user?.role !== "admin") {
        throw new Error(
            "Admin access required."
        );
    }

    return decodedToken;
}

export async function POST(
    request: NextRequest
) {
    try {
        const adminUser =
            await verifyAdmin(request);

        const formData =
            await request.formData();

        const productIdValue =
            formData.get("productId");

        const typeValue =
            formData.get("type");

        const file =
            formData.get("file");

        const productId =
            typeof productIdValue === "string"
                ? productIdValue.trim()
                : "";

        const type =
            typeof typeValue === "string"
                ? typeValue.trim().toLowerCase()
                : "";

        /*
         * Validate product ID.
         *
         * Firebase push IDs are safe path names.
         * We reject path separators to prevent
         * filesystem traversal.
         */
        if (
            !productId ||
            productId.includes("/") ||
            productId.includes("\\") ||
            productId.includes("..")
        ) {
            return NextResponse.json(
                {
                    error:
                        "Invalid productId.",
                },
                { status: 400 }
            );
        }

        if (!isBrandingType(type)) {
            return NextResponse.json(
                {
                    error:
                        "Invalid branding type. Use icon, logo or banner.",
                },
                { status: 400 }
            );
        }

        if (!(file instanceof File)) {
            return NextResponse.json(
                {
                    error:
                        "Branding image is required.",
                },
                { status: 400 }
            );
        }

        if (file.size <= 0) {
            return NextResponse.json(
                {
                    error:
                        "The selected image is empty.",
                },
                { status: 400 }
            );
        }

        const maxSize =
            type === "banner"
                ? MAX_BANNER_SIZE
                : MAX_ICON_LOGO_SIZE;

        if (file.size > maxSize) {
            return NextResponse.json(
                {
                    error:
                        type === "banner"
                            ? "Banner must be 10MB or smaller."
                            : "Icon or logo must be 5MB or smaller.",
                },
                { status: 400 }
            );
        }

        const extension =
            getExtension(file.name);

        if (
            !ALLOWED_TYPES.has(file.type) ||
            !ALLOWED_EXTENSIONS.has(extension)
        ) {
            return NextResponse.json(
                {
                    error:
                        "Allowed formats: PNG, JPG, JPEG, WEBP or SVG.",
                },
                { status: 400 }
            );
        }

        /*
         * Verify product.
         */
        const productRef =
            adminDatabase.ref(
                `bots/${productId}`
            );

        const productSnapshot =
            await productRef.get();

        if (!productSnapshot.exists()) {
            return NextResponse.json(
                {
                    error:
                        "Product not found.",
                },
                { status: 404 }
            );
        }

        const product =
            productSnapshot.val();

        /*
         * Private filesystem directory.
         *
         * private-files/
         *   products/
         *     PRODUCT_ID/
         *       branding/
         */
        const productDirectory =
            path.join(
                process.cwd(),
                "private-files",
                "products",
                productId,
                "branding"
            );

        await fs.mkdir(
            productDirectory,
            {
                recursive: true,
            }
        );

        /*
         * Each branding type gets its own fixed filename.
         *
         * icon.png
         * logo.png
         * banner.png
         *
         * The extension is preserved.
         */
        const storageFileName =
            `${type}${extension}`;

        const storagePath =
            path.join(
                productDirectory,
                storageFileName
            );

        /*
         * Safety check.
         */
        const baseDirectory =
            path.resolve(
                productDirectory
            );

        const resolvedStoragePath =
            path.resolve(storagePath);

        if (
            !resolvedStoragePath.startsWith(
                `${baseDirectory}${path.sep}`
            )
        ) {
            return NextResponse.json(
                {
                    error:
                        "Invalid storage path.",
                },
                { status: 400 }
            );
        }

        /*
         * Remove previous versions of THIS
         * branding type with another extension.
         *
         * This does NOT touch:
         *
         * versions/
         *
         * EX5 files remain completely untouched.
         */
        const possibleExtensions = [
            ".png",
            ".jpg",
            ".jpeg",
            ".webp",
            ".svg",
        ];

        for (
            const oldExtension
            of possibleExtensions
        ) {
            const oldFileName =
                `${type}${oldExtension}`;

            const oldPath =
                path.join(
                    productDirectory,
                    oldFileName
                );

            if (
                path.resolve(oldPath) ===
                resolvedStoragePath
            ) {
                continue;
            }

            try {
                await fs.unlink(oldPath);
            } catch {
                // File does not exist.
            }
        }

        /*
         * Write the new image.
         */
        const arrayBuffer =
            await file.arrayBuffer();

        const buffer =
            Buffer.from(arrayBuffer);

        await fs.writeFile(
            resolvedStoragePath,
            buffer
        );

        /*
         * Browser-accessible API URL.
         *
         * IMPORTANT:
         * We do NOT expose the physical
         * private-files path.
         */
        const publicPath =
            `/api/products/branding?productId=${encodeURIComponent(
                productId
            )}&type=${encodeURIComponent(
                type
            )}`;

        const safeOriginalName =
            sanitizeFileName(
                file.name
            );

        /*
         * Store branding under:
         *
         * bots/{productId}/branding/{type}
         *
         * NOT:
         *
         * bots/{productId}/{type}
         */
        const branding = {
            uploaded: true,
            type,
            fileName:
                storageFileName,
            originalFileName:
                safeOriginalName,
            size: file.size,
            mimeType:
                file.type,
            contentType:
                file.type,

            /*
             * Physical path is kept for
             * server-side reference only.
             */
            storagePath:
                `private-files/products/${productId}/branding/${storageFileName}`,

            /*
             * Browser URL used by the UI.
             */
            path: publicPath,

            uploadedAt:
                Date.now(),

            uploadedBy:
                adminUser.uid,
        };

        /*
         * Save in the correct Firebase structure.
         *
         * branding/icon
         * branding/logo
         * branding/banner
         */
        await productRef.update({
            [`branding/${type}`]:
                branding,
            updatedAt:
                Date.now(),
        });

        console.log(
            `[BRANDING] ${type} uploaded for product ${productId}`
        );

        return NextResponse.json({
            success: true,

            productId,

            productName:
                product.name || "",

            type,

            branding,
        });
    } catch (error: any) {
        console.error(
            "UPLOAD BRANDING ERROR:",
            error
        );

        const message =
            error?.message ||
            "Unable to upload branding image.";

        if (
            message ===
            "Unauthorized." ||
            message ===
            "Admin access required."
        ) {
            return NextResponse.json(
                {
                    error: message,
                },
                { status: 401 }
            );
        }

        if (
            message ===
            "User profile not found."
        ) {
            return NextResponse.json(
                {
                    error: message,
                },
                { status: 403 }
            );
        }

        return NextResponse.json(
            {
                error: message,
            },
            { status: 500 }
        );
    }
}