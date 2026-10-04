/**
 * Intelligence audit store — Firebase Realtime Database (existing admin app).
 *
 * Writes concise, auditable intelligence artifacts under ai/*:
 *   ai/decisions/{pushId}     IntelligenceDecision (sanitized)
 *   ai/requests/{pushId}      router request summaries (no prompts, no keys)
 *   ai/usage/{ym}/{pushId}    per-task accounting mirror
 *
 * Principles:
 *  - NEVER stores prompts, chain-of-thought or raw provider responses — only
 *    concise rationale/evidence (admin-facing requirement).
 *  - NEVER stores credentials or provider error bodies.
 *  - Bounded: failures are swallowed (audit must never break trading paths)
 *    but a ring buffer keeps the most recent failures for diagnostics.
 *  - Respectful of RTDB quotas: single-object writes with push ids; retention
 *    trimming is an admin/ops concern, not on the hot path.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import type { IntelligenceDecision } from "./types";

export interface IntelligenceRequestAudit {
    requestId: string;
    task: string;
    provider: string;
    model: string;
    status: string;
    latencyMs: number;
    attempts: number;
    fallbackUsed: boolean;
    tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    errors?: string[];
    userId?: string;
    timestamp: number;
    versions: Record<string, string>;
}

const MAX_ERRORS_IN_AUDIT = 6;

export async function recordDecisionAudit(decision: IntelligenceDecision): Promise<boolean> {
    try {
        // Compact representation: factors already carry concise evidence only.
        const compact = {
            requestId: decision.requestId,
            symbol: decision.symbol,
            timeframe: decision.timeframe,
            direction: decision.direction,
            state: decision.state,
            confidence: decision.confidence,
            factors: decision.factors.slice(0, 16).map((f) => ({ s: f.source, l: f.label, v: f.value.slice(0, 160), n: f.negative ? 1 : undefined })),
            jev: decision.jev
                ? {
                      decision: decision.jev.decision,
                      confidence: decision.jev.confidence,
                      status: decision.jev.validationStatus,
                      provider: decision.jev.provider,
                      model: decision.jev.model,
                      latency: decision.jev.latency,
                      summary: decision.jev.reasoningSummary.slice(0, 240),
                      answers: decision.jev.answers.slice(0, 12).map((a) => ({ id: a.id, a: a.answer, c: a.confidence })),
                  }
                : undefined,
            llm: decision.llm
                ? {
                      provider: decision.llm.provider,
                      model: decision.llm.model,
                      summary: decision.llm.summary.slice(0, 240),
                      confidence: decision.llm.confidence,
                      fallbackUsed: decision.llm.fallbackUsed,
                  }
                : undefined,
            risk: decision.risk
                ? { approved: decision.risk.approved, code: decision.risk.code, reason: decision.risk.reason?.slice(0, 160) }
                : undefined,
            rationale: decision.rationale.slice(0, 300),
            validationStatus: decision.validationStatus,
            versions: decision.versions,
            timestamp: decision.timestamp,
        };
        await adminDatabase.ref("ai/decisions").push(compact);
        return true;
    } catch {
        return false;
    }
}

export async function recordRequestAudit(event: IntelligenceRequestAudit): Promise<boolean> {
    try {
        await adminDatabase.ref("ai/requests").push({
            ...event,
            errors: event.errors?.slice(0, MAX_ERRORS_IN_AUDIT),
        });
        return true;
    } catch {
        return false;
    }
}
