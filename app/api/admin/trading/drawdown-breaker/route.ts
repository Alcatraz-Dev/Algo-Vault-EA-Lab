import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { accountKey } from "@/lib/risk/account-state";
import { BREAKER_PATH } from "@/lib/risk/breaker-persistence";
import {
    BREAKER_RESET_PHRASE,
    resetDrawdownBreaker,
    type DrawdownBreakerRecord,
} from "@/lib/risk/drawdown-breaker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin-only drawdown-breaker reset.
 *
 * TRIPPED is latched and no equity observation can clear it. Returning an
 * account to trading requires a human operator, an operator identity (the
 * authenticated admin), a written reason and the exact confirmation phrase.
 * The transition (actor, reason, timestamp) is appended to the breaker's own
 * `history`, which is the durable audit trail the Risk Engine reads.
 */

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
}

function parseTarget(body: Record<string, unknown>) {
    const userId = String(body.userId || "").trim();
    const accountId = String(body.accountId || "").trim();
    return { userId, accountId, key: accountId ? accountKey(accountId) : "" };
}

export async function GET(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }
    const { searchParams } = new URL(request.url);
    const { userId, accountId, key } = parseTarget({
        userId: searchParams.get("userId"),
        accountId: searchParams.get("accountId"),
    });
    if (!userId || !key) {
        return NextResponse.json(
            { error: "userId and accountId are required." },
            { status: 400, headers: corsHeaders }
        );
    }

    const snap = await adminDatabase.ref(BREAKER_PATH(userId, key)).get();
    const record = (snap.val() || null) as DrawdownBreakerRecord | null;
    return NextResponse.json(
        {
            userId,
            accountId,
            breaker: record,
            latched: record?.state === "TRIPPED",
        },
        { status: 200, headers: corsHeaders }
    );
}

export async function POST(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    try {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const { userId, key } = parseTarget(body);
        if (!userId || !key) {
            return NextResponse.json(
                { error: "userId and accountId are required." },
                { status: 400, headers: corsHeaders }
            );
        }

        const by = String(body.operatorId || admin.uid).trim();
        const reason = String(body.reason || "").trim();
        const confirmation = String(body.confirmation || "");

        const ref = adminDatabase.ref(BREAKER_PATH(userId, key));
        let response: NextResponse | null = null;

        await ref.transaction((current) => {
            const record = (current && typeof current === "object" ? current : null) as DrawdownBreakerRecord | null;
            if (!record) {
                response = NextResponse.json(
                    { error: "No drawdown breaker record exists for this account." },
                    { status: 404, headers: corsHeaders }
                );
                return undefined;
            }

            const reset = resetDrawdownBreaker(record, {
                by,
                reason,
                confirmation,
                now: Date.now(),
            });
            if (!reset.ok) {
                const status = reset.code === "BAD_CONFIRMATION" ? 400 : 409;
                response = NextResponse.json(
                    { error: reset.reason, code: reset.code, phrase: BREAKER_RESET_PHRASE },
                    { status, headers: corsHeaders }
                );
                return undefined;
            }

            response = NextResponse.json(
                {
                    success: true,
                    resetBy: reset.record.resetBy,
                    resetAt: reset.record.resetAt,
                    state: reset.record.state,
                    history: reset.record.history.slice(-1),
                },
                { status: 200, headers: corsHeaders }
            );
            return reset.record;
        });

        if (response) {
            const final: NextResponse = response;
            // Clear the legacy boolean too, so an old `drawdownBreakerActive:
            // true` cannot keep blocking entries after an audited reset.
            if (final.status === 200) {
                await adminDatabase
                    .ref(`trading_controls/${userId}/${key}`)
                    .update({ drawdownBreakerActive: false });
            }
            return final;
        }

        return NextResponse.json(
            { error: "Drawdown breaker reset did not commit." },
            { status: 500, headers: corsHeaders }
        );
    } catch (error) {
        console.error("[admin/trading/drawdown-breaker POST]", error);
        return NextResponse.json(
            { error: "Drawdown breaker reset failed." },
            { status: 500, headers: corsHeaders }
        );
    }
}
