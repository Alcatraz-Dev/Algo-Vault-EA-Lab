import { adminDatabase } from "@/lib/firebase-admin";
import { BacktestResult, Deployment, ForwardTest, OptimizationOutcome, Strategy, ValidationOutcome } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Persistent storage helpers for the Strategy Lab.
//
// All state lives under  strategyLab/{uid}/{collection}  in Firebase RTDB,
// following the project convention of per-user object maps keyed by generated
// ids, with epoch-ms timestamps.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = "strategyLab";

function basePath(uid: string, collection: string) {
    return `${ROOT}/${uid}/${collection}`;
}

function pushId(ref: string): string {
    return adminDatabase.ref(ref).push().key!;
}

export async function saveStrategy(uid: string, strategy: Strategy): Promise<string> {
    const id = strategy.id || pushId(basePath(uid, "strategies"));
    await adminDatabase.ref(`${basePath(uid, "strategies")}/${id}`).set(strategy);
    return id;
}

export async function getStrategy(uid: string, strategyId: string): Promise<Strategy | null> {
    const snap = await adminDatabase.ref(`${basePath(uid, "strategies")}/${strategyId}`).get();
    return snap.exists() ? (snap.val() as Strategy) : null;
}

export async function listStrategies(uid: string, limit = 50): Promise<Strategy[]> {
    const snap = await adminDatabase.ref(`${basePath(uid, "strategies")}`).limitToLast(limit).get();
    if (!snap.exists()) return [];
    const all = Object.values(snap.val()) as Strategy[];
    return all.sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, limit);
}

export async function deleteStrategy(uid: string, strategyId: string): Promise<void> {
    await adminDatabase.ref(`${basePath(uid, "strategies")}/${strategyId}`).remove();
}

export async function saveBacktest(uid: string, result: BacktestResult): Promise<string> {
    const id = result.id || pushId(basePath(uid, "backtests"));
    await adminDatabase.ref(`${basePath(uid, "backtests")}/${id}`).set(result);
    return id;
}

export async function getBacktest(uid: string, backtestId: string): Promise<BacktestResult | null> {
    const snap = await adminDatabase.ref(`${basePath(uid, "backtests")}/${backtestId}`).get();
    return snap.exists() ? (snap.val() as BacktestResult) : null;
}

export async function listBacktests(uid: string, strategyId: string, limit = 20): Promise<BacktestResult[]> {
    const snap = await adminDatabase.ref(`${basePath(uid, "backtests")}`).limitToLast(limit * 3).get();
    if (!snap.exists()) return [];
    const all = Object.values(snap.val()) as BacktestResult[];
    return all.filter((b) => b.strategyId === strategyId).sort((a, b) => (b.generatedAt || 0) - (a.generatedAt || 0)).slice(-limit);
}

export async function saveOptimization(uid: string, result: OptimizationOutcome): Promise<string> {
    const id = result.id || pushId(basePath(uid, "optimizations"));
    await adminDatabase.ref(`${basePath(uid, "optimizations")}/${id}`).set(result);
    return id;
}

export async function saveValidation(uid: string, result: ValidationOutcome): Promise<string> {
    const id = result.id || pushId(basePath(uid, "validations"));
    await adminDatabase.ref(`${basePath(uid, "validations")}/${id}`).set(result);
    return id;
}

export async function saveForwardTest(uid: string, ft: ForwardTest): Promise<string> {
    const id = ft.id || pushId(basePath(uid, "forwardTests"));
    await adminDatabase.ref(`${basePath(uid, "forwardTests")}/${id}`).set(ft);
    return id;
}

export async function getForwardTest(uid: string, forwardTestId: string): Promise<ForwardTest | null> {
    const snap = await adminDatabase.ref(`${basePath(uid, "forwardTests")}/${forwardTestId}`).get();
    return snap.exists() ? (snap.val() as ForwardTest) : null;
}

export async function listForwardTests(uid: string, strategyId: string, limit = 20): Promise<ForwardTest[]> {
    const snap = await adminDatabase.ref(`${basePath(uid, "forwardTests")}`).limitToLast(limit * 2).get();
    if (!snap.exists()) return [];
    const all = Object.values(snap.val()) as ForwardTest[];
    return all.filter((ft) => ft.strategyId === strategyId).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(-limit);
}

export async function saveDeployment(uid: string, deployment: Deployment): Promise<string> {
    const id = deployment.id || pushId(basePath(uid, "deployments"));
    await adminDatabase.ref(`${basePath(uid, "deployments")}/${id}`).set(deployment);
    return id;
}

export async function getDeployment(uid: string, deploymentId: string): Promise<Deployment | null> {
    const snap = await adminDatabase.ref(`${basePath(uid, "deployments")}/${deploymentId}`).get();
    return snap.exists() ? (snap.val() as Deployment) : null;
}

export async function listDeployments(uid: string, limit = 50): Promise<Deployment[]> {
    const snap = await adminDatabase.ref(`${basePath(uid, "deployments")}`).limitToLast(limit).get();
    if (!snap.exists()) return [];
    const all = Object.values(snap.val()) as Deployment[];
    return all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, limit);
}

export async function deleteDeployment(uid: string, deploymentId: string): Promise<void> {
    await adminDatabase.ref(`${basePath(uid, "deployments")}/${deploymentId}`).remove();
}

export async function saveAnalysisSummary(uid: string, id: string, data: unknown): Promise<void> {
    await adminDatabase.ref(`${basePath(uid, "analyses")}/${id}`).set(data);
}

export async function savePatternResult(uid: string, id: string, data: unknown): Promise<void> {
    await adminDatabase.ref(`${basePath(uid, "patterns")}/${id}`).set(data);
}