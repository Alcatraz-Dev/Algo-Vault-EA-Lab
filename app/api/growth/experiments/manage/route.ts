import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "@/lib/growth/constants";
import { Experiment } from "@/lib/growth/types";
import { Experiment as ExperimentLib } from "@/lib/growth/experiments/types";
import { createExperiment as createExperimentLib } from "@/lib/growth/experiments";
import { deepClean, writeGrowthAudit } from "@/lib/growth/database";

async function verifyAdmin(request: NextRequest): Promise<{ uid: string; error: NextResponse | null }> {
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return { uid: "", error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

    try {
        const decoded = await adminAuth.verifyIdToken(token);
        if (!decoded.admin && decoded.role !== "admin") {
            return { uid: "", error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
        }
        return { uid: decoded.uid, error: null };
    } catch {
        return { uid: "", error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    }
}

export async function POST(request: NextRequest) {
    const { uid, error: authError } = await verifyAdmin(request);
    if (authError) return authError;

    let body: { action?: string; id?: string; data?: Partial<Experiment> };
    try {
        body = (await request.json()) as { action?: string; id?: string; data?: Partial<Experiment> };
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const ref = adminDatabase.ref(GROWTH_COLLECTIONS.experiments);

    switch (body.action) {
        case "create": {
            const exp = body.data;
            if (!exp?.name || !exp?.hypothesis) {
                return NextResponse.json({ error: "name and hypothesis are required" }, { status: 400 });
            }
            const variants = exp.variants || [
                { id: "A", label: exp.variantA ? "Variant A" : "Control" },
                { id: "B", label: exp.variantB ? "Variant B" : "Variant A" },
            ];
            const created: ExperimentLib = createExperimentLib(
                exp.name,
                exp.hypothesis,
                variants,
            );
            const now = Date.now();
            const record = deepClean({
                ...exp,
                name: created.name,
                hypothesis: created.hypothesis,
                variants,
                variantA: exp.variantA,
                variantB: exp.variantB,
                metric: exp.metric || created.targetMetric,
                state: "DRAFT" as const,
                createdAt: now,
                updatedAt: now,
                createdBy: uid,
            });
            const childRef = ref.push();
            await childRef.set(record);
            await writeGrowthAudit({
                actor: uid,
                action: "experiment_created" as const,
                targetType: "growthExperiment",
                targetId: childRef.key as string,
                detail: { name: exp.name },
            });
            return NextResponse.json({ id: childRef.key, ok: true }, { status: 201 });
        }

        case "start":
        case "stop":
        case "archive": {
            if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
            const snap = await ref.child(body.id).once("value");
            if (!snap.exists()) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });

            const existing = snap.val() as Experiment;
            const currentState = existing.state;

            const transitions: Record<string, Record<string, string>> = {
                start: { DRAFT: "RUNNING" },
                stop: { RUNNING: "COMPLETED" },
                archive: { COMPLETED: "ARCHIVED" },
            };
            const targetState = transitions[body.action]?.[currentState];
            if (!targetState) {
                return NextResponse.json(
                    { error: `Cannot ${body.action} experiment in state ${currentState}` },
                    { status: 409 },
                );
            }

            const updates: Partial<Experiment> = { state: targetState as Experiment["state"], updatedAt: Date.now() };
            if (body.action === "start") updates.startAt = Date.now();
            if (body.action === "stop") updates.endAt = Date.now();

            await ref.child(body.id).update(updates);
            await writeGrowthAudit({
                actor: uid,
                action: "experiment_updated" as const,
                targetType: "growthExperiment",
                targetId: body.id,
                detail: { action: body.action, from: currentState, to: targetState },
            });
            return NextResponse.json({ ok: true });
        }

        default:
            return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
    }
}
