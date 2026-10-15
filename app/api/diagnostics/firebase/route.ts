import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// This endpoint previously exposed Firebase credential metadata and stacks.
// Keep the legacy path closed without inspecting or returning server settings.
export async function GET() {
    return NextResponse.json(
        { ok: false, error: "Not found." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
    );
}
