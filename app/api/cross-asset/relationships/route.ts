/**
 * /api/cross-asset/relationships (Phase 16 §4, §5, §42).
 *
 * GET    ?symbol=X   → measured relationships for X + the user's declared links
 * POST                → create a USER_DEFINED relationship (declared, never measured)
 * DELETE               → remove a declared relationship
 *
 * Auth: Firebase Bearer idToken. Reads and writes are scoped to the calling
 * user's `userRelationships/{uid}` node — no cross-user access is possible
 * because the uid comes from the token, never from the body (§50).
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { isProUser } from "@/lib/ai-signals/access";
import { getSymbolCrossAssetContext, DEFAULT_BARS, DEFAULT_TIMEFRAME } from "@/lib/cross-asset/service";
import {
    deleteUserRelationship,
    loadUserRelationships,
    saveUserRelationship,
} from "@/lib/cross-asset/store";
import type { UserDefinedRelationship } from "@/lib/cross-asset/types";
import { getSymbolSpec } from "@/lib/ai-signals/symbol-specs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DECLARED_TYPES = new Set(["POSITIVE", "NEGATIVE", "LEADS", "EXPOSED"]);
const MAX_NOTE = 500;

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const symbol = (request.nextUrl.searchParams.get("symbol") ?? "").trim().toUpperCase();
        const pro = await isProUser(user.uid);
        const userRelationships = await loadUserRelationships(user.uid).catch(() => []);

        if (!symbol) {
            return NextResponse.json(
                { success: true, userRelationships, measured: [] },
                { status: 200 }
            );
        }

        const context = await getSymbolCrossAssetContext({
            symbol,
            focusSymbol: symbol,
            timeframe: DEFAULT_TIMEFRAME,
            bars: DEFAULT_BARS,
            tier: pro ? "PRO" : "FREE",
            userId: user.uid,
            userRelationships,
        });

        return NextResponse.json(
            {
                success: true,
                symbol,
                measured: context.relationships,
                userRelationships: userRelationships.filter(
                    (r) => r.sourceSymbol === symbol || r.targetSymbol === symbol
                ),
                narrative: context.narrative,
                limitations: context.limitations,
            },
            { status: 200 }
        );
    } catch (err) {
        console.error("[cross-asset/relationships] GET failed:", err);
        return NextResponse.json({ error: "UNAVAILABLE" }, { status: 503 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = (await request.json().catch(() => ({}))) as {
            sourceSymbol?: unknown;
            targetSymbol?: unknown;
            declaredType?: unknown;
            note?: unknown;
        };

        const source = String(body.sourceSymbol ?? "").trim().toUpperCase();
        const target = String(body.targetSymbol ?? "").trim().toUpperCase();
        const declaredType = String(body.declaredType ?? "").toUpperCase();
        const note = String(body.note ?? "").slice(0, MAX_NOTE).trim();

        if (!getSymbolSpec(source) || !getSymbolSpec(target)) {
            return NextResponse.json(
                { error: "UNKNOWN_SYMBOL", detail: "Both symbols must exist in the canonical instrument registry." },
                { status: 400 }
            );
        }
        if (source === target) {
            return NextResponse.json({ error: "INVALID_PAIR" }, { status: 400 });
        }
        if (!DECLARED_TYPES.has(declaredType)) {
            return NextResponse.json(
                { error: "INVALID_TYPE", detail: `declaredType must be one of ${Array.from(DECLARED_TYPES).join(", ")}` },
                { status: 400 }
            );
        }

        const now = Date.now();
        const existing = (await loadUserRelationships(user.uid).catch(() => [])).find(
            (r) =>
                (r.sourceSymbol === source && r.targetSymbol === target) ||
                (r.sourceSymbol === target && r.targetSymbol === source)
        );

        const record: UserDefinedRelationship = {
            id: existing?.id ?? `urel_${user.uid}_${source}_${target}`,
            userId: user.uid, // from the token — never from the body (§50)
            sourceSymbol: source,
            targetSymbol: target,
            declaredType: declaredType as UserDefinedRelationship["declaredType"],
            note,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            userDefined: true,
        };

        await saveUserRelationship(record);
        return NextResponse.json(
            {
                success: true,
                relationship: record,
                note: "Declared links are labelled USER_DEFINED and are never presented as measured correlations (§4).",
            },
            { status: 200 }
        );
    } catch (err) {
        console.error("[cross-asset/relationships] POST failed:", err);
        return NextResponse.json({ error: "UNAVAILABLE" }, { status: 503 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = (await request.json().catch(() => ({}))) as {
            sourceSymbol?: unknown;
            targetSymbol?: unknown;
        };
        const source = String(body.sourceSymbol ?? "").trim().toUpperCase();
        const target = String(body.targetSymbol ?? "").trim().toUpperCase();
        if (!source || !target) {
            return NextResponse.json({ error: "MISSING_PAIR" }, { status: 400 });
        }

        const removed = await deleteUserRelationship(user.uid, source, target);
        return NextResponse.json({ success: true, removed }, { status: removed ? 200 : 404 });
    } catch (err) {
        console.error("[cross-asset/relationships] DELETE failed:", err);
        return NextResponse.json({ error: "UNAVAILABLE" }, { status: 503 });
    }
}
