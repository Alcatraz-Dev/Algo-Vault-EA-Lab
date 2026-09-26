// Account health scoring tests.
//
// The scorer is pure, so every case here runs offline with no Firebase and no
// clock.
//
// ── Why several of these exist ────────────────────────────────────────────────
// Every bug below shipped as a *plausible but wrong* number rather than a crash,
// which is the dangerous kind. The fixtures are built from records read out of
// the live database, so they are the shapes that actually occur:
//
//   - An account holding real money reported balance 0 and a margin call,
//     because the loader read paths that do not exist.
//   - A user with no trading account at all scored a confident 100, because
//     `hasData` counted the platform-wide signal library.
//   - `marginLevel: 0` with `margin: 0` rendered "Margin: DANGER" on an account
//     that had no leverage in use and therefore no margin call.
//   - Every per-position risk figure was 100x too small, because the contract
//     size multiplier was missing.
//   - Thirty-two signals, all `pending`, reported as a 0.0% win rate.

import { buildAccountHealthDirectory, buildAccountHealthReport } from "../report";
import type {
    AccountHealthAccount,
    AccountHealthDirectoryEntry,
    AccountHealthFacts,
    AccountHealthPosition,
    AccountHealthSignal,
} from "../types";

/** One broker account record, shaped exactly as `trading_accounts` stores it. */
function account(over: Partial<AccountHealthAccount> = {}): AccountHealthAccount {
    return {
        accountId: "gateway_5054775401",
        balance: 10_000,
        equity: 10_000,
        freeMargin: 9_000,
        margin: 1_000,
        marginLevel: 1_200,
        currency: "USD",
        positionsCount: 1,
        status: "connected",
        lastHeartbeatAt: 1_790_086_906_102,
        mt5Account: "5054775401",
        ...over,
    };
}

/** A healthy, fully-populated account used as the baseline for comparisons. */
function healthyFacts(overrides: Partial<AccountHealthFacts> = {}): AccountHealthFacts {
    return {
        accounts: [account()],
        maxDrawdown: 5,
        peakEquity: 10_600,
        positions: [
            { symbol: "EURUSD", type: "buy", volume: 0.1, profit: 120, currentPrice: 1.1, sl: 1.05 },
        ],
        signals: [
            { result: "WIN", resultR: 1.8 },
            { result: "WIN", resultR: 2.1 },
            { result: "LOSS", resultR: -1 },
        ],
        ...overrides,
    };
}

export async function runAccountHealthTests(): Promise<boolean> {
    console.log("--- Account Health Tests ---");
    let passed = true;
    const check = (cond: boolean, label: string) => {
        if (cond) {
            console.log(`  PASS: ${label}`);
        } else {
            console.error(`  FAIL: ${label}`);
            passed = false;
        }
    };

    // ── Baseline ──────────────────────────────────────────────────────────────
    const healthy = buildAccountHealthReport(healthyFacts());
    check(Number.isFinite(healthy.score), "Score is finite for a populated account");
    check(healthy.score > 0 && healthy.score <= 100, "Score stays inside 0-100");
    check(healthy.hasData === true, "A populated account reports hasData");
    check(healthy.riskLevel === "LOW", "A well-funded account reports LOW risk");
    check(healthy.marginStatus === "SAFE", "Margin level 1200% reports SAFE");
    check(healthy.drawdownStatus === "SAFE", "No equity shortfall reports SAFE drawdown");
    check(healthy.exposureStatus === "LOW", "One position reports LOW exposure");
    check(healthy.metrics.balance === 10_000, "Balance is read from the broker account record");
    check(healthy.metrics.accounts === 1, "The broker account count is reported");

    // ── The live record that started this ────────────────────────────────────
    // Read verbatim from RTDB: $66.06, unleveraged, gateway-connected. It must
    // come back healthy and must not claim a margin call.
    const live = buildAccountHealthReport({
        accounts: [account({
            balance: 66.06, equity: 66.06, freeMargin: 66.06,
            margin: 0, marginLevel: 0, positionsCount: 0, status: "connected",
        })],
        positions: [],
        maxDrawdown: 0,
        peakEquity: 66.06,
        signals: [],
    });
    check(live.metrics.balance === 66.06, "A real $66.06 balance is reported, not 0");
    check(live.hasData === true, "A funded broker account reports hasData");
    check(live.marginStatus === "SAFE", "An unleveraged account does not report a margin call");
    check(live.metrics.marginLevel === null, "No margin in use reports no margin level, not 0%");
    check(live.metrics.marginUtilization === 0, "An unleveraged account reports 0% margin used");
    check(live.metrics.marginCallDistance === 0, "No leverage means no distance to a margin call");
    check(live.drawdownStatus === "SAFE", "A flat account reports SAFE drawdown");
    check(live.accounts[0].accountId === "gateway_5054775401", "The gateway accountId is surfaced");
    check(live.accounts[0].currency === "USD", "The account currency is surfaced");
    check(live.accounts[0].status === "connected", "The gateway status is surfaced");

    // ── hasData must not be satisfied by the shared signal library ───────────
    // `aiSignals` is platform-wide: every user has the same 32 pending signals.
    // If that counted, a user who has never traded scores a perfect 100.
    const neverTraded = buildAccountHealthReport({
        accounts: [],
        positions: [],
        maxDrawdown: 0,
        peakEquity: 0,
        signals: [{ result: "pending" }, { result: "pending" }],
    });
    check(neverTraded.hasData === false, "A user with no broker account reports hasData=false");
    check(
        neverTraded.accounts.length === 0 && neverTraded.positions.length === 0,
        "A user with no broker account has nothing to render a verdict from",
    );
    // `score` and `riskLevel` carry no meaning when hasData is false — both
    // surfaces render an em dash instead. The invariant that matters is that such
    // an account is never counted as healthy, which the directory enforces below.
    const dirNeverTraded = buildAccountHealthDirectory([{
        uid: "x", email: null, displayName: null, score: neverTraded.score,
        riskLevel: neverTraded.riskLevel, drawdownStatus: neverTraded.drawdownStatus,
        marginStatus: neverTraded.marginStatus, exposureStatus: neverTraded.exposureStatus,
        hasData: neverTraded.hasData, balance: 0, equity: 0, marginLevel: null,
        openRisk: 0, totalPositions: 0, positionsAtRisk: 0, accounts: 0,
        currency: "USD", connected: false,
    }]);
    check(dirNeverTraded.totals.active === 0, "A user with only pending signals is not 'active'");
    check(dirNeverTraded.totals.lowRisk === 0, "A user with no account is never counted low risk");

    // An account record that exists but has nothing in it is also not "active".
    const emptyAccount = buildAccountHealthReport({
        accounts: [account({ balance: 0, equity: 0, freeMargin: 0, margin: 0, marginLevel: 0, positionsCount: 0 })],
        positions: [],
        maxDrawdown: 0,
        peakEquity: 0,
        signals: [],
    });
    check(emptyAccount.hasData === false, "A zero-balance account with no positions is not hasData");

    // ── An unresolved signal library reports no win rate, not 0% ──────────────
    const allPending = buildAccountHealthReport(healthyFacts({
        signals: Array.from({ length: 32 }, (): AccountHealthSignal => ({ result: "pending" })),
    }));
    check(allPending.trading.winRate === null, "32 pending signals report no win rate, not 0.0%");
    check(allPending.trading.averageR === null, "32 pending signals report no average R");
    check(allPending.trading.resolvedSignals === 0, "32 pending signals count as 0 resolved");
    check(allPending.breakdown.signalQuality === 0, "An unresolved library earns no signal-quality credit");

    const halfResolved = buildAccountHealthReport(healthyFacts({
        signals: [
            { result: "WIN", resultR: 2 },
            { result: "LOSS", resultR: -1 },
            { result: "pending" },
        ],
    }));
    check(halfResolved.trading.resolvedSignals === 2, "Pending signals are excluded from the resolved count");
    check(halfResolved.trading.winRate === "50.0", "The win rate uses resolved signals only");
    check(halfResolved.trading.totalSignals === 3, "The tracked total still counts pending signals");
    check(halfResolved.breakdown.signalQuality === 8, "A 50% win rate earns half the signal credit");

    // ── No positions must not earn the open-P/L credit ───────────────────────
    // Otherwise inactivity is worth +10 points, which is a free pass for never
    // having opened a trade.
    const flat = buildAccountHealthReport(healthyFacts({ positions: [] }));
    check(flat.breakdown.pnl === 0, "No positions earns no open-P/L credit");
    const openAndFlat = buildAccountHealthReport(healthyFacts({
        positions: [{ symbol: "EURUSD", type: "buy", volume: 0.1, profit: 0, currentPrice: 1.1, sl: 1.05 }],
    }));
    check(openAndFlat.breakdown.pnl === 10, "A flat open book does earn the credit");

    // ── Position risk needs the contract multiplier ──────────────────────────
    // 1000 -> 950 on 1.0 lot is 50 points, times the 100 contract size = 5000.
    // Without the multiplier this read 50 and never crossed any risk threshold.
    const contracted = buildAccountHealthReport(healthyFacts({
        accounts: [account({ balance: 100_000 })],
        positions: [{ symbol: "XAUUSD", type: "buy", volume: 1, profit: 0, currentPrice: 2_000, sl: 1_900 }],
    }));
    check(contracted.positions[0].risk === 10_000, "Position risk includes the 100x contract size");
    check(contracted.metrics.openRisk === 10_000, "openRisk carries the contract size through");

    // Falling back to the open price when no stop is set.
    const noStop = buildAccountHealthReport(healthyFacts({
        accounts: [account({ balance: 100_000 })],
        positions: [{ symbol: "BTCUSD", type: "buy", volume: 0.5, profit: 0, currentPrice: 50_000, openPrice: 49_000 }],
    }));
    check(noStop.positions[0].risk === 50_000, "Without a stop, risk is measured from the open price");

    // A position with neither a stop nor an open price has no measurable risk,
    // which must read as 0 rather than NaN.
    const unmeasurable = buildAccountHealthReport(healthyFacts({
        positions: [{ symbol: "???", type: "buy", volume: 1, profit: 0 }],
    }));
    check(unmeasurable.positions[0].risk === 0, "A position with no prices reports 0 risk");
    check(unmeasurable.metrics.positionsAtRisk === 0, "An unmeasurable position is not flagged at risk");

    // ── Multi-account aggregation ────────────────────────────────────────────
    // Money sums; the tightest leveraged margin level binds.
    const multi = buildAccountHealthReport(healthyFacts({
        accounts: [
            account({ accountId: "gateway_a", balance: 1_000, equity: 1_000, margin: 100, marginLevel: 800 }),
            account({ accountId: "gateway_b", balance: 4_000, equity: 3_000, margin: 3_000, marginLevel: 120 }),
        ],
        positions: [],
        maxDrawdown: 0,
        peakEquity: 5_000,
    }));
    check(multi.metrics.balance === 5_000, "Balances sum across broker accounts");
    check(multi.metrics.equity === 4_000, "Equities sum across broker accounts");
    check(multi.metrics.marginUtilization === 62, "Margin utilisation uses the summed margin");
    check(multi.metrics.marginLevel === 120, "The weakest leveraged account's margin level binds");
    check(multi.marginStatus === "DANGER", "A 120% margin level on the weakest account is DANGER");
    check(multi.metrics.accounts === 2, "Both broker accounts are reported");

    // An idle account sitting alongside a leveraged one must not drag the level
    // to 0, which is what made every real account look redlined.
    const mixed = buildAccountHealthReport(healthyFacts({
        accounts: [
            account({ accountId: "gateway_a", balance: 1_000, equity: 1_000, margin: 0, marginLevel: 0 }),
            account({ accountId: "gateway_b", balance: 1_000, equity: 1_000, margin: 500, marginLevel: 600 }),
        ],
        positions: [],
    }));
    check(mixed.metrics.marginLevel === 600, "An idle account's 0 level is excluded from the minimum");
    check(mixed.marginStatus === "SAFE", "600% is above the 500% safe line");

    // ── Zero balance must not flag every position as at risk ────────────────
    const zeroBalance = buildAccountHealthReport(healthyFacts({
        accounts: [account({ balance: 0, equity: 0, margin: 0, marginLevel: 0 })],
        positions: [
            { symbol: "XAUUSD", type: "buy", volume: 1, profit: 0, currentPrice: 2000, sl: 1900 },
        ],
    }));
    check(
        zeroBalance.metrics.positionsAtRisk === 0,
        "A 5%-of-zero threshold does not mark positions as at risk",
    );
    check(Number.isFinite(zeroBalance.metrics.drawdown), "Zero balance reports drawdown 0, not NaN");
    check(Number.isFinite(zeroBalance.metrics.marginUtilization), "Zero balance reports margin 0%, not NaN");
    check(zeroBalance.metrics.openRisk === 10_000, "Open risk is still measured with a zero balance");

    // ── Risk detection ───────────────────────────────────────────────────────
    // Volumes are chosen against the x100 contract size, so "exactly 5% of a
    // 10,000 balance" is a risk of 500 — 50 points x 0.1 lots x 100.
    const scoreFixture = (positions: AccountHealthPosition[]): AccountHealthFacts => ({
        ...healthyFacts({ positions, accounts: [account({ equity: 9_000 })] }),
        signals: [{ result: "LOSS", resultR: -1 }, { result: "LOSS", resultR: -1 }],
    });
    const calm = buildAccountHealthReport(scoreFixture([
        { symbol: "EURUSD", type: "buy", volume: 0.1, profit: 0, currentPrice: 1_000, sl: 950 },
    ]));
    const risky = buildAccountHealthReport(scoreFixture([
        // 5000 risk against a 10,000 balance is 50% — well over the 5% line.
        { symbol: "BTCUSD", type: "buy", volume: 1, profit: 0, currentPrice: 1_000, sl: 950 },
    ]));
    check(calm.score < 100, "The comparison fixture sits below the 100 clamp");
    check(calm.metrics.positionsAtRisk === 0, "A 5% risk position is not flagged");
    check(risky.metrics.positionsAtRisk === 1, "A position risking >5% of balance is flagged");
    check(risky.positions[0].atRisk === true, "The at-risk flag is set on the position");
    check(risky.score < calm.score, "An at-risk position lowers the score");
    check(calm.score - risky.score === 5, "One at-risk position costs exactly 5 points");

    const atThreshold = buildAccountHealthReport(healthyFacts({
        accounts: [account({ balance: 20_000 })],
        positions: [{ symbol: "ETHUSD", type: "buy", volume: 0.02, profit: 0, currentPrice: 5_000, sl: 4_500 }],
    }));
    check(
        atThreshold.metrics.positionsAtRisk === 0,
        "A position at exactly 5% is not flagged (threshold is strictly greater)",
    );

    // ── Drawdown drives the verdict ──────────────────────────────────────────
    const drawn = buildAccountHealthReport(healthyFacts({ accounts: [account({ equity: 8_000 })] }));
    check(Math.abs(drawn.metrics.drawdown - 20) < 0.05, "A 2000 shortfall on 10000 reads as 20% drawdown");
    check(drawn.drawdownStatus === "DANGER", "20% drawdown reports DANGER");

    const mild = buildAccountHealthReport(healthyFacts({ accounts: [account({ equity: 9_500 })] }));
    check(mild.drawdownStatus === "SAFE", "5% drawdown is still SAFE (warning starts at 8%)");
    const warned = buildAccountHealthReport(healthyFacts({ accounts: [account({ equity: 9_000 })] }));
    check(warned.drawdownStatus === "WARNING", "10% drawdown reports WARNING");

    // Equity above balance must not produce a negative-drawdown bonus.
    // With no recorded peak drawdown, a profitable account has no penalty at all.
    const profitable = buildAccountHealthReport(healthyFacts({
        accounts: [account({ equity: 12_000 })],
        maxDrawdown: 0,
    }));
    check(profitable.metrics.drawdown < 0, "Equity above balance reads as negative drawdown");
    check(profitable.breakdown.drawdown === 0, "A positive equity with no recorded drawdown earns no penalty");

    // A recorded peak drawdown is real history and must not be hidden by a
    // healthy present moment.
    const recovered = buildAccountHealthReport(healthyFacts({ maxDrawdown: 60.08 }));
    check(recovered.metrics.drawdown === 0, "A recovered account shows 0% live drawdown");
    check(recovered.metrics.maxDrawdown === 60.1, "The recorded peak drawdown is reported");
    check(recovered.drawdownStatus === "DANGER", "A 60% recorded drawdown is not reported as SAFE");

    // ── Margin ───────────────────────────────────────────────────────────────
    const overLeveraged = buildAccountHealthReport(healthyFacts({
        accounts: [account({ margin: 9_000, marginLevel: 90 })],
    }));
    check(overLeveraged.marginStatus === "DANGER", "A 90% margin level reports DANGER");
    const thinMargin = buildAccountHealthReport(healthyFacts({
        accounts: [account({ marginLevel: 300 })],
    }));
    check(thinMargin.marginStatus === "WARNING", "A 300% margin level reports WARNING");
    check(
        buildAccountHealthReport(healthyFacts({ accounts: [account({ margin: 10_000, marginLevel: 0 })] })).marginStatus === "SAFE",
        "Margin in use but no reported level does not fabricate a margin call",
    );

    // ── Saturation ───────────────────────────────────────────────────────────
    check(healthy.score === 100, "A flawless account clamps to 100 rather than exceeding it");

    // ── Clamping ─────────────────────────────────────────────────────────────
    const wrecked = buildAccountHealthReport(healthyFacts({
        accounts: [account({ equity: 0, margin: 10_000, marginLevel: 0 })],
        maxDrawdown: 0,
        positions: Array.from({ length: 20 }, (_, i) => ({
            symbol: `S${i}`, type: "buy", volume: 1, profit: -100, currentPrice: 5_000, sl: 1_000,
        })),
        signals: Array.from({ length: 10 }, () => ({ result: "LOSS", resultR: -1 })),
    }));
    check(wrecked.score >= 0, "Score never goes below 0");
    check(wrecked.riskLevel === "HIGH", "A wrecked account reports HIGH risk");
    check(wrecked.breakdown.drawdown === 30, "Drawdown penalty caps at 30");
    check(wrecked.breakdown.exposure === 25, "Exposure penalty caps at 25 (15 at-risk + 10 count)");

    // ── openRisk matches the sum of its parts ────────────────────────────────
    const sumCheck = buildAccountHealthReport(healthyFacts({
        accounts: [account({ balance: 1_000_000 })],
        positions: [
            { symbol: "A", type: "buy", volume: 1, profit: 0, currentPrice: 1_000, sl: 900 },
            { symbol: "B", type: "sell", volume: 1, profit: 0, currentPrice: 500, sl: 550 },
        ],
    }));
    check(
        sumCheck.metrics.openRisk === sumCheck.positions.reduce((s, p) => s + p.risk, 0),
        "openRisk equals the sum of the listed per-position risks",
    );
    check(sumCheck.positions[1].risk === 5_000, "Short-side risk measures price to stop correctly");

    // ── Malformed input must not produce NaN anywhere ────────────────────────
    const junk = buildAccountHealthReport({
        accounts: [{
            accountId: undefined,
            balance: Number.NaN,
            equity: "abc" as unknown as number,
            freeMargin: undefined,
            margin: Number.POSITIVE_INFINITY,
            marginLevel: null,
            currency: 42 as unknown as string,
            positionsCount: 0,
            status: null,
        }],
        maxDrawdown: "abc" as unknown as number,
        peakEquity: 0,
        positions: [
            { symbol: undefined, volume: "x", profit: Number.NaN, currentPrice: undefined, sl: undefined },
        ],
        signals: [{ result: "WIN", resultR: "not-a-number" }],
    });
    const junkNumbers = [
        junk.score, junk.metrics.balance, junk.metrics.equity, junk.metrics.freeMargin,
        junk.metrics.floatingPnl, junk.metrics.floatingPnlPct, junk.metrics.drawdown,
        junk.metrics.maxDrawdown, junk.metrics.peakEquity, junk.metrics.marginUtilization,
        junk.metrics.openRisk, junk.metrics.marginCallDistance,
        junk.positions[0].risk, junk.positions[0].profit,
    ];
    check(junkNumbers.every((v) => Number.isFinite(v)), "Malformed input yields no NaN or Infinity");
    check(junk.metrics.marginLevel === null, "A malformed margin level reports no value, not NaN");
    check(junk.trading.averageR === null, "An unparseable resultR is excluded, not read as 0R");
    check(junk.accounts[0].currency === "USD", "A missing currency falls back to USD");

    // ── Admin directory ──────────────────────────────────────────────────────
    const entry = (over: Partial<AccountHealthDirectoryEntry>): AccountHealthDirectoryEntry => ({
        uid: "u", email: null, displayName: null, score: 80,
        riskLevel: "LOW", drawdownStatus: "SAFE", marginStatus: "SAFE", exposureStatus: "LOW",
        hasData: true, balance: 0, equity: 0, marginLevel: null, openRisk: 0,
        totalPositions: 0, positionsAtRisk: 0, accounts: 1, currency: "USD", connected: true,
        ...over,
    });

    const dir = buildAccountHealthDirectory([
        entry({ uid: "a-low", score: 90, riskLevel: "LOW" }),
        entry({ uid: "b-high", score: 20, riskLevel: "HIGH" }),
        entry({ uid: "c-mod", score: 60, riskLevel: "MODERATE" }),
        entry({ uid: "d-empty", hasData: false, score: 100, riskLevel: "LOW", accounts: 0, connected: false }),
    ]);
    const order = dir.accounts.map((a) => a.uid);
    check(
        order[0] === "b-high" && order[1] === "c-mod" && order[2] === "a-low",
        "The directory sorts worst-first, not alphabetically",
    );
    check(order[3] === "d-empty", "Accounts with no activity sort last whatever their score");
    check(dir.totals.accounts === 4, "Totals count every account");
    check(dir.totals.active === 3, "Inactive accounts are excluded from the active count");
    check(dir.totals.highRisk === 1 && dir.totals.moderateRisk === 1 && dir.totals.lowRisk === 1, "Risk bands are counted separately");
    check(dir.totals.allImpaired === false, "Mixed risk is not reported as all-impaired");
    check(dir.distribution.HIGH === 33 && dir.distribution.MODERATE === 33 && dir.distribution.LOW === 33, "Distribution shares sum to 100");

    const emptyOnly = buildAccountHealthDirectory([entry({ uid: "x", hasData: false, accounts: 0 })]);
    check(emptyOnly.totals.active === 0, "A single inactive account is not active");
    check(emptyOnly.totals.lowRisk === 0, "An inactive account is never counted as low risk");
    check(emptyOnly.distribution.LOW === 0, "An inactive account does not dilute the distribution");
    check(emptyOnly.totals.allImpaired === false, "An empty platform is not an impaired platform");

    const allBad = buildAccountHealthDirectory([
        entry({ uid: "p", riskLevel: "HIGH", score: 10 }),
        entry({ uid: "q", riskLevel: "HIGH", score: 20 }),
    ]);
    check(allBad.totals.allImpaired === true, "Every active account HIGH is reported as all-impaired");
    check(allBad.distribution.HIGH === 100, "An all-HIGH platform reads as 100% high risk");

    // Ordering must be total and stable, so a refresh never shuffles rows under
    // the operator's cursor.
    const tie = buildAccountHealthDirectory([
        entry({ uid: "z", riskLevel: "HIGH", score: 50 }),
        entry({ uid: "y", riskLevel: "HIGH", score: 50 }),
    ]);
    check(tie.accounts[0].uid === "y", "Tied accounts break by uid, so ordering is deterministic");
    check(buildAccountHealthDirectory([]).totals.accounts === 0, "An empty directory is handled");

    console.log(passed ? "Account health tests passed." : "Account health tests FAILED.");
    return passed;
}
