"use server";

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";

export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const decoded = await adminAuth.verifyIdToken(token);
        if (!decoded.admin && decoded.role !== "admin") {
            return NextResponse.json({ error: "Admin required" }, { status: 403 });
        }

        // Verify Firebase auth server-side.
        const userSnap = await adminAuth.getUser(decoded.uid);
        if (!userSnap) return NextResponse.json({ error: "User not found" }, { status: 403 });

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
}
