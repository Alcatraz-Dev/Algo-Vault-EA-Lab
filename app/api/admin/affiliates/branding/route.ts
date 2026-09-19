import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

const MIME_TYPES: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    svg: "image/svg+xml",
};

async function verifyAdmin(request: NextRequest) {
    const authorization =
        request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
        throw new Error("Unauthorized");
    }

    const token = authorization.substring(7);

    const decodedToken =
        await adminAuth.verifyIdToken(token);

    const userSnapshot = await adminDatabase
        .ref(`users/${decodedToken.uid}`)
        .get();

    if (
        !userSnapshot.exists() ||
        userSnapshot.val()?.role !== "admin"
    ) {
        throw new Error("Forbidden");
    }

    return decodedToken;
}

export async function GET(request: NextRequest) {
    try {
        await verifyAdmin(request);

        const { searchParams } =
            new URL(request.url);

        const offerId =
            searchParams.get("offerId");

        const type =
            searchParams.get("type") || "logo";

        if (!offerId) {
            return NextResponse.json(
                {
                    error: "Missing offerId.",
                },
                { status: 400 }
            );
        }

        if (type !== "logo") {
            return NextResponse.json(
                {
                    error: "Only logo branding is supported.",
                },
                { status: 400 }
            );
        }

        const snapshot = await adminDatabase
            .ref(`affiliate_offers/${offerId}`)
            .get();

        if (!snapshot.exists()) {
            return NextResponse.json(
                {
                    error: "Affiliate offer not found.",
                },
                { status: 404 }
            );
        }

        const offer = snapshot.val();

        const logo =
            offer?.branding?.logo;

        if (!logo?.fileName) {
            return NextResponse.json(
                {
                    error: "Logo not found.",
                },
                { status: 404 }
            );
        }

        const safeFileName = path.basename(
            String(logo.fileName)
        );

        if (
            safeFileName !==
            String(logo.fileName)
        ) {
            return NextResponse.json(
                {
                    error: "Invalid file name.",
                },
                { status: 400 }
            );
        }

        const extension =
            String(
                logo.extension ||
                path
                    .extname(safeFileName)
                    .replace(".", "")
            )
                .toLowerCase();

        const mimeType =
            MIME_TYPES[extension];

        if (!mimeType) {
            return NextResponse.json(
                {
                    error: "Unsupported image type.",
                },
                { status: 400 }
            );
        }

        const baseDirectory = path.resolve(
            process.cwd(),
            "private-files",
            "affiliates",
            offerId,
            "branding"
        );

        const filePath = path.resolve(
            baseDirectory,
            safeFileName
        );

        if (
            !filePath.startsWith(
                baseDirectory + path.sep
            )
        ) {
            return NextResponse.json(
                {
                    error: "Invalid file path.",
                },
                { status: 400 }
            );
        }

        let fileBuffer: Buffer;

        try {
            fileBuffer = await readFile(filePath);
        } catch (fileError) {
            console.error(
                "ADMIN AFFILIATE BRANDING FILE READ ERROR:",
                fileError
            );

            return NextResponse.json(
                {
                    error: "Logo file could not be found on the server.",
                },
                { status: 404 }
            );
        }

        return new NextResponse(
            new Uint8Array(fileBuffer),
            {
                status: 200,
                headers: {
                    "Content-Type": mimeType,
                    "Content-Length":
                        String(fileBuffer.length),
                    "Cache-Control":
                        "private, no-store",
                    "X-Content-Type-Options":
                        "nosniff",
                },
            }
        );
    } catch (error) {
        console.error(
            "ADMIN AFFILIATE BRANDING ERROR:",
            error
        );

        if (
            error instanceof Error &&
            error.message === "Forbidden"
        ) {
            return NextResponse.json(
                {
                    error: "Forbidden",
                },
                { status: 403 }
            );
        }

        return NextResponse.json(
            {
                error: "Unauthorized",
            },
            { status: 401 }
        );
    }
}