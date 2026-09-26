/**
 * Strategy Lab DNA + evolution persistence (server-only).
 *
 * Stored under the existing `strategyLab/{uid}` subtree, which the current
 * `database.rules.json` already protects with an owner-or-admin rule. No new
 * rules entries are required beyond the index on `asOf` below — the two new
 * children are simply namespaced under the same owner.
 *
 *   strategyLab/{uid}/evolutionRuns/{runId}  → EvolutionRun
 *   strategyLab/{uid}/dnaCandidates/{dnaId}   → StrategyDna
 *
 * Reads are paginated and capped so a browser can never pull an unbounded
 * number of records.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import type { SupportedSymbol } from "@/lib/market-data/types";
import type { StrategyDna } from "@/lib/ai/strategy-lab/dna";
import type { EvolutionRun, GenerationReport } from "@/lib/ai/strategy-lab/evolution";

export const EVOLUTION_RUNS_PATH = "evolutionRuns";
export const DNA_CANDIDATES_PATH = "dnaCandidates";

/** Hard read caps. Callers may request fewer, never more. */
export const MAX_RUNS_PER_READ = 20;

export async function saveEvolutionRun(uid: string, run: EvolutionRun): Promise<void> {
    await adminDatabase.ref(`strategyLab/${uid}/${EVOLUTION_RUNS_PATH}/${run.id}`).set(run);
}

export async function getEvolutionRun(uid: string, runId: string): Promise<EvolutionRun | null> {
    const snap = await adminDatabase.ref(`strategyLab/${uid}/${EVOLUTION_RUNS_PATH}/${runId}`).get();
    return snap.exists() ? (snap.val() as EvolutionRun) : null;
}

/**
 * List runs newest-first. `limit` is clamped to {@link MAX_RUNS_PER_READ}.
 * The returned runs are summaries — the newest run keeps its `details`, older
 * runs are stripped to their real counts so the payload stays bounded.
 */
export async function listEvolutionRuns(
    uid: string,
    options?: { limit?: number; symbol?: SupportedSymbol }
): Promise<EvolutionRun[]> {
    const limit = Math.max(1, Math.min(options?.limit ?? 10, MAX_RUNS_PER_READ));

    const ref = adminDatabase.ref(`strategyLab/${uid}/${EVOLUTION_RUNS_PATH}`);
    const snap = await (options?.symbol
        ? ref.orderByChild("asOf").limitToLast(Math.max(limit * 3, 30)).get()
        : ref.orderByChild("asOf").limitToLast(limit).get());
    if (!snap.exists()) return [];

    const raw = snap.val() as Record<string, EvolutionRun>;
    let runs = Object.keys(raw)
        .map((k) => raw[k])
        .sort((a, b) => b.asOf - a.asOf);
    if (options?.symbol) {
        runs = runs.filter((r) => r.symbol === options.symbol);
    }
    runs = runs.slice(0, limit);
    return runs.map((run, index) => (index === 0 ? run : stripDetails(run)));
}

/** Drop per-candidate detail from an older run. Counts are left untouched. */
function stripDetails(run: EvolutionRun): EvolutionRun {
    return {
        ...run,
        generationReports: run.generationReports.map((g) => {
            const rest: GenerationReport = { ...g, details: undefined };
            delete rest.details;
            return rest;
        }),
    };
}

export async function deleteEvolutionRun(uid: string, runId: string): Promise<void> {
    await adminDatabase.ref(`strategyLab/${uid}/${EVOLUTION_RUNS_PATH}/${runId}`).remove();
}

export async function saveDna(uid: string, dna: StrategyDna): Promise<void> {
    await adminDatabase.ref(`strategyLab/${uid}/${DNA_CANDIDATES_PATH}/${dna.id}`).set(dna);
}

export async function getDna(uid: string, dnaId: string): Promise<StrategyDna | null> {
    const snap = await adminDatabase.ref(`strategyLab/${uid}/${DNA_CANDIDATES_PATH}/${dnaId}`).get();
    return snap.exists() ? (snap.val() as StrategyDna) : null;
}

export async function listDna(uid: string, limit = 50): Promise<StrategyDna[]> {
    const capped = Math.max(1, Math.min(limit, MAX_RUNS_PER_READ * 5));
    const snap = await adminDatabase
        .ref(`strategyLab/${uid}/${DNA_CANDIDATES_PATH}`)
        .orderByChild("createdAt")
        .limitToLast(capped)
        .get();
    if (!snap.exists()) return [];
    const raw = snap.val() as Record<string, StrategyDna>;
    return Object.keys(raw)
        .map((k) => raw[k])
        .sort((a, b) => b.createdAt - a.createdAt);
}
