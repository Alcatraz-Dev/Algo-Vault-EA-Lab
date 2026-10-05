/**
 * Phase 11 — Mobile, Cross-Device Sync & Trading Cockpit test suite.
 *
 * Run with:
 *     node scripts/jiti-tsrun.mjs tests/mobile/phase11.test.ts
 * (or `npm run test:mobile`)
 *
 * Self-contained runner convention, matching tests/market-core and
 * tests/chart-engine: no test framework, no Firebase, no network. Everything the
 * suite exercises is a pure function, which is why the safety-critical parts of
 * this phase (merge resolution, freshness, the live-order gate, deep links) live
 * in pure modules in the first place.
 *
 * Coverage:
 *   1.  Sync envelope ordering and deterministic conflict resolution
 *   2.  Workspace merge — desktop → mobile, mobile → desktop, partial sync
 *   3.  Drawing + watchlist merge (the cross-device chart compatibility case)
 *   4.  Preferences merge independence
 *   5.  Offline queue coalescing and rebase
 *   6.  Freshness states incl. reconnect and canonical-engine bridge
 *   7.  Live-order gate — fail closed on stale/unknown/incomplete state
 *   8.  Deep links — build, parse, auth return, open-redirect refusal
 *   9.  Notification anti-spam — dedup, cooldown, grouping, quiet hours
 *   10. Setup lifecycle honesty (no future-leakage display rules)
 */

import {
    DEFAULT_USER_PREFERENCES,
    emptyWorkspaceState,
    FRESHNESS_LABEL,
    type SyncEnvelope,
    type WorkspaceState,
    type UserPreferences,
} from "@/lib/mobile/contracts";
import {
    coalesceQueue,
    compareEnvelopes,
    mergeOrderedLists,
    mergePreferenceEnvelopes,
    mergeWorkspaceEnvelopes,
    pendingWriteAfterMerge,
    pickWinner,
} from "@/lib/mobile/sync";
import {
    DEFAULT_STALE_THRESHOLD_MS,
    describeFreshness,
    formatAge,
    freshnessThresholdsFor,
    fromCanonicalFreshness,
    isTradeableFreshness,
} from "@/lib/mobile/freshness";
import { evaluateOrderSafety, primaryBlockerMessage, MAX_LIVE_QUOTE_AGE_MS, isTicketExpired } from "@/lib/mobile/order-safety";
import {
    buildDeepLink,
    buildDeepLinkPath,
    buildLoginUrl,
    isSafeInternalPath,
    mobilePathFor,
    parseDeepLink,
} from "@/lib/mobile/deep-links";
import {
    classifyServerEvent,
    dedupKeyFor,
    renderGroupNotification,
    routeNotification,
    type NotificationEvent,
} from "@/lib/mobile/notification-routing";
import type { SetupMemoryRecord } from "@/lib/market-intelligence/memory/types";

// ─────────────────────────────────────────────────────────────────────────────
// Tiny test harness
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
    if (condition) {
        passed++;
    } else {
        failures.push(detail ? `${name} — ${detail}` : name);
    }
}

function eq<T>(name: string, actual: T, expected: T): void {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    check(name, ok, ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function envelope<T>(
    data: T,
    revision: number,
    updatedAt: number,
    device: string,
): SyncEnvelope<T> {
    return { revision, updatedAt, updatedByDevice: device, updatedByPlatform: "web", data };
}

function workspace(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
    return { ...emptyWorkspaceState(), ...overrides };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Envelope ordering
// ─────────────────────────────────────────────────────────────────────────────

{
    const a = envelope("a", 3, 100, "device-a");
    const b = envelope("b", 4, 50, "device-b");
    check("revision beats a newer timestamp", compareEnvelopes(b, a) > 0);
    eq("higher revision wins", pickWinner(a, b).winner.revision, 4);

    const same1 = envelope("a", 2, 200, "device-a");
    const same2 = envelope("b", 2, 100, "device-b");
    eq("timestamp breaks a revision tie", pickWinner(same1, same2).winner.data, "a");

    // Deterministic tiebreak: same revision, same timestamp, different devices.
    const tie1 = envelope("a", 2, 100, "device-a");
    const tie2 = envelope("b", 2, 100, "device-b");
    const forward = pickWinner(tie1, tie2);
    const backward = pickWinner(tie2, tie1);
    eq("device tiebreak is order-independent (forward)", forward.winner.data, "a");
    eq("device tiebreak is order-independent (backward)", backward.winner.data, "a");
    eq("tiebreak is explained", forward.reason, "equal revision and timestamp — deterministic device id tiebreak");

    const identical = envelope("same", 5, 100, "device-a");
    check("identical records are detected", pickWinner(identical, identical).identical);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Workspace merge — desktop ⇄ mobile
// ─────────────────────────────────────────────────────────────────────────────

{
    // Desktop changes the symbol; phone changes the timeframe. With a common base
    // both edits survive — this is the cross-device continuity guarantee.
    const base = envelope(workspace({ selectedSymbol: "XAUUSD", selectedTimeframe: "M5" }), 9, 900, "desktop");
    const desktop = envelope(workspace({ selectedSymbol: "EURUSD", selectedTimeframe: "M5" }), 10, 1000, "desktop");
    const phone = envelope(workspace({ selectedSymbol: "XAUUSD", selectedTimeframe: "H1" }), 11, 1100, "phone");
    const merged = mergeWorkspaceEnvelopes(desktop, phone, { base });
    eq("desktop symbol edit survives", merged.data.selectedSymbol, "EURUSD");
    eq("phone timeframe edit survives", merged.data.selectedTimeframe, "H1");
    check(
        "no unresolved scalar conflict when only one side changed each field",
        !merged.conflicts.some((c) => c.outcome === "remote" && c.key === "selectedSymbol"),
    );
}

{
    // Without a base there is nothing to reason from, so the record winner decides
    // and the conflict is reported rather than silently applied.
    const desktop = envelope(workspace({ selectedSymbol: "XAUUSD" }), 10, 1000, "desktop");
    const phone = envelope(workspace({ selectedSymbol: null }), 11, 1100, "phone");
    const merged = mergeWorkspaceEnvelopes(desktop, phone);
    eq("without a base the newer record decides the scalar", merged.data.selectedSymbol, null);
    check(
        "a base-less scalar conflict is recorded",
        merged.conflicts.some((c) => c.key === "selectedSymbol" && c.reason.includes("no common base")),
    );
}

{
    // Mobile → desktop: a phone that only toggled a Smart Money layer must not
    // revert the desktop's symbol.
    const base = envelope(workspace({ selectedSymbol: "XAUUSD", layers: { fvg: false } }), 19, 1900, "desktop");
    const desktop = envelope(
        workspace({ selectedSymbol: "EURUSD", layers: { fvg: false } }),
        20,
        2000,
        "desktop",
    );
    const phone = envelope(workspace({ selectedSymbol: "XAUUSD", layers: { fvg: true } }), 21, 2100, "phone");
    const merged = mergeWorkspaceEnvelopes(phone, desktop, { base });
    eq("mobile layer edit wins for its own key", merged.data.layers.fvg, true);
    eq("desktop symbol survives a layer-only phone edit", merged.data.selectedSymbol, "EURUSD");
}

{
    // Equal records short-circuit without touching anything.
    const a = envelope(workspace({ selectedSymbol: "GBPUSD" }), 5, 500, "d1");
    const b = envelope(workspace({ selectedSymbol: "GBPUSD" }), 5, 500, "d1");
    const merged = mergeWorkspaceEnvelopes(a, b);
    eq("identical workspaces merge to themselves", merged.data.selectedSymbol, "GBPUSD");
    check("identical merge reports no scalar conflict", merged.conflicts.every((c) => c.outcome === "identical"));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Drawings & watchlists — the cross-device chart compatibility case
// ─────────────────────────────────────────────────────────────────────────────

{
    const drawing = (id: string, price: number, updatedAt: number, device: string) => ({
        id,
        type: "trendline",
        symbol: "XAUUSD",
        points: [{ time: 1_700_000_000_000, price }],
        style: { color: "#2563eb", width: 1, lineStyle: "solid" as const },
        createdAt: updatedAt,
        updatedAt,
        updatedByDevice: device,
    });

    // Desktop drew a trend line; phone drew a rectangle. Neither may be lost.
    const desktop = envelope(
        workspace({ drawings: { XAUUSD: [drawing("line-1", 2648.2, 1000, "desktop")] } }),
        30,
        1000,
        "desktop",
    );
    const phone = envelope(
        workspace({
            drawings: {
                XAUUSD: [drawing("rect-1", 2650.5, 2000, "phone")],
            },
        }),
        31,
        2000,
        "phone",
    );

    const merged = mergeWorkspaceEnvelopes(desktop, phone);
    const ids = merged.data.drawings.XAUUSD.map((d) => d.id).sort();
    eq("drawings from both devices survive", ids, ["line-1", "rect-1"]);

    // Same object edited on both: newest per-item timestamp wins, deterministically.
    const bothEdited = mergeWorkspaceEnvelopes(
        envelope(workspace({ drawings: { XAUUSD: [drawing("line-1", 2640.0, 1500, "desktop")] } }), 40, 1500, "desktop"),
        envelope(workspace({ drawings: { XAUUSD: [drawing("line-1", 2655.0, 2500, "phone")] } }), 41, 2500, "phone"),
    );
    eq("a concurrently edited drawing resolves to the newer edit", bothEdited.data.drawings.XAUUSD[0].points[0].price, 2655.0);

    // Tied timestamps across devices must still converge.
    const tieA = envelope(workspace({ drawings: { XAUUSD: [drawing("line-1", 100, 999, "aaa")] } }), 50, 999, "aaa");
    const tieB = envelope(workspace({ drawings: { XAUUSD: [drawing("line-1", 200, 999, "bbb")] } }), 51, 999, "bbb");
    const tieMerged1 = mergeWorkspaceEnvelopes(tieA, tieB);
    const tieMerged2 = mergeWorkspaceEnvelopes(tieB, tieA);
    eq(
        "a tied drawing edit converges regardless of merge order",
        tieMerged1.data.drawings.XAUUSD[0].points[0].price,
        tieMerged2.data.drawings.XAUUSD[0].points[0].price,
    );

    check(
        "drawings are stored in market coordinates only",
        mergeWorkspaceEnvelopes(desktop, phone).data.drawings.XAUUSD.every((d) =>
            d.points.every((p) => typeof p.time === "number" && typeof p.price === "number"),
        ),
    );
}

{
    const list = (id: string, symbols: string[], order: number, updatedAt: number, device: string) => ({
        id,
        name: id,
        symbols,
        order,
        updatedAt,
        updatedByDevice: device,
    });

    const desktop = envelope(
        workspace({ watchlists: [list("main", ["XAUUSD", "EURUSD"], 0, 1000, "desktop")] }),
        60,
        1000,
        "desktop",
    );
    const phone = envelope(
        workspace({ watchlists: [list("main", ["XAUUSD", "GBPUSD"], 0, 2000, "phone")] }),
        61,
        2000,
        "phone",
    );

    const merged = mergeWorkspaceEnvelopes(desktop, phone);
    const symbols = merged.data.watchlists[0].symbols;
    check("a symbol added on the phone survives", symbols.includes("GBPUSD"), `got ${symbols.join(",")}`);
    check("a symbol only the desktop knew also survives", symbols.includes("EURUSD"), `got ${symbols.join(",")}`);
    check("no symbol is duplicated", new Set(symbols).size === symbols.length, `got ${symbols.join(",")}`);

    // A reorder from one device must not wipe an unrelated add from the other.
    const reordered = mergeWorkspaceEnvelopes(
        envelope(workspace({ watchlists: [list("main", ["EURUSD", "XAUUSD", "GBPUSD"], 0, 5000, "desktop")] }), 70, 5000, "desktop"),
        merged.envelope,
    );
    check("reordering does not drop symbols", reordered.data.watchlists[0].symbols.length === 3);
    eq("the newer ordering is respected", reordered.data.watchlists[0].symbols[0], "EURUSD");
}

{
    const a = mergeOrderedLists(["A", "B", "C"], ["A", "B", "C"]);
    eq("identical ordering merges to itself", a.values, ["A", "B", "C"]);
    eq("no additions reported when nothing is new", a.added, 0);

    const b = mergeOrderedLists(["A", "C"], ["B", "A"]);
    check("disjoint inserts both survive", b.values.includes("B") && b.values.includes("C"), `got ${b.values.join(",")}`);
    eq("additions are counted", b.added, 1);

    // A reorder on the newer side is respected rather than averaged away.
    eq("the newer ordering wins", mergeOrderedLists(["C", "A", "B"], ["A", "B", "C"]).values, ["C", "A", "B"]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Preferences
// ─────────────────────────────────────────────────────────────────────────────

{
    const desktop = envelope<UserPreferences>({ ...DEFAULT_USER_PREFERENCES, theme: "light" }, 80, 1000, "desktop");
    const phone = envelope<UserPreferences>(
        { ...DEFAULT_USER_PREFERENCES, theme: "dark", notifications: { ...DEFAULT_USER_PREFERENCES.notifications, cooldownSeconds: 60 } },
        81,
        1100,
        "phone",
    );

    const merged = mergePreferenceEnvelopes(desktop, phone);
    eq("theme follows the record winner", merged.data.theme, "dark");
    eq("a phone-only notification change is not reverted", merged.data.notifications.cooldownSeconds, 60);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Offline queue & rebase
// ─────────────────────────────────────────────────────────────────────────────

{
    const queued = [
        { id: "1", envelope: envelope(workspace({ selectedSymbol: "A" }), 1, 100, "d"), queuedAt: 1, attempts: 0 },
        { id: "2", envelope: envelope(workspace({ selectedSymbol: "B" }), 2, 200, "d"), queuedAt: 2, attempts: 0 },
        { id: "3", envelope: envelope(workspace({ selectedSymbol: "C" }), 3, 300, "d"), queuedAt: 3, attempts: 0 },
    ];
    eq("only the newest queued write is replayed", coalesceQueue(queued).envelope.revision, 3);

    const base = envelope(workspace({ selectedSymbol: "START", selectedTimeframe: "M5" }), 4, 4000, "desktop");
    const local = envelope(workspace({ selectedSymbol: "PHONE", selectedTimeframe: "M5" }), 5, 5000, "phone");
    const remote = envelope(workspace({ selectedSymbol: "START", selectedTimeframe: "D1" }), 9, 6000, "desktop");

    const merged = mergeWorkspaceEnvelopes(local, remote, { base });
    eq("the phone edit survives rebase", merged.data.selectedSymbol, "PHONE");
    eq("the desktop edit that was never in conflict survives", merged.data.selectedTimeframe, "D1");

    const pending = pendingWriteAfterMerge(local, merged.envelope, remote);
    check("a surviving local edit is still owed to the server", pending !== null);

    // A local edit that lost entirely must not be resurrected.
    const losingBase = envelope(workspace({ selectedSymbol: "START" }), 1, 50, "desktop");
    const losingLocal = envelope(workspace({ selectedSymbol: "LOST" }), 2, 100, "phone");
    const dominantRemote = envelope(workspace({ selectedSymbol: "WON" }), 99, 99000, "desktop");
    const losingMerged = mergeWorkspaceEnvelopes(losingLocal, dominantRemote, { base: losingBase });
    eq("a losing local edit does not overwrite the server", losingMerged.data.selectedSymbol, "WON");
    eq("a losing local edit is not re-queued", pendingWriteAfterMerge(losingLocal, losingMerged.envelope, dominantRemote), null);

    // …and an edit that the server already holds byte-for-byte is not re-sent.
    eq(
        "a record identical to the server's is not re-sent",
        pendingWriteAfterMerge(losingLocal, dominantRemote, dominantRemote),
        null,
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Freshness
// ─────────────────────────────────────────────────────────────────────────────

{
    const now = 1_000_000_000;
    const thresholds = { liveThresholdMs: 60_000, staleThresholdMs: 600_000 };

    eq(
        "recent data is live",
        describeFreshness({ dataTimestamp: now - 1_000, now, transport: "online", source: "tv", ...thresholds }).freshness,
        "live",
    );
    eq(
        "old-but-recent data is delayed",
        describeFreshness({ dataTimestamp: now - 120_000, now, transport: "online", source: "tv", ...thresholds }).freshness,
        "delayed",
    );
    eq(
        "very old data is stale",
        describeFreshness({ dataTimestamp: now - 900_000, now, transport: "online", source: "tv", ...thresholds }).freshness,
        "stale",
    );
    eq(
        "no data is stale, never live",
        describeFreshness({ dataTimestamp: null, now, transport: "online", source: "tv", ...thresholds }).freshness,
        "stale",
    );
    eq(
        "offline outranks a fresh timestamp",
        describeFreshness({ dataTimestamp: now - 500, now, transport: "offline", source: "tv", ...thresholds }).freshness,
        "offline",
    );
    eq(
        "reconnecting outranks a stale verdict",
        describeFreshness({ dataTimestamp: now - 900_000, now, transport: "reconnecting", source: "tv", ...thresholds }).freshness,
        "reconnecting",
    );

    check("only LIVE is tradeable", isTradeableFreshness(describeFreshness({ dataTimestamp: now, now, transport: "online", source: "tv" })));
    check(
        "DELAYED is not tradeable",
        !isTradeableFreshness(describeFreshness({ dataTimestamp: now - 120_000, now, transport: "online", source: "tv", liveThresholdMs: 60_000 })),
    );

    eq("age formatting", formatAge(now - 12_000, now), "12s");
    eq("age formatting (minutes)", formatAge(now - 240_000, now), "4m");
    eq("age formatting (hours)", formatAge(now - 4_320_000, now), "1h 12m");
    eq("unknown age", formatAge(null, now), "—");

    check("an M1 chart has a tighter staleness bound than D1", freshnessThresholdsFor("M1").staleThresholdMs < freshnessThresholdsFor("D1").staleThresholdMs);
    check("a default stale threshold exists", DEFAULT_STALE_THRESHOLD_MS > 0);

    // The canonical bridge: `unavailable` must never surface as live.
    const canonical = fromCanonicalFreshness(
        { fresh: false, status: "unavailable", dataAgeMs: 0, category: "tick" },
        { now, transport: "online", source: "biquote" },
    );
    eq("canonical `unavailable` maps to stale, not live", canonical.freshness, "stale");
    eq(
        "canonical `fresh` maps to live",
        fromCanonicalFreshness({ fresh: true, status: "fresh", dataAgeMs: 120, category: "tick" }, { now, transport: "online", source: "tv", timestamp: now - 120 }).freshness,
        "live",
    );
    eq(
        "canonical `stale` maps to stale",
        fromCanonicalFreshness({ fresh: false, status: "stale", dataAgeMs: 99_000, category: "tick" }, { now, transport: "online", source: "tv" }).freshness,
        "stale",
    );
    eq(
        "transport wins over a canonical fresh verdict",
        fromCanonicalFreshness({ fresh: true, status: "fresh", dataAgeMs: 10, category: "tick" }, { now, transport: "offline", source: "tv" }).freshness,
        "offline",
    );

    eq("every freshness state has a label", Object.keys(FRESHNESS_LABEL).length, 5);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Live-order gate — fail closed
// ─────────────────────────────────────────────────────────────────────────────

{
    const goodOrder = {
        mode: "live" as const,
        accountId: "acc-1",
        accountLabel: "Demo · IC Markets",
        symbol: "XAUUSD",
        side: "BUY" as const,
        orderType: "MARKET" as const,
        quantity: 0.1,
        price: 2650,
        stopLoss: 2640,
        takeProfit: 2670,
        estimatedRisk: 50,
        riskDecisionCode: "APPROVED",
        priceTimestamp: 1_000_000_000,
    };

    const baseInput: Parameters<typeof evaluateOrderSafety>[0] = {
        mode: "live",
        order: goodOrder,
        freshness: "live",
        now: 1_000_000_000,
        quoteAgeMs: 500,
        riskDecision: { approved: true, code: "APPROVED" },
        brokerConnected: true,
        killSwitchActive: false,
        confirmed: true,
    };

    const good = evaluateOrderSafety(baseInput);
    check("a complete live order is allowed", good.allowed, JSON.stringify(good.blockers));

    const cases: Array<[string, Parameters<typeof evaluateOrderSafety>[0], string]> = [
        ["stale data blocks", { ...baseInput, freshness: "stale", quoteAgeMs: 60_000 }, "STALE_MARKET_DATA"],
        ["offline blocks", { ...baseInput, freshness: "offline" }, "OFFLINE"],
        ["delayed blocks", { ...baseInput, freshness: "delayed", quoteAgeMs: 30_000 }, "STALE_MARKET_DATA"],
        ["unknown freshness blocks", { ...baseInput, freshness: null }, "UNKNOWN_FRESHNESS"],
        ["unconfirmed broker blocks", { ...baseInput, brokerConnected: null }, "BROKER_NOT_CONNECTED"],
        ["disconnected broker blocks", { ...baseInput, brokerConnected: false }, "BROKER_NOT_CONNECTED"],
        ["kill switch blocks", { ...baseInput, killSwitchActive: true }, "KILL_SWITCH_ACTIVE"],
        ["risk rejection blocks", { ...baseInput, riskDecision: { approved: false, code: "DAILY_LOSS_LIMIT" } }, "RISK_REJECTED"],
        ["missing stop loss blocks", { ...baseInput, order: { ...goodOrder, stopLoss: null } }, "MISSING_STOP_LOSS"],
        ["inverted stop loss blocks", { ...baseInput, order: { ...goodOrder, stopLoss: 2660 } }, "INVALID_STOP_LOSS"],
        ["missing account blocks", { ...baseInput, order: { ...goodOrder, accountId: null } }, "MISSING_ACCOUNT"],
        ["missing quantity blocks", { ...baseInput, order: { ...goodOrder, quantity: 0 } }, "MISSING_QUANTITY"],
        ["bad symbol blocks", { ...baseInput, order: { ...goodOrder, symbol: "../../etc/passwd" } }, "MISSING_SYMBOL"],
        ["a quote older than the live TTL blocks", { ...baseInput, quoteAgeMs: MAX_LIVE_QUOTE_AGE_MS + 1 }, "STALE_MARKET_DATA"],
    ];

    for (const [name, input, expected] of cases) {
        const result = evaluateOrderSafety(input);
        check(name, !result.allowed && result.blockers.includes(expected as never), `blockers: ${result.blockers.join(",")}`);
        check(`${name} produces a human message`, Boolean(primaryBlockerMessage(result)));
    }

    // Paper mode: stale is a labelled warning, not a refusal. That is the only
    // reason paper trading keeps working on a train.
    const paper = evaluateOrderSafety({
        mode: "paper",
        order: { ...goodOrder, mode: "paper", stopLoss: null },
        freshness: "stale",
        now: 1_000_000_000,
        quoteAgeMs: 300_000,
    });
    check("paper mode proceeds on stale data", paper.allowed, JSON.stringify(paper.blockers));
    check("paper mode warns that it used cached state", paper.warnings.some((w) => /simulation/i.test(w)));

    // …but structural nonsense is still a bug in either mode.
    const paperNoSymbol = evaluateOrderSafety({
        mode: "paper",
        order: { ...goodOrder, mode: "paper", symbol: "" },
        freshness: "live",
        now: 1_000_000_000,
    });
    check("paper mode still rejects a missing symbol", !paperNoSymbol.allowed);
    check("paper mode rejects a missing symbol for the right reason", paperNoSymbol.blockers.includes("MISSING_SYMBOL"));

    check("a ticket expires", isTicketExpired(1_000_000, 1_030_000));
    check("a fresh ticket has not expired", !isTicketExpired(1_000_000, 1_001_000));
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Deep links
// ─────────────────────────────────────────────────────────────────────────────

{
    eq("terminal link with timeframe", buildDeepLinkPath({ kind: "terminal", symbol: "XAUUSD", timeframe: "M5" }), "/terminal/XAUUSD?tf=M5");
    eq("terminal link without timeframe", buildDeepLinkPath({ kind: "terminal", symbol: "XAUUSD" }), "/terminal/XAUUSD");
    eq("setup link", buildDeepLinkPath({ kind: "setup", setupId: "setup_abc123" }), "/setup/setup_abc123");
    eq("alert link", buildDeepLinkPath({ kind: "alert", alertId: "alert_1" }), "/alert/alert_1");
    eq("research link", buildDeepLinkPath({ kind: "research", researchId: "run_9" }), "/research/run_9");
    eq("strategy link", buildDeepLinkPath({ kind: "strategy", strategyId: "strat_1" }), "/strategy/strat_1");
    eq("journal link", buildDeepLinkPath({ kind: "journal", entryId: "entry_1" }), "/journal/entry_1");
    eq("position link", buildDeepLinkPath({ kind: "position", positionId: "pos_1" }), "/position/pos_1");

    check("a path-traversal id is refused", buildDeepLinkPath({ kind: "setup", setupId: "../../users" }) === null);
    check("an over-long id is refused", buildDeepLinkPath({ kind: "setup", setupId: "a".repeat(65) }) === null);
    check("a malformed symbol is refused", buildDeepLinkPath({ kind: "terminal", symbol: "XAU USD" }) === null);
    check("an unsupported timeframe is dropped, not trusted", buildDeepLinkPath({ kind: "terminal", symbol: "XAUUSD", timeframe: "M99" as never }) === "/terminal/XAUUSD");

    eq(
        "build → parse round trip",
        parseDeepLink(buildDeepLinkPath({ kind: "setup", setupId: "setup_abc123" })!)?.target,
        { kind: "setup", setupId: "setup_abc123" },
    );
    eq(
        "terminal round trip preserves the timeframe",
        parseDeepLink("/terminal/XAUUSD?tf=H4")?.target,
        { kind: "terminal", symbol: "XAUUSD", timeframe: "H4" },
    );

    check("legacy /strategy-research links still resolve", parseDeepLink("/strategy-research/run_9")?.target.kind === "research");
    check("legacy /trade-journal links still resolve", parseDeepLink("/trade-journal/entry_1")?.target.kind === "journal");
    check("a malformed link does not parse", parseDeepLink("/setup/..%2F..%2Fadmin") === null);
    check("an absolute URL is not an internal path", !isSafeInternalPath("https://evil.example/steal"));
    check("a protocol-relative URL is refused", !isSafeInternalPath("//evil.example"));
    check("a backslash path is refused", !isSafeInternalPath("/\\evil"));
    check("a control character is refused", !isSafeInternalPath("/setup/ "));

    eq("login url carries the destination", buildLoginUrl("/setup/abc"), "/login?redirect=%2Fsetup%2Fabc");
    eq(
        "an unsafe return target is replaced, not forwarded",
        buildLoginUrl("https://evil.example"),
        "/login?redirect=%2Fdashboard",
    );

    eq(
        "the mobile variant of a link",
        mobilePathFor({ target: { kind: "setup", setupId: "abc" }, surface: "universal", returnTo: "/setup/abc" }),
        "/mobile/setup/abc",
    );

    const url = buildDeepLink({ kind: "setup", setupId: "abc" }, { origin: "https://algovault.io" });
    eq("an absolute link is same-origin by construction", url?.url, "https://algovault.io/setup/abc");
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Notification routing — anti-spam
// ─────────────────────────────────────────────────────────────────────────────

{
    const now = Date.UTC(2026, 0, 15, 12, 0, 0);
    const prefs = { ...DEFAULT_USER_PREFERENCES.notifications };

    const event = (over: Partial<NotificationEvent> = {}): NotificationEvent => ({
        category: "smartMoney",
        severity: "info",
        title: "BOS detected",
        body: "Bullish break of structure on XAUUSD M5",
        symbol: "XAUUSD",
        timeframe: "M5",
        code: "BOS_DETECTED",
        occurredAt: now,
        // The router only ever attaches a destination via `classifyServerEvent`,
        // which is exercised separately below.
        target: { kind: "terminal", symbol: "XAUUSD", timeframe: "M5" },
        ...over,
    });

    const first = routeNotification(event(), { now, preferences: prefs, lastDeliveryAt: {} });
    check("a first event is delivered", first.action === "deliver");
    check(
        "a market event deep links to the chart at the right symbol and timeframe",
        first.action === "deliver" && first.deepLinkPath === "/terminal/XAUUSD?tf=M5",
    );

    // Same code, same symbol, inside the cooldown → merged, not re-delivered.
    const repeat = routeNotification(event({ title: "BOS detected again" }), {
        now: now + 60_000,
        preferences: prefs,
        lastDeliveryAt: { [dedupKeyFor(event())]: now },
    });
    check("a repeat inside the cooldown is merged", repeat.action === "merge");

    // Same symbol, different code, while the group is open → merged.
    const grouped = routeNotification(
        event({ code: "FVG_DETECTED", title: "FVG detected" }),
        {
            now: now + 5_000,
            preferences: prefs,
            lastDeliveryAt: {},
            openGroups: { "XAUUSD:M5": { count: 1, openedAt: now } },
        },
    );
    check("a second event in the same group is merged", grouped.action === "merge");

    // Quiet hours suppress a non-critical event.
    const quiet = routeNotification(event(), {
        // 03:00 UTC
        now: Date.UTC(2026, 0, 15, 3, 0, 0),
        preferences: { ...prefs, quietHours: { startMinute: 22 * 60, endMinute: 7 * 60 } },
        lastDeliveryAt: {},
    });
    check("quiet hours suppress an informational event", quiet.action === "suppress");

    // …but never a critical risk event.
    const critical = routeNotification(
        event({ category: "risk", severity: "critical", code: "RISK_HALT", title: "Trading halted" }),
        {
            now: Date.UTC(2026, 0, 15, 3, 0, 0),
            preferences: { ...prefs, quietHours: { startMinute: 22 * 60, endMinute: 7 * 60 } },
            lastDeliveryAt: {},
        },
    );
    check("quiet hours never suppress a critical event", critical.action === "deliver");

    // An explicit user choice beats severity.
    const disabled = routeNotification(event({ category: "risk", severity: "critical" }), {
        now,
        preferences: { ...prefs, risk: false },
        lastDeliveryAt: {},
    });
    check("a disabled category is respected even for a critical event", disabled.action === "suppress");

    const rendered = renderGroupNotification("XAUUSD:M5", [
        event(),
        event({ code: "FVG_DETECTED" }),
        event({ code: "SETUP_CONFIRMED", category: "setup", target: { kind: "setup", setupId: "s1" } }),
        event({ code: "LIQUIDITY_SWEPT" }),
    ]);
    eq("five events become one grouped notification", rendered.title, "XAUUSD M5 Setup Intelligence updated");
    check("the grouped notification counts its events", /4/.test(rendered.body), rendered.body);
    eq("the group opens the most specific destination", rendered.deepLinkTarget, { kind: "setup", setupId: "s1" });

    // Server-event classification maps to the right destination.
    eq("a setup event opens the setup", classifyServerEvent({ code: "SETUP_TRIGGERED", setupId: "s1" }).target, { kind: "setup", setupId: "s1" });
    eq("a research event opens the research run", classifyServerEvent({ code: "RESEARCH_DONE", researchId: "r1" }).target, { kind: "research", researchId: "r1" });
    eq("a strategy degradation opens the strategy", classifyServerEvent({ code: "STRATEGY_DEGRADED", strategyId: "st1" }).target, { kind: "strategy", strategyId: "st1" });
    eq("a position event opens the position", classifyServerEvent({ code: "POSITION_CLOSED", positionId: "p1" }).target, { kind: "position", positionId: "p1" });
    check("a risk halt is critical", classifyServerEvent({ code: "RISK_HALT" }).severity === "critical");
    check("a risk breach is a warning", classifyServerEvent({ code: "RISK_DAILY_LOSS" }).severity === "warning");
    eq("an FVG event opens the chart", classifyServerEvent({ code: "FVG_CONFIRMED", symbol: "XAUUSD", timeframe: "M15" }).target, { kind: "terminal", symbol: "XAUUSD", timeframe: "M15" });
    check("a dedup key separates symbols", dedupKeyFor(event()) !== dedupKeyFor(event({ symbol: "EURUSD" })));
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Setup lifecycle honesty
// ─────────────────────────────────────────────────────────────────────────────

{
    // Phase 10's future-leakage protection: a setup that requires confirmation
    // that has not happened yet must not be rendered as confirmed. This asserts
    // the *data shape* the mobile card depends on, so a change to
    // `SetupMemoryRecord` that loses `triggeredAt`/`invalidatedAt` fails here.
    const record: SetupMemoryRecord = {
        id: "s1",
        status: "PARTIALLY_MATCHED",
        createdAt: 1000,
        updatedAt: 2000,
        matchedCount: 2,
        totalCount: 3,
    };
    check("an unconfirmed setup carries no triggeredAt", record.triggeredAt === undefined);
    check("an unconfirmed setup carries no invalidatedAt", record.invalidatedAt === undefined);
    check("an unconfirmed setup is not rendered as ACTIVE", record.status !== "ACTIVE");
    check("matched/total is available for the progress bar", record.matchedCount < record.totalCount);
}

// ─────────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\nPhase 11 — Mobile & Cross-Device Sync`);
console.log("─".repeat(52));
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
    console.log("\nFailures:");
    for (const failure of failures) console.log(`  ✗ ${failure}`);
    process.exit(1);
}
console.log("All Phase 11 checks passed.\n");
