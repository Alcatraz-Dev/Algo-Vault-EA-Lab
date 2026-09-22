import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import fs from "fs/promises";
import path from "path";
import { formatProductFileExtensions, getProductFileRule, isAllowedProductFileName, safeProductVersionName } from "@/lib/product-files";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

function safeVersion(version: string) {
    return safeProductVersionName(version);
}

export async function POST(
    request: NextRequest
) {
    try {
        /* -----------------------------------------
           1. Authentication
        ----------------------------------------- */

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
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Authentication required.",
                },
                { status: 401 }
            );
        }

        const idToken =
            authorization
                .substring(7)
                .trim();

        if (!idToken) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Invalid authentication token.",
                },
                { status: 401 }
            );
        }

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

        const adminUid =
            decodedToken.uid;

        /* -----------------------------------------
           2. Verify Admin
        ----------------------------------------- */

        const userSnapshot =
            await adminDatabase
                .ref(
                    `users/${adminUid}`
                )
                .get();

        if (!userSnapshot.exists()) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "User not found.",
                },
                { status: 403 }
            );
        }

        const user =
            userSnapshot.val();

        if (
            user.role !== "admin"
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

        /* -----------------------------------------
           3. Read Form Data
        ----------------------------------------- */

        const formData =
            await request.formData();

        const productIdValue =
            formData.get(
                "productId"
            );

        const fileValue =
            formData.get("file");

        const versionValue =
            formData.get("version");

        const productId =
            typeof productIdValue ===
                "string"
                ? productIdValue.trim()
                : "";

        const version =
            typeof versionValue ===
                "string" &&
                versionValue.trim()
                ? versionValue.trim()
                : "1.0.0";

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

        if (
            !(fileValue instanceof File)
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Product file is required.",
                },
                { status: 400 }
            );
        }

        /* -----------------------------------------
           4. Validate Product
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
           5. Validate File
        ----------------------------------------- */

        const originalFileName =
            fileValue.name;

        const fileRule = getProductFileRule(product.productType, product.platform);

        if (!isAllowedProductFileName(originalFileName, product.productType, product.platform)) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        `Only ${fileRule.description} uploads are allowed (${formatProductFileExtensions(product.productType, product.platform)}).`,
                },
                { status: 400 }
            );
        }

        if (
            fileValue.size <= 0
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "The uploaded file is empty.",
                },
                { status: 400 }
            );
        }

        if (
            fileValue.size >
            MAX_FILE_SIZE
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "File is too large. Maximum size is 50 MB.",
                },
                { status: 413 }
            );
        }

        /* -----------------------------------------
           6. Sanitize File Name + Version
        ----------------------------------------- */

        const safeFileName =
            originalFileName.replace(
                /[^a-zA-Z0-9._-]/g,
                "_"
            );


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

        /* -----------------------------------------
           7. Product Directory
        ----------------------------------------- */

        const productDirectory =
            path.join(
                process.cwd(),
                "private-files",
                "products",
                productId
            );

        const versionsDirectory =
            path.join(
                productDirectory,
                "versions"
            );

        await fs.mkdir(
            versionsDirectory,
            {
                recursive: true,
            }
        );

        /* -----------------------------------------
           8. Version Directory
        ----------------------------------------- */

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

        /* -----------------------------------------
       9. Check Duplicate Version
    ----------------------------------------- */

        const versionRef =
            productRef.child(
                `versions/${safeVersionName}`
            );

        const existingVersionSnapshot =
            await versionRef.get();

        if (
            existingVersionSnapshot.exists()
        ) {
            const existingVersion =
                existingVersionSnapshot.val();

            /*
             * Existing versions are NOT errors.
             *
             * We keep the original version and file.
             * We also DO NOT make this old version
             * the current version.
             */
            return NextResponse.json({
                success: true,

                alreadyExists: true,

                message:
                    `Version ${version} already exists. Existing version kept.`,

                productId,

                productName:
                    product.name || "",

                version,

                currentVersion:
                    product.version ||
                    product.file?.version ||
                    version,

                file:
                    existingVersion,
            });
        }

        /* -----------------------------------------
           10. Create Version Directory
        ----------------------------------------- */

        await fs.mkdir(
            versionDirectory,
            {
                recursive: true,
            }
        );

        const filePath =
            path.join(
                versionDirectory,
                safeFileName
            );

        const normalizedFile =
            path.resolve(
                filePath
            );

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
           11. Save File
        ----------------------------------------- */

        const fileBuffer =
            Buffer.from(
                await fileValue.arrayBuffer()
            );

        await fs.writeFile(
            normalizedFile,
            fileBuffer
        );

        const now =
            Date.now();

        /* -----------------------------------------
           12. Version Metadata
        ----------------------------------------- */

        const versionMetadata = {
            version,

            fileName:
                safeFileName,

            originalFileName:
                originalFileName,

            size:
                fileValue.size,

            contentType:
                fileValue.type ||
                "application/octet-stream",

            downloadEnabled:
                true,

            uploadedAt:
                now,

            uploadedBy:
                adminUid,
        };

        /* -----------------------------------------
           13. Save Version + Current File
        ----------------------------------------- */

        await productRef.update({
            [`versions/${safeVersionName}`]:
                versionMetadata,

            file: {
                ...versionMetadata,

                isCurrent:
                    true,
            },

            version,

            updatedAt:
                now,
        });

        /* -----------------------------------------
           14. Return
        ----------------------------------------- */

        return NextResponse.json({
            success: true,

            message:
                "Product file version uploaded successfully.",

            productId,

            productName:
                product.name || "",

            version,

            currentVersion:
                version,

            file:
                versionMetadata,

            versionPath:
                `versions/${safeVersionName}/${safeFileName}`,
        });

    } catch (error: unknown) {
        console.error(
            "ADMIN PRODUCT FILE VERSION UPLOAD ERROR:",
            error
        );

        return NextResponse.json(
            {
                success: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Product file upload failed.",
            },
            { status: 500 }
        );
    }
}
