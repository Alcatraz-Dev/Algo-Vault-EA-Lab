import { NextRequest, NextResponse } from "next/server";
import { authorizePortfolio, portfolioError, portfolioJson, requireFeature, resolvePortfolioId } from "../_lib";
import { readMemory, validateMemoryEntry, writeMemoryEntry } from "@/lib/portfolio/store";
import type { PortfolioMemoryEntry } from "@/lib/portfolio/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/portfolio/memory  (Pro) — bounded read of portfolio memory.
 * POST /api/portfolio/memory  (Pro) — append a structured memory fact, or
 *                                    validate/reject an existing one.
 *
 * Memory stores STRUCTURED FACTS only. Free-text AI speculation is rejected:
 * `facts` must be a flat map of string / number / boolean, and an entry stays
 * `UNVALIDATED` until a real outcome confirms it.
 */
export async function GET(request: NextRequest) {
    try {
        const auth = await authorizePortfolio(request);
        if (!auth.ok) return auth.response;

        const gate = requireFeature(auth.ctx.plan, "portfolio.memory");
        if (!gate.allowed) return gate.response;

        const portfolioId = resolvePortfolioId(auth.ctx, request.nextUrl.searchParams.get("portfolioId"));
        if (!portfolioId) {
            return NextResponse.json(
                { ok: false, error: "PORTFOLIO_NOT_FOUND", message: "You do not own this portfolio." },
                { status: 403 }
            );
        }

        const entries = await readMemory(auth.ctx.uid, portfolioId);
        return portfolioJson({
            ok: true,
            portfolioId,
            data: { entries },
            limitations: [
                "Memory entries are structured facts with a validation state. An unvalidated entry is a hypothesis, not a truth.",
            ],
        });
    } catch (error) {
        return portfolioError(error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const auth = await authorizePortfolio(request);
        if (!auth.ok) return auth.response;

        const gate = requireFeature(auth.ctx.plan, "portfolio.memory");
        if (!gate.allowed) return gate.response;

        const portfolioId = resolvePortfolioId(auth.ctx, request.nextUrl.searchParams.get("portfolioId"));
        if (!portfolioId) {
            return NextResponse.json(
                { ok: false, error: "PORTFOLIO_NOT_FOUND", message: "You do not own this portfolio." },
                { status: 403 }
            );
        }

        const body = (await request.json().catch(() => ({}))) as Partial<PortfolioMemoryEntry>;

        if (typeof body.memoryId === "string" && body.memoryId) {
            const now = Date.now();
            await validateMemoryEntry(auth.ctx.uid, portfolioId, body.memoryId, body.validation === "VALIDATED", now);
            return portfolioJson({ ok: true, portfolioId, data: { memoryId: body.memoryId, validated: body.validation === "VALIDATED" } });
        }

        const facts = body.facts;
        if (!facts || typeof facts !== "object" || Array.isArray(facts)) {
            return portfolioJson(
                { ok: false, error: "INVALID_FACTS", message: "facts must be an object of string, number or boolean values." },
                400
            );
        }
        const invalid = Object.entries(facts).filter(
            ([, v]) => typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean"
        );
        if (invalid.length > 0) {
            return portfolioJson(
                {
                    ok: false,
                    error: "INVALID_FACTS",
                    message: `Free-text speculation is not stored as portfolio truth. Invalid keys: ${invalid.map(([k]) => k).join(", ")}.`,
                },
                400
            );
        }

        const now = Number(body.observedAt ?? Date.now());
        const memoryId = await writeMemoryEntry(auth.ctx.uid, portfolioId, {
            portfolioId,
            kind: (body.kind ?? "PORTFOLIO_STATE") as PortfolioMemoryEntry["kind"],
            facts: facts as Record<string, string | number | boolean>,
            validation: "UNVALIDATED",
            observedAt: now,
            occurrences: Number(body.occurrences ?? 1) || 1,
        });

        return portfolioJson({ ok: true, portfolioId, data: { memoryId, validation: "UNVALIDATED" } });
    } catch (error) {
        return portfolioError(error);
    }
}
