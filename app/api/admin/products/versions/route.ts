import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import fs from "fs/promises";
import path from "path";

/* -----------------------------------------
   Helpers
----------------------------------------- */

async function verifyAdmin(request: NextRequest) {
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
        await adminAuth.verifyIdToken(idToken);

    const userSnapshot =
        await adminDatabase
            .ref(`users/${decodedToken.uid}`)
            .get();

    if (!userSnapshot.exists()) {
        throw new Error("ADMIN_REQUIRED");
    }

    const user = userSnapshot.val();

    if (user.role !== "admin") {
        throw new Error("ADMIN_REQUIRED");
    }

    return decodedToken.uid;
}

function safeVersion(version: string) {
    return version
        .trim()
        .replace(/\./g, "_")
        .replace(/[^a-zA-Z0-9_-]/g, "_");
}

interface ProductVersionRecord {
    version?: string | null;
    isCurrent?: boolean | null;
    uploadedAt?: number | null;
    fileName?: string | null;
    [key: string]: unknown;
}

interface ProductFileRecord {
    version?: string | null;
    file?: { version?: string | null } | null;
    versions?: Record<string, ProductVersionRecord> | null;
}

function toMs(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function errorMessage(error: unknown): string | undefined {
    return error instanceof Error ? error.message : undefined;
}

/* -----------------------------------------
   GET
   Get all product versions
----------------------------------------- */

export async function GET(
    request: NextRequest
) {
    try {
        await verifyAdmin(request);

        const { searchParams } =
            new URL(request.url);

        const productId =
            searchParams
                .get("productId")
                ?.trim();

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
                    error:
                        "Product not found.",
                },
                { status: 404 }
            );
        }

        const product =
            productSnapshot.val() as ProductFileRecord | null;

        const versions =
            product?.versions || {};

        const versionList =
            Object.entries(versions).map(
                ([key, value]) => ({
                    id: key,
                    ...value,
                    isCurrent:
                        value?.version ===
                        product?.version ||
                        value?.isCurrent === true,
                })
            );

        versionList.sort(
            (a, b) =>
                toMs(b.uploadedAt) -
                toMs(a.uploadedAt)
        );

        return NextResponse.json({
            success: true,
            productId,
            currentVersion:
                product?.version ||
                product?.file?.version ||
                null,
            versions: versionList,
        });
    } catch (error: unknown) {
        console.error(
            "GET PRODUCT VERSIONS ERROR:",
            error
        );

        if (
            errorMessage(error) ===
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
            errorMessage(error) ===
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
                    errorMessage(error) ||
                    "Failed to load versions.",
            },
            { status: 500 }
        );
    }
}

/* -----------------------------------------
   DELETE
   Delete old version
----------------------------------------- */

export async function DELETE(
    request: NextRequest
) {
    try {
        const adminUid =
            await verifyAdmin(request);

        const body =
            await request.json();

        const productId =
            typeof body.productId ===
                "string"
                ? body.productId.trim()
                : "";

        const version =
            typeof body.version ===
                "string"
                ? body.version.trim()
                : "";

        if (
            !productId ||
            !version
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "productId and version are required.",
                },
                { status: 400 }
            );
        }

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
                    error:
                        "Product not found.",
                },
                { status: 404 }
            );
        }

        const product =
            productSnapshot.val() as ProductFileRecord | null;

        const currentVersion =
            product?.version ||
            product?.file?.version ||
            "";

        /* -----------------------------------------
           Never delete current version
        ----------------------------------------- */

        if (
            version === currentVersion
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "The current version cannot be deleted.",
                },
                { status: 400 }
            );
        }

        const safeVersionName =
            safeVersion(version);

        const versionRef =
            productRef.child(
                `versions/${safeVersionName}`
            );

        const versionSnapshot =
            await versionRef.get();

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
            versionSnapshot.val() as ProductVersionRecord | null;

        /* -----------------------------------------
           Delete physical file
        ----------------------------------------- */

        if (
            versionData?.fileName
        ) {
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

            const normalizedRoot =
                path.resolve(
                    versionsDirectory
                );

            const normalizedVersion =
                path.resolve(
                    versionDirectory
                );

            if (
                normalizedVersion.startsWith(
                    normalizedRoot +
                    path.sep
                )
            ) {
                try {
                    await fs.rm(
                        normalizedVersion,
                        {
                            recursive: true,
                            force: true,
                        }
                    );
                } catch (
                fileError
                ) {
                    console.error(
                        "VERSION FILE DELETE ERROR:",
                        fileError
                    );
                }
            }
        }

        /* -----------------------------------------
           Delete RTDB metadata
        ----------------------------------------- */

        await versionRef.remove();

        console.log(
            `Admin ${adminUid} deleted product ${productId} version ${version}`
        );

        return NextResponse.json({
            success: true,
            message:
                `Version ${version} deleted successfully.`,
            productId,
            version,
        });
    } catch (error: unknown) {
        console.error(
            "DELETE PRODUCT VERSION ERROR:",
            error
        );

        if (
            errorMessage(error) ===
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
            errorMessage(error) ===
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
                    errorMessage(error) ||
                    "Failed to delete version.",
            },
            { status: 500 }
        );
    }
}