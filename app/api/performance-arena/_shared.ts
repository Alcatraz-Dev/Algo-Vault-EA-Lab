// Shared helpers for Performance Arena routes.
//
// Auth model: every arena route requires a Firebase bearer token
// (`authenticate`). Ownership is enforced by the service layer (owner-scoped
// store paths). Cash-reward endpoints reject server-side regardless of input.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { ArenaError } from "@/lib/performance-arena";

export const arenaCorsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function arenaOPTIONS() {
    return NextResponse.json(null, { status: 204, headers: arenaCorsHeaders });
}

export function arenaJson(body: unknown, status = 200): NextResponse {
    return NextResponse.json(body, { status, headers: arenaCorsHeaders });
}

export function arenaError(error: unknown, fallback: string): NextResponse {
    if (error instanceof ArenaError) {
        return NextResponse.json(
            { error: error.message, code: error.code, details: error.details ?? undefined },
            { status: error.status, headers: arenaCorsHeaders }
        );
    }
    console.error("[performance-arena]", error);
    return NextResponse.json(
        { error: error instanceof Error ? error.message : fallback },
        { status: 500, headers: arenaCorsHeaders }
    );
}

/** Authenticate and return the uid or a ready 401 response. */
export async function arenaAuth(
    request: NextRequest
): Promise<{ uid: string } | { response: NextResponse }> {
    const token = await authenticate(request);
    if (!token) {
        return {
            response: NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: arenaCorsHeaders }),
        };
    }
    return { uid: token.uid };
}
