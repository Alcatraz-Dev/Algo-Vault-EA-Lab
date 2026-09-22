import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import fs from "fs/promises";
import path from "path";
import { isAllowedProductFileName } from "@/lib/product-files";

function safeVersion(version: string) {
    return version
        .trim()
        .replace(/\./g, "_")
        .replace(/[^a-zA-Z0-9_-]/g, "_");
}

interface ProductVersionRecord {
    version?: string | null;
    isCurrent?: boolean | null;
    fileName?: string | null;
    originalFileName?: string | null;
    [key: string]: unknown;
}

interface ProductFileRecord {
    version?: string | null;
    file?: { version?: string | null } | null;
    versions?: Record<string, ProductVersionRecord> | null;
    productType?: string;
    platform?: string;
}

function errorMessage(error: unknown): string | undefined {
    return error instanceof Error ? error.message : undefined;
}

export async function POST(request: NextRequest) {
    try {
        // --------------------------------------------------
        // 1. Verify Firebase authentication
        // --------------------------------------------------

        const authorization =
            request.headers.get("authorization");

        if (!authorization?.startsWith("Bearer ")) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Unauthorized.",
                },
                { status: 401 }
            );
        }

        const token =
            authorization.substring("Bearer ".length);

        const decodedToken =
            await adminAuth.verifyIdToken(token);

        const uid = decodedToken.uid;

        // --------------------------------------------------
        // 2. Verify admin role
        // --------------------------------------------------

        const userSnapshot =
            await adminDatabase
                .ref(`users/${uid}`)
                .get();

        if (!userSnapshot.exists()) {
            return NextResponse.json(
                {
                    success: false,
                    error: "User profile not found.",
                },
                { status: 403 }
            );
        }

        const userData =
            userSnapshot.val();

        if (userData?.role !== "admin") {
            return NextResponse.json(
                {
                    success: false,
                    error: "Admin access required.",
                },
                { status: 403 }
            );
        }

        // --------------------------------------------------
        // 3. Read request body
        // --------------------------------------------------

        const body = await request.json();

        const productId =
            typeof body?.productId === "string"
                ? body.productId.trim()
                : "";

        const version =
            typeof body?.version === "string"
                ? body.version.trim()
                : "";

        if (!productId || !version) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "productId and version are required.",
                },
                { status: 400 }
            );
        }

        // --------------------------------------------------
        // 4. Load product
        // --------------------------------------------------

        const productRef =
            adminDatabase.ref(
                `bots/${productId}`
            );

        const productSnapshot =
            await productRef.get();

        if (!productSnapshot.exists()) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Product not found.",
                },
                { status: 404 }
            );
        }

        const product =
            productSnapshot.val() as ProductFileRecord | null;

        // --------------------------------------------------
        // 5. Find requested version
        // --------------------------------------------------

        const safeVersionName =
            safeVersion(version);

        const versionRef =
            productRef.child(
                `versions/${safeVersionName}`
            );

        const versionSnapshot =
            await versionRef.get();

        if (!versionSnapshot.exists()) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        `Version ${version} does not exist.`,
                },
                { status: 404 }
            );
        }

        const selectedVersion =
            versionSnapshot.val();

        // --------------------------------------------------
        // 6. If already current, do nothing
        // --------------------------------------------------

        const currentVersion =
            product?.version ||
            product?.file?.version ||
            "";

        if (
            currentVersion === version &&
            selectedVersion?.isCurrent === true
        ) {
            return NextResponse.json({
                success: true,
                alreadyCurrent: true,
                message:
                    `Version ${version} is already the current version.`,
                productId,
                version,
            });
        }

        // --------------------------------------------------
        // 7. Validate product filename
        // --------------------------------------------------

        const fileName =
            selectedVersion.fileName ||
            selectedVersion.originalFileName ||
            "";

        if (
            !fileName ||
            !isAllowedProductFileName(fileName, product?.productType, product?.platform)
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "The selected version does not contain a valid product file.",
                },
                { status: 400 }
            );
        }

        // --------------------------------------------------
        // 8. Verify physical product file exists
        // --------------------------------------------------

        const versionDirectory =
            path.join(
                process.cwd(),
                "private-files",
                "products",
                productId,
                "versions",
                safeVersionName
            );

        const filePath =
            path.join(
                versionDirectory,
                fileName
            );

        // Prevent path traversal
        const resolvedBase =
            path.resolve(
                versionDirectory
            );

        const resolvedFile =
            path.resolve(filePath);

        if (
            !resolvedFile.startsWith(
                resolvedBase + path.sep
            )
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Invalid file path.",
                },
                { status: 400 }
            );
        }

        try {
            await fs.access(resolvedFile);
        } catch {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "The product file for this version was not found on the server.",
                },
                { status: 404 }
            );
        }

        // --------------------------------------------------
        // 9. Find the old current version
        // --------------------------------------------------

        let oldCurrentVersion = "";

        const versions =
            product?.versions || {};

        for (const [key, item] of Object.entries(
            versions
        )) {
            if (
                item?.isCurrent === true
            ) {
                oldCurrentVersion =
                    item.version ||
                    key;
                break;
            }
        }

        // Fallback to product.version
        if (!oldCurrentVersion) {
            oldCurrentVersion =
                currentVersion;
        }

        // --------------------------------------------------
        // 10. Build new product.file
        // --------------------------------------------------

        const newCurrentFile = {
            ...selectedVersion,
            version,
            isCurrent: true,
        };

        // --------------------------------------------------
        // 11. Prepare atomic multi-location update
        // --------------------------------------------------

        const updates: Record<
            string,
            unknown
        > = {};

        // New current version
        updates[
            `bots/${productId}/version`
        ] = version;

        updates[
            `bots/${productId}/file`
        ] = newCurrentFile;

        // Mark selected version as current
        updates[
            `bots/${productId}/versions/${safeVersionName}/isCurrent`
        ] = true;

        // --------------------------------------------------
        // 12. Mark old current version as not current
        // --------------------------------------------------

        if (
            oldCurrentVersion &&
            oldCurrentVersion !== version
        ) {
            const oldSafeVersionName =
                safeVersion(
                    oldCurrentVersion
                );

            const oldVersionRef =
                productRef.child(
                    `versions/${oldSafeVersionName}`
                );

            const oldVersionSnapshot =
                await oldVersionRef.get();

            if (
                oldVersionSnapshot.exists()
            ) {
                updates[
                    `bots/${productId}/versions/${oldSafeVersionName}/isCurrent`
                ] = false;
            }
        }

        // --------------------------------------------------
        // 13. Update timestamp
        // --------------------------------------------------

        updates[
            `bots/${productId}/updatedAt`
        ] = Date.now();

        // --------------------------------------------------
        // 14. Atomic database update
        // --------------------------------------------------

        await adminDatabase
            .ref()
            .update(updates);

        // --------------------------------------------------
        // 15. Success
        // --------------------------------------------------

        return NextResponse.json({
            success: true,
            alreadyCurrent: false,
            message:
                `Version ${version} is now the current version.`,
            productId,
            version,
            previousVersion:
                oldCurrentVersion || null,
            file: newCurrentFile,
        });
    } catch (error: unknown) {
        console.error(
            "SET CURRENT VERSION ERROR:",
            error
        );

        return NextResponse.json(
            {
                success: false,
                error:
                    errorMessage(error) ||
                    "Failed to set current version.",
            },
            { status: 500 }
        );
    }
}
