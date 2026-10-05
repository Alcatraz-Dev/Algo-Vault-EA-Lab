// ─────────────────────────────────────────────────────────────────────────────
// Partial-close regression suite.
//
// Locks in the behaviour that a profitable position which is still running can
// have a PERCENTAGE OF ITS PROFIT locked — solved from the executable price and
// the instrument spec, never by blindly closing a percentage of volume — and
// that the same solve backs both the preview and the settlement.
//
//   npm run test:arena   →  [partial-close]
// ─────────────────────────────────────────────────────────────────────────────

import {
    calculateProfitPreservingPartialClose,
    closeTypeOf,
    planPartialClose,
    positionNetPnl,
    resolveVolumeCloseCentiLots,
    slicePnlAt,
    splitTradeCosts,
    totalCostCentsOf,
} from "../partial-close";
import type { ArenaSymbolSpec } from "../execution";
import type { ChallengeTrade } from "../types";
import { createSuite } from "./harness";
import { makeOpenTrade, NOW } from "./fixtures";

const XAU: Pick<ArenaSymbolSpec, "contractSize"> = { contractSize: 100 };
const FX: Pick<ArenaSymbolSpec, "contractSize"> = { contractSize: 100_000 };

/**
 * The worked example from the spec: BUY XAUUSD 1.00 lot at 2650.00, executable
 * close 2651.00, no costs ⇒ exactly +$100.00 of net unrealized profit.
 */
function goldLong100(overrides: Partial<ChallengeTrade> = {}): ChallengeTrade {
    return makeOpenTrade({
        symbol: "XAUUSD",
        market: "metals",
        side: "long",
        sizeCentiLots: 100,
        entryPriceMicros: 2_650_000_000,
        costs: { spreadCostCents: 0, slippageCostCents: 0, commissionCents: 0 },
        ...overrides,
    });
}

const QUOTE_2651 = { price: 2651, timestamp: NOW };

export async function runPartialCloseTests(): Promise<boolean> {
    const { check, section, finish } = createSuite("partial-close");

    // ── The headline bug: "lock 50% of profit" is not "close 50% of volume" ──
    section("profit preservation — the worked example");
    {
        const trade = goldLong100();
        const result = calculateProfitPreservingPartialClose({
            trade,
            spec: XAU,
            quote: QUOTE_2651,
            profitPercent: 50,
            stepCentiLots: 1,
        });

        check(result.ok, "a profitable XAUUSD long accepts a 50% profit lock");
        if (result.ok) {
            check(result.currentNetCents === 10_000, `position is +$100.00 net (got ${result.currentNetCents}c)`);
            check(result.targetCents === 5_000, `target is $50.00 (got ${result.targetCents}c)`);
            check(result.closeCentiLots === 50, `closes 0.50 lot (got ${result.closeCentiLots} centi-lots)`);
            check(result.remainingCentiLots === 50, "0.50 lot keeps running");
            check(result.realized.netCents === 5_000, `realizes $50.00 (got ${result.realized.netCents}c)`);
            check(result.remaining.netCents === 5_000, `remainder still shows $50.00 unrealized (got ${result.remaining.netCents}c)`);
            check(result.executionPrice === 2651, "executed at the resolved quote price");
            check(
                result.realized.netCents + result.remaining.netCents === result.currentNetCents,
                "slices sum back to the position's net P&L — nothing invented or lost",
            );
        }
    }

    // ── Mode A and Mode B are genuinely different quantities ───────────────
    section("volume mode vs profit mode");
    {
        const trade = goldLong100();

        const volume = planPartialClose({
            trade,
            spec: XAU,
            quote: QUOTE_2651,
            stepCentiLots: 1,
            volume: { percent: 25 },
        });
        const profit = planPartialClose({
            trade,
            spec: XAU,
            quote: QUOTE_2651,
            stepCentiLots: 1,
            profitPercent: 80,
        });

        check(volume.mode === "VOLUME" && volume.closeCentiLots === 25, "25% of volume closes 0.25 lot");
        check(volume.targetCents === null, "volume mode requests no profit target");
        check(volume.closeType === "VOLUME_PARTIAL", "volume mode records VOLUME_PARTIAL");

        check(profit.mode === "PROFIT_PRESERVATION" && profit.closeCentiLots === 80, "locking 80% of profit closes 0.80 lot");
        check(profit.targetCents === 8_000, "profit mode carries the $80.00 target");
        check(profit.closeType === "PROFIT_PRESERVATION", "profit mode records PROFIT_PRESERVATION");
        check(
            profit.closeCentiLots !== volume.closeCentiLots,
            "the two modes are NOT the same solve — 80% of profit ≠ 25% of volume",
        );
    }

    // ── A short position must mirror a long exactly ────────────────────────
    section("short side");
    {
        // Entry 2652.00, executable close (bid) 2651.00 ⇒ 1.00 × 1.00 lot × 100 = $100.
        const trade = goldLong100({ side: "short", entryPriceMicros: 2_652_000_000 });
        const result = calculateProfitPreservingPartialClose({
            trade,
            spec: XAU,
            quote: QUOTE_2651,
            profitPercent: 50,
            stepCentiLots: 1,
        });
        check(result.ok, "a profitable short accepts a 50% profit lock");
        if (result.ok) {
            check(result.currentNetCents === 10_000, "short is +$100.00 net at the executable bid");
            check(result.closeCentiLots === 50, "short locks $50.00 with 0.50 lot");
            check(result.realized.netCents === 5_000, "short realizes $50.00");
        }
    }

    // ── Locking the whole profit closes the whole position ─────────────────
    section("full lock");
    {
        const trade = goldLong100();
        const plan = planPartialClose({
            trade,
            spec: XAU,
            quote: QUOTE_2651,
            stepCentiLots: 1,
            profitPercent: 100,
        });
        check(plan.ok && plan.closeCentiLots === 100, "locking 100% closes 1.00 lot");
        check(plan.isFullClose && plan.remainingCentiLots === 0, "nothing is left running");
        check(plan.closeType === "FULL", "a full lock is recorded as a full close");
    }

    // ── HARD RULE: never plan a loss on a profitable position ──────────────
    section("never turns a profit into a loss");
    {
        let allPositive = true;
        let allInGrid = true;
        let allAtOrBelowTarget = true;
        for (let pct = 1; pct <= 100; pct += 1) {
            const result = calculateProfitPreservingPartialClose({
                trade: goldLong100(),
                spec: XAU,
                quote: QUOTE_2651,
                profitPercent: pct,
                stepCentiLots: 1,
            });
            if (!result.ok) {
                allPositive = false;
                continue;
            }
            if (result.realized.netCents <= 0) allPositive = false;
            if (result.closeCentiLots % 1 !== 0) allInGrid = false;
            if (result.realized.netCents > Math.ceil(result.targetCents) + 1) allAtOrBelowTarget = false;
        }
        check(allPositive, "every percentage from 1%..100% realizes a strictly positive P&L");
        check(allInGrid, "every closed quantity lands on the tradable grid");
        check(allAtOrBelowTarget, "grid rounding never locks materially more than requested");
    }

    // ── Costs are included in the target, not ignored ──────────────────────
    section("commission / spread / slippage");
    {
        const trade = goldLong100({
            costs: { spreadCostCents: 2_000, slippageCostCents: 1_000, commissionCents: 500 },
        });
        const current = positionNetPnl(trade, XAU, 2651);
        check(current.grossCents === 10_000, `gross is $100.00 before costs (got ${current.grossCents}c)`);
        check(current.netCents === 6_500, `net unrealized is $65.00 after $35.00 of costs (got ${current.netCents}c)`);

        const result = calculateProfitPreservingPartialClose({
            trade,
            spec: XAU,
            quote: QUOTE_2651,
            profitPercent: 50,
            stepCentiLots: 1,
        });
        check(result.ok, "a profitable position with costs still accepts a lock");
        if (result.ok) {
            check(result.targetCents === 3_250, `target is 50% of the NET $65.00, i.e. $32.50 (got ${result.targetCents}c)`);
            check(result.realized.netCents === 3_250, "realized net equals the target, costs included");
            check(result.realized.costCents === 1_750, "the closed slice carries its pro-rata costs");
        }
    }

    // ── Lot-grid normalization ─────────────────────────────────────────────
    section("lot grid");
    {
        const trade = goldLong100({ sizeCentiLots: 100 });

        const coarse = calculateProfitPreservingPartialClose({
            trade,
            spec: XAU,
            quote: QUOTE_2651,
            profitPercent: 33,
            stepCentiLots: 10,
        });
        check(coarse.ok && coarse.closeCentiLots === 30, "33% snaps DOWN to the 0.10 lot grid → 0.30 lot");
        check(coarse.ok && coarse.remainingCentiLots === 70, "0.70 lot keeps running");

        const dust = calculateProfitPreservingPartialClose({
            trade,
            spec: XAU,
            quote: QUOTE_2651,
            profitPercent: 1,
            stepCentiLots: 10,
        });
        check(dust.ok && dust.closeCentiLots === 10, "a 1% target below one step closes the smallest tradable slice");
        check(dust.ok && dust.realized.netCents > dust.targetCents, "the smallest slice realizes MORE than the tiny target");
        check(dust.ok && dust.realized.netCents > 0, "the smallest slice still realizes a profit, never a loss");
    }

    // ── A position below one lot step can only be closed whole ─────────────
    section("position below the tradable step");
    {
        const trade = goldLong100({ sizeCentiLots: 3 });
        const plan = planPartialClose({
            trade,
            spec: XAU,
            quote: QUOTE_2651,
            stepCentiLots: 10,
            profitPercent: 50,
        });
        check(plan.ok, "a sub-step position still plans a close");
        check(plan.isFullClose && plan.remainingCentiLots === 0, "the only executable close is the whole position");
        check(
            plan.warnings.some((w) => w.includes("smaller than one tradable lot step")),
            "the trader is told the minimum executable quantity",
        );
        check(plan.expectedNetCents > 0, "even the fallback close realizes a profit");
    }

    // ── Honest reporting when the grid leaves a shortfall ──────────────────
    section("shortfall is reported, never disguised");
    {
        const trade = goldLong100();
        const plan = planPartialClose({
            trade,
            spec: XAU,
            quote: QUOTE_2651,
            stepCentiLots: 10,
            profitPercent: 27,
        });
        check(plan.ok, "27% on a 0.10 grid still executes");
        check(plan.targetCents === 2_700, "target stays $27.00 — the requested figure is preserved");
        check(plan.expectedNetCents === 2_000, "the realized figure is the honest $20.00 the grid allows");
        check(plan.expectedNetCents !== plan.targetCents, "the plan does NOT pretend $20.00 is $27.00");
        check(
            plan.warnings.some((w) => w.includes("below") && w.includes("target")),
            "the shortfall is surfaced to the trader",
        );
    }

    // ── Refusals ───────────────────────────────────────────────────────────
    section("refusals");
    {
        const base = { trade: goldLong100(), spec: XAU, quote: QUOTE_2651, stepCentiLots: 1 };

        const flat = calculateProfitPreservingPartialClose({ ...base, profitPercent: 50, quote: { price: 2650, timestamp: NOW } });
        check(!flat.ok && flat.reason === "NOT_PROFITABLE", "a flat position has no profit to preserve");

        const losing = calculateProfitPreservingPartialClose({ ...base, profitPercent: 50, quote: { price: 2649, timestamp: NOW } });
        check(!losing.ok && losing.reason === "NOT_PROFITABLE", "a losing position is refused");
        check(!losing.ok && losing.currentNetCents !== null && losing.currentNetCents < 0, "the refusal still reports the real net P&L");

        const closed = calculateProfitPreservingPartialClose({
            ...base,
            trade: goldLong100({ status: "closed" }),
            profitPercent: 50,
        });
        check(!closed.ok && closed.reason === "NO_POSITION", "a closed position cannot be partially closed again");

        for (const bad of [0, -5, 101, Number.NaN]) {
            const invalid = calculateProfitPreservingPartialClose({ ...base, profitPercent: bad });
            check(!invalid.ok && invalid.reason === "INVALID_PERCENT", `profitPercent ${String(bad)} is rejected`);
        }

        const noSpec = calculateProfitPreservingPartialClose({ ...base, spec: null, profitPercent: 50 });
        check(!noSpec.ok && noSpec.reason === "SPEC_MISSING", "a missing instrument spec blocks the close rather than guessing");

        const noQuote = calculateProfitPreservingPartialClose({ ...base, quote: null, profitPercent: 50 });
        check(!noQuote.ok && noQuote.reason === "INVALID_QUOTE", "a missing quote blocks the close rather than using a stale price");

        const blocked = planPartialClose({ ...base, profitPercent: 50, quote: { price: 2640, timestamp: NOW } });
        check(!blocked.ok && blocked.blocked.includes("NOT_PROFITABLE"), "the plan itself is blocked, so execution refuses it");
        check(blocked.closeCentiLots === 0, "a blocked plan carries no quantity to execute");
    }

    // ── Preview and execution come from ONE engine ─────────────────────────
    section("preview ≡ execution");
    {
        const trade = goldLong100();
        const stepCentiLots = 1;
        for (const profitPercent of [10, 37, 50, 66, 99]) {
            const plan = planPartialClose({ trade, spec: XAU, quote: QUOTE_2651, stepCentiLots, profitPercent });
            const engine = calculateProfitPreservingPartialClose({
                trade,
                spec: XAU,
                quote: QUOTE_2651,
                profitPercent,
                stepCentiLots,
            });
            check(
                plan.ok && engine.ok && plan.closeCentiLots === engine.closeCentiLots && plan.expectedNetCents === engine.realized.netCents,
                `${profitPercent}%: preview and execution resolve to the identical quantity and P&L`,
            );
        }
    }

    // ── The executable price is re-resolved, never a stale chart price ─────
    section("executable price is the resolved quote");
    {
        const trade = goldLong100();
        const near = planPartialClose({ trade, spec: XAU, quote: { price: 2651, timestamp: NOW }, stepCentiLots: 1, profitPercent: 50 });
        const far = planPartialClose({ trade, spec: XAU, quote: { price: 2660, timestamp: NOW }, stepCentiLots: 1, profitPercent: 50 });
        check(near.executionPrice === 2651 && far.executionPrice === 2660, "each plan prices at the quote it was given");
        check(far.currentNetCents > near.currentNetCents, "a better price raises the position's net P&L");
        check(
            far.targetCents === Math.round(far.currentNetCents / 2),
            "the target is re-derived from the fresh price, not a cached value",
        );
    }

    // ── Cost splitting conserves the original charge ───────────────────────
    section("cost conservation");
    {
        const costs = { spreadCostCents: 1_111, slippageCostCents: 999, commissionCents: 333 };
        const halves = [25, 33, 50, 99].map((q) => {
            const { closed, remaining } = splitTradeCosts(costs, q, 100);
            return { q, closed: totalCostCentsOf(closed), remaining: totalCostCentsOf(remaining) };
        });
        check(
            halves.every((h) => h.closed + h.remaining === totalCostCentsOf(costs)),
            "every split charges exactly the original round-trip cost once",
        );

        // Gross is exactly linear in quantity and the cost split conserves the
        // total charge, so slicing adds back to the whole — bar the single cent
        // that per-component half-away-from-zero rounding can shift.
        const trade = goldLong100({ costs });
        const slices = [40, 35].map((q) => slicePnlAt(trade, XAU, 2651, q));
        const sliced = slices.reduce((sum, s) => sum + s.netCents, 0);
        const whole = slicePnlAt(trade, XAU, 2651, 75).netCents;
        check(
            Math.abs(sliced - whole) <= 1,
            `sliced P&L adds back to the whole position within a cent (${sliced}c vs ${whole}c)`,
        );

        const full = splitTradeCosts(costs, 100, 100);
        check(full.remaining.spreadCostCents === 0 && full.remaining.commissionCents === 0, "a full close leaves no residual cost behind");
    }

    // ── Volume-mode semantics are unchanged ────────────────────────────────
    section("volume mode preserved");
    {
        const trade = goldLong100();
        const half = resolveVolumeCloseCentiLots({ trade, stepCentiLots: 1, percent: 50 });
        check(!("error" in half) && half.closeCentiLots === 50, "50% of volume closes 0.50 lot");

        const over = resolveVolumeCloseCentiLots({ trade, stepCentiLots: 1, percent: 150 });
        check(!("error" in over) && over.closeCentiLots === 100, "a volume request above 100% is clamped to the position");

        const none = resolveVolumeCloseCentiLots({ trade, stepCentiLots: 1 });
        check(!("error" in none) && none.closeCentiLots === 100, "no size requested means a full close");

        const snap = resolveVolumeCloseCentiLots({ trade, stepCentiLots: 10, percent: 27 });
        check(!("error" in snap) && snap.closeCentiLots === 20, "volume mode also snaps DOWN to the lot grid");
    }

    // ── Legacy rows are classified, not guessed ────────────────────────────
    section("legacy close-type backfill");
    {
        check(closeTypeOf({ exitReason: "partial_close" } as never) === "VOLUME_PARTIAL", "a legacy partial_close is VOLUME_PARTIAL (profit lock did not exist)");
        check(closeTypeOf({ exitReason: "stop_loss" } as never) === "STOP_LOSS", "legacy stop losses backfill correctly");
        check(closeTypeOf({ exitReason: "manual" } as never) === "FULL", "legacy manual closes backfill to FULL");
        check(closeTypeOf({ exitReason: "partial_close", closeType: "PROFIT_PRESERVATION" } as never) === "PROFIT_PRESERVATION", "an explicit closeType always wins");
    }

    // ── FX contract size is honoured, not assumed ──────────────────────────
    section("instrument specifications");
    {
        const fx = makeOpenTrade({
            symbol: "EURUSD",
            market: "forex",
            side: "long",
            sizeCentiLots: 100,
            entryPriceMicros: 1_100_000,
            costs: { spreadCostCents: 0, slippageCostCents: 0, commissionCents: 0 },
        });
        // 0.00100 (10 pips) × 1.00 lot × 100,000 = $100.
        const current = positionNetPnl(fx, FX, 1.101);
        check(current.netCents === 10_000, `10 pips on 1.00 lot EURUSD is $100.00 (got ${current.netCents}c)`);

        const result = calculateProfitPreservingPartialClose({
            trade: fx,
            spec: FX,
            quote: { price: 1.101, timestamp: NOW },
            profitPercent: 25,
            stepCentiLots: 1,
        });
        check(result.ok && result.targetCents === 2_500, "25% of $100.00 is a $25.00 target");
        check(result.ok && result.closeCentiLots === 25, "$25.00 is realized by closing 0.25 lot");
    }

    return finish();
}