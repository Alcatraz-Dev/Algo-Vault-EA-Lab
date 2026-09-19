import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { authenticate } from "@/lib/admin-auth";
import { getGeneratedEA, updateGeneratedEA } from "@/lib/strategy-lab/ea-storage";
import { safeProductVersionName } from "@/lib/product-files";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

/** Deterministic marketplace product id: ea_{strategyId}_{version}_{symbol}. */
export function eaProductId(strategyId: string, version: string, symbol: string): string {
    const clean = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    return `ea_${clean(strategyId)}_${clean(version)}_${clean(symbol)}`;
}

/**
 * Publishes a generated EA to the Marketplace:
 *   - writes the .mq5 source into private-files/products/{productId}/versions/{version}/
 *   - creates/updates the catalog record at bots/{productId}
 * Both paths are the SAME ones the existing buy flow — checkout, license
 * grant, and `products/download` (license-gated file downloads) — already use.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ eaId: string }> }
) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const uid = token.uid;
        const { eaId } = await params;
        const ea = await getGeneratedEA(uid, eaId);
        if (!ea) {
            return NextResponse.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
        }
        if (!ea.code) {
            return NextResponse.json({ error: "This EA has no source code to publish." }, { status: 400, headers: corsHeaders });
        }

        const body = (await request.json().catch(() => ({}))) as {
            name?: string;
            description?: string;
            price?: number;
            currency?: string;
        };

        const productId = ea.marketplace?.productId ?? eaProductId(ea.strategyId, ea.strategyVersion, ea.symbol);
        const version = ea.eaVersion ?? "1.0.0";
        const safeVersion = safeProductVersionName(version);
        if (!safeVersion) {
            return NextResponse.json({ error: "Invalid EA version for marketplace file layout." }, { status: 400, headers: corsHeaders });
        }

        const fileName = `${ea.name.replace(/[^a-zA-Z0-9._-]/g, "_")}_${ea.symbol}_v${version}.mq5`;

        const productRef = adminDatabase.ref(`bots/${productId}`);
        const existing = (await productRef.get()).val() as Record<string, unknown> | null;

        if (existing && String(existing.developerUid ?? "") !== uid) {
            return NextResponse.json(
                { error: "A marketplace product with this identifier already belongs to another account." },
                { status: 409, headers: corsHeaders }
            );
        }

        const existingVersion = (existing?.versions as Record<string, unknown> | undefined)?.[safeVersion];
        const price = Number(body.price ?? 0);
        const currency = String(body.currency ?? "usd").toLowerCase();
        const now = Date.now();

        // 1. Write the file into the private product tree (same layout as the
        //    admin upload flow and the license-gated download route).
        const versionDirectory = path.join(process.cwd(), "private-files", "products", productId, "versions", safeVersion);
        const filePath = path.join(versionDirectory, fileName);
        const normalizedRoot = path.resolve(path.join(process.cwd(), "private-files", "products", productId, "versions"));
        const normalizedFile = path.resolve(filePath);
        if (!normalizedFile.startsWith(normalizedRoot + path.sep)) {
            return NextResponse.json({ error: "Invalid publish path." }, { status: 400, headers: corsHeaders });
        }
        await fs.mkdir(versionDirectory, { recursive: true });
        await fs.writeFile(normalizedFile, ea.code, "utf8");

        // 2. Version metadata (mirrors the admin upload-file record shape).
        const fileMeta = {
            version,
            fileName,
            originalFileName: fileName,
            size: Buffer.byteLength(ea.code, "utf8"),
            contentType: "text/plain",
            downloadEnabled: true,
            uploadedAt: existingVersion && !ea.marketplace ? (existingVersion as { uploadedAt?: number }).uploadedAt ?? now : now,
            uploadedBy: uid,
            isCurrent: true,
        };

        // 3. Catalog record — fields the checkout / download / reviews /
        //    performance routes rely on.
        const product = {
            name: String(body.name ?? ea.name).trim() || ea.name,
            slug: eaProductId(ea.strategyId, ea.strategyVersion, ea.symbol),
            description: String(body.description ?? "").trim(),
            productType: "expert_advisor",
            platform: "mt5",
            symbol: ea.symbol,
            timeframe: ea.timeframe,
            developer: "AlgoVault Strategy Lab",
            developerUid: uid,
            sellerType: "developer",
            imageUrl: "",
            images: [],
            videoUrl: "",
            version,
            pricing: {
                type: price > 0 ? "paid" : "free",
                price,
                currency: currency || "usd",
            },
            performance: {},
            risk: { level: "Medium" },
            rating: { average: 0, count: 0 },
            downloads: 0,
            status: "published",
            file: fileMeta,
            [`versions/${safeVersion}`]: fileMeta,
            strategyId: ea.strategyId,
            strategyVersion: ea.strategyVersion,
            strategyHash: ea.strategyHash,
            magicNumber: ea.magicNumber,
            generatedAt: ea.createdAt,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };

        await productRef.set(product);

        await updateGeneratedEA(uid, eaId, {
            marketplaceProductId: productId,
            marketplace: {
                productId,
                status: "published",
                version,
                fileName,
                publishedAt: now,
            },
        });

        return NextResponse.json(
            {
                success: true,
                productId,
                version,
                fileName,
                filePath: `versions/${safeVersion}/${fileName}`,
                price,
                alreadyExists: Boolean(existing && (existing as { versions?: unknown }).versions),
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[strategy-lab/ea/:id/publish POST]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Unable to publish EA" }, { status: 500, headers: corsHeaders });
    }
}