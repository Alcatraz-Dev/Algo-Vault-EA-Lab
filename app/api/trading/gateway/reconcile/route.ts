import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { requireAdmin, errMessage } from "@/lib/admin-auth";
import { isCronRequest } from "@/lib/security/cron-auth";
import { getExecution, updateExecution } from "@/lib/bot-studio/database";
import {
    isAwaitingBrokerOutcome,
    isClaimExpired,
    positionSide,
    singleCandidate,
    type RecoverablePosition,
} from "@/lib/trading/gateway/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bounded recovery sweep for gateway commands whose consumer disappeared.
 *
 * A command is claimed atomically by `/gateway/commands` for
 * `COMMAND_CLAIM_TTL_MS`. If the EA dies, restarts, or loses the network after
 * the claim but before reporting, the command would otherwise stay `executing`
 * forever. This route settles those claims from AUTHORITATIVE evidence only:
 *
 *   broker position (magic + symbol + side + unused ticket) → confirmed fill
 *   no single match                                        → explicit `uncertain`
 *
 * It never re-queues and never resubmits: the EA may already have submitted
 * the order, so a second delivery could double the position. Ambiguity is kept
 * visible (`reconciliationRequired`) for human resolution instead of being
 * turned into a fabricated success or failure.
 *
 * Invocation is the deployment's job (cron secret or an admin session), like
 * the other `/cron` routes. The sweep is idempotent and safe to run at any
 * frequency: every write is guarded by a per-command transaction.
 */

/** Bound the work per invocation so a sweep stays request-sized. */
const MAX_RECONCILE_PER_RUN = 100;

/** Cron secret or an authenticated admin session. Never a gateway token. */
async function isAuthorized(request: NextRequest): Promise<boolean> {
    if (isCronRequest(request)) return true;
    const admin = await requireAdmin(request);
    return Boolean(admin);
}

interface ReconcileResult {
    commandId: string;
    userId: string;
    outcome: "recovered" | "uncertain" | "skipped";
    ticket?: string;
    reason?: string;
}

function actionSide(action: unknown): "BUY" | "SELL" | null {
    const value = String(action ?? "").toUpperCase();
    if (value.startsWith("BUY")) return "BUY";
    if (value.startsWith("SELL")) return "SELL";
    return null;
}

async function readPositions(
    userId: string,
    accountId: string
): Promise<RecoverablePosition[]> {
    const snap = await adminDatabase.ref(`trading_positions/${userId}/${accountId}`).get();
    const raw = snap.val();
    if (!raw || typeof raw !== "object") return [];
    return Object.entries(raw as Record<string, Record<string, unknown>>).map(([key, pos]) => ({
        ticket: String(pos?.ticket ?? key),
        magic: String(pos?.magic ?? ""),
        symbol: String(pos?.symbol ?? "").toUpperCase(),
        side: positionSide(pos?.type),
        volume: Number(pos?.volume ?? 0),
        openPrice: Number(pos?.openPrice ?? pos?.currentPrice ?? 0),
    }));
}

/**
 * Reconcile one expired claim.
 *
 * The command is NEVER re-queued: the consumer may have submitted before it
 * vanished. The only safe paths are
 *   (a) broker state proves the trade exists → record it as broker-confirmed,
 *   (b) no single authoritative match → keep an explicit `uncertain` state.
 */
async function reconcileCommand(
    userId: string,
    commandId: string,
    command: Record<string, unknown>,
    now: number,
): Promise<ReconcileResult> {
    const accountId = String(command.accountId ?? "");
    const botId = typeof command.botId === "string" ? command.botId : "";
    const executionId = typeof command.executionId === "string" ? command.executionId : "";
    const isBotCommand = botId !== "" && executionId !== "";

    if (!accountId) {
        return { commandId, userId, outcome: "skipped", reason: "Command has no account scope." };
    }

    const positions = await readPositions(userId, accountId);
    const side = actionSide(command.action);

    let matched: RecoverablePosition | null = null;
    if (isBotCommand && side && String(command.magicNumber ?? "") !== "") {
        // Tickets already attributed to another execution are not reusable.
        const executionsSnap = await adminDatabase.ref(`bot_executions/${botId}`).get();
        const executions = (executionsSnap.val() || {}) as Record<string, Record<string, unknown>>;
        const usedTickets = new Set(
            Object.values(executions)
                .filter((execution) => execution && execution.id !== executionId)
                .map((execution) => String(execution.mt5Ticket ?? ""))
                .filter((value) => value !== "")
        );

        const match = singleCandidate(
            positions.filter(
                (position) =>
                    position.magic === String(command.magicNumber) &&
                    position.symbol === String(command.symbol ?? "").toUpperCase() &&
                    position.side === side &&
                    !usedTickets.has(position.ticket)
            )
        );
        if (match) matched = match;
    }

    const execution = isBotCommand ? await getExecution(botId, executionId) : null;
    // A record that already carries broker evidence is never overwritten.
    const executionSettled = !!execution && !isAwaitingBrokerOutcome(String(execution.status ?? ""));

    // Broker evidence alone settles the COMMAND, even when the execution
    // record is missing or was never created: the trade provably exists.
    if (matched) {
        const patch = {
            status: "filled",
            mt5Ticket: Number(matched.ticket) || undefined,
            fillPrice: matched.openPrice > 0 ? matched.openPrice : undefined,
            fillVolume: matched.volume > 0 ? matched.volume : undefined,
            executionOutcome: "confirmed",
            reconciledAt: now,
            recoveredAt: now,
            recoverySource: "broker_snapshot",
            reconciliationRequired: false,
        } as const;

        const settlement = await adminDatabase
            .ref(`trading_order_requests/${userId}/${commandId}`)
            .transaction((current) => {
                if (!current || typeof current !== "object") return undefined;
                const cmd = current as Record<string, unknown>;
                // A real report (or another reconciler) already settled it.
                if (cmd.status !== "executing") return undefined;
                return {
                    ...cmd,
                    status: "filled",
                    mt5Ticket: matched.ticket,
                    recoveredAt: now,
                    reconciledAt: now,
                    recoverySource: "broker_snapshot",
                    reconciliationRequired: false,
                    updatedAt: now,
                };
            });

        // The transaction is the race guard: if a report settled the command
        // first, this reconciler must not touch the execution record either.
        if (!settlement.committed) {
            return { commandId, userId, outcome: "skipped", reason: "settled_elsewhere" };
        }
        if (execution && !executionSettled) {
            await updateExecution(botId, executionId, patch);
        }
        return { commandId, userId, outcome: "recovered", ticket: matched.ticket };
    }

    // No single authoritative match. Preserve uncertainty explicitly; never
    // guess a fill or a failure, and never resubmit.
    const settlement = await adminDatabase
        .ref(`trading_order_requests/${userId}/${commandId}`)
        .transaction((current) => {
            if (!current || typeof current !== "object") return undefined;
            const cmd = current as Record<string, unknown>;
            if (cmd.status !== "executing") return undefined;
            return {
                ...cmd,
                status: "uncertain",
                reconciledAt: now,
                reconciliationRequired: true,
                reconciliationReason: isBotCommand
                    ? "Claim expired without an execution report and no single broker position matched."
                    : "Claim expired without an execution report; command is not bot-attributed, so no safe automatic reconciliation exists.",
                updatedAt: now,
            };
        });

    if (!settlement.committed) {
        return { commandId, userId, outcome: "skipped", reason: "settled_elsewhere" };
    }
    // Refine ONLY records that have no broker evidence yet. `filled`,
    // `rejected_by_broker`, `executed_pending_sync`, `failed` and `cancelled`
    // already carry an authoritative outcome and must survive a late sweep.
    if (execution && !executionSettled) {
        await updateExecution(botId, executionId, {
            status: "uncertain",
            executionOutcome: "uncertain",
            reconciledAt: now,
            reconciliationRequired: true,
        });
    }

    return {
        commandId,
        userId,
        outcome: "uncertain",
        reason: isBotCommand ? "no_single_broker_match" : "not_bot_attributed",
    };
}

export async function GET(request: NextRequest) {
    if (!(await isAuthorized(request))) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    try {
        const now = Date.now();
        const snap = await adminDatabase.ref("trading_order_requests").get();
        const users = (snap.val() || {}) as Record<string, Record<string, Record<string, unknown>>>;

        const results: ReconcileResult[] = [];
        let scanned = 0;

        sweep: for (const [userId, commands] of Object.entries(users)) {
            if (!commands || typeof commands !== "object") continue;
            for (const [commandId, command] of Object.entries(commands)) {
                if (results.length >= MAX_RECONCILE_PER_RUN) break sweep;
                if (!command || typeof command !== "object") continue;
                if (command.status !== "executing") continue;
                if (!isClaimExpired(command, now)) continue;

                scanned += 1;
                try {
                    results.push(await reconcileCommand(userId, commandId, command, now));
                } catch (error) {
                    console.error("[gateway/reconcile] command failed", {
                        commandId,
                        error: error instanceof Error ? error.message : "unknown",
                    });
                    results.push({ commandId, userId, outcome: "skipped", reason: "error" });
                }
            }
        }

        return NextResponse.json({
            ok: true,
            scanned,
            recovered: results.filter((result) => result.outcome === "recovered").length,
            uncertain: results.filter((result) => result.outcome === "uncertain").length,
            results,
        });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Gateway reconciliation failed") },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    return GET(request);
}
