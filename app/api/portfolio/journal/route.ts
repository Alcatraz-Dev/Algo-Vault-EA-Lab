import { NextRequest, NextResponse } from "next/server";
import { authorizePortfolio, portfolioError, portfolioJson, resolvePortfolioId } from "../_lib";
import { assessJournalOutcome, readJournal, writeJournalEntry } from "@/lib/portfolio/store";
import type { PortfolioJournalEntry } from "@/lib/portfolio/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/portfolio/journal — bounded read of the portfolio journal.
 * POST /api/portfolio/journal — append a journal entry.
 *
 * The journal answers, for any recorded decision: what AlgoVault recommended,
 * what the user did, what happened next, and whether the recommendation held
 * up. Historical entries are never rewritten.
 */
export async function GET(request: NextRequest) {
    try {
        const auth = await authorizePortfolio(request);
        if (!auth.ok) return auth.response;

        const portfolioId = resolvePortfolioId(auth.ctx, request.nextUrl.searchParams.get("portfolioId"));
        if (!portfolioId) {
            return NextResponse.json(
                { ok: false, error: "PORTFOLIO_NOT_FOUND", message: "You do not own this portfolio." },
                { status: 403 }
            );
        }

        const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
        const entries = await readJournal(auth.ctx.uid, portfolioId, Number.isFinite(limit) ? limit : 50);
        return portfolioJson({ ok: true, portfolioId, data: { entries } });
    } catch (error) {
        return portfolioError(error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const auth = await authorizePortfolio(request);
        if (!auth.ok) return auth.response;

        const portfolioId = resolvePortfolioId(auth.ctx, request.nextUrl.searchParams.get("portfolioId"));
        if (!portfolioId) {
            return NextResponse.json(
                { ok: false, error: "PORTFOLIO_NOT_FOUND", message: "You do not own this portfolio." },
                { status: 403 }
            );
        }

        const body = (await request.json().catch(() => ({}))) as Partial<PortfolioJournalEntry>;

        if (body.whatAlgoVaultRecommended !== undefined && typeof body.whatAlgoVaultRecommended === "string") {
            // Close-the-loop assessment on an existing entry. The original
            // recommendation text is never modified.
            const entryId = String(body.entryId ?? "");
            if (!entryId) {
                return portfolioJson({ ok: false, error: "ENTRY_ID_REQUIRED", message: "entryId is required to assess an outcome." }, 400);
            }
            await assessJournalOutcome(auth.ctx.uid, portfolioId, entryId, {
                whatHappenedAfter: String(body.whatHappenedAfter ?? ""),
                outcomeAssessment: (body.outcomeAssessment ?? "PENDING") as PortfolioJournalEntry["outcomeAssessment"],
            });
            return portfolioJson({ ok: true, portfolioId, data: { entryId, assessed: true } });
        }

        const now = Date.now();
        const entryId = await writeJournalEntry(auth.ctx.uid, portfolioId, {
            portfolioId,
            type: (body.type ?? "PORTFOLIO_DECISION") as PortfolioJournalEntry["type"],
            whatAlgoVaultRecommended: String(body.whatAlgoVaultRecommended ?? ""),
            whatTheUserDid: String(body.whatTheUserDid ?? ""),
            whatHappenedAfter: body.whatHappenedAfter ?? null,
            evidenceAtDecision: Array.isArray(body.evidenceAtDecision) ? body.evidenceAtDecision : [],
            outcomeAssessment: (body.outcomeAssessment ?? "PENDING") as PortfolioJournalEntry["outcomeAssessment"],
            createdAt: now,
            dataTimestamp: Number(body.dataTimestamp ?? now),
        });

        return portfolioJson({ ok: true, portfolioId, data: { entryId } });
    } catch (error) {
        return portfolioError(error);
    }
}
