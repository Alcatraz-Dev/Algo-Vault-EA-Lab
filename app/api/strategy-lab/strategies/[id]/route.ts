import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { deleteStrategy, getStrategy, saveStrategy } from "@/lib/strategy-lab/storage";
import { Strategy } from "@/lib/strategy-lab/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

async function resolveUid(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) return { uid: null, status: 401 as const, error: "Unauthorized" };
    return { uid: token.uid, status: 200 as const, error: null as string | null };
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { uid, status, error } = await resolveUid(request);
        if (!uid) {
            return NextResponse.json({ error }, { status, headers: corsHeaders });
        }

        const { id } = await params;
        const strategy = await getStrategy(uid, id);
        if (!strategy) {
            return NextResponse.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
        }
        return NextResponse.json({ strategy }, { status: 200, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-lab/strategies/:id GET]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500, headers: corsHeaders });
    }
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { uid, status, error } = await resolveUid(request);
        if (!uid) {
            return NextResponse.json({ error }, { status, headers: corsHeaders });
        }

        const { id } = await params;
        const existing = await getStrategy(uid, id);
        if (!existing) {
            return NextResponse.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
        }

        const body = (await request.json()) as Partial<Strategy>;
        const updated: Strategy = {
            ...existing,
            ...body,
            id,
            updated: Date.now(),
        };

        await saveStrategy(uid, updated);
        return NextResponse.json({ strategy: updated }, { status: 200, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-lab/strategies/:id PATCH]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500, headers: corsHeaders });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { uid, status, error } = await resolveUid(request);
        if (!uid) {
            return NextResponse.json({ error }, { status, headers: corsHeaders });
        }

        const { id } = await params;
        await deleteStrategy(uid, id);
        return NextResponse.json({ ok: true }, { status: 200, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-lab/strategies/:id DELETE]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500, headers: corsHeaders });
    }
}