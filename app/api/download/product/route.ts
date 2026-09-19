import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import fs from "fs/promises";
import path from "path";
import { isAllowedProductFileName, safeProductVersionName } from "@/lib/product-files";

export async function POST(request: NextRequest) {
    try {
        // --------------------------------------------------
        // 1. Read Firebase Auth token
        // --------------------------------------------------

        const authorization =
            request.headers.get("authorization");

        if (
            !authorization ||
            !authorization.startsWith("Bearer ")
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Authentication required.",
                },
                { status: 401 }
            );
        }

        const idToken =
            authorization.substring(7).trim();

        if (!idToken) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Invalid authentication token.",
                },
                { status: 401 }
            );
        }

        // --------------------------------------------------
        // 2. Verify Firebase token
        // --------------------------------------------------

        let decodedToken;

        try {
            decodedToken =
                await adminAuth.verifyIdToken(
                    idToken
                );
        } catch {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Invalid or expired authentication token.",
                },
                { status: 401 }
            );
        }

        const userId = decodedToken.uid;

        // --------------------------------------------------
        // 3. Read request body
        // --------------------------------------------------

        const body = await request.json();

        const {
            productId,
        } = body;

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

        // --------------------------------------------------
        // 4. Check user
        // --------------------------------------------------

        const userSnapshot =
            await adminDatabase
                .ref(`users/${userId}`)
                .get();

        if (!userSnapshot.exists()) {
            return NextResponse.json(
                {
                    success: false,
                    error: "User not found.",
                },
                { status: 404 }
            );
        }

        // --------------------------------------------------
        // 5. Check product
        // --------------------------------------------------

        const productSnapshot =
            await adminDatabase
                .ref(`bots/${productId}`)
                .get();

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
            productSnapshot.val();

        if (
            product.status !==
            "published"
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Product is not available.",
                },
                { status: 403 }
            );
        }

        // --------------------------------------------------
        // 6. Find paid order belonging to THIS user
        // --------------------------------------------------

        const ordersSnapshot =
            await adminDatabase
                .ref(`orders/${userId}`)
                .get();

        if (!ordersSnapshot.exists()) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "No orders found.",
                },
                { status: 403 }
            );
        }

        const orders =
            ordersSnapshot.val();

        let paidOrder: any = null;
        let paidOrderId: string | null =
            null;

        for (
            const orderId of Object.keys(
                orders
            )
        ) {
            const order =
                orders[orderId];

            if (
                order &&
                order.productId ===
                productId &&
                order.status ===
                "paid"
            ) {
                paidOrder = order;
                paidOrderId = orderId;
                break;
            }
        }

        if (
            !paidOrder ||
            !paidOrderId
        ) {
            // Check if user has a donation reward grant for this product
            const rewardSnapshot = await adminDatabase
                .ref(`donation_rewards/${userId}/${productId}`)
                .get();

            if (!rewardSnapshot.exists() || rewardSnapshot.val()?.status !== "active") {
                return NextResponse.json(
                    {
                        success: false,
                        error:
                            "You do not have a paid order for this product.",
                    },
                    { status: 403 }
                );
            }

            // Donation reward path — skip license check, go straight to file delivery
            // (reuse paidOrderId as a placeholder so the rest of the code flows)
            paidOrderId = rewardSnapshot.val().donationId || "donation_reward";
        }

        // --------------------------------------------------
        // 7. Find active license (or donation reward bypass)
        // --------------------------------------------------

        const isDonationReward = paidOrderId === "donation_reward" ||
            String(paidOrderId).startsWith("donation_");

        let activeLicense: any = null;
        let activeLicenseId: string | null = null;

        if (!isDonationReward) {
            const licensesSnapshot =
                await adminDatabase
                    .ref(`licenses/${userId}`)
                    .get();

            if (!licensesSnapshot.exists()) {
                return NextResponse.json(
                    {
                        success: false,
                        error: "License not found.",
                    },
                    { status: 403 }
                );
            }

            const licenses = licensesSnapshot.val();
            const now = Date.now();

            for (
                const licenseId of Object.keys(licenses)
            ) {
                const license = licenses[licenseId];
                if (
                    license &&
                    license.productId === productId &&
                    license.status === "active" &&
                    Number(license.expiresAt || 0) > now
                ) {
                    activeLicense = license;
                    activeLicenseId = licenseId;
                    break;
                }
            }

            if (!activeLicense || !activeLicenseId) {
                return NextResponse.json(
                    {
                        success: false,
                        error: "You do not have an active license for this product.",
                    },
                    { status: 403 }
                );
            }
        } else {
            // Donation reward — no license required
            activeLicenseId = paidOrderId;
        }

        // --------------------------------------------------
        // 8. File information
        // --------------------------------------------------

        const fileName =
            product.file?.fileName;

        if (!fileName) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Product file is not available yet.",
                },
                { status: 404 }
            );
        }

        if (!isAllowedProductFileName(fileName, product.productType, product.platform)) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Invalid product file.",
                },
                { status: 400 }
            );
        }

        const version =
            product.file?.version ||
            product.version ||
            "1.0.0";

        const downloadEnabled =
            product.file
                ?.downloadEnabled !== false;

        if (!downloadEnabled) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Downloads are currently disabled.",
                },
                { status: 403 }
            );
        }

        // --------------------------------------------------
        // 9. Secure file path
        // --------------------------------------------------

        const productDirectory =
            path.join(
                process.cwd(),
                "private-files",
                "products",
                productId
            );

        const safeVersionName =
            safeProductVersionName(version);

        if (!safeVersionName) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Invalid product version.",
                },
                { status: 400 }
            );
        }

        const filePath =
            path.join(
                productDirectory,
                "versions",
                safeVersionName,
                fileName
            );

        const normalizedRoot =
            path.resolve(
                productDirectory
            );

        const normalizedFile =
            path.resolve(filePath);

        if (
            !normalizedFile.startsWith(
                normalizedRoot +
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

        // --------------------------------------------------
        // 10. Check file
        // --------------------------------------------------

        try {
            await fs.access(
                normalizedFile
            );
        } catch {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Product file is not available yet.",
                },
                { status: 404 }
            );
        }

        // --------------------------------------------------
        // 11. Read file
        // --------------------------------------------------

        const fileBuffer =
            await fs.readFile(
                normalizedFile
            );

        // --------------------------------------------------
        // 12. Download log
        // --------------------------------------------------

        const downloadRef =
            adminDatabase
                .ref(
                    `downloads/${userId}`
                )
                .push();

        const downloadId =
            downloadRef.key;

        const timestamp =
            Date.now();

        if (downloadId) {
            await downloadRef.set({
                id: downloadId,
                userId,
                productId,
                productName:
                    product.name || "",
                orderId:
                    paidOrderId,
                licenseId:
                    activeLicenseId,
                fileName,
                version,
                downloadedAt:
                    timestamp,
                createdAt:
                    timestamp,
            });
        }

        // --------------------------------------------------
        // 13. Deliver file
        // --------------------------------------------------

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

                    "X-Product-ID":
                        productId,

                    "X-License-ID":
                        activeLicenseId ?? "",

                    "X-File-Version":
                        version,
                },
            }
        );
    } catch (error: any) {
        console.error(
            "SECURE DOWNLOAD ERROR:",
            error
        );

        return NextResponse.json(
            {
                success: false,
                error:
                    error?.message ||
                    "Download failed.",
            },
            { status: 500 }
        );
    }
}
