import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

type SocialPost = {
    id: string;
    userId: string;
    displayName: string;
    avatarUrl?: string;
    type: "trade" | "analysis" | "idea" | "result";
    symbol?: string;
    direction?: "BUY" | "SELL";
    entryPrice?: number;
    stopLoss?: number;
    takeProfit?: number;
    result?: "win" | "loss" | "breakeven";
    pnl?: number;
    title: string;
    content: string;
    tags?: string[];
    likes: number;
    comments: number;
    likedByUser: boolean;
    createdAt: number;
};

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const limit = Number(request.nextUrl.searchParams.get("limit") || 20);
        const before = Number(request.nextUrl.searchParams.get("before") || 0);

        const feedRef = adminDatabase.ref("social_feed");
        let query = feedRef.orderByChild("createdAt");
        if (before > 0) query = query.endAt(before - 1);
        const snapshot = await query.limitToLast(limit).get();

        const posts: SocialPost[] = [];
        if (snapshot.exists()) {
            const data = snapshot.val();
            for (const [id, postRaw] of Object.entries(data)) {
                const p = postRaw as Record<string, unknown>;
                posts.push({
                    id,
                    userId: String(p.userId || ""),
                    displayName: String(p.displayName || "Trader"),
                    avatarUrl: p.avatarUrl ? String(p.avatarUrl) : undefined,
                    type: (p.type as SocialPost["type"]) || "idea",
                    symbol: p.symbol ? String(p.symbol) : undefined,
                    direction: p.direction as SocialPost["direction"],
                    entryPrice: p.entryPrice ? Number(p.entryPrice) : undefined,
                    stopLoss: p.stopLoss ? Number(p.stopLoss) : undefined,
                    takeProfit: p.takeProfit ? Number(p.takeProfit) : undefined,
                    result: p.result as SocialPost["result"],
                    pnl: p.pnl ? Number(p.pnl) : undefined,
                    title: String(p.title || ""),
                    content: String(p.content || ""),
                    tags: p.tags ? (Object.values(p.tags) as string[]) : [],
                    likes: Number(p.likes || 0),
                    comments: Number(p.comments || 0),
                    likedByUser: false,
                    createdAt: Number(p.createdAt || 0),
                });
            }
        }

        // Check liked status
        for (const post of posts) {
            const likeSnap = await adminDatabase.ref(`social_likes/${post.id}/${user.uid}`).get();
            post.likedByUser = likeSnap.exists();
        }

        posts.sort((a, b) => b.createdAt - a.createdAt);
        return NextResponse.json({ success: true, posts });
    } catch (err) {
        console.error("Social feed GET error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json();
        const { type, symbol, direction, entryPrice, stopLoss, takeProfit, title, content, tags } = body;
        if (!title || !content) return NextResponse.json({ error: "title and content required" }, { status: 400 });

        const postRef = adminDatabase.ref("social_feed").push();
        const post = {
            userId: user.uid,
            displayName: user.name || user.email?.split("@")[0] || "Trader",
            avatarUrl: user.picture || null,
            type: type || "idea",
            symbol: symbol ? symbol.toUpperCase() : null,
            direction: direction || null,
            entryPrice: entryPrice ? Number(entryPrice) : null,
            stopLoss: stopLoss ? Number(stopLoss) : null,
            takeProfit: takeProfit ? Number(takeProfit) : null,
            result: null,
            pnl: null,
            title,
            content,
            tags: tags || null,
            likes: 0,
            comments: 0,
            createdAt: Date.now(),
        };

        await postRef.set(post);

        return NextResponse.json({ success: true, post: { id: postRef.key, ...post } });
    } catch (err) {
        console.error("Social feed POST error:", err);
        return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { postId } = await request.json();
        if (!postId) return NextResponse.json({ error: "postId required" }, { status: 400 });

        const postSnap = await adminDatabase.ref(`social_feed/${postId}`).get();
        if (!postSnap.exists() || (postSnap.val() as any).userId !== user.uid) {
            return NextResponse.json({ error: "Not found or not authorized" }, { status: 403 });
        }

        await adminDatabase.ref(`social_feed/${postId}`).remove();
        return NextResponse.json({ success: true });
    } catch (err) {
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
