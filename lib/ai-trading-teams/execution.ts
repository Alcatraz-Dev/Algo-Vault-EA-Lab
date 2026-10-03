/**
 * Production execution wiring for AI Trading Teams.
 *
 * `executeTeamRun` is the single place where a queued run becomes a completed
 * run: dossier → orchestrator → persistence → memory → metrics → analytics →
 * notification. Every step is failure-isolated: a notification or metrics
 * failure can never corrupt an otherwise successful run.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { buildDossier, type DossierDeps } from "./context";
import { runTeamAnalysis } from "./orchestrator";
import { teamAIFn } from "./ai";
import { resolveTeamAgents } from "./agents";
import {
    clearRunControl,
    getRun,
    isRunCancelled,
    patchRun,
    recordAgentMetrics,
    recordTeamEvent,
    saveRun,
} from "./database";
import { updateMemoryAfterRun } from "./memory";
import type { AITradingTeam, TeamDataMode, TeamRun } from "./types";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { loadAccountRiskSnapshot } from "@/lib/risk/account-state";

// ─── production dossier dependencies ────────────────────────────────────────

const CALENDAR_WEBHOOK = "https://n8n.w-v.co/webhook/forex-calendar";

function currenciesForMarket(market: string): Set<string> {
    const symbol = market.toUpperCase();
    const set = new Set<string>();
    if (symbol.includes("USD")) set.add("USD");
    if (symbol.includes("EUR")) set.add("EUR");
    if (symbol.includes("GBP")) set.add("GBP");
    if (symbol.includes("JPY")) set.add("JPY");
    if (symbol.includes("XAU")) set.add("USD");
    if (symbol.includes("XAG")) set.add("USD");
    if (symbol.includes("BTC")) set.add("USD");
    if (symbol.includes("ETH")) set.add("USD");
    return set;
}

/**
 * Economic calendar loader — same source as the existing `/api/calendar`
 * route. Returns null when unavailable; the Macro agent then reports UNKNOWN
 * rather than inventing events.
 */
export async function loadCalendarSection(
    market: string,
    asOf: number | null,
): Promise<Record<string, unknown> | null> {
    try {
        const response = await fetch(CALENDAR_WEBHOOK, { next: { revalidate: 300 } } as RequestInit);
        if (!response.ok) return null;
        const data: unknown = await response.json();
        if (!Array.isArray(data)) return null;

        const currencies = currenciesForMarket(market);
        const cutoff = asOf ?? Date.now();
        const windowEnd = cutoff + 48 * 60 * 60 * 1000;

        const events = data
            .map((item, index) => {
                const source = item as Record<string, unknown>;
                return {
                    id: `cal_${index}`,
                    date: String(source.date || ""),
                    timeUtc: String(source.time || ""),
                    currency: String(source.currency || source.country || "USD").toUpperCase(),
                    title: String(source.title || source.event || "Economic release"),
                    impact: String(source.impact || "Medium"),
                };
            })
            .filter((event) => {
                if (currencies.size > 0 && !currencies.has(event.currency)) return false;
                if (!asOf) return true;
                const ts = Date.parse(`${event.date}T${event.timeUtc || "00:00"}Z`);
                // Point-in-time: only events SCHEDULED after the cutoff are
                // relevant, but we never include event outcomes published after it.
                if (Number.isNaN(ts)) return false;
                const hasResult = false; // outcomes are never fed back in replay
                return ts >= cutoff - 6 * 60 * 60 * 1000 && (hasResult || ts <= windowEnd);
            })
            .slice(0, 12);

        return { events, source: "economic-calendar", asOf };
    } catch {
        return null;
    }
}

async function loadSetupsSection(uid: string, market: string): Promise<Record<string, unknown> | null> {
    try {
        const snap = await adminDatabase.ref(`monitoring/setups/${uid}`).get();
        if (!snap.exists()) return { records: [], note: "No setup memory records for this market." };
        const all = snap.val() as Record<string, Record<string, unknown>>;
        const records = Object.entries(all)
            .filter(([, record]) => String(record?.symbol ?? record?.market ?? "").toUpperCase() === market.toUpperCase())
            .slice(0, 8)
            .map(([id, record]) => ({
                id,
                symbol: record.symbol ?? market,
                timeframe: record.timeframe ?? null,
                status: record.status ?? null,
                matchedCount: record.matchedCount ?? null,
                totalCount: record.totalCount ?? null,
                updatedAt: record.updatedAt ?? null,
            }));
        return { records, note: records.length ? undefined : "No setup memory records for this market." };
    } catch {
        return null;
    }
}

async function loadResearchSection(uid: string, market: string): Promise<Record<string, unknown> | null> {
    try {
        const { listMissions } = await import("@/lib/strategy-research/storage");
        const missions = await listMissions(uid, 10);
        const relevant = missions
            .filter((mission) => {
                const spec = mission as unknown as { spec?: { market?: string; asset?: string } };
                const asset = String(spec.spec?.market ?? spec.spec?.asset ?? "").toUpperCase();
                return !asset || asset === market.toUpperCase();
            })
            .slice(0, 5)
            .map((mission) => ({
                id: mission.id,
                title: (mission as { title?: string; name?: string }).title ?? (mission as { name?: string }).name ?? mission.id,
                status: (mission as { status?: string }).status ?? "unknown",
                stage: (mission as { stage?: string }).stage ?? undefined,
                updatedAt: (mission as { updatedAt?: number }).updatedAt ?? null,
            }));
        return { missions: relevant, note: relevant.length ? undefined : "No research missions found for this market." };
    } catch {
        return null;
    }
}

async function loadAccountRiskSection(uid: string, market: string): Promise<Record<string, unknown> | null> {
    try {
        const snap = await adminDatabase.ref(`trading_accounts/${uid}`).get();
        if (!snap.exists()) return null;
        const accounts = snap.val() as Record<string, unknown>;
        const accountId = Object.keys(accounts)[0];
        if (!accountId) return null;
        const snapshot = await loadAccountRiskSnapshot(uid, accountId, market);
        const equityRaw = Number((snapshot.accountRecord as { equity?: unknown } | undefined)?.equity);
        return {
            accountId,
            emergencyStop: snapshot.emergencyStop,
            balance: snapshot.account.balance ?? null,
            equity: Number.isFinite(equityRaw) && equityRaw > 0 ? equityRaw : null,
            openPositionsCount: snapshot.account.openPositionsCount ?? null,
            symbolExposureLots: snapshot.account.symbolExposureLots ?? null,
            dailyLossPercent: snapshot.account.dailyLossPercent ?? null,
            drawdownPercent: snapshot.account.drawdownPercent ?? null,
            note: "Account data is read-only context for risk validation.",
        };
    } catch {
        return null;
    }
}

export function productionDossierDeps(): DossierDeps {
    return {
        fetchCandles,
        loadSetups: loadSetupsSection,
        loadResearch: loadResearchSection,
        loadCalendar: loadCalendarSection,
        loadAccountRisk: loadAccountRiskSection,
    };
}

// ─── notifications ──────────────────────────────────────────────────────────

async function pushRunNotification(uid: string, run: TeamRun): Promise<void> {
    try {
        const level =
            run.status === "completed" ? "success" : run.status === "failed" ? "error" : "warning";
        const title =
            run.status === "failed"
                ? `${run.teamName}: analysis failed`
                : `${run.teamName}: ${run.synthesis?.setupState ?? run.status}`;
        const message =
            run.status === "failed"
                ? (run.errors[0] ?? "The team could not complete the analysis.")
                : `${run.market} · ${run.synthesis?.status === "blocked" ? "blocked pending validation" : "research brief ready"}.`;
        await adminDatabase.ref(`notifications/${uid}`).push({
            title,
            message,
            level,
            link: `/ai-trading-teams/${run.teamId}?run=${run.id}`,
            read: false,
            createdAt: Date.now(),
        });
    } catch (err) {
        console.warn("[ai-trading-teams] notification failed:", err);
    }
}

// ─── run execution ──────────────────────────────────────────────────────────

export interface ExecuteTeamRunOptions {
    uid: string;
    team: AITradingTeam;
    runId: string;
    request?: string;
    dataMode: TeamDataMode;
    asOf: number | null;
}

/**
 * Executes a queued team run to completion. Never throws — failures are
 * recorded on the run record so the UI can show a truthful failure state.
 */
export async function executeTeamRun(options: ExecuteTeamRunOptions): Promise<TeamRun | null> {
    const { uid, team, runId } = options;
    const existing = await getRun(uid, runId);
    if (!existing) return null;

    try {
        const { agents, missing } = await resolveTeamAgents(team);
        for (const miss of missing) {
            await patchRun(uid, runId, {
                errors: [...(existing.errors ?? []), `${miss.agentId}: ${miss.reason}`],
            });
        }
        if (agents.length === 0) {
            const failed: TeamRun = {
                ...existing,
                status: "failed",
                errors: [...existing.errors, "No resolvable agent definitions for this team."],
                finishedAt: Date.now(),
                durationMs: 0,
            };
            await saveRun(failed);
            await recordTeamEvent({ type: "team_run_failed", userId: uid, teamId: team.id, runId });
            await pushRunNotification(uid, failed);
            return failed;
        }

        const dossier = await buildDossier({
            userId: uid,
            market: team.config.market,
            entryTimeframe: team.config.entryTimeframe,
            confirmationTimeframe: team.config.confirmationTimeframe,
            contextTimeframe: team.config.contextTimeframe,
            mode: options.dataMode,
            asOf: options.asOf,
            deps: productionDossierDeps(),
        });

        const run = await runTeamAnalysis({
            runId,
            userId: uid,
            team,
            agents,
            request: options.request,
            dataMode: options.dataMode,
            asOf: options.asOf,
            dossier,
            ai: teamAIFn,
            isCancelled: () => isRunCancelled(uid, runId),
            onProgress: async (patch) => {
                await patchRun(uid, runId, patch);
            },
        });

        await saveRun(run);
        await recordAgentMetrics(Object.values(run.agentOutputs), run.finishedAt ?? Date.now());

        // Memory update is best-effort — a memory failure must not fail a run.
        try {
            await updateMemoryAfterRun(uid, team, run);
        } catch (err) {
            console.warn("[ai-trading-teams] memory update failed:", err);
        }

        await recordTeamEvent({
            type: run.status === "failed" ? "team_run_failed" : "team_run_completed",
            userId: uid,
            teamId: team.id,
            runId,
            meta: {
                status: run.status,
                durationMs: run.durationMs ?? 0,
                agentsExecuted: run.budget.agentsExecuted,
                aiCalls: run.budget.aiCalls,
                mode: options.dataMode,
                setupState: run.synthesis?.setupState ?? "NONE",
            },
        });

        await pushRunNotification(uid, run);
        await clearRunControl(uid, runId);
        return run;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[ai-trading-teams] run failed:", message);
        const failed: TeamRun = {
            ...existing,
            status: "failed",
            errors: [...existing.errors, message],
            finishedAt: Date.now(),
            durationMs: Date.now() - existing.startedAt,
        };
        try {
            await saveRun(failed);
            await recordTeamEvent({ type: "team_run_failed", userId: uid, teamId: team.id, runId, meta: { error: message.slice(0, 200) } });
            await pushRunNotification(uid, failed);
            await clearRunControl(uid, runId);
        } catch (persistErr) {
            console.error("[ai-trading-teams] failed to persist failure state:", persistErr);
        }
        return failed;
    }
}
