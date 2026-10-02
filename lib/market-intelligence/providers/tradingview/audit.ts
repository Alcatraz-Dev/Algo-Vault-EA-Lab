/**
 * Audit logging for the TradingView MCP integration (PHASE 10/14).
 *
 * Persists audit events in RTDB (the only database). Records never contain
 * tokens, secrets or raw provider payloads — ids, actions and codes only.
 */
import { adminDatabase } from "@/lib/firebase-admin";

export interface TradingViewAuditEvent {
    uid: string;
    action:
        | "connection.started"
        | "connection.completed"
        | "connection.failed"
        | "connection.disconnected"
        | "token.refreshed"
        | "token.refresh_failed"
        | "read.capability"
        | "write.denied_readonly";
    capability?: string | null;
    detail?: Record<string, string | number | boolean | null>;
    at?: number;
}

function clean(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (v !== undefined) out[k] = clean(v);
        }
        return out;
    }
    return value;
}

export async function logTradingViewAudit(event: TradingViewAuditEvent): Promise<void> {
    try {
        const ref = adminDatabase.ref(`tradingviewMcp/audit/${event.uid}`).push();
        await ref.set(
            clean({
                action: event.action,
                capability: event.capability ?? null,
                detail: event.detail ?? null,
                at: event.at ?? Date.now(),
            }),
        );
    } catch (err) {
        // Audit is best-effort; never break the request path.
        console.warn("[tradingview-mcp] audit write failed:", err instanceof Error ? err.message : err);
    }
}

/** Read recent audit events for the user (settings UI / admin health). */
export async function listTradingViewAudit(uid: string, limit = 20): Promise<Array<{ action: string; capability: string | null; at: number }>> {
    try {
        const snap = await adminDatabase.ref(`tradingviewMcp/audit/${uid}`).limitToLast(limit).get();
        const out: Array<{ action: string; capability: string | null; at: number }> = [];
        snap.forEach((child) => {
            const v = child.val() as { action?: string; capability?: string | null; at?: number } | null;
            if (v?.action) {
                out.push({ action: v.action, capability: v.capability ?? null, at: v.at ?? 0 });
            }
        });
        return out;
    } catch {
        return [];
    }
}


