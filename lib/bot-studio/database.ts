/**
 * Bot Studio — RTDB persistence helpers.
 *
 * ALL reads and writes to bot-studio RTDB paths go through this module.
 * Only the Firebase Admin SDK is used — no client SDK writes to these paths.
 *
 * RTDB layout:
 *   bot_strategies/{strategyId}          — BotStrategy record
 *   bot_deployments/{botId}              — BotDeployment record
 *   bot_logs/{botId}/{logId}             — BotLogEntry records (newest-first via push keys)
 *   bot_signals/{botId}/{signalId}       — BotSignal records
 *   bot_executions/{botId}/{execId}      — BotExecution records
 *   bot_audit/{botId}/{auditId}          — BotAuditEntry records (immutable)
 *   bot_strategies_index/{authorId}/{strategyId} — reverse index for author lookup
 *   bot_deployments_index/{ownerId}/{botId}      — reverse index for owner lookup
 */

import crypto from "crypto";
import { adminDatabase } from "@/lib/firebase-admin";
import type {
    BotAuditEntry,
    BotDeployment,
    BotExecution,
    BotLogEntry,
    BotSignal,
    BotStrategy,
    BotAuditAction,
    BotLogLevel,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// ID generators
// ─────────────────────────────────────────────────────────────────────────────

export function newStrategyId(): string {
    return `STRAT_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`.toUpperCase();
}

export function newBotId(): string {
    return `BSTUDIO_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`.toUpperCase();
}

export function newLogId(): string {
    return `LOG_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

export function newSignalId(): string {
    return `SIG_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

export function newExecutionId(): string {
    return `BEXEC_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`.toUpperCase();
}

export function newAuditId(): string {
    return `AUD_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deep-clean (RTDB rejects nested undefined)
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepClean(obj: any): any {
    if (obj === undefined) return null;
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(deepClean);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
        out[k] = deepClean(v);
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function saveStrategy(strategy: BotStrategy): Promise<void> {
    const clean = deepClean(strategy) as BotStrategy;
    await adminDatabase.ref(`bot_strategies/${strategy.id}`).set(clean);
    await adminDatabase.ref(`bot_strategies_index/${strategy.authorId}/${strategy.id}`).set(true);
}

export async function getStrategy(strategyId: string): Promise<BotStrategy | null> {
    const snap = await adminDatabase.ref(`bot_strategies/${strategyId}`).get();
    if (!snap.exists()) return null;
    const val = snap.val();
    if (!val || typeof val !== "object") return null;
    return val as BotStrategy;
}

export async function listStrategiesForAuthor(authorId: string): Promise<BotStrategy[]> {
    const indexSnap = await adminDatabase.ref(`bot_strategies_index/${authorId}`).get();
    if (!indexSnap.exists()) return [];
    const ids = Object.keys(indexSnap.val() as Record<string, unknown>);
    const results = await Promise.all(ids.map(getStrategy));
    return results.filter((s): s is BotStrategy => s !== null);
}

export async function listAllStrategies(): Promise<BotStrategy[]> {
    const snap = await adminDatabase.ref("bot_strategies").get();
    if (!snap.exists()) return [];
    const val = snap.val() as Record<string, unknown>;
    return Object.values(val)
        .filter((v): v is BotStrategy => !!v && typeof v === "object")
        .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteStrategy(strategyId: string): Promise<boolean> {
    const strategy = await getStrategy(strategyId);
    if (!strategy) return false;
    await adminDatabase.ref(`bot_strategies/${strategyId}`).remove();
    await adminDatabase.ref(`bot_strategies_index/${strategy.authorId}/${strategyId}`).remove();
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deployment CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function saveDeployment(deployment: BotDeployment): Promise<void> {
    const clean = deepClean(deployment) as BotDeployment;
    await adminDatabase.ref(`bot_deployments/${deployment.id}`).set(clean);
    await adminDatabase.ref(`bot_deployments_index/${deployment.ownerId}/${deployment.id}`).set(true);
}

export async function getDeployment(botId: string): Promise<BotDeployment | null> {
    const snap = await adminDatabase.ref(`bot_deployments/${botId}`).get();
    if (!snap.exists()) return null;
    const val = snap.val();
    if (!val || typeof val !== "object") return null;
    return val as BotDeployment;
}

export async function updateDeploymentState(
    botId: string,
    patch: Partial<BotDeployment>,
): Promise<void> {
    const clean = deepClean({ ...patch, updatedAt: Date.now() });
    await adminDatabase.ref(`bot_deployments/${botId}`).update(clean);
}

export async function listDeploymentsForOwner(ownerId: string): Promise<BotDeployment[]> {
    const indexSnap = await adminDatabase.ref(`bot_deployments_index/${ownerId}`).get();
    if (!indexSnap.exists()) return [];
    const ids = Object.keys(indexSnap.val() as Record<string, unknown>);
    const results = await Promise.all(ids.map(getDeployment));
    return results.filter((d): d is BotDeployment => d !== null);
}

export async function listAllDeployments(): Promise<BotDeployment[]> {
    const snap = await adminDatabase.ref("bot_deployments").get();
    if (!snap.exists()) return [];
    const val = snap.val() as Record<string, unknown>;
    return Object.values(val)
        .filter((v): v is BotDeployment => !!v && typeof v === "object")
        .sort((a, b) => b.updatedAt - a.updatedAt);
}

// ─────────────────────────────────────────────────────────────────────────────
// Log entries (append-only)
// ─────────────────────────────────────────────────────────────────────────────

const MAX_LOG_ENTRIES = 500; // per bot

export async function appendLog(
    botId: string,
    level: BotLogLevel,
    message: string,
    details?: Record<string, unknown>,
): Promise<BotLogEntry> {
    const entry: BotLogEntry = {
        id: newLogId(),
        botId,
        level,
        message,
        details: details ?? {},
        timestamp: Date.now(),
    };
    await adminDatabase.ref(`bot_logs/${botId}/${entry.id}`).set(deepClean(entry));
    return entry;
}

export async function getRecentLogs(botId: string, limit = 100): Promise<BotLogEntry[]> {
    const snap = await adminDatabase
        .ref(`bot_logs/${botId}`)
        .orderByChild("timestamp")
        .limitToLast(Math.min(limit, MAX_LOG_ENTRIES))
        .get();
    if (!snap.exists()) return [];
    const val = snap.val() as Record<string, unknown>;
    return Object.values(val)
        .filter((v): v is BotLogEntry => !!v && typeof v === "object")
        .sort((a, b) => b.timestamp - a.timestamp);
}

// ─────────────────────────────────────────────────────────────────────────────
// Signals (append-only)
// ─────────────────────────────────────────────────────────────────────────────

export async function saveSignal(signal: BotSignal): Promise<void> {
    await adminDatabase.ref(`bot_signals/${signal.botId}/${signal.id}`).set(deepClean(signal));
}

export async function updateSignal(
    botId: string,
    signalId: string,
    patch: Partial<BotSignal>,
): Promise<void> {
    await adminDatabase.ref(`bot_signals/${botId}/${signalId}`).update(deepClean(patch));
}

export async function getRecentSignals(botId: string, limit = 50): Promise<BotSignal[]> {
    const snap = await adminDatabase
        .ref(`bot_signals/${botId}`)
        .orderByChild("generatedAt")
        .limitToLast(Math.min(limit, 200))
        .get();
    if (!snap.exists()) return [];
    const val = snap.val() as Record<string, unknown>;
    return Object.values(val)
        .filter((v): v is BotSignal => !!v && typeof v === "object")
        .sort((a, b) => b.generatedAt - a.generatedAt);
}

// ─────────────────────────────────────────────────────────────────────────────
// Executions (append-only)
// ─────────────────────────────────────────────────────────────────────────────

export async function saveExecution(execution: BotExecution): Promise<void> {
    await adminDatabase
        .ref(`bot_executions/${execution.botId}/${execution.id}`)
        .set(deepClean(execution));
}

export async function updateExecution(
    botId: string,
    execId: string,
    patch: Partial<BotExecution>,
): Promise<void> {
    await adminDatabase
        .ref(`bot_executions/${botId}/${execId}`)
        .update(deepClean({ ...patch, updatedAt: Date.now() }));
}

/** One execution by its deterministic ID (gateway-report correlation). */
export async function getExecution(
    botId: string,
    execId: string,
): Promise<BotExecution | null> {
    const snap = await adminDatabase.ref(`bot_executions/${botId}/${execId}`).get();
    if (!snap.exists()) return null;
    return (snap.val() as BotExecution) ?? null;
}

export async function getRecentExecutions(botId: string, limit = 50): Promise<BotExecution[]> {
    const snap = await adminDatabase
        .ref(`bot_executions/${botId}`)
        .orderByChild("createdAt")
        .limitToLast(Math.min(limit, 200))
        .get();
    if (!snap.exists()) return [];
    const val = snap.val() as Record<string, unknown>;
    return Object.values(val)
        .filter((v): v is BotExecution => !!v && typeof v === "object")
        .sort((a, b) => b.createdAt - a.createdAt);
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit trail (immutable — never updated, never deleted)
// ─────────────────────────────────────────────────────────────────────────────

export async function appendAudit(
    botId: string,
    strategyId: string,
    action: BotAuditAction,
    actorId: string,
    details: Record<string, unknown>,
): Promise<BotAuditEntry> {
    const entry: BotAuditEntry = {
        id: newAuditId(),
        botId,
        strategyId,
        action,
        actorId,
        details,
        timestamp: Date.now(),
    };
    await adminDatabase.ref(`bot_audit/${botId}/${entry.id}`).set(deepClean(entry));
    return entry;
}

export async function getAuditTrail(botId: string, limit = 100): Promise<BotAuditEntry[]> {
    const snap = await adminDatabase
        .ref(`bot_audit/${botId}`)
        .orderByChild("timestamp")
        .limitToLast(Math.min(limit, 500))
        .get();
    if (!snap.exists()) return [];
    const val = snap.val() as Record<string, unknown>;
    return Object.values(val)
        .filter((v): v is BotAuditEntry => !!v && typeof v === "object")
        .sort((a, b) => b.timestamp - a.timestamp);
}

export const getRecentAudit = getAuditTrail;

