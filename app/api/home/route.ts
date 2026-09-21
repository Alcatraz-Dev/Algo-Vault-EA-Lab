import { NextRequest, NextResponse } from "next/server";
import { getHomeData, type HomeData } from "@/lib/home-data";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
    try {
        const data = await getHomeData();
        return NextResponse.json({ success: true, data } as { success: true; data: HomeData });
    } catch (err) {
        console.error("[api/home]", err);
        return NextResponse.json({ error: "Failed to load home data" }, { status: 500 });
    }
}
