// Admin-only AI provider account health.
//
// Access control reuses the project's existing `requireAdmin` from
// `lib/admin-auth` (Firebase ID token + an `admin` role in the RTDB `users`
// node). No parallel auth system is introduced.
//
// ── No probes, no secrets ────────────────────────────────────────────────────
// This route never contacts a provider. Health is derived from facts already
// available on this server: credential presence (boolean only — the key value is
// never read into the response), each provider's own `isAvailable()` gate, the
// cost policy, budget utilisation and recorded usage. So the page is cheap to
// poll and cannot burn provider quota.
//
// Credential values, prompts, completions and raw provider payloads are not part
// of the response. Per-user ids are not either: the usage figures are monthly
// aggregates, and the client rules deny direct reads of the usage namespaces
// (see `database.rules.json`).

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { aiMonthKey } from "@/lib/ai/budget";
import { defaultRouter } from "@/lib/ai/router";
import { AIConfig } from "@/lib/ai/config";
import { providerHasMeteredRisk } from "@/lib/ai/models";
import { emptyAIProviderActivity } from "@/lib/ai/health";
import {
    AIProviderHealth,
    buildAIProviderHealthReport,
    hasProviderCredential,
    resolveAIProviderHealth,
} from "@/lib/ai/health";
import type { AIUsageCountersPublic } from "@/lib/ai/usage-events";
import { emptyUsageCounters, countersToPublic } from "@/lib/ai/usage-events";
import { getAIBudgetStatusReport } from "@/lib/ai/runtime-guards";
import type { AIBudgetStatus } from "@/lib/ai/budget";

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

    const month = normalizeMonth(request.nextUrl.searchParams.get("month"));

    try {
        const { getAIMonthlySummary, readAIProviderActivity } = await import("@/lib/ai/usage-store");
        const { aiHealthFailureRateThreshold, aiHealthLookbackDays } = await import("@/lib/ai/health");

        const registered = defaultRouter.getRegisteredProviders();
        const ids = registered.map((p) => p.id);

        const [budgets, summary, activity, availability] = await Promise.all([
            getAIBudgetStatusReport(month),
            getAIMonthlySummary({ month }),
            readAIProviderActivity(ids, aiHealthLookbackDays()).catch(() => null),
            // `AIProvider.isAvailable()` is declared `Promise<boolean> | boolean`
            // and every provider implements it synchronously, so calling
            // `.catch` on its result directly throws. Normalise through a
            // promise first — that also contains a synchronous throw from a
            // provider, so one bad gate cannot fail the whole report.
            Promise.all(
                registered.map((p) =>
                    Promise.resolve()
                        .then(() => p.isAvailable())
                        .then((ok) => ok === true, () => false),
                ),
            ),
        ]);

        const usageByProvider = new Map<string, AIUsageCountersPublic>(
            summary.providers.map((p) => [p.provider.toLowerCase(), p]),
        );
        const budgetByProvider = new Map<string, AIBudgetStatus>(
            budgets.providers.map((p) => [p.id.toLowerCase(), p]),
        );

        const providers: AIProviderHealth[] = [];
        for (let i = 0; i < registered.length; i++) {
            const provider = registered[i];
            const key = provider.id.toLowerCase();
            providers.push(
                resolveAIProviderHealth({
                    provider: provider.id,
                    name: provider.name,
                    available: availability[i] === true,
                    credentialsConfigured: hasProviderCredential(provider.id),
                    meteredRisk: providerHasMeteredRisk(provider.id),
                    // A provider with no configured limit has no status to read.
                    // `null` means "no cap", which is not the same as "under cap".
                    budget: budgetByProvider.get(key) ?? null,
                    globalBudget: budgets.enforcementActive ? budgets.global : null,
                    usage: usageByProvider.get(key) ?? countersToPublic(emptyUsageCounters()),
                    activity: activity?.[key] ?? emptyAIProviderActivity(),
                }),
            );
        }

        const report = buildAIProviderHealthReport({
            month,
            freeOnly: AIConfig.freeOnly,
            enforcementActive: budgets.enforcementActive,
            activityAvailable: activity !== null,
            providers,
            failureRateThreshold: aiHealthFailureRateThreshold(),
        });

        return NextResponse.json(report);
    } catch (err) {
        console.error("[AI Health] report failed:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Failed to load AI account health." }, { status: 500 });
    }
}
