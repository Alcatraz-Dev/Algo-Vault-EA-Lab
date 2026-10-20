import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { verifyGatewayToken, resolveGatewayToken } from "@/lib/gateway";
import { attachCopiedMt5Ticket } from "@/lib/copy-trading";
import { writeClosedDealHistory } from "@/lib/trading/closed-deals";
import { getExecution, updateExecution } from "@/lib/bot-studio/database";
import { nextReportStatus, normalizeReportedStatus } from "@/lib/trading/gateway/lifecycle";

export const runtime = "nodejs";

/**
 * MT5 `TimeCurrent()` is epoch SECONDS; the platform stores epoch MILLISECONDS.
 * Mixing them made every bot latency figure ~1000x too large.
 */
function toEpochMs(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return Date.now();
    return value > 1e12 ? value : value * 1000;
}

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const gatewayToken = resolveGatewayToken(request.headers.get("authorization"), body);

        // Real-time closed deal: the EA posts each closing deal as it happens
        // (OnTradeTransaction) so Trade History streams like the Execution Log.
        if (body.closedDeal && typeof body.closedDeal === "object") {
            if (!gatewayToken) {
                return NextResponse.json(
                    { success: false, error: "gatewayToken is required." },
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
            const accountNumber = String(body.accountNumber || "").trim();
            if (!accountNumber) {
                return NextResponse.json(
                    { success: false, error: "accountNumber is required." },
                    { status: 400, headers: corsHeaders }
                );
            }
            const ticket = await writeClosedDealHistory(
                gatewayUser.userId,
                `gateway_${accountNumber}`,
                body.closedDeal as Record<string, unknown>
            );
            return NextResponse.json(
                { success: Boolean(ticket), ticket },
                { status: ticket ? 200 : 400, headers: corsHeaders }
            );
        }

        const clientOrderId = String(body.clientOrderId || body.commandId || "").trim();
        const mt5Ticket = String(body.mt5Ticket || body.order || "").trim();
        const executionPrice = Number(body.executionPrice || body.price || 0);
        const volume = Number(body.volume || 0);
        const symbol = String(body.symbol || "").trim();
        const retcode = Number(body.errorCode ?? body.retcode ?? 0);
        const errorMessage = String(body.errorMessage || body.retcodeText || body.comment || "").trim();
        const timestamp = toEpochMs(Number(body.timestamp || 0));

        if (!gatewayToken || !clientOrderId) {
            return NextResponse.json(
                { success: false, error: "gatewayToken and clientOrderId are required." },
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
        const now = Date.now();

        // The EA sends `success` + `retcode`; newer clients may send `status`.
        // MT5 success retcodes start at 10009 (TRADE_RETCODE_DONE).
        const validStatuses = ["filled", "partially_filled", "rejected", "failed"];
        const explicitStatus = String(body.status || "").trim();
        // A failed CTrade submission can still have an uncertain broker outcome
        // (e.g. a transport interruption). Only an explicit terminal status or
        // a known failing retcode is a rejection; an ambiguous report is never
        // promoted into a fabricated fill.
        const status = validStatuses.includes(explicitStatus)
            ? explicitStatus
            : body.success === false || (retcode > 0 && retcode < 10009)
            ? "rejected"
            : body.success === true && (retcode === 10009 || retcode === 10010 || retcode === 10008)
              ? retcode === 10010 ? "partially_filled" : retcode === 10008 ? "queued" : "filled"
              : "unknown";

        // The originating order request scopes the report to the account and
        // carries the action context (BUY/SELL/CLOSE/…) for the terminal's
        // Execution Log tab.
        const orderSnap = await adminDatabase
            .ref(`trading_order_requests/${userId}/${clientOrderId}`)
            .get();
        const orderData = (orderSnap.val() || {}) as Record<string, unknown>;
        const orderAccountId = String(orderData.accountId || "").trim();
        const reportAccountNumber = String(body.accountNumber || "").trim();
        const expectedAccountId = reportAccountNumber ? `gateway_${reportAccountNumber}` : "";
        if (!orderSnap.exists() || !expectedAccountId || orderAccountId !== expectedAccountId) {
            return NextResponse.json(
                { success: false, error: "Execution report does not match an existing command for this gateway account." },
                { status: 403, headers: corsHeaders }
            );
        }

        // Delivery/claim gate: only a CLAIMED command (or one already settled) can
        // receive an execution report. A report for a still-queued command would
        // let a token confirm a trade the gateway was never given.
        const commandStatus = String(orderData.status || "");
        if (commandStatus === "queued") {
            return NextResponse.json(
                { success: false, error: "Command has not been claimed by a gateway consumer." },
                { status: 409, headers: corsHeaders }
            );
        }

        // Duplicate / delayed reports must never downgrade a confirmed result:
        // only a monotonic transition is written. An out-of-order "unknown" or
        // "rejected" report after a fill is recorded as a receipt, not applied.
        const previousStatus = String(orderData.status || "");
        const appliedStatus = nextReportStatus(previousStatus, status);
        // `unknown` is not a resting state — it is explicit uncertainty. Storing
        // it verbatim would strand the command outside both the claimable and
        // the reconciliable sets, so it is persisted as `uncertain` (which the
        // recovery sweep and the broker snapshot may still settle).
        const persistedStatus = normalizeReportedStatus(appliedStatus);
        const staleReport = appliedStatus !== status;

        await adminDatabase
            .ref(`trading_order_requests/${userId}/${clientOrderId}`)
            .update(
                staleReport
                    ? {
                          reportReceivedAt: now,
                          duplicateReportAt: now,
                          updatedAt: now,
                      }
                    : {
                          status: persistedStatus,
                          reconciliationRequired: persistedStatus === "uncertain",
                          mt5Ticket,
                          executionPrice,
                          volume,
                          symbol,
                          errorCode: retcode,
                          errorMessage,
                          reportReceivedAt: now,
                          executedAt: timestamp || now,
                          updatedAt: now,
                      }
            );

        // Bot Studio attribution: the command carries the trusted botId +
        // executionId written by the server (never by a client), and the
        // execution record must still own this exact clientOrderId. A report
        // can therefore never confirm another bot's or another order's record.
        if (
            !staleReport &&
            orderData.source === "bot-studio" &&
            typeof orderData.botId === "string" &&
            typeof orderData.executionId === "string"
        ) {
            const execution = await getExecution(orderData.botId, orderData.executionId);
            if (execution && execution.clientOrderId === clientOrderId) {
                const confirmed = appliedStatus === "filled" || appliedStatus === "partially_filled";
                const rejected = appliedStatus === "rejected" || appliedStatus === "failed";
                // A broker-confirmed fill is never downgraded by a later report.
                const nextStatus = execution.status === "filled"
                    ? "filled"
                    : confirmed
                      ? "filled"
                      : rejected
                        ? "rejected_by_broker"
                        : "uncertain";
                await updateExecution(orderData.botId, execution.id, {
                    status: nextStatus,
                    reconciliationRequired: nextStatus === "uncertain",
                    executionOutcome: confirmed ? "confirmed" : rejected ? "rejected" : "uncertain",
                    mt5Ticket: mt5Ticket ? Number(mt5Ticket) || undefined : undefined,
                    fillPrice: confirmed && Number.isFinite(executionPrice) ? executionPrice : undefined,
                    fillVolume: confirmed && Number.isFinite(volume) ? volume : undefined,
                    gatewayReportedAt: now,
                    brokerConfirmedAt: confirmed ? timestamp : undefined,
                    filledAt: confirmed ? timestamp : undefined,
                    rejectedAt: rejected ? now : undefined,
                    // Merge so earlier markers (e.g. authorization) are preserved.
                    latencyMs: {
                        ...(execution.latencyMs ?? {}),
                        queueToReport: typeof orderData.queuedAt === "number"
                            ? Math.max(0, now - Number(orderData.queuedAt))
                            : undefined,
                    },
                });
            }
        }

        if (appliedStatus === "filled" || appliedStatus === "partially_filled") {
            await adminDatabase
                .ref(`trading_execution_logs/${userId}/${clientOrderId}`)
                .set({
                    clientOrderId,
                    mt5Ticket,
                    status: appliedStatus,
                    executionPrice,
                    volume,
                    symbol,
                    errorCode: retcode,
                    errorMessage,
                    executedAt: timestamp || now,
                    createdAt: now,
                });

            // Per-account execution log under the client-readable
            // `trading_logs` ruleset — the live terminal's Execution Log tab
            // subscribes here in real time (including rejections).
            if (orderAccountId) {
                await adminDatabase
                    .ref(
                        `trading_logs/${userId}/${orderAccountId}/${clientOrderId}`
                    )
                    .set({
                        clientOrderId,
                        accountId: orderAccountId,
                        action:
                            String(orderData.action || "").toUpperCase() ||
                            "ORDER",
                        symbol: symbol || String(orderData.symbol || ""),
                        volume: volume || Number(orderData.volume || 0),
                        status: appliedStatus,
                        mt5Ticket,
                        executionPrice,
                        errorCode: retcode,
                        errorMessage: errorMessage || "Executed",
                        createdAt: now,
                        executedAt: timestamp || now,
                    });
            }

            // Reconcile copy-trading: if this was a copied order, record
            // the real MT5 ticket and update the mt5_orders ledger too.
            if (orderData.source === "copy_follower") {
                const followerMt5 = String(orderData.followerMt5Account || "").trim();
                if (followerMt5) {
                    // Update mt5_orders for backward compat with performance endpoints
                    const mt5Ref = adminDatabase.ref(`mt5_orders/${followerMt5}/${clientOrderId}`);
                    const mt5Existing = (await mt5Ref.get()).val();
                    if (mt5Existing) {
                        await mt5Ref.update({
                            status: "EXECUTED",
                            mt5Ticket,
                            executedAt: timestamp || now,
                            updatedAt: now,
                        });
                    }
                    // Record real MT5 ticket on the copied trade ledger
                    await attachCopiedMt5Ticket({
                        mt5Account: followerMt5,
                        ticket: clientOrderId,
                        mt5Ticket,
                    });
                }
            }
        }

        return NextResponse.json(
            { success: true },
            { status: 200, headers: corsHeaders }
        );
    } catch (error) {
        console.error("[trading/gateway/execution POST]", error);
        return NextResponse.json(
            { success: false, error: "Execution report failed." },
            { status: 500, headers: corsHeaders }
        );
    }
}
