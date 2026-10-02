/**
 * AI Execution — server-side runtime.
 *
 * Gathers the REAL server-side context (market truth, account risk snapshot,
 * setup lifecycle, authorization, policy, kill switch), runs the deterministic
 * gate, and — only when the gate says EXECUTE — submits the order through the
 * EXISTING authorized MT5 boundary (mt5_orders + live_positions via the same
 * pattern as /api/signals/execute and dispatchProSignalToGateway).
 *
 * The AI never reaches this file's submission functions. Nothing here trusts a
 * client-supplied execution status, account id, risk limit or broker credential.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { newClientOrderId, getGatewayTokenForUser, hasActiveTradingLicense } from "@/lib/gateway";
import { loadAccountRiskSnapshot } from "@/lib/risk/account-state";
import { getMarketTruth } from "@/lib/market-data/market-truth";
import { authenticate, isAdminUid } from "@/lib/admin-auth";
import type { NextRequest } from "next/server";
import type { TradePlan, ExecutionPolicy } from "./types";
import { clampAutomationPolicy } from "./types";
import { evaluateGate, type GateContext } from "./gate";
import {
    AI_EXECUTION_PATHS,
    checkAndRecordSubmission,
    getExecutionPolicy,
    getKillSwitch,
    updatePlan,
    writeAudit,
} from "./database";

export interface AuthedCaller {
    uid: string;
    isAdmin: boolean;
}

/** Server-side authentication + admin resolution for every AI-execution API. */
export async function requireCaller(request: NextRequest): Promise<AuthedCaller | null> {
    const token = await authenticate(request);
    if (!token) return null;
    const admin = token.admin === true || (await isAdminUid(token.uid));
    return { uid: token.uid, isAdmin: admin };
}

function connectedAccountKey(accounts: Record<string, unknown>): string | null {
    for (const [key, raw] of Object.entries(accounts)) {
        const acct = raw as { status?: string } | null;
        if (acct && acct.status === "connected") return key;
    }
    return null;
}

/**
 * Resolve the caller's connected MT5 account (the account KEY used in RTDB
 * paths, e.g. `gateway_12345`). Never accepts an account from the request body.
 */
export async function resolveConnectedAccount(uid: string): Promise<string | null> {
    const snap = await adminDatabase.ref(`trading_accounts/${uid}`).get();
    if (!snap.exists()) return null;
    return connectedAccountKey((snap.val() || {}) as Record<string, unknown>);
}

async function loadOpenPositions(uid: string, accountKey: string): Promise<Array<{ symbol: string; volume: number; ticket?: string }>> {
    const snap = await adminDatabase.ref(`trading_positions/${uid}/${accountKey}`).get();
    if (!snap.exists()) return [];
    const val = (snap.val() || {}) as Record<string, { symbol?: string; volume?: number; ticket?: string }>;
    return Object.entries(val).map(([ticket, p]) => ({
        symbol: String(p.symbol ?? "").toUpperCase(),
        volume: Number(p.volume) || 0,
        ticket: p.ticket ?? ticket,
    }));
}

async function loadSetupStatus(uid: string, setupId?: string): Promise<string | null> {
    if (!setupId) return null;
    const snap = await adminDatabase.ref(`monitoring/setups/${uid}/${setupId}`).get();
    if (!snap.exists()) return null;
    const val = snap.val() as { status?: string };
    return val?.status ?? null;
}

async function loadRecentSubmissionKeys(uid: string): Promise<string[]> {
    const snap = await adminDatabase.ref(AI_EXECUTION_PATHS.submissions(uid)).get();
    if (!snap.exists()) return [];
    const val = (snap.val() || {}) as Record<string, { key?: string; at?: number }>;
    const cutoff = Date.now() - 10 * 60_000;
    return Object.values(val)
        .filter((s) => s && Number(s.at) > cutoff && typeof s.key === "string")
        .map((s) => s.key as string);
}

export interface GateRunContext {
    caller: AuthedCaller;
    policy: ExecutionPolicy;
    /** Instrument override for freshness/quote (defaults to plan.instrument). */
}

/**
 * Assemble the full server-side GateContext for a plan and evaluate the gate.
 * Persists nothing. Used by: generation flow, approval submit, automation tick,
 * AI-terminal display, and (with synthetic context) the replay adapter.
 */
export async function runServerGate(plan: TradePlan, caller: AuthedCaller): Promise<{ plan: TradePlan; result: ReturnType<typeof evaluateGate> }> {
    const policy = await getExecutionPolicy(caller.uid);
    const automation = clampAutomationPolicy(policy.automation);
    const killSwitch = await getKillSwitch();

    const accountKey = await resolveConnectedAccount(caller.uid);
    const hasLicense = await hasActiveTradingLicense(caller.uid).catch(() => false);
    const hasGatewayToken = Boolean(await getGatewayTokenForUser(caller.uid).catch(() => null));

    const [riskSnapshot, openPositions, setupStatus, recentKeys, truth] = await Promise.all([
        accountKey
            ? loadAccountRiskSnapshot(caller.uid, accountKey, plan.instrument).catch(() => undefined)
            : Promise.resolve(undefined),
        accountKey ? loadOpenPositions(caller.uid, accountKey).catch(() => []) : Promise.resolve([]),
        plan.setupId ? loadSetupStatus(caller.uid, plan.setupId) : Promise.resolve(null),
        loadRecentSubmissionKeys(caller.uid),
        getMarketTruth(plan.instrument, (plan.timeframe as never) || "M5").catch(() => null),
    ]);

    const quote = truth?.snapshot
        ? {
              price: truth.snapshot.currentPrice,
              spread: truth.snapshot.spread,
              timestamp: truth.snapshot.timestamp,
              provider: truth.snapshot.provider,
          }
        : null;

    const ctx: GateContext = {
        now: Date.now(),
        executionMode: policy.executionMode,
        automation,
        quote,
        setupStatus,
        openPositions,
        riskSnapshot,
        authorization: { hasAccount: Boolean(accountKey), hasLicense, hasGatewayToken },
        recentSubmissionKeys: recentKeys,
        killSwitchEngaged: killSwitch.engaged,
    };

    const result = evaluateGate({ plan, ctx });
    return { plan, result };
}

/**
 * Submit an approved plan through the EXISTING gateway order path.
 *
 * Writes exactly the same records the platform's other execution paths write:
 *   mt5_orders/{account}/{clientOrderId}        (the EA polls this queue)
 *   live_positions/live_{account}/{clientOrderId} (tracking, status=PENDING_MT5_EXECUTION)
 *
 * No ticket is fabricated — the real MT5 ticket arrives later via the gateway
 * state sync, at which point recordGatewayConfirmation() upgrades the plan.
 */
export async function submitApprovedPlan(plan: TradePlan, caller: AuthedCaller, volume: number): Promise<{ ok: boolean; clientOrderId?: string; mt5Account?: string; error?: string }> {
    // Re-verify authorization at submission time (never cached from the gate).
    const accountKey = await resolveConnectedAccount(caller.uid);
    if (!accountKey) return { ok: false, error: "No connected MT5 account." };
    const hasLicense = await hasActiveTradingLicense(caller.uid).catch(() => false);
    const hasToken = Boolean(await getGatewayTokenForUser(caller.uid).catch(() => null));
    if (!hasLicense && !hasToken) return { ok: false, error: "Not authorized for gateway execution." };

    // Duplicate prevention is the last line before the write (atomic-ish: check
    // then record; the 10-minute window makes a race benign for this use case).
    const dup = await checkAndRecordSubmission(caller.uid, plan);
    if (dup.duplicate) {
        await writeAudit({
            userId: caller.uid,
            action: "EXECUTION_REJECTED",
            planId: plan.id,
            actor: "system",
            reason: "DUPLICATE_ORDER",
        });
        return { ok: false, error: "Duplicate order — identical submission already recorded recently." };
    }

    const mt5AccountNumber = accountKey.startsWith("gateway_") ? accountKey.slice("gateway_".length) : accountKey;
    const clientOrderId = newClientOrderId("aie");
    const now = Date.now();
    const symbol = plan.instrument.replace("/", "");

    const orderRecord = {
        ticket: clientOrderId,
        symbol,
        type: plan.direction,
        volume: Number(volume.toFixed(2)),
        openPrice: plan.entry,
        currentPrice: plan.entry,
        stopLoss: plan.stopLoss,
        takeProfit: plan.takeProfits[0]?.price ?? 0,
        profit: 0,
        swap: 0,
        magic: 777333, // AI Execution magic number (distinct from other paths)
        source: "AlgoVault AI Execution",
        planId: plan.id,
        signalId: plan.signalId ?? plan.id,
        userId: caller.uid,
        openedAt: now,
        lastSeenAt: now,
        updatedAt: now,
        status: "PENDING_MT5_EXECUTION",
    };

    try {
        await adminDatabase.ref(`mt5_orders/${accountKey}/${clientOrderId}`).set(orderRecord);
        await adminDatabase.ref(`live_positions/live_${mt5AccountNumber}/${clientOrderId}`).set(orderRecord);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Gateway submission failed.";
        await writeAudit({
            userId: caller.uid,
            action: "EXECUTION_FAILED",
            planId: plan.id,
            actor: "system",
            error: message,
        });
        await updatePlan(caller.uid, plan.id, { status: "FAILED", rejectionStage: "SUBMISSION", rejectionReason: message });
        return { ok: false, error: message };
    }

    await updatePlan(caller.uid, plan.id, {
        status: "SUBMITTED",
        execution: {
            mt5Account: accountKey,
            clientOrderId,
            submittedAt: now,
        },
    });

    await writeAudit({
        userId: caller.uid,
        action: "EXECUTION_SUBMITTED",
        planId: plan.id,
        actor: caller.isAdmin ? `admin:${caller.uid}` : caller.uid,
        executionMode: plan.executionMode,
        evidenceIds: plan.evidence.map((e) => e.id),
        brokerResponse: { clientOrderId, queued: true },
    });

    return { ok: true, clientOrderId, mt5Account: accountKey };
}

/**
 * Gateway state sync calls this when the EA reports a real fill/rejection for
 * a clientOrderId minted by this module. Only real gateway acknowledgements
 * can move a plan to OPEN / FAILED.
 */
export async function recordGatewayConfirmation(
    uid: string,
    clientOrderId: string,
    outcome: { filled: boolean; ticket?: string; price?: number; rejectionReason?: string },
): Promise<void> {
    const snap = await adminDatabase.ref(`${AI_EXECUTION_PATHS.plans(uid)}`).get();
    if (!snap.exists()) return;
    const plans = snap.val() as Record<string, TradePlan>;
    const plan = Object.values(plans).find((p) => p.execution?.clientOrderId === clientOrderId);
    if (!plan) return;

    if (outcome.filled) {
        await updatePlan(uid, plan.id, {
            status: "OPEN",
            execution: {
                ...plan.execution,
                gatewayTicket: outcome.ticket ? String(outcome.ticket) : plan.execution?.gatewayTicket,
                confirmedAt: Date.now(),
            },
        });
        await writeAudit({
            userId: uid,
            action: "EXECUTION_ACCEPTED",
            planId: plan.id,
            actor: "gateway",
            brokerResponse: { ticket: outcome.ticket ?? null, price: outcome.price ?? null },
        });
    } else {
        await updatePlan(uid, plan.id, { status: "FAILED", rejectionStage: "SUBMISSION", rejectionReason: outcome.rejectionReason ?? "Gateway rejected the order." });
        await writeAudit({
            userId: uid,
            action: "EXECUTION_REJECTED",
            planId: plan.id,
            actor: "gateway",
            reason: outcome.rejectionReason ?? "GATEWAY_REJECTED",
        });
    }
}
