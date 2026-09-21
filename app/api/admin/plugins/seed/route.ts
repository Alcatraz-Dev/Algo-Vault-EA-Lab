import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { serverError, unauthorized } from "@/lib/plugins/api-helpers";
import { seedPluginCatalog, catalogSnapshot } from "@/lib/plugins/seed";

export async function POST(request: NextRequest) {
    try {
        const admin = await requireAdmin(request);
        if (!admin) return unauthorized();
        const result = await seedPluginCatalog();
        const snapshot = await catalogSnapshot();
        return NextResponse.json({ success: true, ...result, snapshot });
    } catch (err) {
        return serverError(err, "Catalog seeding failed.");
    }
}

export async function GET(request: NextRequest) {
    try {
        const admin = await requireAdmin(request);
        if (!admin) return unauthorized();
        const snapshot = await catalogSnapshot();
        return NextResponse.json({ success: true, snapshot });
    } catch (err) {
        return serverError(err);
    }
}

export const dynamic = "force-dynamic";