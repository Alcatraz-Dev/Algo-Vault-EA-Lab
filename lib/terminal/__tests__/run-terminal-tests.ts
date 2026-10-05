/**
 * Phase 5 terminal tests — context, workspaces, watchlist, events, chat.
 *
 * Run with:
 *     npm run test:terminal
 *
 * Covers the Definition-of-Done items that live in pure code:
 *   · symbol / timeframe / workspace switching
 *   · watchlist add / remove / reorder / favourite / search
 *   · persisted-state sanitising (no invalid symbol can ever reach the UI)
 *   · workspace preset integrity + normalised panel sizes
 *   · event feed ordering, de-duplication and event → chart navigation
 *   · chat context: missing sections declared, nothing fabricated,
 *     wire sanitising clamps hostile payloads
 *   · paper/live account-mode separation (never mislabel a real account)
 *   · dashboard presets reference only catalog widgets; widget state
 *     normalisation is idempotent across load/save round-trips
 *   · one shared subscription surface (no panel opens its own poller)
 */

import {
    addSymbol,
    applyWorkspacePreset,
    decodeTerminalState,
    defaultTerminalState,
    encodeTerminalState,
    groupOfSymbol,
    removeSymbol,
    reorderSymbol,
    sanitizeTerminalState,
    searchSymbols,
    symbolsOfGroup,
    toggleFavorite,
} from "../state";
import { WORKSPACE_PRESETS, WORKSPACE_PRESET_BY_ID, isWorkspaceId, normalisedPanels } from "../workspaces";
import { PANEL_IDS, WORKSPACE_IDS, type TerminalState } from "../types";
import {
    buildEventFeed,
    eventChartTarget,
    eventTimeLabel,
    riskEvents,
    signalEvents,
    structureEvents,
    sweepEvents,
    zoneEvents,
} from "../events";
import {
    buildTradingChatContext,
    chatSystemInstructions,
    formatContextFacts,
    sanitizeChatContext,
} from "../chat-context";
import { deriveAccountMode } from "../account";
import { DASHBOARD_PRESETS, normalizeWidget } from "../../dashboard/presets";
import { WIDGET_SPEC_BY_TYPE, type DashboardWidget } from "../../../components/dashboard/widgets";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/* ── harness ─────────────────────────────────────────────────────────────── */

let passed = 0;
const failures: string[] = [];
let sectionName = "";

function section(title: string): void {
    sectionName = title;
    console.log(`\n· ${title}`);
}

function check(cond: boolean, message: string): void {
    if (cond) {
        passed += 1;
        console.log(`  ok   ${message}`);
    } else {
        failures.push(`${sectionName} → ${message}`);
        console.log(`  FAIL ${message}`);
    }
}

/* ── fixtures ────────────────────────────────────────────────────────────── */

function baseState(): TerminalState {
    return defaultTerminalState();
}

const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);

/** Minimal but structurally valid analysis payload for the projections. */
function fakeAnalysis(overrides: Record<string, unknown> = {}) {
    return {
        symbol: "XAUUSD",
        asOf: NOW,
        primaryTimeframe: "M5",
        structure: {
            trend: { value: "bullish", source: { id: "analytics.market-structure" }, status: "available" },
            bosEvents: [
                {
                    id: "b1",
                    type: "BOS",
                    direction: "bullish",
                    price: 3871.5,
                    timestamp: NOW - 60_000,
                    timeframe: "M5",
                    brokenLevel: 3870.2,
                },
            ],
            chochEvents: [
                {
                    id: "c1",
                    type: "CHOCH",
                    direction: "bearish",
                    price: 3869.1,
                    timestamp: NOW - 300_000,
                    timeframe: "M5",
                },
            ],
            liquidityLevels: {
                value: [{ id: "l1", type: "equal_highs", price: 3880, strength: 3, timeframe: "M5", timestamp: NOW }],
                source: { id: "analytics.liquidity" },
                status: "available",
            },
            liquiditySweeps: {
                value: [
                    {
                        id: "s1",
                        type: "sweep",
                        side: "sell_side",
                        level: 3865,
                        sweepPrice: 3864.2,
                        confirmed: true,
                        timestamp: NOW - 120_000,
                    },
                ],
                source: { id: "analytics.liquidity" },
                status: "available",
            },
            fairValueGaps: {
                value: [
                    {
                        id: "f1",
                        type: "fvg",
                        direction: "bullish",
                        high: 3874,
                        low: 3872.4,
                        timeframe: "M5",
                        strength: 2,
                        status: "active",
                        createdAt: NOW - 240_000,
                    },
                ],
                source: { id: "analytics.zones" },
                status: "available",
            },
            orderBlocks: {
                value: [
                    {
                        id: "o1",
                        type: "order_block",
                        direction: "bearish",
                        high: 3868,
                        low: 3866,
                        timeframe: "M5",
                        strength: 2,
                        status: "active",
                        createdAt: NOW - 400_000,
                    },
                ],
                source: { id: "analytics.zones" },
                status: "available",
            },
            reversalSetup: { value: null, source: { id: "analytics.market-structure" }, status: "unavailable" },
        },
        multiTimeframe: {
            timeframes: [
                {
                    timeframe: "H4",
                    bars: 200,
                    dataAsOf: NOW,
                    available: true,
                    trend: { value: "bullish", source: {}, status: "available" },
                    momentum: { value: "bullish", source: {}, status: "available" },
                    volatilityState: { value: "normal", source: {}, status: "available" },
                    atrPercent: { value: 0.4, source: {}, status: "available" },
                    structure: { value: "bullish", source: {}, status: "available" },
                    regime: { value: "trending", source: {}, status: "available" },
                    alignment: { value: "aligned", source: {}, status: "available" },
                    vwapPosition: { value: "above", source: {}, status: "available" },
                },
            ],
            availableCount: 1,
            requestedCount: 1,
            dominantBias: { value: "bullish", source: {}, status: "available" },
            alignedCount: 1,
            conflictingCount: 0,
            alignmentRatio: { value: 1, source: {}, status: "available" },
            summary: { value: "All available timeframes agree.", source: {}, status: "available" },
        },
        regime: {
            regime: { value: "trending", source: {}, status: "available" },
            label: { value: "Trending", source: {}, status: "available" },
            confidence: { value: 72, source: {}, status: "available" },
            classifierFactors: [],
            evidence: [],
            reversal: { value: null, source: {}, status: "unavailable" },
        },
        evidence: [
            {
                id: "structure",
                label: "Structure",
                score: 0.8,
                detail: "Bullish BOS on M5.",
                metrics: [],
                source: "analytics.market-structure",
            },
        ],
        scoredZones: [],
        ...overrides,
    } as never;
}

/* ── 1. symbol & timeframe switching ─────────────────────────────────────── */

section("Terminal context — symbol & timeframe switching");
{
    const s0 = baseState();
    check(s0.symbol === "XAUUSD", "default symbol is XAUUSD");

    const s1 = sanitizeTerminalState({ ...s0, symbol: "EURUSD" });
    check(s1.symbol === "EURUSD", "switching to EURUSD persists in state");
    check(s1.watchlist.includes("EURUSD"), "the active symbol is always reachable from the rail");

    const s2 = sanitizeTerminalState({ ...s1, symbol: "GOLD" });
    check(s2.symbol === "XAUUSD", "an unsupported symbol (GOLD) is rejected and falls back");

    const s3 = sanitizeTerminalState({ ...s1, timeframe: "M13" });
    check(s3.timeframe === "M5", "an unsupported timeframe (M13) is rejected");

    const s4 = sanitizeTerminalState({ ...s1, timeframe: "H4" });
    check(s4.timeframe === "H4", "a supported timeframe (H4) is accepted");

    // A stale blob that lost the active symbol keeps the state coherent.
    const s5 = sanitizeTerminalState({ version: 1, watchlist: ["XAUUSD", "EURUSD"], symbol: "GBPUSD" });
    check(s5.watchlist.includes("GBPUSD"), "sanitising re-inserts the active symbol into the watchlist");
}

/* ── 2. workspace switching ──────────────────────────────────────────────── */

section("Terminal context — workspace switching");
{
    check(WORKSPACE_PRESETS.length === WORKSPACE_IDS.length, "one preset per declared workspace id");
    for (const id of WORKSPACE_IDS) {
        check(isWorkspaceId(id), `workspace id "${id}" resolves to a preset`);
    }
    check(!isWorkspaceId("yolo"), "an unknown workspace id is rejected");

    const start = baseState();
    const sm = applyWorkspacePreset(start, "smart-money");
    check(sm.workspace === "smart-money", "workspace id updates");
    check(sm.timeframe === WORKSPACE_PRESET_BY_ID["smart-money"].defaultTimeframe, "preset default timeframe applied");
    check(
        sm.intelligenceMode === WORKSPACE_PRESET_BY_ID["smart-money"].defaultIntelligenceMode,
        "preset default intelligence mode applied"
    );
    // Switching must not throw away the user's market context.
    const moved = applyWorkspacePreset({ ...sm, symbol: "BTCUSD", watchlist: ["BTCUSD", "ETHUSD"] }, "research");
    check(moved.symbol === "BTCUSD", "workspace switch preserves the selected symbol");
    check(moved.watchlist.length === 2, "workspace switch preserves the watchlist");
    check(moved.workspace === "research", "second workspace switch applies");

    for (const p of WORKSPACE_PRESETS) {
        const norm = normalisedPanels(p);
        const total = Object.values(norm).filter((x) => x.visible).reduce((sum, x) => sum + x.size, 0);
        check(Math.abs(total - 1) < 1e-9, `${p.id}: visible panel sizes normalise to 1 (got ${total})`);
        check(norm.chart.visible, `${p.id}: the chart panel is always visible`);
        check(
            Object.keys(p.panels).length === PANEL_IDS.length,
            `${p.id}: covers every panel id`
        );
    }
}

/* ── 3. watchlist operations ─────────────────────────────────────────────── */

section("Watchlist — add / remove / reorder / favourite / search");
{
    let s = baseState();
    const before = s.watchlist.length;

    s = addSymbol(s, "NAS100");
    check(s.watchlist.includes("NAS100"), "adding a supported symbol appends it");
    check(s.watchlist.length === before + 1, "add grows the list by exactly one");

    const dup = addSymbol(s, "NAS100");
    check(dup.watchlist.length === s.watchlist.length, "adding a duplicate is a no-op");

    const bad = addSymbol(s, "NOTAREAL");
    check(bad === s, "adding an unsupported symbol changes nothing");

    s = reorderSymbol(s, "NAS100", 0);
    check(s.watchlist[0] === "NAS100", "reorder moves a symbol to index 0");

    s = reorderSymbol(s, "NAS100", 99);
    check(s.watchlist[s.watchlist.length - 1] === "NAS100", "reorder clamps an out-of-range index");

    const removed = removeSymbol(s, "NAS100");
    check(!removed.watchlist.includes("NAS100"), "remove takes the symbol out of the rail");

    const emptied = removeSymbol({ ...baseState(), watchlist: ["EURUSD"], symbol: "EURUSD" }, "EURUSD");
    check(emptied.watchlist.length === 1, "the rail is never emptied");

    const fav = toggleFavorite(baseState(), "EURUSD");
    check(fav.favorites.includes("EURUSD"), "favourite adds");
    check(symbolsOfGroup(fav, "Favorites").includes("EURUSD"), "Favorites group reads from the favourites list");
    const unfav = toggleFavorite(fav, "EURUSD");
    check(!unfav.favorites.includes("EURUSD"), "favourite toggles off");

    check(groupOfSymbol("XAUUSD") === "Metals", "XAUUSD classifies as Metals");
    check(groupOfSymbol("BTCUSD") === "Crypto", "BTCUSD classifies as Crypto");
    check(groupOfSymbol("ZZZ") === "Custom", "an unknown symbol falls into Custom");

    const hits = searchSymbols("USD", defaultTerminalState().watchlistGroups);
    check(hits.length > 0 && hits.every((h) => h.includes("USD")), "search only returns matching symbols");
    check(searchSymbols("%%% ", defaultTerminalState().watchlistGroups).length === 0, "an empty/odd query returns nothing");

    for (const g of ["Forex", "Metals", "Indices", "Crypto", "Stocks"]) {
        check(symbolsOfGroup(defaultTerminalState(), g).length > 0, `built-in group ${g} is populated from the catalogue`);
    }
}

/* ── 4. persistence round-trip ───────────────────────────────────────────── */

section("Persistence — encode / decode / hostile blobs");
{
    const s = { ...baseState(), symbol: "GBPUSD" as const, timeframe: "H1" as const, chatOpen: false };
    const round = decodeTerminalState(encodeTerminalState(s));
    check(round.symbol === "GBPUSD", "encode/decode preserves the symbol");
    check(round.timeframe === "H1", "encode/decode preserves the timeframe");
    check(round.chatOpen === false, "encode/decode preserves chat visibility");

    check(decodeTerminalState(null).symbol === "XAUUSD", "a missing blob falls back to defaults");
    check(decodeTerminalState("{not json").symbol === "XAUUSD", "a corrupt blob falls back to defaults");
    check(decodeTerminalState("[1,2,3]").symbol === "XAUUSD", "a non-object blob falls back to defaults");

    const hostile = sanitizeTerminalState({
        symbol: "XAUUSD",
        panels: { chart: { visible: false, size: 3 }, watchlist: { visible: "yes", size: -4 } },
        watchlistGroups: { Forex: ["EURUSD", "FAKEUSD"], "&quot;><script>": ["EURUSD"] },
        intelligenceMode: "nonsense",
        accountMode: "godmode",
    });
    check(hostile.panels.chart.visible === true, "the chart can never be hidden");
    check(hostile.panels.watchlist.visible === true, "an invalid visibility falls back to the default");
    check(hostile.panels.watchlist.size > 0, "an invalid size falls back to a positive default");
    check(!hostile.watchlistGroups.Forex.includes("FAKEUSD"), "unsupported symbols are stripped from groups");
    check(hostile.intelligenceMode === "structure", "an invalid intelligence mode falls back");
    check(hostile.accountMode === "unknown", "an invalid account mode falls back to unknown");
}

/* ── 5. event feed ───────────────────────────────────────────────────────── */

section("Event feed — projection, ordering, navigation");
{
    const a = fakeAnalysis();
    const struct = structureEvents(a, "M5");
    const sweeps = sweepEvents(a, "M5");
    const zones = zoneEvents(a, "M5");
    const risk = riskEvents({ symbol: "XAUUSD", timeframe: "M5", timestamp: NOW, reasons: ["kill switch"], halted: true });

    check(struct.length === 2, "BOS and CHOCH both project into the feed");
    check(struct.some((e) => e.type === "BOS"), "a BOS event is produced");
    check(struct.some((e) => e.type === "CHOCH"), "a CHOCH event is produced");
    check(sweeps[0]?.type === "SWEEP", "a liquidity sweep projects");
    check(zones.some((e) => e.type === "FVG_CREATED"), "an active FVG projects as created");
    check(zones.some((e) => e.type === "OB_CREATED"), "an active order block projects as created");
    check(risk[0]?.severity === "critical", "a halted risk guard is critical severity");

    const feed = buildEventFeed([struct, sweeps, zones, risk]);
    check(feed.length > 0, "the assembled feed is non-empty");
    for (let i = 1; i < feed.length; i += 1) {
        check(feed[i - 1].timestamp >= feed[i].timestamp, "the feed is sorted newest first");
    }
    const dupe = buildEventFeed([struct, struct]);
    check(dupe.length === struct.length, "duplicate ids collapse to one entry");

    const empty = buildEventFeed([[], []]);
    check(empty.length === 0, "no engine output means an empty feed — never padded");

    const first = feed[0];
    const target = eventChartTarget(first);
    check(target !== null, "an event yields a chart target");
    check(target?.symbol === first.symbol, "the target carries the event symbol");
    check(target?.timeframe === first.timeframe, "the target carries the event timeframe");
    check(target?.time === first.timestamp, "the target carries the event timestamp");

    const broken = eventChartTarget({ ...first, timestamp: 0 });
    check(broken === null, "an event with no usable timestamp fails closed");

    check(eventTimeLabel(Date.UTC(2026, 9, 5, 14, 35)) === "14:35", "event clock label renders HH:MM UTC");

    const noAnalysis = structureEvents(null, "M5");
    check(noAnalysis.length === 0, "no analysis payload → no structure events");
    check(signalEvents(null).length === 0, "no signals → no signal events");
}

/* ── 6. chat context ─────────────────────────────────────────────────────── */

section("Trading chat — context generation, no fabrication");
{
    // Everything absent: the context must say so rather than invent.
    const bare = buildTradingChatContext({
        question: "Should I trade this?",
        workspace: "day-trading",
        accountMode: "unknown",
        symbol: "XAUUSD",
        timeframe: "M5",
        now: NOW,
    });
    check(bare.market.lastPrice === null, "a missing price is null, not 0");
    check(bare.positions === null, "positions without an account are null (missing), not []");
    check(bare.risk === null, "risk without an account is null");
    check(bare.strategy === null, "an absent strategy is null");
    check(bare.missing.includes("positions"), "the missing positions section is declared");
    check(bare.missing.includes("risk"), "the missing risk section is declared");
    check(bare.market.symbol === "XAUUSD", "the active symbol is carried");
    check(bare.question === "Should I trade this?", "the question is carried");

    const withData = buildTradingChatContext({
        question: "Analyze this setup",
        workspace: "smart-money",
        accountMode: "paper",
        symbol: "XAUUSD",
        timeframe: "M5",
        now: NOW,
        marketTimestamp: NOW - 4_000,
        lastPrice: 3872.4,
        changePct: 0.82,
        regime: "Trending",
        analysis: fakeAnalysis(),
        positions: [
            { ticket: "1", symbol: "XAUUSD", side: "BUY", size: 0.5, entry: 3872.4, current: 3876.2, pnl: 190 },
        ],
        orders: [],
        risk: { status: "SAFE", equity: 10_000, balance: 9_810 },
        setups: [],
        recentTrades: [],
    });

    check(withData.session.marketAgeMs === 4_000, "market age is measured from the supplied timestamp");
    check(withData.market.lastPrice === 3872.4, "the supplied price is carried verbatim");
    check(withData.positions?.length === 1, "positions are carried");
    check(withData.positions?.[0].sl === null, "a position with no SL keeps null (not 0)");
    check(withData.risk?.status === "SAFE", "risk status is carried");
    check(withData.missing.includes("strategy"), "an absent strategy is still declared missing");
    check(withData.smartMoney.structureBias === "bullish", "the structure bias comes from the analysis payload");
    check(withData.smartMoney.multiTimeframe?.[0].timeframe === "H4", "the MTF ladder is carried");
    check(withData.indicators?.[0].name === "Structure", "evidence sections become indicator rows");

    const facts = formatContextFacts(withData);
    check(facts.includes("XAUUSD"), "the facts block names the symbol");
    check(facts.includes("DETERMINISTIC") === false, "the facts block does not editorialise");
    check(facts.includes("USER QUESTION"), "the facts block ends with the question");
    check(facts.includes("3872.4"), "real prices appear in the facts block");

    const bareFacts = formatContextFacts(bare);
    check(bareFacts.includes("unavailable"), "unavailable values are rendered as unavailable");
    check(bareFacts.includes("UNAVAILABLE SECTIONS"), "missing sections are listed for the model");
    check(bareFacts.includes("positions"), "positions is named as unavailable");

    const instructions = chatSystemInstructions();
    check(instructions.includes("INTERPRETATION"), "system instructions require a separate interpretation section");
    check(instructions.includes("Never"), "system instructions forbid inventing values");

    // Volatility in the FACTS block must be a measurement, never the regime
    // id wearing the volatility label (Phase 5 §26: no fabricated data).
    const volCtx = buildTradingChatContext({
        question: "How volatile is it?",
        workspace: "day-trading",
        accountMode: "paper",
        symbol: "XAUUSD",
        timeframe: "M5",
        now: NOW,
        regime: "TRENDING",
        volatility: "trending_bullish",
        analysis: fakeAnalysis({
            evidence: [
                {
                    id: "volatility",
                    label: "Volatility",
                    score: 1,
                    detail: "ATR state normal.",
                    metrics: [
                        { label: "ATR %", value: 0.12, unit: "%" },
                        { label: "ATR(14)", value: 4.2, unit: "price" },
                    ],
                    source: "analytics.volatility",
                },
            ],
        }),
    });
    check(volCtx.market.volatility === "0.12% ATR", "volatility comes from the ATR evidence metrics");
    check(volCtx.market.regime === "TRENDING", "regime stays its own fact");

    const noVolCtx = buildTradingChatContext({
        question: "q",
        workspace: "day-trading",
        accountMode: "paper",
        symbol: "XAUUSD",
        timeframe: "M5",
        now: NOW,
        volatility: "trending_bearish",
        analysis: fakeAnalysis(),
    });
    check(noVolCtx.market.volatility === null, "analysis without a volatility measurement → null, never a regime id");

    const explicitCtx = buildTradingChatContext({
        question: "q",
        workspace: "day-trading",
        accountMode: "paper",
        symbol: "XAUUSD",
        timeframe: "M5",
        now: NOW,
        volatility: "0.30% ATR",
    });
    check(explicitCtx.market.volatility === "0.30% ATR", "a caller-supplied measurement survives without analysis");
}

/* ── 7. wire sanitising ──────────────────────────────────────────────────── */

section("Trading chat — wire sanitising");
{
    const good = buildTradingChatContext({
        question: "q",
        workspace: "day-trading",
        accountMode: "live",
        symbol: "XAUUSD",
        timeframe: "M5",
        now: NOW,
        lastPrice: 3872.4,
    });

    const clean = sanitizeChatContext(good, "server question");
    check(clean !== null, "a well-formed context survives sanitising");
    check(clean?.question === "server question", "the server-side question wins over the payload");
    check(clean?.market.lastPrice === 3872.4, "finite numbers pass through");
    check(clean?.session.accountMode === "live", "the account mode is preserved");

    check(sanitizeChatContext(null, "q") === null, "a null context is rejected");
    check(sanitizeChatContext("nope", "q") === null, "a non-object context is rejected");
    check(sanitizeChatContext({ session: { workspace: "x" } }, "q") === null, "a context without market data is rejected");

    const hostile = sanitizeChatContext(
        { ...good, market: { ...good.market, lastPrice: Number.NaN, symbol: "X".repeat(500) }, evil: { __proto__: {} } },
        "q"
    );
    check(hostile?.market.lastPrice === null, "NaN becomes null — never rendered as a price");
    check((hostile?.market.symbol.length ?? 0) <= 16, "an oversized symbol string is clipped");

    const deep = sanitizeChatContext(
        { ...good, smartMoney: { ...good.smartMoney, structureEvents: Array.from({ length: 500 }, (_, i) => ({ type: "BOS", direction: "bullish", price: i, timestamp: NOW })) } },
        "q"
    );
    check((deep?.smartMoney.structureEvents?.length ?? 0) <= 32, "oversized arrays are truncated before they reach the model");
}

/* ── 8. account mode (DoD: positions — paper/live separation) ─────────────── */

section("Positions — paper/live account mode separation");
{
    check(deriveAccountMode({ demo: true }) === "paper", "an explicit demo flag is paper");
    check(deriveAccountMode({ server: "MetaQuotes-Demo" }) === "paper", "a demo server is paper");
    check(deriveAccountMode({ type: "trial" }) === "paper", "a trial account is paper");
    check(deriveAccountMode({ environment: "practice" }) === "paper", "a practice environment is paper");
    check(deriveAccountMode({ mt5Account: "simulation-7" }) === "paper", "a simulation marker is paper");
    check(deriveAccountMode({ server: "Live-02", broker: "ICMarkets" }) === "live", "a live record stays live");
    check(deriveAccountMode({}) === "live", "an unrecognised record is treated as live — never mislabelled paper");
    check(deriveAccountMode({ type: "demoish" }) === "live", "the demo marker is word-bounded, not a substring match");
}

/* ── 9. dashboard (DoD: widget state persistence) ─────────────────────────── */

section("Dashboard — presets & widget state persistence");
{
    check(DASHBOARD_PRESETS.length >= 6, "the preset catalogue ships its starting points");
    const ids = DASHBOARD_PRESETS.map((p) => p.id);
    check(new Set(ids).size === ids.length, "preset ids are unique");

    for (const preset of DASHBOARD_PRESETS) {
        check(preset.widgets.length > 0, `preset "${preset.id}" defines a layout`);
        for (const [type, w] of preset.widgets) {
            const spec = WIDGET_SPEC_BY_TYPE[type];
            check(!!spec, `preset "${preset.id}" references catalog widget "${type}"`);
            check(!!spec && spec.widths.includes(w), `preset "${preset.id}" width ${w} is allowed for "${type}"`);
        }
    }

    // Load → save → load must be a fixed point: a normalised widget survives
    // the round-trip unchanged, and a corrupt row degrades to something
    // renderable instead of crashing the board.
    const hostile = normalizeWidget({ id: "w1", type: "live_chart", title: "Chart", x: 0, y: 0, w: 99, h: 7 } as DashboardWidget);
    check(hostile.w === WIDGET_SPEC_BY_TYPE["live_chart"].widths[0], "an invalid width falls back to the spec default");
    check(hostile.h === 1, "an invalid height falls back to 1");
    const again = normalizeWidget(hostile);
    check(again.w === hostile.w && again.h === hostile.h && again.config === hostile.config, "normalisation is idempotent — persisted state never drifts");

    const unknown = normalizeWidget({ id: "w2", type: "no_such_widget", title: "?", x: 0, y: 0, w: 3, h: 7, config: {} });
    check(unknown.w === 1, "an unknown widget type degrades to a renderable width");
    check(unknown.h === 1, "an unknown widget type still clamps height");
    check(typeof unknown.config === "object" && unknown.config !== null, "config is always an object");
}

/* ── 10. performance (DoD: no duplicated subscriptions) ───────────────────── */

section("Performance — one shared subscription surface");
{
    const dir = join(process.cwd(), "components", "terminal");
    const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"));
    check(files.length >= 10, "the terminal panel set is present");

    // Full-line comments are stripped so docs may name an endpoint without
    // being mistaken for a second poller.
    const codeOnly = (src: string): string =>
        src
            .split("\n")
            .filter((l) => {
                const t = l.trimStart();
                return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
            })
            .join("\n");

    const provider = codeOnly(readFileSync(join(dir, "TerminalData.tsx"), "utf8"));
    check(provider.includes("onValue("), "RTDB listeners live in the shared provider");
    const pollers = [
        "/api/analytics/watchlist",
        "/api/analysis/intelligence",
        "/api/scalping/signals",
        "/api/terminal/risk",
        "/api/analytics/ohlc",
    ];
    for (const ep of pollers.slice(0, 4)) {
        check(provider.includes(ep), `the shared provider polls ${ep}`);
    }

    for (const f of files) {
        if (f === "TerminalData.tsx") continue;
        const src = codeOnly(readFileSync(join(dir, f), "utf8"));
        check(!src.includes("onValue("), `${f} reads RTDB through the shared provider, not its own listener`);
        for (const ep of pollers) {
            check(!src.includes(ep), `${f} does not open its own poller for ${ep}`);
        }
    }
}

/* ── summary ─────────────────────────────────────────────────────────────── */

console.log(`\n${"─".repeat(50)}`);
console.log(`terminal tests: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
}
console.log("ALL TERMINAL TESTS PASSED");
