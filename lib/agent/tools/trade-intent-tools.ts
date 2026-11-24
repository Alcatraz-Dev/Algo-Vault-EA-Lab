// ─────────────────────────────────────────────────────────────────────────────
// AlgoVault Agent IDE — trade intent authorization tool
//
// `trade.authorize` checks an order INTENT: it validates volume/SL/TP geometry
// with the canonical Risk Engine, computes the tenant+account-scoped order
// fingerprint and verifies the human's typed confirmation phrase.
//
// It does NOT submit anything. Submission stays in the Unified Trading Service
// (server routes / bot runtime), which re-runs the Risk Engine with real account
// state and the durable idempotency claim. Keeping authorization and submission
// separate is deliberate: an external skill can ask "would this be allowed, and
// what must the user type?" without ever holding an execution capability.
//
// The registry's policy gate runs BEFORE this executor (see
// TRADE_TOOL_DECLARATIONS): no mode grants `trade_execute_demo` by default, so
// the tool is unreachable without an explicit per-run override.
// ─────────────────────────────────────────────────────────────────────────────

import { defineTool, type ToolResult } from "../core/types";
import { evaluateOrder, type OrderEntryKind, type OrderIntent } from "@/lib/risk/risk-engine";
import {
    authorizeExecution,
    computeOrderIdentity,
    type FingerprintKind,
    type FingerprintSide,
} from "@/lib/risk/order-fingerprint";
import { redactErrorForLog } from "../policies/redaction";

function ok(data: unknown): ToolResult {
    return { ok: true, data, output: JSON.stringify(data) };
}

function fail(error: string, code: string, data?: unknown): ToolResult {
    return { ok: false, error, code, data };
}

function num(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

export const tradeAuthorizeTool = defineTool(
    {
        id: "trade.authorize",
        description:
            "Authorize a DEMO order intent without submitting it: validates volume and SL/TP geometry, returns the tenant+account order fingerprint and the exact typed confirmation phrase the human must enter. Never executes, never reads broker credentials.",
        category: "context",
        argsHint:
            "{ accountId: string, symbol: string, side: 'BUY'|'SELL', kind?: 'MARKET'|'LIMIT'|'STOP'|'STOP_LIMIT', volume: number, price?: number, stopLoss?: number, takeProfit?: number, typedConfirmation?: string }",
    },
    async (args, ctx) => {
        try {
            const accountId = typeof args.accountId === "string" ? args.accountId.trim() : "";
            const symbol = typeof args.symbol === "string" ? args.symbol.trim().toUpperCase() : "";
            const side = args.side === "SELL" ? "SELL" : args.side === "BUY" ? "BUY" : null;
            const kind = normalizeKind(args.kind);
            const volume = num(args.volume);
            const price = num(args.price);
            const stopLoss = num(args.stopLoss);
            const takeProfit = num(args.takeProfit);

            if (!accountId) return fail("accountId is required.", "invalid_args");
            if (!symbol) return fail("symbol is required.", "invalid_args");
            if (!side) return fail("side must be BUY or SELL.", "invalid_args");
            if (volume === null || volume <= 0) return fail("volume must be a positive number.", "invalid_args");

            // Tenant is always the authenticated user — never a tool argument.
            const tenantId = ctx.uid;
            if (!tenantId) return fail("No authenticated tenant in the tool context.", "missing_tenant");

            const order = {
                symbol,
                side: side as FingerprintSide,
                kind,
                volume,
                price: price ?? null,
                stopLoss: stopLoss ?? null,
                takeProfit: takeProfit ?? null,
            };

            // Geometry/volume sanity only. Account-level limits require real
            // account state, which this tool deliberately does not accept from
            // the caller — fabricating safe state is exactly what we refuse.
            const intent: OrderIntent = {
                symbol,
                direction: side,
                entryKind: kind === "MARKET" ? "MARKET" : kind === "LIMIT" ? "LIMIT" : "STOP",
                price: kind === "MARKET" ? 0 : price ?? 0,
                volume,
                sl: stopLoss,
                tp: takeProfit,
                protective: false,
            };
            const risk = evaluateOrder(intent, {}, {}, Date.now());

            const identity = computeOrderIdentity(tenantId, accountId, order);
            const authorization = authorizeExecution({
                tenantId,
                accountId,
                order,
                risk: { approved: risk.approved, code: risk.code, reason: risk.reason },
                policy: { allowed: true, code: "POLICY_GRANTED" },
                typedConfirmation: typeof args.typedConfirmation === "string" ? args.typedConfirmation : undefined,
                requireTypedConfirmation: true,
                now: Date.now(),
            });

            const payload = {
                authorized: authorization.allowed,
                code: authorization.code,
                reason: authorization.reason ?? null,
                scope: authorization.scope,
                fingerprint: authorization.fingerprint,
                canonical: authorization.canonical,
                requiredConfirmationPhrase: authorization.requiredConfirmationPhrase,
                confirmationVerified: authorization.confirmationVerified,
                riskCode: risk.code,
                // Explicit boundaries: this is not an execution and not a
                // substitute for the submission-time account risk evaluation.
                executes: false,
                accountRiskStateEvaluated: false,
                note: "Intent authorization only. Submission re-runs the Risk Engine with live account state via the Unified Trading Service.",
            };

            if (!authorization.allowed && authorization.code !== "CONFIRMATION_REQUIRED") {
                return fail(authorization.reason ?? "Execution authorization denied.", "not_authorized", payload);
            }

            // The phrase is part of a successful response only when it matched;
            // otherwise the caller is told what to display, not that it passed.
            return ok(payload);
        } catch (error) {
            return fail(redactErrorForLog(error), "trade_authorize_failed");
        }
    },
);

function normalizeKind(value: unknown): FingerprintKind {
    if (value === "LIMIT" || value === "STOP" || value === "STOP_LIMIT") return value;
    return "MARKET";
}
