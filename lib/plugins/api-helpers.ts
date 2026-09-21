import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";

/** JSON response helpers for plugin API routes. */
export function unauthorized(): NextResponse {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

export function badRequest(error: string): NextResponse {
    return NextResponse.json({ error }, { status: 400 });
}

export function notFound(error = "Not found."): NextResponse {
    return NextResponse.json({ error }, { status: 404 });
}

export function serverError(error: unknown, fallback = "Request failed."): NextResponse {
    const message = error instanceof Error ? error.message : fallback;
    console.error("[plugins][api]", message, error);
    return NextResponse.json({ error: message }, { status: 500 });
}

/** Verifies the request and returns the Firebase UID or null. */
export async function authUid(request: NextRequest): Promise<string | null> {
    try {
        const token = await authenticate(request);
        return token?.uid || null;
    } catch {
        return null;
    }
}

export function revokedError(): string {
    return "Your session has expired. Sign in again to continue.";
}