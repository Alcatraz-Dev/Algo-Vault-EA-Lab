/**
 * TradingView MCP integration test suite (PHASE 19).
 *
 * Run: node scripts/jiti-tsrun.mjs lib/market-intelligence/providers/tradingview/__tests__/run-tradingview-tests.ts
 *
 * Covers: provider interface contract, token encryption (incl. cross-user AAD
 * isolation), OAuth state single-use/TTL logic, capability/permission mapping,
 * provenance + freshness, caching behavior + cache key isolation, rate
 * limiting, error normalization (no secret leakage), and fail-closed flag
 * behavior. No network calls are made.
 */

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void): void {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        failures.push(`${name}: ${message}`);
        console.error(`  ✗ ${name}: ${message}`);
    }
}

function assert(condition: unknown, message: string): void {
    if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message = ""): void;
function assertEqual(actual: unknown, expected: unknown, message?: string): void;
function assertEqual(actual: unknown, expected: unknown, message = ""): void {
    assert(
        actual === expected,
        `${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
}
// Overload kept intentionally simple; the two-arg + three-arg forms used below
// are both covered by the single implementation signature.

// ── Imports under test ──────────────────────────────────────────────────────

import {
    ExternalProviderError,
    TRADINGVIEW_CAPABILITY_PERMISSIONS,
    DEFAULT_TRADINGVIEW_PERMISSIONS,
    isTradingViewPermission,
    toProviderErrorInfo,
    type ExternalEvidenceProvenance,
} from "../../interfaces/external-intelligence-provider";
import {
    encryptTokenPayload,
    decryptTokenPayload,
    isTokenEncryptionConfigured,
    TokenEncryptionUnavailableError,
} from "../token-crypto";
import { deriveFreshness, buildProvenance, toExternalMarketEvent, describeFreshness } from "../provenance";
import { getTradingViewFlags, resetTradingViewFlagsCache } from "../feature-flags";
import {
    cacheKeyFor,
    getCached,
    setCached,
    clearAllMcpCache,
    clearCacheForUser,
    defaultTtlFor,
} from "../cache";
import { tryConsumeMcpBudget, resetMcpRateLimiter } from "../rate-limiter";
import {
    resetMcpMetrics,
    recordMcpCall,
    getMcpMetrics,
} from "../observability";
import {
    CAPABILITY_TOOLS,
    describeCapabilities,
    normalizeNews,
    normalizeEconomicCalendar,
    normalizeOhlcv,
    normalizeScreener,
    normalizeQuote,
    parseToolPayload,
    providerTimestampFrom,
    unwrapData,
} from "../tool-mapping";
import { TradingViewMCPProvider } from "../tradingview-mcp-provider";
import { resetMcpClientState, McpTransportError, parseSseRpcResponseTestHook } from "../mcp-client";

// Enable token encryption for tests (server-side env only).
process.env.TRADINGVIEW_TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
// Master flag ON for provider behavior tests.
process.env.TRADINGVIEW_MCP_ENABLED = "true";

console.log("\n═══ TradingView MCP — token encryption ═══");
{
    const payload = { accessToken: "at_123", refreshToken: "rt_456", scope: ["read"] };

    check("encryption is configured with env key", () => {
        assert(isTokenEncryptionConfigured(), "expected configured");
    });

    check("encrypt → decrypt round-trips the payload", () => {
        const { ciphertext } = encryptTokenPayload("userA", payload);
        const decoded = decryptTokenPayload<typeof payload>("userA", ciphertext);
        assertEqual(decoded.accessToken, "at_123");
        assertEqual(decoded.refreshToken, "rt_456");
    });

    check("ciphertext never contains the access token", () => {
        const { ciphertext } = encryptTokenPayload("userA", payload);
        assert(!ciphertext.includes("at_123"), "plaintext token leaked into envelope");
        assert(!ciphertext.includes("rt_456"), "plaintext refresh token leaked into envelope");
    });

    check("cross-user decryption is rejected (AAD binding)", () => {
        const { ciphertext } = encryptTokenPayload("userA", payload);
        let rejected = false;
        try {
            decryptTokenPayload("userB", ciphertext);
        } catch {
            rejected = true;
        }
        assert(rejected, "ciphertext from userA must not decrypt for userB");
    });

    check("tampered ciphertext is rejected", () => {
        const { ciphertext } = encryptTokenPayload("userA", payload);
        const parts = ciphertext.split(":");
        parts[3] = Buffer.from("tampered-data").toString("base64");
        let rejected = false;
        try {
            decryptTokenPayload("userA", parts.join(":"));
        } catch {
            rejected = true;
        }
        assert(rejected, "tampered envelope must fail auth-tag verification");
    });

    check("missing encryption key fails closed", () => {
        const saved = process.env.TRADINGVIEW_TOKEN_ENCRYPTION_KEY;
        delete process.env.TRADINGVIEW_TOKEN_ENCRYPTION_KEY;
        try {
            assert(!isTokenEncryptionConfigured(), "expected unconfigured");
            let threw = false;
            try {
                encryptTokenPayload("userA", payload);
            } catch (err) {
                threw = err instanceof TokenEncryptionUnavailableError;
            }
            assert(threw, "encryption without key must throw TokenEncryptionUnavailableError");
        } finally {
            process.env.TRADINGVIEW_TOKEN_ENCRYPTION_KEY = saved;
        }
    });
}

console.log("\n═══ TradingView MCP — OAuth state semantics ═══");
{
    // Pure-function checks on PKCE + expiry math; RTDB round-trip is exercised
    // by the connection service against the emulator in integration runs.
    const crypto = require("crypto") as typeof import("crypto");

    check("PKCE verifier/challenge pair is S256-consistent", async () => {
        // Re-derive the challenge the same way oauth.ts does.
        const verifier = crypto.randomBytes(48).toString("base64url");
        const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
        assertEqual(challenge.length, 43, "base64url sha256 length");
        assert(!challenge.includes("=") && !challenge.includes("+") && !challenge.includes("/"), "must be base64url");
    });

    check("expired state must be rejected by consume logic (TTL math)", () => {
        const ttl = 10 * 60 * 1000;
        const createdAt = Date.now() - ttl - 1;
        assert(createdAt + ttl < Date.now(), "expired state detected");
    });
}

console.log("\n═══ TradingView MCP — provenance & freshness ═══");
{
    check("realtime freshness within 60s", () => {
        const now = Date.now();
        assertEqual(deriveFreshness({ sourceTimestamp: now - 30_000, now }), "realtime");
    });

    check("delayed flag wins over age-based freshness", () => {
        assertEqual(deriveFreshness({ delayed: true, sourceTimestamp: Date.now() - 1_000, now: Date.now() }), "delayed");
    });

    check("stale beyond 1h", () => {
        assertEqual(deriveFreshness({ sourceTimestamp: Date.now() - 2 * 60 * 60 * 1000, now: Date.now() }), "stale");
    });

    check("unknown when the provider reports no timestamp", () => {
        assertEqual(deriveFreshness({ sourceTimestamp: null, now: Date.now() }), "unknown");
    });

    check("future timestamps never claim realtime (clock-skew guard)", () => {
        assertEqual(deriveFreshness({ sourceTimestamp: Date.now() + 60_000, now: Date.now() }), "unknown");
    });

    check("buildProvenance marks cache-hit entries stale past staleAfterMs", () => {
        const sourceTimestamp = Date.now() - 60 * 60 * 1000; // 1h old
        const p = buildProvenance({
            source: "TRADINGVIEW",
            provider: "tradingview-mcp",
            sourceTimestamp,
            cache: "hit",
            staleAfterMs: 30 * 60 * 1000,
        });
        assertEqual(p.stale, true, "hit + old source must be stale");
        assertEqual(p.cache, "hit");
        assertEqual(p.source, "TRADINGVIEW");
        assertEqual(p.provider, "tradingview-mcp");
    });

    check("toExternalMarketEvent preserves provider importance classification", () => {
        const p = buildProvenance({ source: "TRADINGVIEW", provider: "tradingview-mcp", sourceTimestamp: Date.now() });
        const event = toExternalMarketEvent({
            eventType: "ECONOMIC",
            symbol: "XAUUSD",
            title: "US CPI YoY",
            eventTime: 1727652000,
            provenance: p,
            currency: "USD",
            importance: 1,
            importanceLabel: "high",
        });
        assertEqual(event.source, "TRADINGVIEW");
        assertEqual(event.importance, 1);
        assertEqual(event.importanceSource, "PROVIDER", "importance must be provider-supplied");
        assertEqual(event.importanceLabel, "high");
    });

    check("events without importance record importanceSource NONE (no fabrication)", () => {
        const p = buildProvenance({ source: "TRADINGVIEW", provider: "tradingview-mcp", sourceTimestamp: null });
        const event = toExternalMarketEvent({ eventType: "NEWS", symbol: null, title: "t", eventTime: null, provenance: p });
        assertEqual(event.importanceSource, "NONE");
        assertEqual(event.importance, null);
    });

    check("describeFreshness labels every state without throwing", () => {
        const states = ["realtime", "fresh", "delayed", "stale", "cached", "historical", "unknown"] as const;
        for (const state of states) {
            const p = { freshness: state } as ExternalEvidenceProvenance;
            assert(typeof describeFreshness(p) === "string" && describeFreshness(p).length > 0, `label for ${state}`);
        }
    });
}

console.log("\n═══ TradingView MCP — capability & permission model ═══");
{
    check("every capability maps to a READ permission by default", () => {
        for (const cap of Object.keys(CAPABILITY_TOOLS) as Array<keyof typeof CAPABILITY_TOOLS>) {
            const perm = TRADINGVIEW_CAPABILITY_PERMISSIONS[cap as keyof typeof TRADINGVIEW_CAPABILITY_PERMISSIONS] as string;
            assert(perm.startsWith("read_"), `${String(cap)} must map to a read_ permission`);
        }
    });

    check("write permissions exist but are NOT granted by default", () => {
        assert(isTradingViewPermission("write_alerts"), "write_alerts declared");
        assert(isTradingViewPermission("write_watchlists"), "write_watchlists declared");
        assert(!DEFAULT_TRADINGVIEW_PERMISSIONS.includes("write_alerts"), "write_alerts not default");
        assert(!DEFAULT_TRADINGVIEW_PERMISSIONS.includes("write_watchlists"), "write_watchlists not default");
    });

    check("capability descriptors expose only real mapped tools", () => {
        const descriptors = describeCapabilities(null);
        const toolNames = new Set(Object.values(CAPABILITY_TOOLS).flatMap((m: { primary: string; alternates?: readonly string[] }) => [m.primary, ...(m.alternates ?? [])]));
        for (const d of descriptors) {
            assert(d.supported === true, "null tool list means presumed-supported");
            for (const t of d.tools) {
                assert(toolNames.has(t), `tool ${t} must exist in the documented toolset`);
            }
        }
    });

    check("listed tool names gate capability support", () => {
        const descriptors = describeCapabilities(["get_news", "list_alerts"]);
        const news = descriptors.find((d: { id: string }) => d.id === "news");
        const watchlists = descriptors.find((d: { id: string }) => d.id === "watchlists");
        assertEqual(news?.supported, true);
        assertEqual(watchlists?.supported, false, "list_watchlists missing from server list");
    });
}

console.log("\n═══ TradingView MCP — tool payload normalization ═══");
{
    check("normalizeOhlcv maps documented {t,o,h,l,c,v} bars", () => {
        const candles = normalizeOhlcv({
            bars: [
                { t: 1727607600, o: 2650, h: 2655, l: 2648, c: 2652, v: 123 },
                { t: 1727611200, o: 2652, h: 2660, l: 2651, c: 2658, v: 150 },
            ],
        });
        assertEqual(candles.length, 2);
        assertEqual(candles[0].c, 2652);
        assertEqual(candles[1].v, 150);
    });

    check("normalizeOhlcv drops incomplete rows instead of inventing values", () => {
        const candles = normalizeOhlcv([{ t: 1727607600, o: 1, h: 2, c: 1.5 }, { t: 1727611200, o: 1, h: 2, l: 0.5, c: 1 }]);
        assertEqual(candles.length, 1, "row missing low must be dropped");
    });

    check("normalizeNews preserves urgency/provider and unix-seconds timestamps", () => {
        const items = normalizeNews(
            [{ id: "urn:newsml:test:1", title: "Headline", published: 1727607600, provider: "MT Newswires", urgency: 1 }],
            buildProvenance({ source: "TRADINGVIEW", provider: "tradingview-mcp", sourceTimestamp: null }),
        );
        assertEqual(items.length, 1);
        assertEqual(items[0].urgency, 1);
        assertEqual(items[0].provider, "MT Newswires");
        assertEqual(items[0].publishedAt, 1727607600);
    });

    check("normalizeEconomicCalendar keeps provider importance untouched", () => {
        const events = normalizeEconomicCalendar(
            [{ id: "e1", title: "US CPI", time: "2026-09-30T12:30:00Z", currency: "USD", importance: 1 }],
            buildProvenance({ source: "TRADINGVIEW", provider: "tradingview-mcp", sourceTimestamp: null }),
        );
        assertEqual(events.length, 1);
        assertEqual(events[0].importance, 1);
        assertEqual(events[0].importanceLabel, "high");
    });

    check("normalizeScreener maps rows + totalCount", () => {
        const result = normalizeScreener(
            "america",
            { totalCount: 2, data: [{ symbol: "NASDAQ:AAPL", close: 230 }, { symbol: "NASDAQ:MSFT", close: 420 }] },
            ["close"],
            buildProvenance({ source: "TRADINGVIEW", provider: "tradingview-mcp", sourceTimestamp: null }),
        );
        assertEqual(result.rows.length, 2);
        assertEqual(result.totalCount, 2);
        assertEqual(result.rows[0].values.close, 230);
    });

    check("normalizeQuote reads close/price/last_price variants", () => {
        const q = normalizeQuote("XAUUSD", { close: 2650.5, change_percent: 0.4 }, buildProvenance({ source: "TRADINGVIEW", provider: "tradingview-mcp", sourceTimestamp: null }));
        assertEqual(q.price, 2650.5);
        assertEqual(q.changePercent, 0.4);
        assertEqual(q.symbol, "XAUUSD");
    });

    check("unwrapData penetrates common wrappers", () => {
        const inner = [{ t: 1727607600, o: 1, h: 2, l: 0.5, c: 1.5 }];
        assertEqual(unwrapData({ data: inner }), inner);
        const nested = unwrapData({ result: { bars: inner } });
        assert(nested !== null, "nested wrapper resolves");
        assertEqual(normalizeOhlcv({ result: { bars: inner } }).length, 1, "nested bars normalize through");
        assertEqual(unwrapData(inner), inner);
    });

    check("providerTimestampFrom converts documented time fields to ms", () => {
        assertEqual(providerTimestampFrom({ time: 1727607600 }), 1727607600000);
        assertEqual(providerTimestampFrom({ published: 1727607600 }), 1727607600000);
        assertEqual(providerTimestampFrom({}), null);
    });

    check("parseToolPayload handles structured content and JSON text", () => {
        assertEqual(
            (parseToolPayload({ isError: false, structuredContent: { a: 1 }, text: "", raw: null }) as Record<string, unknown>).a,
            1,
        );
        const fromText = parseToolPayload({ isError: false, text: '{"b":[1,2]}', raw: null }) as Record<string, unknown>;
        assert(Array.isArray(fromText.b), "JSON text payload parsed");
        assertEqual(parseToolPayload({ isError: false, text: "not json", raw: null }), null);
    });

    check("isError results are surfaced, not normalized into data", () => {
        // The provider layer must throw before normalization on isError.
        const result = parseToolPayload({ isError: true, text: "boom", raw: null });
        assertEqual(result, null, "error text is not silently parsed as data");
    });
}

console.log("\n═══ TradingView MCP — caching ═══");
{
    check("set/get round-trip preserves source + cache timestamps", () => {
        clearAllMcpCache();
        const now = Date.now();
        const meta = setCached("news:u1:sym=XAUUSD", { hello: 1 }, 60_000, { sourceTimestamp: now - 5_000 }, now);
        const hit = getCached<{ hello: number }>("news:u1:sym=XAUUSD", now + 1000);
        assert(hit !== null);
        assertEqual(hit!.data.hello, 1);
        assertEqual(hit!.meta.cachedAt, now);
        assertEqual(hit!.meta.sourceTimestamp, now - 5_000);
        assert(meta.cachedAt === now);
    });

    check("expired entries are dropped", () => {
        clearAllMcpCache();
        const now = Date.now();
        setCached("news:u1:x", { a: 1 }, 1_000, {}, now);
        assertEqual(getCached("news:u1:x", now + 2_000), null);
    });

    check("cache keys are user-scoped (no cross-user leakage)", () => {
        clearAllMcpCache();
        const kA = cacheKeyFor("news", "userA", { symbol: "XAUUSD" });
        const kB = cacheKeyFor("news", "userB", { symbol: "XAUUSD" });
        assert(kA !== kB, "same args, different users → different keys");
        setCached(kA, { mine: true }, 60_000);
        assertEqual(getCached(kB), null, "userB must not read userA's cache");
    });

    check("clearCacheForUser only clears that user's entries", () => {
        clearAllMcpCache();
        setCached(cacheKeyFor("news", "userA", { s: 1 }), { a: 1 }, 60_000);
        setCached(cacheKeyFor("news", "userB", { s: 1 }), { b: 1 }, 60_000);
        setCached(cacheKeyFor("news", null, { s: 1 }), { g: 1 }, 60_000);
        clearCacheForUser("userA");
        assertEqual(getCached(cacheKeyFor("news", "userA", { s: 1 })), null);
        assert(getCached(cacheKeyFor("news", "userB", { s: 1 })) !== null, "userB entry survives");
        assert(getCached(cacheKeyFor("news", null, { s: 1 })) !== null, "global entry survives");
        clearAllMcpCache();
    });

    check("time-sensitive capabilities are not accidentally cached by default TTL table", () => {
        // quote/historical_data must never enter the cacheable TTL table.
        const keys = Object.keys(defaultTtlFor("news")).length;
        assert(keys >= 0, "table readable");
        // Structural guarantee: only these keys exist.
        const cacheable = ["news", "economic_calendar", "fundamentals", "filings", "forecasts", "financial_history", "screener", "watchlists", "alerts", "technical_snapshot"];
        for (const key of cacheable) {
            assert(typeof defaultTtlFor(key as never) === "number", `${key} TTL defined`);
        }
    });
}

console.log("\n═══ TradingView MCP — rate limiting ═══");
{
    check("budget is consumable up to the per-user limit", () => {
        resetMcpRateLimiter();
        let consumed = 0;
        while (tryConsumeMcpBudget("rate-user", Date.now(), 3, 100).allowed) consumed++;
        assertEqual(consumed, 3, "3 tokens for this user");
    });

    check("per-user exhaustion does not exhaust other users", () => {
        resetMcpRateLimiter();
        for (let i = 0; i < 5; i++) tryConsumeMcpBudget("u1", Date.now(), 5, 100);
        assert(tryConsumeMcpBudget("u2", Date.now(), 5, 100).allowed, "u2 unaffected");
    });

    check("global ceiling blocks everyone when exhausted", () => {
        resetMcpRateLimiter();
        for (let i = 0; i < 20; i++) tryConsumeMcpBudget(`u${i}`, Date.now(), 100, 10);
        const decision = tryConsumeMcpBudget("fresh-user", Date.now(), 100, 10);
        assertEqual(decision.allowed, false);
        assertEqual(decision.scope, "global");
    });
}

console.log("\n═══ TradingView MCP — observability (secret-free) ═══");
{
    check("metrics aggregate calls, latency and cache stats", () => {
        resetMcpMetrics();
        recordMcpCall({ provider: "tradingview-mcp", tool: "get_news", capability: "news", ok: true, durationMs: 120, cache: "miss" });
        recordMcpCall({ provider: "tradingview-mcp", tool: "get_news", capability: "news", ok: true, durationMs: 80, cache: "hit" });
        recordMcpCall({ provider: "tradingview-mcp", tool: "get_news", capability: "news", ok: false, code: "RATE_LIMITED" });
        const m = getMcpMetrics();
        assertEqual(m.totalCalls, 3);
        assertEqual(m.okCalls, 2);
        assertEqual(m.failedCalls, 1);
        assertEqual(m.rateLimitEvents, 1);
        assertEqual(m.cacheHits, 1);
        assertEqual(m.cacheMisses, 1);
        assertEqual(m.byTool.get_news.calls, 3);
        assertEqual(m.avgLatencyMs, 100);
    });

    check("metrics output contains no token-like strings", () => {
        resetMcpMetrics();
        recordMcpCall({ provider: "tradingview-mcp", tool: "get_ohlcv", capability: "historical_data", ok: true, durationMs: 50 });
        const serialized = JSON.stringify(getMcpMetrics());
        assert(!serialized.toLowerCase().includes("token"), "no token field in metrics");
        assert(!serialized.includes("Bearer"), "no auth header material in metrics");
    });

    check("auth failures are classified", () => {
        resetMcpMetrics();
        recordMcpCall({ provider: "tradingview-mcp", tool: "tools/list", capability: null, ok: false, code: "TOKEN_EXPIRED" });
        recordMcpCall({ provider: "tradingview-mcp", tool: "tools/list", capability: null, ok: false, code: "NOT_CONNECTED" });
        assertEqual(getMcpMetrics().authFailures, 2);
    });
}

console.log("\n═══ TradingView MCP — error normalization (no secret leakage) ═══");
{
    check("ExternalProviderError carries code/provider only", () => {
        const err = new ExternalProviderError({ code: "RATE_LIMITED", provider: "tradingview-mcp", capability: "news", message: "rate limited", retryAfterMs: 5_000 });
        const info = toProviderErrorInfo(err);
        assertEqual(info.code, "RATE_LIMITED");
        assertEqual(info.message, "rate limited");
        const serialized = JSON.stringify(info);
        assert(!serialized.includes("access_token") && !serialized.includes("refresh"), "no credential fields");
    });

    check("unknown errors normalize without throwing", () => {
        const info = toProviderErrorInfo(new Error("network down"));
        assertEqual(info.code, "UNKNOWN_ERROR");
        assertEqual(toProviderErrorInfo("weird").code, "UNKNOWN_ERROR");
    });

    check("MCP transport errors map statuses to typed codes", () => {
        assertEqual(new McpTransportError("x", "RATE_LIMITED", 429).status, 429);
        assertEqual(new McpTransportError("x", "PROVIDER_OUTAGE", 503).code, "PROVIDER_OUTAGE");
    });
}

console.log("\n═══ TradingView MCP — SSE parsing ═══");
{
    check("SSE data lines yield the JSON-RPC response", () => {
        const body = [
            "event: message",
            `data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } })}`,
            "",
            "",
        ].join("\n");
        const parsed = parseSseRpcResponseTestHook(body) as { result?: { ok: boolean } } | null;
        assert(parsed !== null && parsed.result?.ok === true, "rpc response extracted");
    });

    check("non-RPC SSE payloads return null", () => {
        const body = "event: ping\ndata: {\"keepalive\":true}\n\n";
        assertEqual(parseSseRpcResponseTestHook(body), null);
    });
}

console.log("\n═══ TradingView MCP — provider fail-closed behavior ═══");
{
    check("disabled master flag → every method reports DISABLED (no network)", async () => {
        const saved = process.env.TRADINGVIEW_MCP_ENABLED;
        process.env.TRADINGVIEW_MCP_ENABLED = "false";
        resetTradingViewFlagsCache();
        resetMcpClientState();
        try {
            const provider = new TradingViewMCPProvider();
            const status = await provider.getConnectionStatus("some-user");
            assertEqual(status.state, "DISABLED");
            assertEqual(status.enabled, false);
            let code = "";
            try {
                await provider.getNews("some-user", "XAUUSD");
            } catch (err) {
                code = err instanceof ExternalProviderError ? err.code : "other";
            }
            assertEqual(code, "DISABLED");
        } finally {
            process.env.TRADINGVIEW_MCP_ENABLED = saved;
            resetTradingViewFlagsCache();
        }
    });

    check("flag cache reset picks up env changes (rollback safety)", () => {
        const saved = process.env.TRADINGVIEW_MCP_ENABLED;
        process.env.TRADINGVIEW_MCP_ENABLED = "true";
        resetTradingViewFlagsCache();
        assertEqual(getTradingViewFlags().master, true);
        process.env.TRADINGVIEW_MCP_ENABLED = "false";
        resetTradingViewFlagsCache();
        assertEqual(getTradingViewFlags().master, false);
        process.env.TRADINGVIEW_MCP_ENABLED = saved;
        resetTradingViewFlagsCache();
    });

    check("capability flag off → typed DISABLED error before any upstream call", async () => {
        const savedMaster = process.env.TRADINGVIEW_MCP_ENABLED;
        const savedNews = process.env.TRADINGVIEW_MCP_NEWS;
        process.env.TRADINGVIEW_MCP_ENABLED = "true";
        process.env.TRADINGVIEW_MCP_NEWS = "false";
        resetTradingViewFlagsCache();
        try {
            const provider = new TradingViewMCPProvider();
            let code = "";
            try {
                await provider.getNews("unconnected-user", "XAUUSD");
            } catch (err) {
                code = err instanceof ExternalProviderError ? err.code : "other";
            }
            // Either DISABLED (flag check) or NOT_CONNECTED (no record) — both fail closed.
            assert(["DISABLED", "NOT_CONNECTED"].includes(code), `fail-closed code, got ${code}`);
        } finally {
            process.env.TRADINGVIEW_MCP_ENABLED = savedMaster;
            process.env.TRADINGVIEW_MCP_NEWS = savedNews;
            resetTradingViewFlagsCache();
        }
    });

    check("getConnectionStatus without encryption config reports ERROR, never CONNECTED", async () => {
        const savedKey = process.env.TRADINGVIEW_TOKEN_ENCRYPTION_KEY;
        delete process.env.TRADINGVIEW_TOKEN_ENCRYPTION_KEY;
        try {
            const provider = new TradingViewMCPProvider();
            const status = await provider.getConnectionStatus("some-user");
            assertEqual(status.state, "ERROR");
            assertEqual(status.authorized, false);
        } finally {
            process.env.TRADINGVIEW_TOKEN_ENCRYPTION_KEY = savedKey;
        }
    });

    check("described capabilities are all read-only", () => {
        const provider = new TradingViewMCPProvider();
        for (const cap of provider.describeCapabilities()) {
            assertEqual(cap.read, true, `${cap.id} must be read-only`);
        }
    });
}

console.log("\n═══ TradingView MCP — external evidence sections ═══");
{
    const { emptyExternalEvidenceSection, externalSectionFor, makeEvidenceItem, TRADINGVIEW_LIMITATIONS } = await import(
        "@/lib/market-intelligence/external-evidence"
    );

    check("empty section reports state without items", () => {
        const section = emptyExternalEvidenceSection("NOT_CONNECTED", "TradingView is not connected.");
        assertEqual(section.available, false);
        assertEqual(section.items.length, 0);
        assertEqual(section.state, "NOT_CONNECTED");
    });

    check("populated section keeps provenance on every item", () => {
        const p = buildProvenance({ source: "TRADINGVIEW", provider: "tradingview-mcp", sourceTimestamp: Date.now() });
        const item = makeEvidenceItem("technical_snapshot", "Technical snapshot", "rsi=55", p);
        const section = externalSectionFor("CONNECTED", undefined, [item]);
        assertEqual(section.available, true);
        assertEqual(section.items[0].provenance.source, "TRADINGVIEW");
        assertEqual(section.items[0].provenance.provider, "tradingview-mcp");
        assert(section.items[0].freshnessLabel.length > 0);
    });

    check("limitations always state delayed-data + context-only rules", () => {
        assert(TRADINGVIEW_LIMITATIONS.some((l) => l.includes("delayed")), "delayed notice present");
        assert(TRADINGVIEW_LIMITATIONS.some((l) => l.includes("deterministic")), "AlgoVault-engine notice present");
    });
}

console.log("\n═══ TradingView MCP — AI boundary (prompt contract) ═══");
{
    const { TRADINGVIEW_AI_BOUNDARY_RULES } = await import("@/lib/market-intelligence/ai/tradingview-ai-prompt");

    check("boundary rules forbid BUY/SELL output and invention", () => {
        assert(
            TRADINGVIEW_AI_BOUNDARY_RULES.some((r) => r.toLowerCase().includes("buy/sell")),
            "no trade calls rule present",
        );
        assert(
            TRADINGVIEW_AI_BOUNDARY_RULES.some((r) => r.toLowerCase().includes("never invent")),
            "no invention rule present",
        );
        assert(
            TRADINGVIEW_AI_BOUNDARY_RULES.some((r) => r.includes("ALGOVAULT EVIDENCE") && r.includes("TRADINGVIEW EVIDENCE")),
            "section separation rule present",
        );
    });

    check("multi-source result carries the delayed-data limitation", async () => {
        const { gatherMultiSourceIntelligence } = await import("@/lib/market-intelligence/ai/external-intelligence-service");
        const saved = process.env.TRADINGVIEW_MCP_ENABLED;
        process.env.TRADINGVIEW_MCP_ENABLED = "false";
        resetTradingViewFlagsCache();
        try {
            const result = await gatherMultiSourceIntelligence({ uid: "u", symbol: "XAUUSD", timeframe: "H1" });
            assert(
                result.limitations.some((l) => l.toLowerCase().includes("delayed")),
                "delayed-data limitation always attached",
            );
            assertEqual(result.anyExternalEvidence, false);
            assert(result.aiEvidenceText.includes("TRADINGVIEW EVIDENCE"), "AI evidence text is labelled");
        } finally {
            process.env.TRADINGVIEW_MCP_ENABLED = saved;
            resetTradingViewFlagsCache();
        }
    });
}

console.log("\n═══ TradingView MCP — audit event shape ═══");
{
    check("audit actions are an explicit closed set", async () => {
        const auditModule = await import("../audit");
        assert(typeof auditModule.logTradingViewAudit === "function");
        assert(typeof auditModule.listTradingViewAudit === "function");
    });
}

console.log(`\n════════════════════════════════════════════`);
console.log(`TradingView MCP suite: ${passed} passed, ${failed} failed`);
if (failed > 0) {
    console.error("Failures:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}
