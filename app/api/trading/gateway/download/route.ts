import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { readGatewayDistributable } from "@/lib/gateway-distribution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/trading/gateway/download
 *
 * Returns the real AlgoVault Gateway EA distributable (the `.mq5` source) as a
 * binary attachment. Access requires an authenticated account, matching the
 * Trading Access page that hosts the button — the Gateway token itself is
 * minted separately and requires an active trading license.
 *
 * The route never fabricates an artifact: when the source is missing or not an
 * MQL5 expert it responds 503 with a JSON error instead of an HTML 404 page.
 */
export async function GET(request: NextRequest) {
    const caller = await authenticate(request);
    if (!caller) {
        return NextResponse.json(
            { error: "Unauthorized." },
            { status: 401, headers: { "Cache-Control": "no-store" } },
        );
    }

    try {
        const artifact = await readGatewayDistributable();
        // Blob is the portable BodyInit for a binary attachment in Next's
        // typed route handlers (a raw Uint8Array is not accepted).
        const body = new Blob([artifact.body as BlobPart], { type: artifact.contentType });
        return new NextResponse(body, {
            status: 200,
            headers: {
                "Content-Type": artifact.contentType,
                "Content-Disposition": `attachment; filename="${artifact.filename}"`,
                "Content-Length": String(artifact.contentLength),
                "Cache-Control": "private, no-store",
                ETag: artifact.etag,
                "X-AlgoVault-Gateway-Version": artifact.version,
                "X-AlgoVault-Gateway-Kind": artifact.kind,
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (error) {
        console.error("[trading/gateway/download]", error);
        return NextResponse.json(
            {
                error:
                    "The Gateway EA distributable is unavailable. Nothing was downloaded — please contact support.",
            },
            { status: 503, headers: { "Cache-Control": "no-store" } },
        );
    }
}
