import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { providerCatalog } from "@/lib/trading/unified/server";
import { unifiedTradingFlagSnapshot } from "@/lib/trading/feature-flags";
import { isMt5AccountId } from "@/lib/trading/unified/mt5-demo-provider";

export const runtime = "nodejs";

/**
 * GET /api/admin/trading/providers
 *
 * Operational visibility for the unified trading layer:
 *   • provider catalog + feature flags
 *   • connected demo accounts with connection state and heartbeat age
 *   • recent execution events (from the unified audit trail)
 *   • recent execution results, including failures
 *
 * Reads only. Secrets (gateway tokens) are never returned.
 */
export async function GET(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    try {
        const now = Date.now();

        const [accountsSnap, auditSnap, resultsSnap] = await Promise.all([
            adminDatabase.ref("tradingUnifiedAccounts").get(),
            adminDatabase.ref("tradingAudit").orderByChild("timestamp").limitToLast(100).get(),
            adminDatabase.ref("tradingExecutionResults").get(),
        ]);

        const accountsRaw = accountsSnap.val() ?? {};
        const accounts: Array<Record<string, unknown>> = [];
        for (const [userId, byAccount] of Object.entries(accountsRaw as Record<string, unknown>)) {
            if (!byAccount || typeof byAccount !== "object") continue;
            for (const [accountId, raw] of Object.entries(byAccount as Record<string, unknown>)) {
                if (!raw || typeof raw !== "object") continue;
                const account = raw as Record<string, unknown>;
                const lastHeartbeatAt = Number(account.lastHeartbeatAt ?? 0);
                accounts.push({
                    userId,
                    accountId,
                    provider: account.provider ?? "MT5",
                    environment: account.environment ?? "UNKNOWN",
                    connection: account.connection ?? "UNKNOWN",
                    providerStatus: account.providerStatus ?? "UNKNOWN",
                    brokerName: account.brokerName ?? null,
                    serverName: account.serverName ?? null,
                    externalAccountId: account.externalAccountId ?? null,
                    gatewayVersion: account.gatewayVersion ?? null,
                    balance: account.metrics ? (account.metrics as Record<string, unknown>).balance ?? null : null,
                    equity: account.metrics ? (account.metrics as Record<string, unknown>).equity ?? null : null,
                    marginLevel: account.metrics ? (account.metrics as Record<string, unknown>).marginLevel ?? null : null,
                    lastHeartbeatAt: lastHeartbeatAt || null,
                    heartbeatAgeMs: lastHeartbeatAt ? now - lastHeartbeatAt : null,
                    connectionError: account.connectionError ?? null,
                    updatedAt: Number(account.updatedAt ?? 0) || null,
                });
            }
        }
        accounts.sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));

        const audit: Array<Record<string, unknown>> = [];
        for (const [, byUser] of Object.entries((auditSnap.val() ?? {}) as Record<string, unknown>)) {
            if (!byUser || typeof byUser !== "object") continue;
            for (const [, raw] of Object.entries(byUser as Record<string, unknown>)) {
                if (!raw || typeof raw !== "object") continue;
                audit.push(raw as Record<string, unknown>);
            }
        }
        audit.sort((a, b) => Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0));

        const results: Array<Record<string, unknown>> = [];
        for (const [, byUser] of Object.entries((resultsSnap.val() ?? {}) as Record<string, unknown>)) {
            if (!byUser || typeof byUser !== "object") continue;
            for (const [, raw] of Object.entries(byUser as Record<string, unknown>)) {
                if (!raw || typeof raw !== "object") continue;
                results.push(raw as Record<string, unknown>);
            }
        }
        results.sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));

        return NextResponse.json({
            success: true,
            flags: unifiedTradingFlagSnapshot(),
            providers: providerCatalog(),
            accounts,
            accountsCount: accounts.length,
            gatewayAccounts: accounts.filter((a) => isMt5AccountId(String(a.accountId))).length,
            executionEvents: audit.slice(0, 100),
            failedExecutions: results.filter((r) => r.status !== "SUCCEEDED").slice(0, 50),
            recentExecutions: results.slice(0, 50),
            generatedAt: now,
        });
    } catch (error) {
        console.error("[admin/trading/providers GET]", error);
        return NextResponse.json({ error: "Failed to load trading observability." }, { status: 500 });
    }
}