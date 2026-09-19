import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { adminDatabase } from "@/lib/firebase-admin";

const MIME_TYPES: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    svg: "image/svg+xml",
};

const ALLOWED_EXTENSIONS = [
    "png",
    "jpg",
    "jpeg",
    "webp",
    "svg",
];

function safeSegment(value: string) {
    return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

function getExtension(fileName: string) {
    return path
        .extname(fileName)
        .replace(".", "")
        .toLowerCase();
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);

        const offerIdValue = searchParams.get("offerId");
        const type = searchParams.get("type");

        if (!offerIdValue || type !== "logo") {
            return new NextResponse("Invalid request.", {
                status: 400,
            });
        }

        const offerId = safeSegment(
            offerIdValue.trim()
        );

        if (!offerId) {
            return new NextResponse(
                "Invalid offer ID.",
                {
                    status: 400,
                }
            );
        }

        console.log(
            "AFFILIATE LOGO REQUEST:",
            offerId
        );

        /*
         * Load affiliate offer from Firebase.
         */
        const snapshot = await adminDatabase
            .ref(`affiliate_offers/${offerId}`)
            .once("value");

        const offer = snapshot.val();

        if (!offer) {
            console.error(
                "AFFILIATE OFFER NOT FOUND:",
                offerId
            );

            return new NextResponse(
                "Affiliate offer not found.",
                {
                    status: 404,
                }
            );
        }

        /*
         * Public page can only access active offers.
         */
        if (offer.status !== "active") {
            console.error(
                "AFFILIATE OFFER NOT ACTIVE:",
                offerId,
                offer.status
            );

            return new NextResponse(
                "Not found.",
                {
                    status: 404,
                }
            );
        }

        const branding = offer.branding?.logo;

        /*
         * IMPORTANT:
         * We first use the filename stored in Firebase.
         */
        let fileName = branding?.fileName
            ? path.basename(
                String(branding.fileName)
            )
            : "";

        const baseDirectory = path.resolve(
            process.cwd(),
            "private-files",
            "affiliates",
            offerId,
            "branding"
        );

        console.log(
            "AFFILIATE LOGO DIRECTORY:",
            baseDirectory
        );

        /*
         * If Firebase has no filename, look for logo.*
         * directly inside the branding directory.
         */
        if (!fileName) {
            console.log(
                "NO LOGO METADATA - SEARCHING DIRECTORY"
            );

            try {
                const files =
                    await fs.readdir(
                        baseDirectory
                    );

                const foundFile = files.find(
                    (name) => {
                        const extension =
                            getExtension(name);

                        return (
                            name
                                .toLowerCase()
                                .startsWith("logo.") &&
                            ALLOWED_EXTENSIONS.includes(
                                extension
                            )
                        );
                    }
                );

                if (foundFile) {
                    fileName = foundFile;

                    console.log(
                        "LOGO FILE FOUND:",
                        fileName
                    );
                }
            } catch (directoryError) {
                console.error(
                    "LOGO DIRECTORY READ ERROR:",
                    directoryError
                );
            }
        }

        if (!fileName) {
            console.error(
                "LOGO FILE NAME NOT FOUND IN FIREBASE OR FILESYSTEM:",
                {
                    offerId,
                    branding,
                }
            );

            return new NextResponse(
                "Logo not found.",
                {
                    status: 404,
                }
            );
        }

        /*
         * Only allow known image extensions.
         */
        const extension =
            getExtension(fileName);

        if (!MIME_TYPES[extension]) {
            console.error(
                "INVALID LOGO EXTENSION:",
                extension
            );

            return new NextResponse(
                "Invalid file type.",
                {
                    status: 400,
                }
            );
        }

        /*
         * Protect against path traversal.
         */
        const filePath = path.resolve(
            baseDirectory,
            fileName
        );

        if (
            !filePath.startsWith(
                baseDirectory + path.sep
            )
        ) {
            console.error(
                "INVALID LOGO PATH:",
                filePath
            );

            return new NextResponse(
                "Invalid path.",
                {
                    status: 400,
                }
            );
        }

        console.log(
            "READING AFFILIATE LOGO:",
            filePath
        );

        /*
         * Read actual file.
         */
        let fileBuffer: Buffer;

        try {
            fileBuffer =
                await fs.readFile(
                    filePath
                );
        } catch (fileError) {
            console.error(
                "AFFILIATE LOGO FILE READ ERROR:",
                {
                    filePath,
                    fileError,
                    branding,
                }
            );

            /*
             * Firebase may contain an old filename.
             * Search the directory one more time for the
             * current logo file.
             */
            try {
                const files =
                    await fs.readdir(
                        baseDirectory
                    );

                const fallbackFile =
                    files.find(
                        (name) => {
                            const ext =
                                getExtension(
                                    name
                                );

                            return (
                                name
                                    .toLowerCase()
                                    .startsWith(
                                        "logo."
                                    ) &&
                                ALLOWED_EXTENSIONS.includes(
                                    ext
                                )
                            );
                        }
                    );

                if (!fallbackFile) {
                    return new NextResponse(
                        "Logo file not found.",
                        {
                            status: 404,
                        }
                    );
                }

                const fallbackPath =
                    path.resolve(
                        baseDirectory,
                        fallbackFile
                    );

                if (
                    !fallbackPath.startsWith(
                        baseDirectory +
                        path.sep
                    )
                ) {
                    return new NextResponse(
                        "Invalid path.",
                        {
                            status: 400,
                        }
                    );
                }

                console.log(
                    "USING FALLBACK LOGO:",
                    fallbackPath
                );

                fileBuffer =
                    await fs.readFile(
                        fallbackPath
                    );

                const fallbackExtension =
                    getExtension(
                        fallbackFile
                    );

                return new NextResponse(
                    new Uint8Array(fileBuffer),
                    {
                        status: 200,
                        headers: {
                            "Content-Type":
                                MIME_TYPES[
                                fallbackExtension
                                ],
                            "Cache-Control":
                                "public, max-age=3600, stale-while-revalidate=86400",
                            "X-Content-Type-Options":
                                "nosniff",
                        },
                    }
                );
            } catch (fallbackError) {
                console.error(
                    "AFFILIATE LOGO FALLBACK ERROR:",
                    fallbackError
                );

                return new NextResponse(
                    "Logo file could not be loaded.",
                    {
                        status: 404,
                    }
                );
            }
        }

        /*
         * Return logo.
         */
        return new NextResponse(
            new Uint8Array(fileBuffer),
            {
                status: 200,
                headers: {
                    "Content-Type":
                        MIME_TYPES[extension],
                    "Cache-Control":
                        "public, max-age=3600, stale-while-revalidate=86400",
                    "X-Content-Type-Options":
                        "nosniff",
                },
            }
        );
    } catch (error) {
        console.error(
            "AFFILIATE BRANDING READ ERROR:",
            error
        );

        return new NextResponse(
            "Affiliate branding could not be loaded.",
            {
                status: 404,
            }
        );
    }
}