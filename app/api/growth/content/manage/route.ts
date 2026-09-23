/**
 * AlgoVault — Growth content management API (admin).
 *
 * Actions (all validated server-side, all real DB mutations):
 *  - create       create a marketing task draft (+ optionally start generation)
 *  - generate     run the content pipeline for one or more DRAFT/FAILED tasks
 *  - approve      move READY_FOR_REVIEW → APPROVED (writes approval record)
 *  - reject       move any review-pending state → REJECTED
 *  - schedule     move APPROVED → SCHEDULED with a target time
 *  - publish      publish an APPROVED/SCHEDULED task via a real channel adapter
 *
 * Every transition is validated against the marketing task state machine
 * (lib/growth/content-states). Publish is idempotent (canPublish guard) and
 * only ever reports SUCCESS when the channel adapter actually accepted the
 * content — never faked.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS, CHANNEL_TYPES, CONTENT_TYPES } from "@/lib/growth/constants";
import { MarketingTask, MarketingApproval } from "@/lib/growth/types";
import { updateRecord, writeGrowthAudit } from "@/lib/growth/database";
import { canTransition } from "@/lib/growth/content-states";
import {
    createMarketingTaskDraft,
    runContentPipeline,
    publishTaskToChannel,
} from "@/lib/growth/agents";

type AdminClaims = { uid: string; admin?: boolean; role?: string };

async function requireAdmin(token: string): Promise<AdminClaims | null> {
    try {
        const decoded = await adminAuth.verifyIdToken(token);
        if (!decoded.admin && decoded.role !== "admin") return null;
        return { uid: decoded.uid, admin: decoded.admin, role: decoded.role };
    } catch {
        return null;
    }
}

async function getTask(taskId: string): Promise<MarketingTask | null> {
    const snap = await adminDatabase.ref(`${GROWTH_COLLECTIONS.tasks}/${taskId}`).get();
    return snap.exists() ? (snap.val() as MarketingTask) : null;
}

export async function POST(request: NextRequest) {
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = await requireAdmin(token);
    if (!admin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

    let body: Record<string, unknown>;
    try {
        body = (await request.json()) as Record<string, unknown>;
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const action = String(body.action || "");

    switch (action) {
        case "create": {
            const type = String(body.type || "");
            const topic = String(body.topic || "").trim();
            const channels = Array.isArray(body.channels) ? (body.channels as string[]) : [];
            if (!type || !topic) return NextResponse.json({ error: "type and topic are required" }, { status: 400 });
            if (!(CONTENT_TYPES as readonly string[]).includes(type)) {
                return NextResponse.json({ error: `Unknown content type: ${type}` }, { status: 400 });
            }
            if (channels.length === 0 || channels.some((c) => !(CHANNEL_TYPES as readonly string[]).includes(c))) {
                return NextResponse.json({ error: "At least one valid channel is required" }, { status: 400 });
            }

            const task = await createMarketingTaskDraft({
                type,
                topic,
                channels,
                title: body.title ? String(body.title) : undefined,
                objective: body.objective ? String(body.objective) : undefined,
                audience: body.audience ? String(body.audience) : undefined,
                tone: body.tone ? String(body.tone) : undefined,
                language: body.language ? String(body.language) : undefined,
                campaignId: body.campaignId ? String(body.campaignId) : undefined,
                offerId: body.offerId ? String(body.offerId) : undefined,
                approvalRequired: body.approvalRequired === false ? false : true,
                actor: admin.uid,
            });

            let generated: Awaited<ReturnType<typeof runContentPipeline>> | undefined;
            if (body.generateNow === true) {
                generated = await runContentPipeline({ taskId: task.id as string, actor: admin.uid });
            }
            return NextResponse.json({ taskId: task.id, generated }, { status: 201 });
        }

        case "generate": {
            const taskIds = Array.isArray(body.taskIds) ? (body.taskIds as string[]) : [];
            if (taskIds.length === 0) return NextResponse.json({ error: "taskIds are required" }, { status: 400 });
            const results = [];
            for (const taskId of taskIds.slice(0, 20)) {
                const task = await getTask(taskId);
                if (!task) {
                    results.push({ taskId, ok: false, error: "Task not found." });
                    continue;
                }
                if (task.state !== "DRAFT" && task.state !== "FAILED") {
                    results.push({ taskId, ok: false, error: `Task is ${task.state}; only DRAFT/FAILED can be generated.` });
                    continue;
                }
                const out = await runContentPipeline({ taskId, actor: admin.uid });
                results.push({ taskId, ok: out.ok, state: out.task?.state, error: out.error, blockedByCompliance: out.blockedByCompliance });
            }
            return NextResponse.json({ results });
        }

        case "approve": {
            const taskId = String(body.taskId || "");
            if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });
            const task = await getTask(taskId);
            if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
            const gate = canTransition(task.state, "APPROVED");
            if (!gate.ok) {
                return NextResponse.json({ error: gate.reason || `Cannot approve from ${task.state}.` }, { status: 400 });
            }
            await updateRecord(GROWTH_COLLECTIONS.tasks, taskId, { state: "APPROVED" }, admin.uid);
            const approvalRef = adminDatabase.ref(GROWTH_COLLECTIONS.approvals).push();
            const approval: MarketingApproval = {
                taskId,
                decision: "APPROVED",
                approvedBy: admin.uid,
                comment: body.comment ? String(body.comment) : undefined,
                decidedAt: Date.now(),
                createdAt: Date.now(),
                updatedAt: Date.now(),
                createdBy: admin.uid,
                status: "APPROVED",
            };
            await approvalRef.set({ ...approval, id: approvalRef.key });
            await writeGrowthAudit({ actor: admin.uid, action: "content_approved", targetType: "marketingTask", targetId: taskId });
            return NextResponse.json({ ok: true });
        }

        case "reject": {
            const taskId = String(body.taskId || "");
            const reason = String(body.reason || "").trim();
            if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });
            if (!reason) return NextResponse.json({ error: "reason is required" }, { status: 400 });
            const task = await getTask(taskId);
            if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
            const gate = canTransition(task.state, "REJECTED");
            if (!gate.ok) {
                return NextResponse.json({ error: gate.reason || `Cannot reject from ${task.state}.` }, { status: 400 });
            }
            await updateRecord(GROWTH_COLLECTIONS.tasks, taskId, { state: "REJECTED", rejectReason: reason }, admin.uid);
            await writeGrowthAudit({ actor: admin.uid, action: "content_rejected", targetType: "marketingTask", targetId: taskId, detail: { reason } });
            return NextResponse.json({ ok: true });
        }

        case "resetToDraft": {
            const taskId = String(body.taskId || "");
            if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });
            const task = await getTask(taskId);
            if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
            const gate = canTransition(task.state, "DRAFT");
            if (!gate.ok) {
                return NextResponse.json({ error: gate.reason || `Cannot reset ${task.state} to draft.` }, { status: 400 });
            }
            await updateRecord<Record<string, unknown>>(
                GROWTH_COLLECTIONS.tasks,
                taskId,
                {
                    state: "DRAFT",
                    generatedContent: null,
                    compliance: null,
                    reviewNotes: null,
                    rejectReason: null,
                },
                admin.uid
            );
            await writeGrowthAudit({ actor: admin.uid, action: "task_state_changed", targetType: "marketingTask", targetId: taskId, detail: { to: "DRAFT", from: task.state } });
            return NextResponse.json({ ok: true });
        }

        case "schedule": {
            const taskId = String(body.taskId || "");
            const scheduledAt = Number(body.scheduledAt || 0);
            if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });
            if (!scheduledAt || scheduledAt <= Date.now()) {
                return NextResponse.json({ error: "A future scheduledAt timestamp is required" }, { status: 400 });
            }
            const task = await getTask(taskId);
            if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
            const gate = canTransition(task.state, "SCHEDULED");
            if (!gate.ok) {
                return NextResponse.json({ error: gate.reason || `Cannot schedule from ${task.state}.` }, { status: 400 });
            }
            await updateRecord(GROWTH_COLLECTIONS.tasks, taskId, { state: "SCHEDULED", scheduledAt }, admin.uid);
            await writeGrowthAudit({ actor: admin.uid, action: "content_scheduled", targetType: "marketingTask", targetId: taskId, detail: { scheduledAt } });
            return NextResponse.json({ ok: true });
        }

        case "publish": {
            const taskId = String(body.taskId || "");
            const channel = String(body.channel || "") as MarketingTask["channels"][number];
            if (!taskId || !channel) return NextResponse.json({ error: "taskId and channel are required" }, { status: 400 });
            if (!(CHANNEL_TYPES as readonly string[]).includes(channel)) {
                return NextResponse.json({ error: `Unknown channel: ${channel}` }, { status: 400 });
            }
            const task = await getTask(taskId);
            if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
            if (!task.channels.includes(channel)) {
                return NextResponse.json({ error: `Task is not targeted at ${channel}.` }, { status: 400 });
            }
            const result = await publishTaskToChannel(task, channel, admin.uid);
            if (!result.ok) {
                return NextResponse.json({ ok: false, reason: result.reason }, { status: 422 });
            }
            return NextResponse.json({ ok: true, publishedAt: result.publishedAt, externalId: result.externalId });
        }

        default:
            return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
}