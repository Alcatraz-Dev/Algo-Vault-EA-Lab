import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import type { SourceGroup } from "@/features/telegram-signals/types";

const DEFAULT_GROUPS: SourceGroup[] = [
    {
        id: "group_premium",
        name: "Premium / Strong",
        description: "High confidence VIP signal channels with full auto-execution enabled",
        enabled: true,
        autoExecution: true,
        riskMultiplier: 1.0,
        expirationMinutes: 240,
        notificationEnabled: true,
        createdAt: Date.now(),
    },
    {
        id: "group_standard",
        name: "Standard / Medium",
        description: "Standard signal sources with moderate risk parameters",
        enabled: true,
        autoExecution: true,
        riskMultiplier: 0.75,
        expirationMinutes: 180,
        notificationEnabled: true,
        createdAt: Date.now(),
    },
    {
        id: "group_testing",
        name: "Testing / Experimental",
        description: "Experimental sources for testing parser accuracy. Auto-execution OFF",
        enabled: true,
        autoExecution: false,
        riskMultiplier: 0.0,
        expirationMinutes: 120,
        notificationEnabled: true,
        createdAt: Date.now(),
    },
    {
        id: "group_blocked",
        name: "Blocked",
        description: "Disabled/Blacklisted sources. Ingestion and execution OFF",
        enabled: false,
        autoExecution: false,
        riskMultiplier: 0.0,
        expirationMinutes: 0,
        notificationEnabled: false,
        createdAt: Date.now(),
    },
];

export async function GET(request: NextRequest) {
    try {
        const adminToken = await requireAdmin(request);
        if (!adminToken) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        const snap = await adminDatabase.ref("telegramGroups").once("value");

        if (!snap.exists()) {
            // Seed default groups
            for (const group of DEFAULT_GROUPS) {
                await adminDatabase.ref(`telegramGroups/${group.id}`).set(group);
            }
            return NextResponse.json({ success: true, groups: DEFAULT_GROUPS });
        }

        const groupsObj = snap.val();
        const groups: SourceGroup[] = Object.values(groupsObj);
        return NextResponse.json({ success: true, groups });
    } catch (err: any) {
        console.error("[GET /api/admin/telegram/groups]", err);
        return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const adminToken = await requireAdmin(request);
        if (!adminToken) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const { name, description, autoExecution, riskMultiplier, expirationMinutes } = body;

        if (!name || typeof name !== "string") {
            return NextResponse.json({ error: "Group name is required" }, { status: 400 });
        }

        const groupId = `group_${Date.now()}`;
        const newGroup: SourceGroup = {
            id: groupId,
            name: name.trim(),
            description: description ? String(description) : undefined,
            enabled: true,
            autoExecution: Boolean(autoExecution),
            riskMultiplier: Number(riskMultiplier || 1.0),
            expirationMinutes: Number(expirationMinutes || 180),
            notificationEnabled: true,
            createdAt: Date.now(),
        };

        await adminDatabase.ref(`telegramGroups/${groupId}`).set(newGroup);

        return NextResponse.json({ success: true, group: newGroup });
    } catch (err: any) {
        console.error("[POST /api/admin/telegram/groups]", err);
        return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const adminToken = await requireAdmin(request);
        if (!adminToken) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const { groupId, ...updates } = body;

        if (!groupId) {
            return NextResponse.json({ error: "groupId is required" }, { status: 400 });
        }

        const groupRef = adminDatabase.ref(`telegramGroups/${groupId}`);
        const snap = await groupRef.once("value");

        if (!snap.exists()) {
            return NextResponse.json({ error: "Group not found" }, { status: 404 });
        }

        const current = snap.val();
        const updatedGroup: SourceGroup = {
            ...current,
            ...updates,
        };

        await groupRef.set(updatedGroup);

        return NextResponse.json({ success: true, group: updatedGroup });
    } catch (err: any) {
        console.error("[PUT /api/admin/telegram/groups]", err);
        return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const adminToken = await requireAdmin(request);
        if (!adminToken) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const groupId = searchParams.get("groupId");

        if (!groupId) {
            return NextResponse.json({ error: "groupId is required" }, { status: 400 });
        }

        await adminDatabase.ref(`telegramGroups/${groupId}`).remove();

        return NextResponse.json({ success: true, message: "Group deleted successfully" });
    } catch (err: any) {
        console.error("[DELETE /api/admin/telegram/groups]", err);
        return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
    }
}
