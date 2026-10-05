/**
 * Intelligence Cloud — Audit Log (Phase 13)
 *
 * Append-only record of security-relevant actions: key creation/revocation,
 * strategy deployment, certification changes, webhook changes, tenant
 * permission changes, risk configuration and admin actions.
 *
 * There is intentionally no update or delete function. Entries are written with
 * a server-generated id and an opaque hash-chain field, so removing or editing
 * history breaks verification rather than being silently possible.
 */

import { randomUUID, createHash } from "node:crypto";
import { adminDatabase } from "@/lib/firebase-admin";
import { CLOUD_ROOT } from "./api-keys";
import { sanitizeSegment } from "./tenancy";

export const AUDIT_ACTIONS = [
    "API_KEY_CREATED",
    "API_KEY_REVOKED",
    "STRATEGY_DEPLOYED",
    "STRATEGY_STATUS_CHANGED",
    "CERTIFICATION_CHANGED",
    "WEBHOOK_CREATED",
    "WEBHOOK_CHANGED",
    "TENANT_PERMISSION_CHANGED",
    "MEMBERSHIP_CHANGED",
    "RISK_CONFIG_CHANGED",
    "RESEARCH_JOB_CREATED",
    "RESEARCH_JOB_CANCELLED",
    "ADMIN_ACTION",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
    auditId: string;
    tenantId: string;
    action: AuditAction;
    actorId: string;
    /** Request id, so an audit entry joins to observability logs. */
    requestId?: string;
    /** What changed, in factual terms. Must never contain secrets. */
    detail: Record<string, unknown>;
    at: number;
    ip?: string;
    /** Hash of the previous entry for this tenant — tamper-evident ordering. */
    prevHash?: string;
    /** SHA-256 over this entry plus `prevHash`. */
    hash: string;
}

export function computeAuditHash(
    entry: Omit<AuditEntry, "auditId" | "hash">,
    prevHash: string | undefined
): string {
    const material = JSON.stringify({ ...entry, prevHash: prevHash ?? null });
    return createHash("sha256").update(material).digest("hex");
}

/**
 * Append an audit entry.
 *
 * Callers must pass only non-sensitive facts: an API key's secret must never
 * reach here, only its key id and scopes.
 */
export async function recordAudit(input: {
    tenantId: string;
    action: AuditAction;
    actorId: string;
    requestId?: string;
    detail?: Record<string, unknown>;
    ip?: string;
}): Promise<AuditEntry> {
    const ref = adminDatabase.ref(`${CLOUD_ROOT}/audit/${sanitizeSegment(input.tenantId)}`);
    const previous = await ref.orderByChild("at").limitToLast(1).get();
    let prevHash: string | undefined;
    if (previous.exists()) {
        previous.forEach((child) => {
            const value = child.val() as AuditEntry | null;
            if (value?.hash) prevHash = value.hash;
        });
    }

    const now = Date.now();
    const base: Omit<AuditEntry, "auditId" | "hash"> = {
        tenantId: sanitizeSegment(input.tenantId),
        action: input.action,
        actorId: input.actorId,
        requestId: input.requestId,
        detail: input.detail ?? {},
        at: now,
        ip: input.ip,
        prevHash,
    };

    const entry: AuditEntry = {
        ...base,
        auditId: `aud_${randomUUID()}`,
        hash: computeAuditHash(base, prevHash),
    };

    // Append-only: a push keyed by a fresh id, never a set over an existing key.
    await ref.child(entry.auditId).set(entry);
    return entry;
}

/** Read a tenant's audit trail, newest first. */
export async function listAudit(tenantId: string, limit = 100): Promise<AuditEntry[]> {
    const snap = await adminDatabase
        .ref(`${CLOUD_ROOT}/audit/${sanitizeSegment(tenantId)}`)
        .orderByChild("at")
        .limitToLast(limit)
        .get();
    const out: AuditEntry[] = [];
    snap.forEach((child) => {
        out.push(child.val() as AuditEntry);
    });
    return out.sort((a, b) => b.at - a.at);
}

/**
 * Verify the hash chain for a tenant.
 *
 * Any edit or removal in the middle of history breaks the chain from that point
 * onward, which is what makes the trail worth keeping.
 */
export async function verifyAuditChain(entries: AuditEntry[]): Promise<{ valid: boolean; brokenAt?: string }> {
    const ordered = [...entries].sort((a, b) => a.at - b.at);
    for (let i = 0; i < ordered.length; i += 1) {
        const entry = ordered[i];
        const expectedPrev = i === 0 ? undefined : ordered[i - 1].hash;
        if ((entry.prevHash ?? undefined) !== expectedPrev) {
            return { valid: false, brokenAt: entry.auditId };
        }
        const { auditId, hash, ...body } = entry;
        void auditId;
        if (computeAuditHash(body, expectedPrev) !== hash) {
            return { valid: false, brokenAt: entry.auditId };
        }
    }
    return { valid: true };
}
