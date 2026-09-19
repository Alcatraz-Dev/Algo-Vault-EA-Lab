import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

type WorkspacePayload = {
    name?: unknown;
    source?: unknown;
    mode?: unknown;
    nodes?: unknown;
    edges?: unknown;
    type?: unknown;
    scope?: unknown;
};

async function requireScope(
    request: NextRequest
): Promise<{ uid: string; scope: "admin" | "account" } | NextResponse> {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) {
        return NextResponse.json({ success: false, error: "Please sign in before saving." }, { status: 401 });
    }

    try {
        const token = await adminAuth.verifyIdToken(authorization.slice(7).trim());
        const scopeParam = new URL(request.url).searchParams.get("scope");
        const scope = scopeParam === "admin" ? "admin" : "account";

        if (scope === "admin") {
            const userSnapshot = await adminDatabase.ref(`users/${token.uid}`).get();
            if (userSnapshot.val()?.role !== "admin") {
                return NextResponse.json({ success: false, error: "Admin permission is required for shared workspaces." }, { status: 403 });
            }
        }

        return { uid: token.uid, scope };
    } catch (error) {
        console.error("TRADINGVIEW WORKSPACE AUTH ERROR:", error);
        return NextResponse.json({ success: false, error: "Authentication failed." }, { status: 401 });
    }
}

export async function GET(request: NextRequest) {
    const result = await requireScope(request);
    if (result instanceof NextResponse || !result) return result;

    const id = String(new URL(request.url).searchParams.get("id") || "").trim();
    if (id) {
        try {
            const workspaceRef = adminDatabase.ref(`tradingview_workspaces/${result.uid}/${id}`);
            const snapshot = await workspaceRef.get();
            const value = snapshot.val();
            if (!snapshot.exists() || value?.scope !== result.scope) {
                return NextResponse.json({ success: false, error: "Workspace not found." }, { status: 404 });
            }
            return NextResponse.json({ success: true, workspace: value });
        } catch (error) {
            console.error("TRADINGVIEW WORKSPACE LOAD ERROR:", error);
            return NextResponse.json({ success: false, error: "Unable to load the workspace." }, { status: 500 });
        }
    }

    try {
        const snapshot = await adminDatabase
            .ref(`tradingview_workspaces/${result.uid}`)
            .get();

        const workspaces: Array<Record<string, unknown>> = [];
        snapshot.forEach((child) => {
            const value = child.val();
            if (value?.scope !== result.scope) return;
            workspaces.push({
                id: child.key,
                name: value.name ?? "Untitled Pine script",
                source: value.source ?? "",
                mode: value.mode ?? "visual",
                type: value.type ?? "indicator",
                createdAt: value.createdAt ?? 0,
            });
        });
        workspaces.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));

        return NextResponse.json({ success: true, workspaces });
    } catch (error) {
        console.error("TRADINGVIEW WORKSPACE LIST ERROR:", error);
        return NextResponse.json({ success: false, error: "Unable to load workspaces." }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    const result = await requireScope(request);
    if (result instanceof NextResponse || !result) return result;

    const id = String(new URL(request.url).searchParams.get("id") || "").trim();
    if (!id) {
        return NextResponse.json({ success: false, error: "Missing workspace id." }, { status: 400 });
    }

    try {
        const workspaceRef = adminDatabase.ref(`tradingview_workspaces/${result.uid}/${id}`);
        const snapshot = await workspaceRef.get();
        if (!snapshot.exists()) {
            return NextResponse.json({ success: false, error: "Workspace not found." }, { status: 404 });
        }
        const value = snapshot.val();
        if (value?.scope !== result.scope) {
            return NextResponse.json({ success: false, error: "Workspace not found." }, { status: 404 });
        }
        await workspaceRef.remove();
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("TRADINGVIEW WORKSPACE DELETE ERROR:", error);
        return NextResponse.json({ success: false, error: "Unable to delete the workspace." }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) {
        return NextResponse.json({ success: false, error: "Please sign in before saving." }, { status: 401 });
    }

    try {
        const token = await adminAuth.verifyIdToken(authorization.slice(7).trim());
        const payload = await request.json() as WorkspacePayload;
        const name = String(payload.name || "Untitled Pine script").trim().slice(0, 100);
        const source = String(payload.source || "");
        const scope = payload.scope === "admin" ? "admin" : "account";

        if (!source || source.length > 100_000) {
            return NextResponse.json({ success: false, error: "The Pine script is missing or too large." }, { status: 400 });
        }

        if (scope === "admin") {
            const userSnapshot = await adminDatabase.ref(`users/${token.uid}`).get();
            if (userSnapshot.val()?.role !== "admin") {
                return NextResponse.json({ success: false, error: "Admin permission is required for shared workspaces." }, { status: 403 });
            }
        }

        const workspaceRef = adminDatabase.ref(`tradingview_workspaces/${token.uid}`).push();
        await workspaceRef.set({
            id: workspaceRef.key,
            name,
            source,
            mode: payload.mode === "code" ? "code" : "visual",
            nodes: Array.isArray(payload.nodes) ? payload.nodes.slice(0, 100) : [],
            edges: Array.isArray(payload.edges) ? payload.edges.slice(0, 200) : [],
            type: payload.type === "strategy" ? "strategy" : "indicator",
            scope,
            createdBy: token.uid,
            createdAt: Date.now(),
        });

        return NextResponse.json({ success: true, workspaceId: workspaceRef.key });
    } catch (error) {
        console.error("TRADINGVIEW WORKSPACE SAVE ERROR:", error);
        return NextResponse.json({ success: false, error: "Unable to save the workspace. Please try again." }, { status: 500 });
    }
}
