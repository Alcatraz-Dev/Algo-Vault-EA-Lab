// Admin-only AI usage summary.
//
// Access control reuses the project's existing `requireAdmin` from
// `lib/admin-auth` (Firebase ID token + an `admin` role in the RTDB `users`
// node). No parallel auth system is introduced.
//
// No secret, prompt, completion or raw provider response is returned: the
// response is built entirely from aggregate counters. Per-user ids are only ever
// visible through this authenticated admin path, and the client Firebase rules
// deny direct reads of the usage namespaces (see `database.rules.json`).

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { aiMonthKey } from "@/lib/ai/budget";
import { refreshCatalogSnapshot } from "@/lib/ai/catalog-snapshot";

export const dynamic = "force-dynamic";

/** `YYYY-MM`, optionally any past month. Rejects anything else. */
function normalizeMonth(raw: string | null): string {
    if (!raw) return aiMonthKey();
    const trimmed = raw.trim();
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(trimmed)) return trimmed;
    return aiMonthKey();
}

export async function GET(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const params = request.nextUrl.searchParams;
    const month = normalizeMonth(params.get("month"));

    try {
        // Warm the pricing snapshot so the cost columns are as accurate as the
        // provider catalogs allow. An admin opening this page can absorb the
        // latency; the AI request path deliberately cannot.
        await refreshCatalogSnapshot().catch(() => undefined);

        const { getAIMonthlySummary, pruneAIUsageEvents } = await import("@/lib/ai/usage-store");

        const summary = await getAIMonthlySummary({
            month,
            provider: params.get("provider") ?? undefined,
            model: params.get("model") ?? undefined,
            source: params.get("source") ?? undefined,
        });

        // Retention is opportunistic and best-effort: raw events are bucketed by
        // day so pruning a day is a single node delete. Aggregates are never
        // touched, so reporting history is unaffected by retention.
        const retentionDays = parseInt(process.env.AI_USAGE_EVENT_RETENTION_DAYS || "90", 10);
        if (Number.isFinite(retentionDays) && retentionDays > 0) {
            await pruneAIUsageEvents(retentionDays).catch(() => 0);
        }

        return NextResponse.json({
            month: summary.month,
            totals: summary.totals,
            providers: summary.providers,
            sources: summary.sources,
            modelCount: summary.modelCount,
            costIsEstimate: true,
        });
    } catch (err) {
        console.error("[AI Usage] summary failed:", err instanceof Error ? err.message : err);
        return NextResponse.json(
            { error: "Failed to load AI usage." },
            { status: 500 },
        );
    }
}
