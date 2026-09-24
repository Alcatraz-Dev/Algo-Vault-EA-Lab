"use server";

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { requireGrowthAdmin } from "@/lib/growth/server-auth";

export async function GET(request: NextRequest) {
    try {
        const admin = await requireGrowthAdmin(request);
        if (!admin) {
            return NextResponse.json({ error: "Admin required" }, { status: 403 });
        }

        // Verify Firebase auth server-side.
        const userSnap = await adminAuth.getUser(admin.uid);
        if (!userSnap) return NextResponse.json({ error: "User not found" }, { status: 403 });

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
}
