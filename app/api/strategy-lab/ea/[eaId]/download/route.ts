import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { getGeneratedEA } from "@/lib/strategy-lab/ea-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ eaId: string }> }
) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const { eaId } = await params;
        const ea = await getGeneratedEA(token.uid, eaId);
        if (!ea) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        if (!ea.code) {
            return NextResponse.json({ error: "This EA has no source code to download." }, { status: 404 });
        }

        const fileName = `${ea.name.replace(/[^a-zA-Z0-9._-]/g, "_")}_${ea.symbol}_v${ea.eaVersion ?? ea.strategyVersion}.mq5`;

        return new NextResponse(ea.code, {
            status: 200,
            headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Content-Disposition": `attachment; filename="${fileName}"`,
                "Cache-Control": "no-store",
            },
        });
    } catch (err: unknown) {
        console.error("[strategy-lab/ea/:id/download GET]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Download failed" }, { status: 500 });
    }
}