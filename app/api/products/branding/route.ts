import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { adminDatabase } from "@/lib/firebase-admin";

const ALLOWED_TYPES = [
    "icon",
    "logo",
    "banner",
] as const;

type BrandingType =
    (typeof ALLOWED_TYPES)[number];

const MIME_TYPES: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
};

function isValidType(
    value: string
): value is BrandingType {
    return ALLOWED_TYPES.includes(
        value as BrandingType
    );
}

export async function GET(
    request: NextRequest
) {
    try {
        const productId =
            request.nextUrl.searchParams.get(
                "productId"
            );

        const type =
            request.nextUrl.searchParams.get(
                "type"
            );

        if (!productId || !type) {
            return new NextResponse(
                "Missing parameters.",
                { status: 400 }
            );
        }

        if (!isValidType(type)) {
            return new NextResponse(
                "Invalid branding type.",
                { status: 400 }
            );
        }

        /*
         * Only published products can expose
         * branding publicly.
         */
        const productSnapshot =
            await adminDatabase
                .ref(`bots/${productId}`)
                .get();

        if (!productSnapshot.exists()) {
            return new NextResponse(
                "Product not found.",
                { status: 404 }
            );
        }

        const product =
            productSnapshot.val();

        if (
            product.status !==
            "published"
        ) {
            return new NextResponse(
                "Product not available.",
                { status: 404 }
            );
        }

        const branding =
            product.branding?.[type];

        if (!branding?.fileName) {
            return new NextResponse(
                "Branding not found.",
                { status: 404 }
            );
        }

        const fileName =
            path.basename(
                String(
                    branding.fileName
                )
            );

        const extension =
            path
                .extname(fileName)
                .toLowerCase()
                .replace(".", "");

        const mimeType =
            MIME_TYPES[extension];

        if (!mimeType) {
            return new NextResponse(
                "Unsupported image type.",
                { status: 400 }
            );
        }

        /*
         * Branding is stored outside public/.
         */
        const filePath = path.join(
            process.cwd(),
            "private-files",
            "products",
            productId,
            "branding",
            fileName
        );

        const baseDirectory =
            path.resolve(
                process.cwd(),
                "private-files",
                "products",
                productId,
                "branding"
            );

        const resolvedPath =
            path.resolve(filePath);

        if (
            !resolvedPath.startsWith(
                `${baseDirectory}${path.sep}`
            )
        ) {
            return new NextResponse(
                "Invalid file path.",
                { status: 400 }
            );
        }

        let fileBuffer: Buffer;

        try {
            fileBuffer =
                await readFile(
                    resolvedPath
                );
        } catch {
            return new NextResponse(
                "Branding file not found.",
                { status: 404 }
            );
        }

        return new NextResponse(
            fileBuffer as BodyInit,
            {
                status: 200,
                headers: {
                    "Content-Type":
                        mimeType,

                    "Cache-Control":
                        "public, max-age=3600",

                    "X-Content-Type-Options":
                        "nosniff",
                },
            }
        );
    } catch (error) {
        console.error(
            "BRANDING SERVE ERROR:",
            error
        );

        return new NextResponse(
            "Internal server error.",
            { status: 500 }
        );
    }
}