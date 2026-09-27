// AlgoVault Agent IDE — Run API
//
// Auth-first: every request must carry a valid Firebase ID token of an admin
// user (requireAdmin). Non-admins get 403 without any agent capability being
// exercised. The runtime independently refuses unverified project roots.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { errMessage } from "@/lib/admin-auth";
import { AgentRuntime } from "@/lib/agent/core/runtime";
import type { AgentMode } from "@/lib/agent/core/types";
import { AGENT_MODES } from "@/lib/agent/core/types";

// One runtime per server process (confirmations are process-local by design).
const globalForAgent = globalThis as unknown as { __algoVaultAgentRuntime?: AgentRuntime };
const runtime = globalForAgent.__algoVaultAgentRuntime ?? new AgentRuntime();
globalForAgent.__algoVaultAgentRuntime = runtime;

export async function POST(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 });
    }

    try {
        const body = (await request.json()) as {
            request?: unknown;
            mode?: unknown;
            confirmations?: unknown;
            permissionOverrides?: unknown;
            action?: unknown;
            runId?: unknown;
            confirmCode?: unknown;
        };

        const action = body.action ?? "start";

        // ── Cancel ──────────────────────────────────────────────────────
        if (action === "cancel") {
            if (typeof body.runId !== "string") {
                return NextResponse.json({ error: "runId is required." }, { status: 400 });
            }
            const cancelled = runtime.cancelRun(body.runId);
            return NextResponse.json({ cancelled }, { status: cancelled ? 200 : 404 });
        }

        // ── Confirm ─────────────────────────────────────────────────────
        if (action === "confirm") {
            if (typeof body.runId !== "string" || typeof body.confirmCode !== "string") {
                return NextResponse.json({ error: "runId and confirmCode are required." }, { status: 400 });
            }
            const granted = runtime.grantConfirmation(body.runId, body.confirmCode);
            return NextResponse.json({ granted }, { status: granted ? 200 : 404 });
        }

        // ── Start ───────────────────────────────────────────────────────
        if (typeof body.request !== "string" || body.request.trim() === "") {
            return NextResponse.json({ error: "request is required." }, { status: 400 });
        }
        const mode = (typeof body.mode === "string" && (AGENT_MODES as readonly string[]).includes(body.mode))
            ? (body.mode as AgentMode)
            : "ask";
        if (typeof body.request !== "string" || body.request.length > 8_000) {
            return NextResponse.json({ error: "request exceeds the 8,000 character limit." }, { status: 400 });
        }

        const result = await runtime.startRun({
            uid: admin.uid,
            request: body.request,
            mode,
            confirmations: Array.isArray(body.confirmations) ? body.confirmations.filter((c): c is string => typeof c === "string") : [],
            permissionOverrides: Array.isArray(body.permissionOverrides)
                ? body.permissionOverrides.filter((p): p is string => typeof p === "string")
                : [],
        });

        if (result.runId === null) {
            // Scope refusal / root verification failure — a 422 keeps the reason visible.
            return NextResponse.json({ error: result.error, code: result.code }, { status: 422 });
        }

        return NextResponse.json({ runId: result.runId, mode });
    } catch (err) {
        return NextResponse.json({ error: errMessage(err) }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 });
    }

    const runId = request.nextUrl.searchParams.get("runId");
    if (!runId) {
        return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }

    const status = runtime.getStatus(runId);
    if (!status) {
        return NextResponse.json({ error: "Run not found (it may have completed and been archived)." }, { status: 404 });
    }
    return NextResponse.json(status);
}
