import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { verifyGatewayToken, resolveGatewayToken } from "@/lib/gateway";
import { isCopiedLedgerPosition, mirrorMasterClose, mirrorMasterOrder, recordMasterPerformance } from "@/lib/copy-trading";
import { writeClosedDealHistory } from "@/lib/trading/closed-deals";
import { getBotOwnedMagics, findMatchingBots, indexBotPosition, clearBotPositions, indexBotTrade } from "@/lib/bots";
import { listDeploymentsForOwner, updateExecution } from "@/lib/bot-studio/database";
import {
    EXECUTION_RECOVERY_WINDOW_MS,
    canSettleFromBrokerEvidence,
    positionSide,
    singleCandidate,
} from "@/lib/trading/gateway/lifecycle";

export const runtime = "nodejs";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
}

function normalizePositionType(value: unknown): string {
    const s = String(value ?? "").trim().toUpperCase();
    if (s === "BUY" || s === "OP_BUY" || s === "0") return "BUY";
    if (s === "SELL" || s === "OP_SELL" || s === "1") return "SELL";
    return s;
}

/**
 * True when the position belongs to this account but originated from a copy
 * signal (either already acked into mt5_orders, or still queued/executing in
 * trading_order_requests). Prevents copy-of-copy recursion when a gateway
 * account that is itself being copied also acts as a master.
 */
async function isCopiedSnapshotPosition(
    userId: string,
    accountNumber: string,
    ticket: string
): Promise<boolean> {
    if (await isCopiedLedgerPosition(accountNumber, ticket)) return true;

    const reqsSnap = await adminDatabase
        .ref(`trading_order_requests/${userId}`)
        .get();
    const reqs = reqsSnap.val() || {};
    for (const key of Object.keys(reqs)) {
        const cmd = reqs[key];
        if (!cmd || String(cmd.source ?? "") !== "copy_follower") continue;
        if (
            String(key) === ticket ||
            String(cmd.ticket ?? "") === ticket ||
            String(cmd.mt5Ticket ?? "") === ticket ||
            String(cmd.clientOrderId ?? "") === ticket
        ) {
            return true;
        }
    }
    return false;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const gatewayToken = resolveGatewayToken(request.headers.get("authorization"), body);
        const accountNumber = String(body.accountNumber || "").trim();
        const positions = Array.isArray(body.positions) ? body.positions : [];
        const orders = Array.isArray(body.orders) ? body.orders : [];

        if (!gatewayToken || !accountNumber) {
            return NextResponse.json(
                { success: false, error: "gatewayToken and accountNumber are required." },
                { status: 400, headers: corsHeaders }
            );
        }

        const gatewayUser = await verifyGatewayToken(gatewayToken);
        if (!gatewayUser) {
            return NextResponse.json(
                { success: false, error: "Invalid gateway token." },
                { status: 403, headers: corsHeaders }
            );
        }

        const userId = gatewayUser.userId;
        const accountId = `gateway_${accountNumber}`;
        const now = Date.now();

        const prevSnap = await adminDatabase
            .ref(`trading_positions/${userId}/${accountId}`)
            .get();
        const prevPositions = (prevSnap.val() || {}) as Record<string, unknown>;

        const positionsData: Record<string, unknown> = {};
        for (const pos of positions) {
            const p = pos as Record<string, unknown>;
            const ticket = String(p.ticket || "");
            if (ticket) {
                positionsData[ticket] = {
                    ticket,
                    symbol: String(p.symbol || ""),
                    type: normalizePositionType(p.type),
                    volume: Number(p.volume || 0),
                    openPrice: Number(p.openPrice || 0),
                    currentPrice: Number(p.currentPrice || 0),
                    sl: Number(p.sl || 0),
                    tp: Number(p.tp || 0),
                    profit: Number(p.profit || 0),
                    swap: Number(p.swap || 0),
                    magic: Number(p.magic || 0),
                    comment: String(p.comment || ""),
                    openedAt: Number(p.openedAt || 0),
                    updatedAt: now,
                };
            }
        }

        await adminDatabase
            .ref(`trading_positions/${userId}/${accountId}`)
            .set(positionsData);

        const ordersData: Record<string, unknown> = {};
        for (const ord of orders) {
            const o = ord as Record<string, unknown>;
            const ticket = String(o.ticket || "");
            if (ticket) {
                ordersData[ticket] = {
                    ticket,
                    symbol: String(o.symbol || ""),
                    type: String(o.type || ""),
                    volume: Number(o.volume || 0),
                    price: Number(o.price || 0),
                    sl: Number(o.sl || 0),
                    tp: Number(o.tp || 0),
                    status: String(o.status || ""),
                    updatedAt: now,
                };
            }
        }

        await adminDatabase
            .ref(`trading_orders/${userId}/${accountId}`)
            .set(ordersData);

        // ── MT5 Deal History (closedDeals) — full account history ───────
        // The gateway EA harvests MT5 deal history (HistorySelect) and
        // reports every closing deal. These are written to `trading_history`
        // so the terminal shows the complete account trade history regardless
        // of whether the position was seen open in a prior snapshot.
        const closedDeals = Array.isArray(body.closedDeals) ? body.closedDeals : [];
        if (closedDeals.length > 0) {
            for (const deal of closedDeals) {
                await writeClosedDealHistory(userId, accountId, deal as Record<string, unknown>);
            }
        }

        // ── Copy trading: mirror master opens / closes ────────────────────
        // The gateway EA reports every position on each snapshot, so diffing
        // against the previous snapshot yields newly opened masters (mirror
        // open) and positions that disappeared (mirror close). Positions that
        // were themselves copied are skipped to avoid copy-of-copy recursion.
        const openedTickets = Object.keys(positionsData).filter(
            (t) => !(t in prevPositions)
        );
        const removedTickets = Object.keys(prevPositions).filter(
            (t) => !(t in positionsData)
        );

        // Bot Studio attribution for THIS gateway account: deployments and
        // strategy magics are read ONCE per snapshot, never per position. A
        // magic claimed by two deployments on the same account is ambiguous
        // and is deliberately left unattributed rather than guessed.
        const studioByMagic = new Map<string, { botId: string; strategyId: string }>();
        try {
            const deployments = (await listDeploymentsForOwner(userId)).filter(
                (deployment) => String(deployment.mt5Account || "").replace(/^gateway_/, "") === accountNumber,
            );
            if (deployments.length > 0) {
                const strategySnap = await adminDatabase.ref("bot_strategies").get();
                const strategies = (strategySnap.val() || {}) as Record<string, { magicNumber?: number }>;
                const ambiguous = new Set<string>();
                for (const deployment of deployments) {
                    const magic = String(strategies[deployment.strategyId]?.magicNumber ?? "");
                    if (!magic) continue;
                    if (studioByMagic.has(magic)) ambiguous.add(magic);
                    else studioByMagic.set(magic, { botId: deployment.id, strategyId: deployment.strategyId });
                }
                for (const magic of ambiguous) studioByMagic.delete(magic);
            }
        } catch (error) {
            console.error("[gateway/snapshot] bot attribution lookup failed", {
                error: error instanceof Error ? error.message : "unknown",
            });
        }
        // Executions are read at most once per bot per snapshot.
        const studioExecutions = new Map<string, Record<string, Record<string, unknown>>>();
        const loadStudioExecutions = async (botId: string) => {
            if (!studioExecutions.has(botId)) {
                const snap = await adminDatabase.ref(`bot_executions/${botId}`).get();
                studioExecutions.set(botId, (snap.val() || {}) as Record<string, Record<string, unknown>>);
            }
            return studioExecutions.get(botId)!;
        };

        // Magics claimed by this user's registered bots (custom + marketplace).
        // Positions carrying one of these belong to a bot and are never pushed
        // into the live marketplace mirror/copy pipeline. The same positions
        // ARE indexed under bot_positions/{botId}/{ticket} so each bot has an
        // exact open-position set.
        const ownedMagics = await getBotOwnedMagics(userId, accountNumber);
        const perBotTickets = new Map<string, string[]>();

        for (const [ticket, posRaw] of Object.entries(positionsData)) {
            const pos = posRaw as Record<string, unknown>;
            const magic = String(pos.magic ?? "");
            if (magic === "") continue;

            const studioMatch = studioByMagic.get(magic);
            if (studioMatch) {
                await indexBotPosition(studioMatch.botId, {
                    ...pos,
                    ticket,
                    strategyId: studioMatch.strategyId,
                    accountId,
                });
                const studioTickets = perBotTickets.get(studioMatch.botId) || [];
                studioTickets.push(ticket);
                perBotTickets.set(studioMatch.botId, studioTickets);

                // Broker-confirmed position: settle the execution whose reported
                // MT5 ticket this is. Ticket equality is the only match — a
                // manual trade (no bot magic) never reaches this branch.
                const executions = await loadStudioExecutions(studioMatch.botId);
                const matching = Object.entries(executions).find(
                    ([, execution]) => String(execution.mt5Ticket ?? "") === ticket,
                );
                if (matching) {
                    const execution = matching[1];
                    await updateExecution(studioMatch.botId, matching[0], {
                        status: "filled",
                        executionOutcome: "confirmed",
                        synchronizedAt: now,
                        latencyMs: {
                            ...((execution.latencyMs as Record<string, number | undefined>) ?? {}),
                            brokerToSync: typeof execution.brokerConfirmedAt === "number"
                                ? Math.max(0, now - Number(execution.brokerConfirmedAt))
                                : undefined,
                        },
                    });
                    continue;
                }

                // Lost/delayed execution report: broker state is authoritative.
                // Adopt a ticket ONLY when exactly one in-flight execution for
                // this bot/symbol/side has no ticket yet. Ambiguity stays
                // `uncertain` (surfaced by the reconciliation sweep) — a ticket
                // is never guessed onto one of several candidates.
                const orphan = singleCandidate(
                    Object.entries(executions).filter(([, execution]) => {
                        const status = String(execution.status ?? "");
                        const isInFlight = status === "submitted"
                            || status === "uncertain"
                            || status === "executed_pending_sync";
                        const submittedAt = Number(execution.submittedAt ?? execution.createdAt ?? 0);
                        return isInFlight
                            && (execution.mt5Ticket == null || String(execution.mt5Ticket) === "")
                            && String(execution.symbol ?? "").toUpperCase() === String(pos.symbol ?? "").toUpperCase()
                            && String(execution.direction ?? "") === positionSide(pos.type)
                            && submittedAt > 0
                            && now - submittedAt <= EXECUTION_RECOVERY_WINDOW_MS;
                    })
                );
                if (!orphan) continue;

                const [executionKey, orphanExecution] = orphan;
                // The command must actually be in an unknown state: a still
                // `queued` command was never claimed (so this position is not
                // its), and a live claim still belongs to the EA.
                const orphanClientOrderId = String(orphanExecution.clientOrderId ?? "");
                if (!orphanClientOrderId) continue;
                const commandSnap = await adminDatabase
                    .ref(`trading_order_requests/${userId}/${orphanClientOrderId}`)
                    .get();
                const orphanCommand = (commandSnap.val() || {}) as Record<string, unknown>;
                if (!canSettleFromBrokerEvidence(orphanCommand, now)) continue;

                await updateExecution(studioMatch.botId, executionKey, {
                    status: "filled",
                    executionOutcome: "confirmed",
                    mt5Ticket: Number(ticket) || undefined,
                    fillPrice: Number(pos.openPrice || 0) || undefined,
                    fillVolume: Number(pos.volume || 0) || undefined,
                    synchronizedAt: now,
                    recoveredAt: now,
                    recoverySource: "broker_snapshot",
                    reconciledAt: now,
                    reconciliationRequired: false,
                    latencyMs: {
                        ...((orphanExecution.latencyMs as Record<string, number | undefined>) ?? {}),
                        brokerToSync: typeof orphanExecution.brokerConfirmedAt === "number"
                            ? Math.max(0, now - Number(orphanExecution.brokerConfirmedAt))
                            : undefined,
                    },
                });

                // Reflect the recovered outcome on the command record too, but
                // never overwrite an already-confirmed ticket/result, and never
                // fight a claim that is still alive.
                {
                    await adminDatabase
                        .ref(`trading_order_requests/${userId}/${orphanClientOrderId}`)
                        .transaction((current) => {
                            if (!current || typeof current !== "object") return undefined;
                            const cmd = current as Record<string, unknown>;
                            if (cmd.status === "filled" && String(cmd.mt5Ticket ?? "") === ticket) return undefined;
                            if (!canSettleFromBrokerEvidence(cmd, now)) return undefined;
                            return {
                                ...cmd,
                                status: "filled",
                                mt5Ticket: ticket,
                                executionPrice: Number(pos.openPrice || 0) || cmd.executionPrice,
                                volume: Number(pos.volume || 0) || cmd.volume,
                                recoveredAt: now,
                                reconciledAt: now,
                                recoverySource: "broker_snapshot",
                                reconciliationRequired: false,
                                updatedAt: now,
                            };
                        });
                }
                continue;
            }

            if (!ownedMagics.includes(magic)) continue;

            const matches = await findMatchingBots(
                userId,
                accountNumber,
                magic,
                String(pos.symbol || ""),
                String((pos as Record<string, unknown>).comment || "")
            );
            const target = matches[0]?.bot;
            if (!target) continue;

            await indexBotPosition(target.id, pos);

            const tickets = perBotTickets.get(target.id) || [];
            tickets.push(ticket);
            perBotTickets.set(target.id, tickets);
        }

        for (const [botId, tickets] of perBotTickets) {
            await clearBotPositions(botId, tickets);
        }

        const isBotOwned = (pos: Record<string, unknown> | undefined) => {
            if (!pos) return false;
            const magic = String(pos.magic ?? "");
            if (magic === "") return false;
            // Bot Studio positions are bot-owned too: they must never be
            // mirrored into copy-trading followers as if they were manual.
            return ownedMagics.includes(magic) || studioByMagic.has(magic);
        };

        for (const ticket of openedTickets) {
            if (await isCopiedSnapshotPosition(userId, accountNumber, ticket)) continue;
            const pos = positionsData[ticket] as Record<string, unknown>;
            if (isBotOwned(pos)) continue;
            await mirrorMasterOrder({
                masterId: accountId,
                masterMt5Account: accountNumber,
                order: {
                    ticket,
                    symbol: String(pos.symbol || ""),
                    type: String(pos.type || "BUY"),
                    volume: Number(pos.volume || 0.01),
                    openPrice: Number(pos.openPrice || 0),
                    stopLoss: Number(pos.sl || 0) || null,
                    takeProfit: Number(pos.tp || 0) || null,
                },
                notify: true,
            });
        }

        for (const ticket of removedTickets) {
            if (await isCopiedSnapshotPosition(userId, accountNumber, ticket)) continue;

            const closedPos = prevPositions[ticket] as Record<string, unknown> | undefined;

            // ── Closed-trade history (real-time) ─────────────────────────
            // A position that disappeared from a snapshot is a close. Persist
            // the last observed gateway state so the terminal's Trade History
            // tab updates in real time with the close price, realized P/L and
            // the close % (price move in the trade direction).
            const openPrice = Number(closedPos?.openPrice || 0);
            const closePrice = Number(closedPos?.currentPrice || 0);
            const direction =
                String(closedPos?.type || "BUY").toUpperCase() === "SELL" ? -1 : 1;
            const priceMovePct =
                openPrice > 0 && closePrice > 0
                    ? Math.round(
                          ((closePrice - openPrice) / openPrice) *
                              100 *
                              direction *
                              100
                      ) / 100
                    : null;

            await adminDatabase
                .ref(`trading_history/${userId}/${accountId}/${ticket}`)
                .set({
                    ticket,
                    symbol: String(closedPos?.symbol || ""),
                    type: String(closedPos?.type || ""),
                    volume: Number(closedPos?.volume || 0),
                    openPrice,
                    closePrice,
                    profit: Number(closedPos?.profit || 0),
                    swap: Number(closedPos?.swap || 0),
                    magic: String(closedPos?.magic ?? ""),
                    comment: String(closedPos?.comment || ""),
                    openedAt: Number(closedPos?.openedAt || 0),
                    closedAt: now,
                    closeSource: "gateway_snapshot",
                    priceMovePct,
                });

            // Bot Studio close: index the realized trade under the studio bot
            // so its performance statistics reflect real broker outcomes.
            const studioClosed = studioByMagic.get(String(closedPos?.magic ?? ""));
            if (studioClosed) {
                await indexBotTrade(studioClosed.botId, {
                    ticket,
                    symbol: String(closedPos?.symbol || ""),
                    type: String(closedPos?.type || ""),
                    volume: Number(closedPos?.volume || 0),
                    openPrice,
                    closePrice,
                    profit: Number(closedPos?.profit || 0),
                    swap: Number(closedPos?.swap || 0),
                    magic: String(closedPos?.magic ?? ""),
                    comment: String(closedPos?.comment || ""),
                    mt5Account: accountNumber,
                    accountId,
                    strategyId: studioClosed.strategyId,
                    openedAt: Number(closedPos?.openedAt || 0),
                    closedAt: now,
                    closeSource: "gateway_snapshot",
                });
                continue;
            }

            if (isBotOwned(closedPos)) {
                // Bot-owned position closed: index a trade so the bot's stats
                // reflect realized P/L. Profit is the last floating value the
                // gateway observed (MT5 doesn't expose close prices here).
                const magic = String(closedPos?.magic ?? "");
                const symbol = String(closedPos?.symbol || "");
                const matches = await findMatchingBots(userId, accountNumber, magic, symbol, String(closedPos?.comment || ""));
                const target = matches[0]?.bot;
                if (target) {
                    void indexBotTrade(target.id, {
                        ticket,
                        symbol,
                        type: String(closedPos?.type || ""),
                        volume: Number(closedPos?.volume || 0),
                        openPrice: Number(closedPos?.openPrice || 0),
                        closePrice: Number(closedPos?.currentPrice || 0),
                        profit: Number(closedPos?.profit || 0),
                        swap: Number(closedPos?.swap || 0),
                        magic,
                        comment: String(closedPos?.comment || ""),
                        mt5Account: accountNumber,
                        accountId,
                        openedAt: Number(closedPos?.openedAt || 0),
                        closedAt: now,
                        closeSource: "gateway_snapshot",
                    });
                }
                continue;
            }

            await recordMasterPerformance({
                accountId,
                realizedProfit: Number(closedPos?.profit || 0),
                closedAt: now,
            });

            await mirrorMasterClose({
                masterId: accountId,
                masterMt5Account: accountNumber,
                masterTicket: ticket,
                notify: true,
            });
        }

        // Cap the per-account history so snapshots cannot grow it without
        // bound. Newest 200 closed trades are kept, by close time.
        if (removedTickets.length > 0) {
            const histSnap = await adminDatabase
                .ref(`trading_history/${userId}/${accountId}`)
                .get();
            const hist = (histSnap.val() || {}) as Record<
                string,
                { closedAt?: number } | undefined
            >;
            const histKeys = Object.keys(hist);
            if (histKeys.length > 200) {
                const oldestFirst = histKeys.sort(
                    (a, b) =>
                        Number(hist[a]?.closedAt || 0) -
                        Number(hist[b]?.closedAt || 0)
                );
                const removals: Record<string, null> = {};
                for (const key of oldestFirst.slice(
                    0,
                    histKeys.length - 200
                )) {
                    removals[key] = null;
                }
                await adminDatabase
                    .ref(`trading_history/${userId}/${accountId}`)
                    .update(removals);
            }
        }

        return NextResponse.json(
            {
                success: true,
                positionsCount: Object.keys(positionsData).length,
                ordersCount: Object.keys(ordersData).length,
                mirroredOpens: openedTickets.length,
                mirroredCloses: removedTickets.length,
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (error) {
        console.error("[trading/gateway/snapshot POST]", error);
        return NextResponse.json(
            { success: false, error: "Snapshot failed." },
            { status: 500, headers: corsHeaders }
        );
    }
}
