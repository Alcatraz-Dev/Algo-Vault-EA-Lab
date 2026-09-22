import { AgentExecutionRecord, AgentOutput, WorkflowContext } from "./types";
import { notifyUser, NotifyPayload, NotifyChannel } from "@/lib/notifications";

/**
 * Notification Agent
 *
 * Receives the final structured result from Synthesis and transforms
 * it into the user's configured channels (in-app, push, Telegram,
 * Discord, Email, Webhook) through the existing notification stack.
 *
 * Respects:
 * - user preferences
 * - quiet hours
 * - cooldown
 * - severity
 * - duplicate suppression
 * - plugin limits
 * - license status
 */
export async function notificationAgent(
    record: AgentExecutionRecord,
    context: WorkflowContext
): Promise<AgentOutput> {
    const outputs = context.agentOutputs || {};
    const synthesisOut = outputs["synthesis"] as AgentOutput | undefined;
    const finalOutput = synthesisOut?.metadata?.finalOutput as {
        notify?: {
            warranted: boolean;
            reason: string;
            severity: "low" | "medium" | "high";
            title: string;
            message: string;
        };
    } | undefined;

    const notifyDecision = finalOutput?.notify;

    if (!notifyDecision || !notifyDecision.warranted) {
        return {
            agentId: record.agentId,
            status: "success",
            confidence: 1,
            summary: "Synthesis did not warrant notification — no delivery needed.",
            findings: [{ id: "notif_skip", title: "No notification", detail: notifyDecision ? notifyDecision.reason : "No notification decision available." }],
            evidence: [],
            warnings: [],
            dataUsed: ["synthesis:output"],
            nextStep: "done",
            metadata: { delivered: false, reason: notifyDecision?.reason || "not warranted" },
        };
    }

    const payload: NotifyPayload = {
        title: notifyDecision.title,
        message: notifyDecision.message,
        level: notifyDecision.severity === "high" ? "warning" : notifyDecision.severity === "medium" ? "success" : "info",
        link: "/app/insights",
    };

    const uid = context.user?.uid || null;
    const channels: NotifyChannel[] = ["email"];

    try {
        if (uid) {
            const audit = await notifyUser(uid, payload);
            const delivered = audit.status === "delivered";
            return {
                agentId: record.agentId,
                status: "success",
                confidence: 1,
                summary: `Notification ${delivered ? "delivered" : "attempted"} via ${audit.channels.join(", ")}.`,
                findings: [
                    {
                        id: "notif_result",
                        title: delivered ? "Notification delivered" : "Notification attempted",
                        detail: `Channels: ${audit.channels.join(", ")}. Status: ${audit.status}.`,
                    },
                ],
                evidence: [{ id: "notif_1", dataUsed: "user:preferences", note: "user notification preferences" }],
                warnings: delivered ? [] : ["Some channels failed delivery."],
                dataUsed: ["synthesis:output", "user:preferences"],
                nextStep: "done",
                metadata: {
                    delivered: delivered,
                    channels: audit.channels,
                    reason: notifyDecision.reason,
                },
            };
        }
        return {
            agentId: record.agentId,
            status: "success",
            confidence: 1,
            summary: "No user UID — in-app record only.",
            findings: [{ id: "notif_n uid", title: "No user context", detail: "Cannot deliver without a user UID." }],
            evidence: [],
            warnings: [],
            dataUsed: ["synthesis:output"],
            nextStep: "done",
        };
    } catch (err) {
        return {
            agentId: record.agentId,
            status: "failed",
            confidence: 0,
            summary: "Notification delivery failed.",
            findings: [{ id: "notif_fail", title: "Delivery failed", detail: err instanceof Error ? err.message : "Unknown error." }],
            evidence: [],
            warnings: [],
            dataUsed: ["synthesis:output"],
            nextStep: "done",
            error: err instanceof Error ? err.message : "Unknown error.",
        };
    }
}
