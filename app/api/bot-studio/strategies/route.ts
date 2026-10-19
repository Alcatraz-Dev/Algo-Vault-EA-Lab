import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/admin-auth";
import { requireBotStudioAccess, canAccessStrategy } from "@/lib/bot-studio/auth";
import {
    listAllStrategies,
    saveStrategy,
    newStrategyId,
    appendAudit,
    getStrategy,
} from "@/lib/bot-studio/database";
import { deriveMagicNumber } from "@/lib/bot-studio/magic-numbers";
import { validateStrategyDefinition } from "@/lib/strategy-engine/validation";
import type { BotStrategy, StrategySource } from "@/lib/bot-studio/types";

export async function GET(request: NextRequest) {
    const access = await requireBotStudioAccess(request);
    if (!access) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        let strategies = await listAllStrategies();
        if (!access.isAdmin) {
            strategies = strategies.filter((st: any) => st.authorId === access.uid);
        }
        return NextResponse.json({ ok: true, strategies });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to load strategies") },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    const access = await requireBotStudioAccess(request);
    if (!access) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await request.json();
        const {
            name,
            description,
            symbol,
            timeframe,
            sourceType,
            canonicalStrategy,
            visualGraph,
            avScriptSource,
        } = body;

        if (!name || typeof name !== "string") {
            return NextResponse.json({ ok: false, error: "Strategy name is required" }, { status: 400 });
        }
        if (!canonicalStrategy) {
            return NextResponse.json(
                { ok: false, error: "Canonical strategy definition is required" },
                { status: 400 }
            );
        }

        // Validate canonical strategy with Strategy Engine validator
        const validation = validateStrategyDefinition(canonicalStrategy);
        if (!validation.valid) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Strategy validation failed",
                    issues: validation.issues,
                },
                { status: 400 }
            );
        }

        const now = Date.now();
        const id = body.id || newStrategyId();
        // When the caller supplies an id, the record is UPSERTED. Guard the
        // upsert so one Pro user cannot overwrite another user's strategy by
        // posting a known strategy id.
        if (body.id) {
            const existing = await getStrategy(id);
            if (existing && !canAccessStrategy(access, existing)) {
                return NextResponse.json(
                    { ok: false, error: `Strategy ${id} does not exist` },
                    { status: 404 }
                );
            }
        }
        const magicNumber = deriveMagicNumber(id);
        const fingerprint = crypto.createHash("sha256").update(JSON.stringify(canonicalStrategy)).digest("hex").slice(0, 16);

        const source: StrategySource = sourceType === "avscript"
            ? { kind: "avscript", source: avScriptSource ?? "", compilerVersion: "1.0.0" }
            : { kind: "visual_builder", nodeGraph: typeof visualGraph === "string" ? visualGraph : JSON.stringify(visualGraph ?? {}), compilerVersion: "1.0.0" };

        const strategyRecord: BotStrategy = {
            id,
            authorId: access.uid,
            name: name.trim(),
            description: description?.trim() ?? "",
            state: "valid",
            validationErrors: [],
            validationWarnings: validation.issues.map((i) => i.message),
            source,
            definition: canonicalStrategy,
            fingerprint,
            magicNumber,
            createdAt: body.createdAt || now,
            updatedAt: now,
        };

        await saveStrategy(strategyRecord);
        await appendAudit(
            id,
            id,
            body.id ? "strategy_updated" : "strategy_created",
            access.uid,
            { name: strategyRecord.name }
        );

        return NextResponse.json({ ok: true, strategy: strategyRecord });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to save strategy") },
            { status: 500 }
        );
    }
}
