import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

type TradingGoal = {
    id: string;
    type: "monthly_pnl" | "win_rate" | "trade_count" | "max_drawdown" | "profit_factor" | "risk_reward" | "custom";
    title: string;
    target: number;
    current: number;
    unit: string;
    deadline: number;
    achieved: boolean;
    createdAt: number;
};

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const goalsRef = adminDatabase.ref(`goals/${user.uid}`);
        const snapshot = await goalsRef.get();

        if (!snapshot.exists()) return NextResponse.json({ success: true, goals: [] });

        const data = snapshot.val();
        const goals = Object.entries(data).map(([id, val]) => ({ id, ...(val as Omit<TradingGoal, "id">) }));
        return NextResponse.json({ success: true, goals: goals.sort((a, b) => b.createdAt - a.createdAt) });
    } catch (err) {
        console.error("Goals GET error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json();
        const { type, title, target, unit, deadline } = body;
        if (!title || !target) return NextResponse.json({ error: "title and target required" }, { status: 400 });

        const goalRef = adminDatabase.ref(`goals/${user.uid}`).push();
        const goal: Omit<TradingGoal, "id"> = {
            type: type || "custom",
            title,
            target: Number(target),
            current: 0,
            unit: unit || "",
            deadline: deadline ? Number(deadline) : Date.now() + 30 * 24 * 60 * 60 * 1000,
            achieved: false,
            createdAt: Date.now(),
        };

        await goalRef.set(goal);
        return NextResponse.json({ success: true, goal: { id: goalRef.key, ...goal } });
    } catch (err) {
        console.error("Goals POST error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json();
        const { goalId, current, achieved } = body;
        if (!goalId) return NextResponse.json({ error: "goalId required" }, { status: 400 });

        const updates: Record<string, unknown> = {};
        if (current !== undefined) updates.current = Number(current);
        if (achieved !== undefined) updates.achieved = Boolean(achieved);

        await adminDatabase.ref(`goals/${user.uid}/${goalId}`).update(updates);
        return NextResponse.json({ success: true });
    } catch (err) {
        console.error("Goals PATCH error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { goalId } = await request.json();
        if (!goalId) return NextResponse.json({ error: "goalId required" }, { status: 400 });

        await adminDatabase.ref(`goals/${user.uid}/${goalId}`).remove();
        return NextResponse.json({ success: true });
    } catch (err) {
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
