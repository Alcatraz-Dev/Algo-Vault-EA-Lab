// Admin-only AI budget configuration.
//
// GET  -> effective configuration (env baseline + RTDB overrides) and current
//         utilisation/status per scope.
// PATCH -> merges limit overrides into RTDB and invalidates the config cache so
//          the change takes effect on the very next AI request.
//
// Access control reuses the project's existing `requireAdmin` from
// `lib/admin-auth`. No parallel auth system is introduced.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { aiMonthKey } from "@/lib/ai/budget";
import type { AIBudgetOverrides } from "@/lib/ai/budget";
import { getAIBudgetStatusReport, getEffectiveAIBudgetConfig, applyAIBudgetOverrides } from "@/lib/ai/runtime-guards";

export const dynamic = "force-dynamic";

const LIMIT_SCOPES = ["providers", "users", "plugins"] as const;

function isFiniteNonNegative(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Validate and normalise the PATCH body.
 *
 * `null` is meaningful and preserved: it CLEARS a limit, which is how an admin
 * removes a cap. A missing key leaves that limit untouched, so two admins
 * editing different providers cannot clobber each other.
 */
function parseOverrides(body: unknown): AIBudgetOverrides | string {
    if (!body || typeof body !== "object" || Array.isArray(body)) return "Invalid request body.";
    const input = body as Record<string, unknown>;
    const out: AIBudgetOverrides = {};

    if (input.global !== undefined) {
        if (!input.global || typeof input.global !== "object") return "Invalid global budget.";
        const g = input.global as Record<string, unknown>;
        const global: { monthlyUsd?: number | null; monthlyTokens?: number | null } = {};
        for (const key of ["monthlyUsd", "monthlyTokens"] as const) {
            if (g[key] === undefined) continue;
            if (g[key] === null) {
                global[key] = null;
                continue;
            }
            if (!isFiniteNonNegative(g[key])) return `Invalid global.${key}.`;
            global[key] = g[key];
        }
        out.global = global;
    }

    for (const scope of LIMIT_SCOPES) {
        if (input[scope] === undefined) continue;
        const group = input[scope];
        if (!group || typeof group !== "object" || Array.isArray(group)) {
            return `Invalid ${scope} budget.`;
        }
        const parsed: Record<string, { monthlyUsd?: number | null; monthlyTokens?: number | null }> = {};
        for (const [id, raw] of Object.entries(group as Record<string, unknown>)) {
            if (!id || id.length > 128) return `Invalid ${scope} key.`;
            // A null scope entry removes every limit for that id.
            if (raw === null) {
                parsed[id] = null as unknown as { monthlyUsd?: number | null };
                continue;
            }
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
                return `Invalid ${scope}.${id}.`;
            }
            const entry = raw as Record<string, unknown>;
            const limits: { monthlyUsd?: number | null; monthlyTokens?: number | null } = {};
            for (const key of ["monthlyUsd", "monthlyTokens"] as const) {
                if (entry[key] === undefined) continue;
                if (entry[key] === null) {
                    limits[key] = null;
                    continue;
                }
                if (!isFiniteNonNegative(entry[key])) return `Invalid ${scope}.${id}.${key}.`;
                limits[key] = entry[key] as number;
            }
            parsed[id] = limits;
        }
        (out as Record<string, unknown>)[scope] = parsed;
    }

    return out;
}

export async function GET(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    try {
        const month = request.nextUrl.searchParams.get("month")?.trim() || aiMonthKey();
        const [status, effective] = await Promise.all([
            getAIBudgetStatusReport(month),
            getEffectiveAIBudgetConfig(),
        ]);
        return NextResponse.json({
            month: status.month,
            warnThreshold: status.warnThreshold,
            blockThreshold: status.blockThreshold,
            enforcementActive: status.enforcementActive,
            global: status.global,
            providers: status.providers,
            users: status.users,
            plugins: status.plugins,
            effective,
        });
    } catch (err) {
        console.error("[AI Budget] status failed:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Failed to load AI budgets." }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const parsed = parseOverrides(body);
    if (typeof parsed === "string") {
        return NextResponse.json({ error: parsed }, { status: 400 });
    }

    try {
        await applyAIBudgetOverrides(parsed);
        const [status, effective] = await Promise.all([
            getAIBudgetStatusReport(),
            getEffectiveAIBudgetConfig(),
        ]);
        return NextResponse.json({
            ok: true,
            month: status.month,
            global: status.global,
            providers: status.providers,
            users: status.users,
            plugins: status.plugins,
            effective,
        });
    } catch (err) {
        console.error("[AI Budget] update failed:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Failed to update AI budgets." }, { status: 500 });
    }
}
