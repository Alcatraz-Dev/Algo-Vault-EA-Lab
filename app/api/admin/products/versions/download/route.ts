import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import fs from "fs/promises";
import path from "path";
import { isAllowedProductFileName } from "@/lib/product-files";

/* -----------------------------------------
   Helpers
----------------------------------------- */

function safeVersion(version: string) {
    return version
        .trim()
        .replace(/\./g, "_")
        .replace(/[^a-zA-Z0-9_-]/g, "_");
}

function safeProductId(productId: string) {
    return /^[a-zA-Z0-9_-]+$/.test(productId);
}

async function verifyAdmin(
    request: NextRequest
) {
    const authorization =
        request.headers.get("authorization");

    if (
        !authorization ||
        !authorization.startsWith("Bearer ")
    ) {
        throw new Error("AUTH_REQUIRED");
    }

    const idToken =
        authorization.substring(7).trim();

    if (!idToken) {
        throw new Error("AUTH_REQUIRED");
    }

    const decodedToken =
        await adminAuth.verifyIdToken(
            idToken
        );

    const userSnapshot =
        await adminDatabase
            .ref(
                `users/${decodedToken.uid}`
            )
            .get();

    if (!userSnapshot.exists()) {
        throw new Error("ADMIN_REQUIRED");
    }

    const user =
        userSnapshot.val();

    if (user.role !== "admin") {
        throw new Error("ADMIN_REQUIRED");
    }

    return decodedToken.uid;
}

/* -----------------------------------------
   GET
   Secure Admin Version Download
----------------------------------------- */

export async function GET(
    request: NextRequest
) {
    try {
        const adminUid =
            await verifyAdmin(request);

        const { searchParams } =
            new URL(request.url);

        const productId =
            searchParams
                .get("productId")
                ?.trim() || "";

        const version =
            searchParams
                .get("version")
                ?.trim() || "";

        if (!productId) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "productId is required.",
                },
                { status: 400 }
            );
        }

        if (!version) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "version is required.",
                },
                { status: 400 }
            );
        }

        /* -----------------------------------------
           Validate Product ID
        ----------------------------------------- */

        if (
            !safeProductId(productId)
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Invalid productId.",
                },
                { status: 400 }
            );
        }

        /* -----------------------------------------
           Load Product
        ----------------------------------------- */

        const productRef =
            adminDatabase.ref(
                `bots/${productId}`
            );

        const productSnapshot =
            await productRef.get();

        if (
            !productSnapshot.exists()
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Product not found.",
                },
                { status: 404 }
            );
        }

        const product =
            productSnapshot.val();

        /* -----------------------------------------
           Find Version
        ----------------------------------------- */

        const safeVersionName =
            safeVersion(version);

        if (!safeVersionName) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Invalid version.",
                },
                { status: 400 }
            );
        }

        const versionSnapshot =
            await productRef
                .child(
                    `versions/${safeVersionName}`
                )
                .get();

        if (
            !versionSnapshot.exists()
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Version not found.",
                },
                { status: 404 }
            );
        }

        const versionData =
            versionSnapshot.val();

        const fileName =
            versionData?.fileName;

        if (
            !fileName ||
            typeof fileName !==
            "string"
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Version file metadata is missing.",
                },
                { status: 404 }
            );
        }

        /* -----------------------------------------
           Validate File Name
        ----------------------------------------- */

        if (
            !isAllowedProductFileName(fileName, product.productType, product.platform)
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Invalid product filename.",
                },
                { status: 400 }
            );
        }

        /* -----------------------------------------
           Build Secure File Path
        ----------------------------------------- */

        const versionsDirectory =
            path.join(
                process.cwd(),
                "private-files",
                "products",
                productId,
                "versions"
            );

        const versionDirectory =
            path.join(
                versionsDirectory,
                safeVersionName
            );

        const filePath =
            path.join(
                versionDirectory,
                fileName
            );

        const normalizedRoot =
            path.resolve(
                versionsDirectory
            );

        const normalizedVersion =
            path.resolve(
                versionDirectory
            );

        const normalizedFile =
            path.resolve(filePath);

        /* -----------------------------------------
           Path Traversal Protection
        ----------------------------------------- */

        if (
            !normalizedVersion.startsWith(
                normalizedRoot +
                path.sep
            )
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Invalid version path.",
                },
                { status: 400 }
            );
        }

        if (
            !normalizedFile.startsWith(
                normalizedVersion +
                path.sep
            )
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Invalid file path.",
                },
                { status: 400 }
            );
        }

        /* -----------------------------------------
           Check File
        ----------------------------------------- */

        let fileBuffer: Buffer;

        try {
            fileBuffer =
                await fs.readFile(
                    normalizedFile
                );
        } catch {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Version file not found on server.",
                },
                { status: 404 }
            );
        }

        /* -----------------------------------------
           Log Download
        ----------------------------------------- */

        const now =
            Date.now();

        await adminDatabase
            .ref(
                `settings/admin_downloads/${productId}`
            )
            .push({
                productId,
                version:
                    versionData.version ||
                    version,
                fileName,
                adminUid,
                downloadedAt: now,
            });

        /* -----------------------------------------
           Response
        ----------------------------------------- */

        return new NextResponse(
            new Uint8Array(fileBuffer),
            {
                status: 200,
                headers: {
                    "Content-Type":
                        "application/octet-stream",

                    "Content-Disposition":
                        `attachment; filename="${fileName}"`,

                    "Content-Length":
                        String(
                            fileBuffer.length
                        ),

                    "Cache-Control":
                        "private, no-store, max-age=0",

                    "X-Content-Type-Options":
                        "nosniff",
                },
            }
        );
    } catch (error: any) {
        console.error(
            "ADMIN VERSION DOWNLOAD ERROR:",
            error
        );

        if (
            error?.message ===
            "AUTH_REQUIRED"
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Authentication required.",
                },
                { status: 401 }
            );
        }

        if (
            error?.message ===
            "ADMIN_REQUIRED"
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Admin access required.",
                },
                { status: 403 }
            );
        }

        return NextResponse.json(
            {
                success: false,
                error:
                    error?.message ||
                    "Failed to download version.",
            },
            { status: 500 }
        );
    }
}
