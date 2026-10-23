import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { auth } from "@/lib/firebase";
import { adminDatabase } from "@/lib/firebase-admin";
import type { BotDeployment } from "@/lib/bot-studio/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
    try {
        // Use Firebase client auth (same as /api/bots), not Pro/Admin gate
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
        }

        const uid = token.uid;

        // Load deployments owned by this user
        const indexSnap = await adminDatabase.ref(`bot_deployments_index/${uid}`).get();
        const indexVal = (indexSnap.val() || {}) as Record<string, unknown>;
        const ids = Object.keys(indexVal);

        const deployments: BotDeployment[] = [];
        for (const id of ids) {
            const snap = await adminDatabase.ref(`bot_deployments/${id}`).get();
            const val = snap.val();
            if (!val || typeof val !== "object") continue;
            deployments.push(val as BotDeployment);
        }

        // Load strategies for name lookup
        const stratIndexSnap = await adminDatabase.ref(`bot_strategies_index/${uid}`).get();
        const stratIndexVal = (stratIndexSnap.val() || {}) as Record<string, unknown>;
        const stratIds = Object.keys(stratIndexVal);
        const strategyMap = new Map<string, { name: string; description: string; symbol: string }>();
        for (const sid of stratIds) {
            const ssnap = await adminDatabase.ref(`bot_strategies/${sid}`).get();
            const sval = ssnap.val();
            if (sval && typeof sval === "object") {
                const s = sval as { name?: string; description?: string; asset?: string; definition?: { asset?: string } };
                strategyMap.set(sid, {
                    name: s.name || `Strategy ${sid.slice(-8)}`,
                    description: s.description || "",
                    symbol: s.asset || (s.definition?.asset ?? "XAUUSD"),
                });
            }
        }

        const result = deployments.map((d: BotDeployment) => {
            const strat = strategyMap.get(d.strategyId);
            return {
                id: d.id,
                name: strat?.name || `Strategy ${d.strategyId.slice(-8)}`,
                description: strat?.description || "Deployed strategy",
                direction: "long" as const,
                symbol: strat?.symbol || "XAUUSD",
                mt5Account: d.mt5Account,
                runtimeState: d.runtimeState,
                desiredState: d.desiredState,
                signalCount: d.signalCount,
                executionCount: d.executionCount,
                rejectionCount: d.rejectionCount,
                createdAt: d.createdAt,
                updatedAt: d.updatedAt,
            };
        });

        return NextResponse.json({ success: true, deployments: result });
    } catch (error) {
        console.error("[bots/deployments GET]", error);
        return NextResponse.json({ success: false, error: "Unable to load deployments." }, { status: 500 });
    }
}
