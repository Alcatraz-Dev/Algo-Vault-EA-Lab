// Simulated execution tests — fills, cost model, exits, marks, triggers.

import { createSuite } from "./harness";
import { arenaSymbolSpec, marketOfSymbol, computeFill, computeExit, markPosition, pendingOrderSide, stopLossHit, takeProfitHit, contractSizeOf } from "../execution";
import { makePolicy, makeOpenTrade } from "./fixtures";

export async function runExecutionTests(): Promise<boolean> {
    const s = createSuite("execution");
    const policy = makePolicy();

    s.section("Symbol metadata resolution");
    const eur = arenaSymbolSpec("EURUSD");
    s.check(eur !== null && eur.source === "SYMBOL_SPECS", "EURUSD resolves from canonical SYMBOL_SPECS");
    s.check(eur?.contractSize === 100_000 && eur?.pipSize === 0.0001, "EURUSD contract size / pip size");
    const gold = arenaSymbolSpec("XAUUSD");
    s.check(gold?.market === "metals" && gold?.contractSize === 100, "XAUUSD is metals, contract 100");
    const aapl = arenaSymbolSpec("AAPL");
    s.check(aapl !== null && aapl.market === "equities" && aapl.source === "derived", "AAPL derived spec (no fabricated spread)");
    s.check(aapl?.typicalSpread === 0, "derived spec has zero spread (honest — no fake data)");
    s.check(arenaSymbolSpec("DOGEUSDT") === null, "unknown symbol → null");
    s.check(marketOfSymbol("BTCUSD") === "crypto" && marketOfSymbol("NAS100") === "indices", "market classification");
    s.check(contractSizeOf("EURUSD") === 100_000, "contractSizeOf fallback resolver");

    s.section("Fill computation");
    const fill = computeFill({ side: "long", sizeCentiLots: 100, quotePrice: 1.1, spec: eur!, policy });
    s.check(fill.entryPriceMicros === 1_100_000, "entry at resolved quote (integer micros)");
    // spread 0.00012×1×100k=$12, slippage 0.00002×2×100k=$4, commission $3.50
    s.check(fill.totalCostCents === 1950, `round-trip cost = 1950 cents (got ${fill.totalCostCents})`);
    s.check(fill.costs.spreadCostCents === 1200 && fill.costs.slippageCostCents === 400 && fill.costs.commissionCents === 350, "cost breakdown recorded separately");
    s.check(fill.notionalCents === 110_000_00, "1-lot notional at 1.10");

    const risk = fill.riskCents(1_095_000);
    s.check(risk === 51_950, `planned risk = stop distance + costs (got ${risk})`);
    s.check(fill.riskCents(null) === null, "no stop → no measurable risk");

    s.section("Exit PnL = gross − recorded round-trip costs");
    const win = computeExit({
        side: "long",
        entryPriceMicros: 1_100_000,
        sizeCentiLots: 100,
        contractSize: 100_000,
        quotePrice: 1.105,
        costs: fill.costs,
    });
    // gross = 0.005 × 100k = $500; net = 500 − 19.50
    s.check(win.grossPnLCents === 50_000, `gross $500 (got ${win.grossPnLCents})`);
    s.check(win.netPnLCents === 50_000 - 1950, `net = gross − costs (got ${win.netPnLCents})`);

    const loss = computeExit({
        side: "long",
        entryPriceMicros: 1_100_000,
        sizeCentiLots: 100,
        contractSize: 100_000,
        quotePrice: 1.095,
        costs: fill.costs,
    });
    s.check(loss.netPnLCents === -50_000 - 1950, "loss includes costs too");

    const shortWin = computeExit({
        side: "short",
        entryPriceMicros: 1_100_000,
        sizeCentiLots: 100,
        contractSize: 100_000,
        quotePrice: 1.095,
        costs: fill.costs,
    });
    s.check(shortWin.netPnLCents === 50_000 - 1950, "short PnL sign correct");

    s.section("Mark-to-market");
    const marked = markPosition({
        side: "long",
        entryPriceMicros: 1_100_000,
        sizeCentiLots: 100,
        contractSize: 100_000,
        quotePrice: 1.1,
        costs: fill.costs,
    });
    s.check(marked.unrealizedPnLCents === -1950, "fresh entry marks −costs (spread/slippage/commission charged round trip)");
    const noQuote = markPosition({
        side: "long",
        entryPriceMicros: 1_100_000,
        sizeCentiLots: 100,
        contractSize: 100_000,
        quotePrice: null,
        costs: fill.costs,
    });
    s.check(noQuote.markPriceMicros === null && noQuote.unrealizedPnLCents === 0, "no quote → null mark (fail-closed, never fabricated)");

    s.section("Stop-loss / take-profit triggers");
    s.check(stopLossHit("long", 1_095_000, 1.0949), "long SL hit below stop");
    s.check(!stopLossHit("long", 1_095_000, 1.0951), "long SL not hit above stop");
    s.check(stopLossHit("short", 1_105_000, 1.1051), "short SL hit above stop");
    s.check(takeProfitHit("long", 1_110_000, 1.1101), "long TP hit above target");
    s.check(takeProfitHit("short", 1_090_000, 1.0899), "short TP hit below target");

    s.section("Pending order trigger geometry");
    s.check(pendingOrderSide("long", "limit", 1.099, 1.0985), "buy limit fills when quote ≤ limit");
    s.check(!pendingOrderSide("long", "limit", 1.099, 1.1), "buy limit not filled above limit");
    s.check(pendingOrderSide("short", "limit", 1.101, 1.1015), "sell limit fills when quote ≥ limit");
    s.check(pendingOrderSide("long", "stop", 1.101, 1.1015), "buy stop fills when quote ≥ stop");
    s.check(pendingOrderSide("short", "stop", 1.099, 1.0985), "sell stop fills when quote ≤ stop");

    s.section("Determinism (no randomness in fills)");
    const run1 = computeFill({ side: "short", sizeCentiLots: 25, quotePrice: 2650.5, spec: arenaSymbolSpec("XAUUSD")!, policy });
    const run2 = computeFill({ side: "short", sizeCentiLots: 25, quotePrice: 2650.5, spec: arenaSymbolSpec("XAUUSD")!, policy });
    s.check(JSON.stringify(run1) === JSON.stringify(run2), "same request → byte-identical fill record");

    s.section("Trade fixture shape");
    const trade = makeOpenTrade();
    s.check(trade.status === "open" && trade.realizedPnLCents === null, "open trade has no realized PnL");
    s.check(Number.isInteger(trade.sizeCentiLots) && Number.isInteger(trade.entryPriceMicros), "sizes/prices are integers");

    return s.finish();
}
