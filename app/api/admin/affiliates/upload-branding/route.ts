import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

const ALLOWED_TYPES = ["logo"] as const;
type BrandingType = (typeof ALLOWED_TYPES)[number];

const ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "svg"];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

function safeSegment(value: string) {
    return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

function getExtension(fileName: string) {
    const parts = fileName.toLowerCase().split(".");
    return parts.length > 1 ? parts.pop() || "" : "";
}

async function verifyAdmin(request: NextRequest) {
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
        throw new Error("Unauthorized");
    }

    const token = authorization.substring("Bearer ".length);
    const decodedToken = await adminAuth.verifyIdToken(token);

    const userSnapshot = await adminDatabase
        .ref(`users/${decodedToken.uid}`)
        .once("value");

    const user = userSnapshot.val();

    if (!user || user.role !== "admin") {
        throw new Error("Forbidden");
    }

    return decodedToken;
}

export async function POST(request: NextRequest) {
    try {
        await verifyAdmin(request);

        const formData = await request.formData();

        const productIdValue = formData.get("offerId");
        const typeValue = formData.get("type");
        const file = formData.get("file");

        if (
            typeof productIdValue !== "string" ||
            !productIdValue.trim()
        ) {
            return NextResponse.json(
                { error: "Affiliate offer ID is required." },
                { status: 400 }
            );
        }

        if (
            typeof typeValue !== "string" ||
            !ALLOWED_TYPES.includes(typeValue as BrandingType)
        ) {
            return NextResponse.json(
                { error: "Invalid branding type." },
                { status: 400 }
            );
        }

        if (!(file instanceof File)) {
            return NextResponse.json(
                { error: "Logo file is required." },
                { status: 400 }
            );
        }

        const offerId = safeSegment(productIdValue.trim());

        if (!offerId) {
            return NextResponse.json(
                { error: "Invalid affiliate offer ID." },
                { status: 400 }
            );
        }

        const type = typeValue as BrandingType;

        const offerRef = adminDatabase.ref(
            `affiliate_offers/${offerId}`
        );

        const offerSnapshot = await offerRef.once("value");
        const offer = offerSnapshot.val();

        if (!offer) {
            return NextResponse.json(
                { error: "Affiliate offer not found." },
                { status: 404 }
            );
        }

        if (file.size <= 0) {
            return NextResponse.json(
                { error: "The uploaded file is empty." },
                { status: 400 }
            );
        }

        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json(
                {
                    error: "Logo must be smaller than 5 MB.",
                },
                { status: 400 }
            );
        }

        const extension = getExtension(file.name);

        if (!ALLOWED_EXTENSIONS.includes(extension)) {
            return NextResponse.json(
                {
                    error:
                        "Unsupported logo format. Use PNG, JPG, JPEG, WEBP or SVG.",
                },
                { status: 400 }
            );
        }

        const baseDirectory = path.join(
            process.cwd(),
            "private-files",
            "affiliates",
            offerId,
            "branding"
        );

        await fs.mkdir(baseDirectory, {
            recursive: true,
        });

        /*
         * Remove old logo files regardless of their previous extension.
         * This prevents logo.png + logo.webp existing simultaneously.
         */
        for (const oldExtension of ALLOWED_EXTENSIONS) {
            const oldPath = path.join(
                baseDirectory,
                `logo.${oldExtension}`
            );

            try {
                await fs.unlink(oldPath);
            } catch {
                // File does not exist - ignore.
            }
        }

        const filePath = path.join(
            baseDirectory,
            `logo.${extension}`
        );

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        await fs.writeFile(filePath, buffer);

        const branding = {
            ...(offer.branding || {}),
            [type]: {
                fileName: `logo.${extension}`,
                path: `/api/affiliate/branding?offerId=${encodeURIComponent(
                    offerId
                )}&type=${type}`,
                extension,
                size: file.size,
                uploadedAt: Date.now(),
            },
        };

        await offerRef.update({
            branding,
            updatedAt: Date.now(),
        });

        return NextResponse.json({
            success: true,
            offerId,
            type,
            branding: branding[type],
        });
    } catch (error) {
        console.error(
            "AFFILIATE BRANDING UPLOAD ERROR:",
            error
        );

        const message =
            error instanceof Error
                ? error.message
                : "Upload failed.";

        if (message === "Unauthorized") {
            return NextResponse.json(
                { error: "Unauthorized." },
                { status: 401 }
            );
        }

        if (message === "Forbidden") {
            return NextResponse.json(
                { error: "Forbidden." },
                { status: 403 }
            );
        }

        return NextResponse.json(
            {
                error:
                    "Failed to upload affiliate branding.",
            },
            { status: 500 }
        );
    }
}