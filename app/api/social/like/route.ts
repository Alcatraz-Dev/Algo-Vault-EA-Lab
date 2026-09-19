import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { postId } = await request.json();
        if (!postId) return NextResponse.json({ error: "postId required" }, { status: 400 });

        const likeRef = adminDatabase.ref(`social_likes/${postId}/${user.uid}`);
        const likeSnap = await likeRef.get();

        if (likeSnap.exists()) {
            await likeRef.remove();
            await adminDatabase.ref(`social_feed/${postId}/likes`).transaction((val) => Math.max(0, (val || 1) - 1));
            return NextResponse.json({ success: true, liked: false });
        } else {
            await likeRef.set({ createdAt: Date.now() });
            await adminDatabase.ref(`social_feed/${postId}/likes`).transaction((val) => (val || 0) + 1);
            return NextResponse.json({ success: true, liked: true });
        }
    } catch (err) {
        console.error("Social like error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
