import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { getGeneratedEA, deleteGeneratedEA, toEAView } from "@/lib/strategy-lab/ea-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ eaId: string }> }
) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const { eaId } = await params;
        const ea = await getGeneratedEA(token.uid, eaId);
        if (!ea) {
            return NextResponse.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
        }
        const includeCode = request.nextUrl.searchParams.get("code") === "1" || request.nextUrl.searchParams.get("code") === "true";
        return NextResponse.json({ ea: toEAView(ea, includeCode) }, { status: 200, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-lab/ea/:id GET]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500, headers: corsHeaders });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ eaId: string }> }
) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const { eaId } = await params;
        const ea = await getGeneratedEA(token.uid, eaId);
        if (!ea) {
            return NextResponse.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
        }
        await deleteGeneratedEA(token.uid, eaId);
        return NextResponse.json({ success: true, eaId }, { status: 200, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-lab/ea/:id DELETE]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to delete EA" }, { status: 500, headers: corsHeaders });
    }
}