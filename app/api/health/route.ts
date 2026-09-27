// Liveness probe for connectivity checks (PWA offline banner, extension).
//
// Deliberately unauthenticated and side-effect free: callers only need a
// binary "is the app reachable" answer, so this route must never fail because
// of auth, cookies or database work. Returns 200 immediately.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
    return NextResponse.json(
        { ok: true, timestamp: Date.now() },
        { headers: { "Cache-Control": "no-store" } },
    );
}
