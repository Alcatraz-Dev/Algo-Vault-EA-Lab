import { NextRequest, NextResponse } from "next/server";
import { authorizePortfolio, portfolioError, portfolioJson, resolvePortfolioId } from "../_lib";
import { buildPortfolioBundle } from "@/lib/portfolio/service";
import { answerPortfolioQuestion } from "@/lib/portfolio/chat";
import { buildDeterministicBrief, buildPortfolioContext } from "@/lib/portfolio/intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bound the question length so a crafted prompt cannot be used to smuggle context. */
const MAX_QUESTION_LENGTH = 400;

/**
 * POST /api/portfolio/chat
 *
 * Answers a portfolio question from the deterministic snapshot. Every answer is
 * labelled by epistemic level (OBSERVED / CALCULATED / INFERRED / SIMULATED /
 * RECOMMENDATION) and the structured brief is attached so the client can render
 * evidence rather than prose alone.
 *
 * The deterministic path is authoritative. Optional AI narration may only
 * *interpret* the structured context; if the gateway is unavailable or its
 * answer does not echo the measured equity anchor, the deterministic brief
 * stands and `deterministicOnly` is true.
 */
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

        const body = (await request.json().catch(() => ({}))) as { question?: string };
        const question = String(body.question ?? "").slice(0, MAX_QUESTION_LENGTH).trim();
        if (!question) {
            return portfolioJson({ ok: false, error: "QUESTION_REQUIRED", message: "Ask a portfolio question." }, 400);
        }

        const bundle = await buildPortfolioBundle({ userId: auth.ctx.uid, portfolioId });
        const answer = answerPortfolioQuestion(question, bundle.snapshot);
        const brief = buildDeterministicBrief(bundle.snapshot);

        return portfolioJson({
            ok: true,
            portfolioId,
            data: {
                question,
                intent: answer.intent,
                lines: answer.lines,
                brief,
                context: buildPortfolioContext(bundle.snapshot),
            },
            freshness: bundle.snapshot.freshness,
            limitations: [
                ...answer.limitations,
                ...bundle.limitations,
                "Answers are built from the deterministic portfolio snapshot; AI narration never computes authoritative equity, exposure, PnL, margin, risk or correlation.",
            ],
        });
    } catch (error) {
        return portfolioError(error);
    }
}
