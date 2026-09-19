import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import fs from "fs/promises";
import path from "path";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const productId = searchParams.get("productId");
        const fileName = searchParams.get("file");

        if (!productId || !fileName) {
            return NextResponse.json(
                { success: false, error: "productId and file are required." },
                { status: 400 }
            );
        }

        // --------------------------------------------------
        // 1. Firebase Auth
        // --------------------------------------------------
        const authorization = request.headers.get("authorization");

        if (!authorization?.startsWith("Bearer ")) {
            return NextResponse.json(
                { success: false, error: "Authentication required." },
                { status: 401 }
            );
        }

        const idToken = authorization.substring(7).trim();
        let decodedToken;

        try {
            decodedToken = await adminAuth.verifyIdToken(idToken);
        } catch {
            return NextResponse.json(
                { success: false, error: "Invalid or expired token." },
                { status: 401 }
            );
        }

        const userId = decodedToken.uid;

        // --------------------------------------------------
        // 2. Check active license for product
        // --------------------------------------------------
        const licensesSnapshot = await adminDatabase
            .ref(`licenses/${userId}`)
            .get();

        if (!licensesSnapshot.exists()) {
            return NextResponse.json(
                { success: false, error: "No active license found." },
                { status: 403 }
            );
        }

        const licenses = licensesSnapshot.val();
        const now = Date.now();

        let hasAccess = false;
        for (const licId of Object.keys(licenses)) {
            const lic = licenses[licId];
            if (
                lic &&
                lic.productId === productId &&
                lic.status === "active" &&
                Number(lic.expiresAt || 0) > now
            ) {
                hasAccess = true;
                break;
            }
        }

        // Also allow users who have a paid order (for lifetime products)
        if (!hasAccess) {
            const ordersSnapshot = await adminDatabase
                .ref(`orders/${userId}`)
                .get();
            if (ordersSnapshot.exists()) {
                const orders = ordersSnapshot.val();
                for (const orderId of Object.keys(orders)) {
                    const order = orders[orderId];
                    if (
                        order &&
                        order.productId === productId &&
                        order.status === "paid"
                    ) {
                        hasAccess = true;
                        break;
                    }
                }
            }
        }

        if (!hasAccess) {
            return NextResponse.json(
                {
                    success: false,
                    error: "You need an active license to download set files.",
                },
                { status: 403 }
            );
        }

        // --------------------------------------------------
        // 3. Secure path resolution
        // --------------------------------------------------
        const setfilesDir = path.join(
            process.cwd(),
            "private-files",
            "products",
            productId,
            "setfiles"
        );

        // Sanitize fileName — strip any path separators
        const safeFileName = path.basename(fileName);
        const filePath = path.join(setfilesDir, safeFileName);

        const normalizedRoot = path.resolve(setfilesDir);
        const normalizedFile = path.resolve(filePath);

        if (!normalizedFile.startsWith(normalizedRoot + path.sep)) {
            return NextResponse.json(
                { success: false, error: "Invalid file path." },
                { status: 400 }
            );
        }

        // --------------------------------------------------
        // 4. Check file exists
        // --------------------------------------------------
        try {
            await fs.access(normalizedFile);
        } catch {
            return NextResponse.json(
                { success: false, error: "Set file not found." },
                { status: 404 }
            );
        }

        // --------------------------------------------------
        // 5. Read & stream file
        // --------------------------------------------------
        const fileBuffer = await fs.readFile(normalizedFile);

        // Log the download
        const downloadRef = adminDatabase.ref(`set_file_downloads/${userId}`).push();
        if (downloadRef.key) {
            await downloadRef.set({
                id: downloadRef.key,
                userId,
                productId,
                fileName: safeFileName,
                downloadedAt: Date.now(),
            });
        }

        return new NextResponse(new Uint8Array(fileBuffer), {
            status: 200,
            headers: {
                "Content-Type": "application/octet-stream",
                "Content-Disposition": `attachment; filename="${safeFileName}"`,
                "Content-Length": String(fileBuffer.length),
                "Cache-Control": "private, no-store, max-age=0",
            },
        });
    } catch (error: unknown) {
        console.error("SET FILE DOWNLOAD ERROR:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Download failed." },
            { status: 500 }
        );
    }
}

// --------------------------------------------------
// List available set files for a product (authenticated)
// --------------------------------------------------
export async function POST(request: NextRequest) {
    try {
        const authorization = request.headers.get("authorization");

        if (!authorization?.startsWith("Bearer ")) {
            return NextResponse.json(
                { success: false, error: "Authentication required." },
                { status: 401 }
            );
        }

        const idToken = authorization.substring(7).trim();
        let decodedToken;

        try {
            decodedToken = await adminAuth.verifyIdToken(idToken);
        } catch {
            return NextResponse.json(
                { success: false, error: "Invalid or expired token." },
                { status: 401 }
            );
        }

        const userId = decodedToken.uid;
        const body = await request.json().catch(() => ({}));
        const { productId } = body;

        if (!productId) {
            return NextResponse.json(
                { success: false, error: "productId is required." },
                { status: 400 }
            );
        }

        // Check license access
        const licensesSnapshot = await adminDatabase.ref(`licenses/${userId}`).get();
        const now = Date.now();
        let hasAccess = false;

        if (licensesSnapshot.exists()) {
            const licenses = licensesSnapshot.val();
            for (const licId of Object.keys(licenses)) {
                const lic = licenses[licId];
                if (
                    lic &&
                    lic.productId === productId &&
                    lic.status === "active" &&
                    Number(lic.expiresAt || 0) > now
                ) {
                    hasAccess = true;
                    break;
                }
            }
        }

        if (!hasAccess) {
            const ordersSnapshot = await adminDatabase.ref(`orders/${userId}`).get();
            if (ordersSnapshot.exists()) {
                const orders = ordersSnapshot.val();
                for (const orderId of Object.keys(orders)) {
                    const order = orders[orderId];
                    if (order && order.productId === productId && order.status === "paid") {
                        hasAccess = true;
                        break;
                    }
                }
            }
        }

        if (!hasAccess) {
            return NextResponse.json(
                { success: false, error: "License required." },
                { status: 403 }
            );
        }

        // Source of truth: the `set_files` DB node (what the admin published).
        const publishedSnapshot = await adminDatabase
            .ref("set_files")
            .once("value");
        const publishedData = publishedSnapshot.val() || {};

        const files: {
            name: string;
            size: number;
            description: string;
            pair?: string;
            timeframe?: string;
            riskLevel?: string;
            fileName: string;
        }[] = [];

        for (const id of Object.keys(publishedData)) {
            const record = publishedData[id];
            if (!record || record.productId !== productId) continue;
            files.push({
                name: record.fileName || record.name || id,
                size: Number(record.size || 0),
                description: record.description || getSetFileDescription(record.fileName || record.name || ""),
                pair: record.pair,
                timeframe: record.timeframe,
                riskLevel: record.riskLevel,
                fileName: record.fileName || record.name || "",
            });
        }

        // Only files published through the admin / owner flow are exposed.
        // Files that exist on disk without a set_files record are never listed
        // (legacy demo or stray files are intentionally hidden).
        files.sort((a, b) => a.name.localeCompare(b.name));

        return NextResponse.json({ success: true, files });
    } catch (error: unknown) {
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Failed to list set files." },
            { status: 500 }
        );
    }
}

function getSetFileDescription(fileName: string): string {
    const lower = fileName.toLowerCase();
    if (lower.includes("gold") || lower.includes("xauusd")) return "Gold (XAUUSD) optimized settings";
    if (lower.includes("eurusd") || lower.includes("eur_usd")) return "EURUSD optimized settings";
    if (lower.includes("gbpusd") || lower.includes("gbp_usd")) return "GBPUSD optimized settings";
    if (lower.includes("conservative") || lower.includes("low")) return "Conservative / Low risk profile";
    if (lower.includes("aggressive") || lower.includes("high")) return "Aggressive / High growth profile";
    if (lower.includes("scalp")) return "Scalping optimized settings";
    if (lower.includes("swing")) return "Swing trading settings";
    if (lower.includes("default")) return "Default recommended settings";
    return "Optimized EA configuration file";
}
