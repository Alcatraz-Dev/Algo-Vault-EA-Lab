// Money / precision tests — deterministic integer rounding for finance.

import { createSuite, approxEqual } from "./harness";
import {
    roundHalfAwayFromZero,
    toCents,
    toPriceMicros,
    toCentiLots,
    grossPnLCents,
    positionCostCents,
    plannedRiskCents,
    notionalCents,
    formatCents,
    pctOf,
    pctOfCents,
    addCents,
} from "../money";

export async function runMoneyTests(): Promise<boolean> {
    const s = createSuite("money");

    s.section("Rounding (half away from zero, deterministic)");
    s.check(roundHalfAwayFromZero(0.5) === 1, "0.5 → 1");
    s.check(roundHalfAwayFromZero(-0.5) === -1, "-0.5 → -1");
    s.check(roundHalfAwayFromZero(1.49) === 1, "1.49 → 1");
    s.check(roundHalfAwayFromZero(1.5) === 2, "1.5 → 2");
    s.check(roundHalfAwayFromZero(-1.5) === -2, "-1.5 → -2");
    s.check(roundHalfAwayFromZero(Number.NaN) === 0, "NaN → 0 (guarded)");

    s.section("Cents / micros / lots conversions");
    s.check(toCents(10.5) === 1050, "toCents(10.5) = 1050");
    s.check(toCents(-10.5) === -1050, "toCents(-10.5) = -1050");
    s.check(toPriceMicros(1.1) === 1_100_000, "price micros for 1.1");
    s.check(toPriceMicros(2650.5) === 2_650_500_000, "price micros for 2650.5");
    s.check(toCentiLots(0.1) === 10, "0.10 lot → 10 centi-lots");
    s.check(toCentiLots(1.25) === 125, "1.25 lot → 125 centi-lots");
    s.check(toCentiLots(-1) === null, "negative size → null");

    s.section("Gross PnL (long / short, deterministic)");
    const longEur = grossPnLCents({
        side: "long",
        entryPriceMicros: 1_100_000,
        exitPriceMicros: 1_101_000,
        sizeCentiLots: 100,
        contractSize: 100_000,
    });
    s.check(longEur === 10_000, `EURUSD long +10 pips 1 lot = $100 (got ${longEur})`);

    const shortEur = grossPnLCents({
        side: "short",
        entryPriceMicros: 1_101_000,
        exitPriceMicros: 1_100_000,
        sizeCentiLots: 100,
        contractSize: 100_000,
    });
    s.check(shortEur === 10_000, `EURUSD short same move = $100 (got ${shortEur})`);

    const gold = grossPnLCents({
        side: "long",
        entryPriceMicros: 2_650_500_000,
        exitPriceMicros: 2_655_500_000,
        sizeCentiLots: 10,
        contractSize: 100,
    });
    s.check(gold === 5_000, `XAUUSD +$5 × 0.1 lot × 100 = $50 (got ${gold})`);

    const losing = grossPnLCents({
        side: "long",
        entryPriceMicros: 1_100_000,
        exitPriceMicros: 1_099_000,
        sizeCentiLots: 100,
        contractSize: 100_000,
    });
    s.check(losing === -10_000, "loss is negative with correct sign");

    s.section("Round-trip cost model (spread + 2-leg slippage + commission)");
    const costs = positionCostCents({
        sizeCentiLots: 100,
        contractSize: 100_000,
        spreadPriceUnits: 0.00012,
        slippagePriceUnits: 0.00002,
        commissionPerLotCents: 350,
    });
    // spread 0.00012 × 1 lot × 100k = $12; slippage 0.00002 × 2 legs × 100k = $4; commission $3.50
    s.check(costs === 1950, `EURUSD round trip = 1950 cents (got ${costs})`);

    s.section("Planned risk (stop distance + costs, side-validated)");
    const risk = plannedRiskCents({
        side: "long",
        entryPriceMicros: 1_100_000,
        stopLossMicros: 1_095_000,
        sizeCentiLots: 100,
        contractSize: 100_000,
        costCents: 1950,
    });
    s.check(risk === 51_950, `50-pip stop 1 lot + costs = 51950 cents (got ${risk})`);
    const wrongSide = plannedRiskCents({
        side: "long",
        entryPriceMicros: 1_100_000,
        stopLossMicros: 1_105_000,
        sizeCentiLots: 100,
        contractSize: 100_000,
        costCents: 1950,
    });
    s.check(wrongSide === null, "stop on wrong side → null (caller rejects)");

    s.section("Notional / percentages / formatting");
    const notional = notionalCents({ priceMicros: 1_100_000, sizeCentiLots: 100, contractSize: 100_000 });
    s.check(notional === 110_000_00, "1 lot EURUSD @1.10 = $110,000 notional");
    s.check(pctOf(100_000_00, 5_000_00) === 5, "5% of 100k");
    s.check(pctOfCents(100_000_00, 4) === 4_000_00, "4% of 100k cents");
    s.check(addCents(100, -40) === 60, "addCents integer arithmetic");
    s.check(formatCents(-123_45) === "-$123.45", "negative formatting");
    s.check(approxEqual(pctOf(0, 5), 0), "pctOf zero-base guarded");

    s.section("Determinism");
    const inputs = {
        side: "long" as const,
        entryPriceMicros: 1_234_567,
        exitPriceMicros: 1_236_789,
        sizeCentiLots: 37,
        contractSize: 100_000,
    };
    const a = grossPnLCents(inputs);
    const b = grossPnLCents({ ...inputs });
    s.check(a === b && Number.isInteger(a), `same inputs → identical integer PnL (${a})`);

    return s.finish();
}
