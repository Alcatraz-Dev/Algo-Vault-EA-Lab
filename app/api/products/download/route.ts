import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { isAllowedProductFileName, safeProductVersionName } from "@/lib/product-files";

function jsonError(
    message: string,
    status: number
) {
    return NextResponse.json(
        {
            success: false,
            error: message,
        },
        { status }
    );
}

function isValidId(value: string) {
    return (
        value.length > 0 &&
        value.length <= 200 &&
        !value.includes("/") &&
        !value.includes("\\") &&
        !value.includes("..")
    );
}

/** An order record stored under orders/{uid}. */
interface OrderRecord {
    userId?: string;
    productId?: string;
    status?: string;
    paymentStatus?: string;
    [key: string]: unknown;
}

/** A license record stored under licenses/{uid}. */
interface LicenseRecord {
    productId?: string;
    status?: string;
    expiresAt?: number | string;
    [key: string]: unknown;
}

function isLicenseActive(
    license: LicenseRecord
) {
    if (!license) return false;

    if (
        license.status !== "active"
    ) {
        return false;
    }

    if (
        license.expiresAt &&
        Number(license.expiresAt) <
        Date.now()
    ) {
        return false;
    }

    return true;
}

export async function GET(
    request: NextRequest
) {
    try {
        /*
         * ------------------------------------------------
         * 1. AUTHENTICATION
         * ------------------------------------------------
         */

        const authorization =
            request.headers.get(
                "authorization"
            );

        if (
            !authorization ||
            !authorization.startsWith(
                "Bearer "
            )
        ) {
            return jsonError(
                "Authentication required.",
                401
            );
        }

        const idToken =
            authorization
                .substring(7)
                .trim();

        if (!idToken) {
            return jsonError(
                "Invalid authentication token.",
                401
            );
        }

        let decodedToken;

        try {
            decodedToken =
                await adminAuth.verifyIdToken(
                    idToken
                );
        } catch {
            return jsonError(
                "Invalid or expired authentication token.",
                401
            );
        }

        const uid =
            decodedToken.uid;

        /*
         * ------------------------------------------------
         * 2. PARAMETERS
         * ------------------------------------------------
         */

        const productId =
            request.nextUrl.searchParams.get(
                "productId"
            );

        if (
            !productId ||
            !isValidId(productId)
        ) {
            return jsonError(
                "Invalid product ID.",
                400
            );
        }

        /*
         * ------------------------------------------------
         * 3. LOAD PRODUCT
         * ------------------------------------------------
         */

        const productSnapshot =
            await adminDatabase
                .ref(
                    `bots/${productId}`
                )
                .get();

        if (
            !productSnapshot.exists()
        ) {
            return jsonError(
                "Product not found.",
                404
            );
        }

        const product =
            productSnapshot.val();

        /*
         * Only published products
         * can be downloaded.
         */

        if (
            product.status !==
            "published"
        ) {
            return jsonError(
                "Product is not available.",
                404
            );
        }

        /*
         * ------------------------------------------------
         * 4. CHECK CURRENT PRODUCT FILE
         * ------------------------------------------------
         */

        const file =
            product.file;

        if (
            !file ||
            !file.fileName
        ) {
            return jsonError(
                "Product file is not available.",
                404
            );
        }

        /*
         * Only the product's expected file type is allowed.
         */

        const fileName =
            path.basename(
                String(
                    file.fileName
                )
            );

        if (!isAllowedProductFileName(fileName, product.productType, product.platform)) {
            return jsonError(
                "Invalid product file.",
                400
            );
        }

        /*
         * ------------------------------------------------
         * 5. CHECK PAID ORDER
         * ------------------------------------------------
         */

        const ordersSnapshot =
            await adminDatabase
                .ref(`orders/${uid}`)
                .get();

        if (
            !ordersSnapshot.exists()
        ) {
            return jsonError(
                "No purchase found for this product.",
                403
            );
        }

        const orders =
            (ordersSnapshot.val() ?? {}) as Record<string, OrderRecord>;

        let paidOrder: (OrderRecord & { id: string }) | null = null;

        for (
            const [orderId, order] of Object.entries(
                orders
            )
        ) {
            const currentOrder =
                order;

            /*
             * Make sure the order belongs
             * to this Firebase user.
             */

            if (
                currentOrder.userId &&
                currentOrder.userId !== uid
            ) {
                continue;
            }

            if (
                currentOrder.productId !==
                productId
            ) {
                continue;
            }

            /*
             * Stripe checkout must be
             * completed successfully.
             */

            if (
                currentOrder.status ===
                "paid" ||
                currentOrder.paymentStatus ===
                "paid"
            ) {
                paidOrder = {
                    id: orderId,
                    ...currentOrder,
                };

                break;
            }
        }

        if (!paidOrder) {
            return jsonError(
                "A paid purchase is required to download this product.",
                403
            );
        }

        /*
         * ------------------------------------------------
         * 6. CHECK ACTIVE LICENSE
         * ------------------------------------------------
         */

        const licensesSnapshot =
            await adminDatabase
                .ref(`licenses/${uid}`)
                .get();

        if (
            !licensesSnapshot.exists()
        ) {
            return jsonError(
                "No license found for this product.",
                403
            );
        }

        const licenses =
            (licensesSnapshot.val() ?? {}) as Record<string, LicenseRecord>;

        let activeLicense: (LicenseRecord & { id: string }) | null =
            null;

        for (
            const [
                licenseId,
                license,
            ] of Object.entries(
                licenses
            )
        ) {
            const currentLicense =
                license;

            if (
                currentLicense.productId !==
                productId
            ) {
                continue;
            }

            if (
                isLicenseActive(
                    currentLicense
                )
            ) {
                activeLicense = {
                    id: licenseId,
                    ...currentLicense,
                };

                break;
            }
        }

        if (!activeLicense) {
            return jsonError(
                "No active license found for this product.",
                403
            );
        }

        /*
         * ------------------------------------------------
         * 7. RESOLVE PRIVATE FILE
         * ------------------------------------------------
         *
         * Product files are NEVER stored
         * inside /public.
         */

        const productDirectory =
            path.resolve(
                process.cwd(),
                "private-files",
                "products",
                productId
            );

        /*
         * Current files are stored
         * inside the version directory.
         */

        const version =
            String(
                file.version ||
                product.version ||
                ""
            ).trim();

        if (!version) {
            return jsonError(
                "Product version is missing.",
                500
            );
        }

        /*
         * Prevent path traversal.
         */

        const safeVersion =
            safeProductVersionName(version);

        if (!safeVersion) {
            return jsonError(
                "Invalid product version.",
                400
            );
        }

        const versionDirectory =
            path.resolve(
                productDirectory,
                "versions",
                safeVersion
            );

        const filePath =
            path.resolve(
                versionDirectory,
                fileName
            );

        if (
            !filePath.startsWith(
                `${versionDirectory}${path.sep}`
            )
        ) {
            return jsonError(
                "Invalid file path.",
                400
            );
        }

        /*
         * ------------------------------------------------
         * 8. READ PRIVATE PRODUCT FILE
         * ------------------------------------------------
         */

        let fileBuffer: Buffer;

        try {
            fileBuffer =
                await readFile(
                    filePath
                );
        } catch (error) {
            console.error(
                "PRODUCT FILE READ ERROR:",
                error
            );

            return jsonError(
                "Product file could not be found on the server.",
                404
            );
        }

        /*
         * ------------------------------------------------
         * 9. DOWNLOAD RESPONSE
         * ------------------------------------------------
         */

        const safeDownloadName =
            fileName.replace(
                /[^a-zA-Z0-9._-]/g,
                "_"
            );

        console.log(
            "SECURE PRODUCT DOWNLOAD:",
            {
                uid,
                productId,
                orderId:
                    paidOrder.id,
                licenseId:
                    activeLicense.id,
                version:
                    safeVersion,
                fileName:
                    safeDownloadName,
            }
        );

        return new NextResponse(
            fileBuffer as BodyInit,
            {
                status: 200,
                headers: {
                    "Content-Type":
                        "application/octet-stream",

                    "Content-Disposition":
                        `attachment; filename="${safeDownloadName}"`,

                    "Content-Length":
                        String(
                            fileBuffer.length
                        ),

                    "Cache-Control":
                        "private, no-store, max-age=0",

                    Pragma:
                        "no-cache",

                    "X-Content-Type-Options":
                        "nosniff",
                },
            }
        );
    } catch (error) {
        console.error(
            "SECURE DOWNLOAD ERROR:",
            error
        );

        return jsonError(
            "Internal server error.",
            500
        );
    }
}
