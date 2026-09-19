import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const tagsRef = adminDatabase.ref(`tradeTags/${user.uid}`);
        const snapshot = await tagsRef.get();

        if (!snapshot.exists()) return NextResponse.json({ success: true, tags: [] });

        const data = snapshot.val();
        const tags = Object.entries(data).map(([id, raw]) => {
            const t = raw as Record<string, unknown>;
            return {
                id,
                name: String(t.name || ""),
                color: String(t.color || "#8b5cf6"),
                trades: t.trades ? Object.keys(t.trades as Record<string, boolean>) : [],
                createdAt: Number(t.createdAt || 0),
            };
        });

        return NextResponse.json({ success: true, tags });
    } catch (err) {
        console.error("Trade tags error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json();
        const { name, color } = body;

        if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

        const tagRef = adminDatabase.ref(`tradeTags/${user.uid}`).push();
        await tagRef.set({ name, color: color || "#8b5cf6", createdAt: Date.now() });

        return NextResponse.json({ success: true, id: tagRef.key });
    } catch (err) {
        console.error("Create tag error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json();
        const { tagId } = body;
        if (!tagId) return NextResponse.json({ error: "Tag ID required" }, { status: 400 });

        await adminDatabase.ref(`tradeTags/${user.uid}/${tagId}`).remove();
        return NextResponse.json({ success: true });
    } catch (err) {
        console.error("Delete tag error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
