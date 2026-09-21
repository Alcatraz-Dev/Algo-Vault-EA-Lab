import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { runDueTasks } from "@/lib/plugins/runtime/engine";
import { adminDatabase } from "@/lib/firebase-admin";

/**
 * Runtime scheduler tick — invoked by a cron/worker (vercel.json) or by an
 * admin token for on-demand sweeps. Runs every due plugin across all users.
 *
 * Auth: when PLUGIN_RUNTIME_CRON_SECRET is configured the request must send
 * `x-cron-secret`; otherwise an admin Bearer token is accepted. If neither
 * auth path is available the endpoint reports a clear configuration error
 * instead of pretending to run.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
    return handleTick(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    return handleTick(request);
}

async function handleTick(request: NextRequest): Promise<NextResponse> {
    const secret = process.env.PLUGIN_RUNTIME_CRON_SECRET;
    const headerSecret = request.headers.get("x-cron-secret") || "";
    const querySecret = new URL(request.url).searchParams.get("secret") || "";
    const isVercelCron = (request.headers.get("user-agent") || "").toLowerCase().includes("vercel-cron");

    if (secret) {
        if (headerSecret !== secret && querySecret !== secret && !isVercelCron) {
            return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
        }
    } else if (!isVercelCron) {
        const authorization = request.headers.get("authorization") || "";
        if (!authorization.startsWith("Bearer ")) {
            return NextResponse.json(
                { error: "Plugin runtime tick is not configured for public access. Set PLUGIN_RUNTIME_CRON_SECRET or call with an admin token." },
                { status: 503 }
            );
        }
        try {
            const token = await adminAuth.verifyIdToken(authorization.slice(7));
            const userSnap = await adminDatabase.ref(`users/${token.uid}`).get();
            if (!userSnap.exists() || userSnap.val()?.role !== "admin") {
                return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
            }
        } catch {
            return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
        }
    }

    try {
        const maxRuns = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("max") || 30)));
        const summary = await runDueTasks(Date.now(), maxRuns);
        return NextResponse.json({ success: true, ...summary, nextTick: Date.now() + 60_000 });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Runtime tick failed.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export const dynamic = "force-dynamic";