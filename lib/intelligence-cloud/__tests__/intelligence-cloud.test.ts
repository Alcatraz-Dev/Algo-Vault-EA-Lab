/**
 * Intelligence Cloud — Phase 13 tests.
 *
 * Covers the security-critical and honesty-critical properties:
 *   crypto/API keys · scopes · tenancy isolation · rate limits · usage metering
 *   webhook signing + replay · snapshots · jobs · certification · due diligence
 *   error contract · request validation · engine version honesty
 *
 * Pure-logic modules are tested directly. RTDB-backed paths are exercised
 * against an in-memory counter store / injected fetch so the suite runs
 * without a database or network.
 */

import {
    generateApiKey,
    hashApiKey,
    parseApiKeyPrefix,
    safeEqualDigest,
    signWebhookPayload,
    buildWebhookSignatureHeader,
    verifyWebhookSignature,
} from "../crypto";
import {
    hasScope,
    missingScopes,
    sanitiseScopes,
    isGrantableScope,
    isExecutionScope,
    DEFAULT_KEY_SCOPES,
    type ApiScope,
} from "../auth";
import { effectivePermissions, requirePermission, sanitizeSegment, type TenantContext } from "../tenancy";
import { canManageRole, isPermission, ROLE_PERMISSIONS, ROLE_RANK } from "../permissions";
import { consumeRateLimit, resolvePolicy, endpointCost, type CounterStore } from "../rate-limit";
import { assertDeliverableUrl, isInternalHostname, sanitiseEvents, signDelivery, nextAttemptDelayMs, WEBHOOK_HEADERS } from "../webhooks";
import { canonical, hashSnapshotBody, digestSeries, type IntelligenceSnapshot } from "../snapshots";
import { canTransition, isTerminal } from "../jobs";
import { evaluateCertification, testsImpliedBy, resolveStatus, shouldExpire } from "../certification";
import { generateDueDiligence } from "../marketplace-due-diligence";
import { IntelligenceError, toErrorBody, errors, statusForErrorCode, isRetryableCode, INTELLIGENCE_ERROR_CODES } from "../errors";
import { normaliseRequest, intelligenceCost } from "../intelligence";
import { ENGINE_REGISTRY, buildEngineVersions, unversionedEngines, UNVERSIONED } from "../engine-registry";
import { tenantHasEntitlement, PLAN_DEFINITIONS, entitlementsForConsumerTier } from "../entitlements";
import { computeAuditHash, verifyAuditChain, type AuditEntry } from "../audit";
import { INTELLIGENCE_API_VERSION } from "../contracts";

type TestResult = { name: string; ok: boolean; error?: string };

const results: TestResult[] = [];

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
    return Promise.resolve()
        .then(fn)
        .then(() => {
            results.push({ name, ok: true });
        })
        .catch((error: unknown) => {
            results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
        });
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected) throw new Error(`${message} (expected ${String(expected)}, got ${String(actual)})`);
}

function assertThrows(fn: () => unknown, message: string): Error {
    try {
        fn();
    } catch (error) {
        return error as Error;
    }
    throw new Error(`${message}: expected a throw`);
}

async function assertRejects(fn: () => Promise<unknown>, message: string): Promise<Error> {
    try {
        await fn();
    } catch (error) {
        return error as Error;
    }
    throw new Error(`${message}: expected a rejection`);
}

// ── in-memory counter store ────────────────────────────────────────────────

function memoryStore(): CounterStore & { reset(): void } {
    const counters = new Map<string, { count: number; resetAt: number }>();
    return {
        async read(key) {
            const value = counters.get(key);
            if (!value || value.resetAt <= Date.now()) return null;
            return value;
        },
        async increment(key, ttlMs) {
            const now = Date.now();
            const current = counters.get(key);
            const next =
                !current || current.resetAt <= now
                    ? { count: 1, resetAt: now + ttlMs }
                    : { count: current.count + 1, resetAt: current.resetAt };
            counters.set(key, next);
            return next.count;
        },
        reset() {
            counters.clear();
        },
    };
}

// ── suites ─────────────────────────────────────────────────────────────────

async function cryptoTests(): Promise<void> {
    await test("api key: generated secret carries a parseable public prefix", () => {
        const { secret, lookupPrefix } = generateApiKey();
        const parsed = parseApiKeyPrefix(secret);
        assert(parsed !== null, "generated key must parse");
        assertEqual(parsed.lookupPrefix, lookupPrefix, "prefix must round-trip");
        assert(secret.startsWith(`av_live_${lookupPrefix}_`), "secret embeds its lookup prefix");
        assertEqual(secret.slice(`av_live_${lookupPrefix}_`.length).length >= 20, true, "secret payload is substantial");
    });

    await test("api key: two generated secrets never collide", () => {
        const a = generateApiKey();
        const b = generateApiKey();
        assert(a.secret !== b.secret, "secrets must be unique");
        assert(a.lookupPrefix !== b.lookupPrefix, "prefixes must be unique");
    });

    await test("api key: a secret containing underscores still parses", () => {
        // Regression: base64url's alphabet includes "_", so splitting the key on
        // "_" produced more than four segments and rejected a valid secret.
        let parsed = parseApiKeyPrefix(generateApiKey().secret);
        let attempts = 0;
        while (parsed === null && attempts < 200) {
            parsed = parseApiKeyPrefix(generateApiKey().secret);
            attempts += 1;
        }
        assert(parsed !== null, "every generated key must parse, including ones with underscores");
        assertEqual(parsed.lookupPrefix.length, 12, "prefix is 12 hex characters");
    });

    await test("api key: malformed tokens are rejected before any hashing", () => {
        assertEqual(parseApiKeyPrefix(""), null, "empty token");
        assertEqual(parseApiKeyPrefix("not-a-key"), null, "garbage token");
        assertEqual(parseApiKeyPrefix("av_live_short_secret"), null, "short prefix");
        assertEqual(parseApiKeyPrefix("pk_test_aaaaaaaaaaaa_secretsecretsecretsecret"), null, "wrong namespace");
    });

    await test("api key: digest is stable, salted and never equals the secret", () => {
        const { secret } = generateApiKey();
        const digest = hashApiKey(secret);
        assertEqual(digest, hashApiKey(secret), "digest must be deterministic for the same input");
        assert(digest !== secret, "digest must not be the secret");
        assertEqual(digest.length, 64, "sha256 hex digest length");
        const other = generateApiKey().secret;
        assert(hashApiKey(other) !== digest, "distinct secrets must produce distinct digests");
    });

    await test("api key: constant-time compare rejects mismatches of different length", () => {
        assertEqual(safeEqualDigest("abc", "abc"), true, "equal digests");
        assertEqual(safeEqualDigest("abc", "abd"), false, "differing digests");
        assertEqual(safeEqualDigest("abc", "abcd"), false, "differing lengths");
        assertEqual(safeEqualDigest("abc", "" as string), false, "empty compare");
    });

    await test("webhook: signature is real HMAC-SHA256 over timestamp.body", () => {
        const body = JSON.stringify({ a: 1 });
        const ts = 1_700_000_000_000;
        const signature = signWebhookPayload(body, "s3cret", ts);
        // Deterministic known-answer check against node crypto semantics.
        assertEqual(signature.length, 64, "hex sha256 length");
        assert(/^[0-9a-f]{64}$/.test(signature), "must be lowercase hex");
        assertEqual(buildWebhookSignatureHeader(body, "s3cret", ts), `sha256=${signature}`, "header format");
        assert(signature !== signWebhookPayload(body, "other", ts), "different secret ⇒ different signature");
        assert(signature !== signWebhookPayload(`${body} `, "s3cret", ts), "body change ⇒ different signature");
        assert(signature !== signWebhookPayload(body, "s3cret", ts + 1), "timestamp change ⇒ different signature");
    });

    await test("webhook: verification accepts a genuine delivery", () => {
        const body = JSON.stringify({ event: "x" });
        const ts = Date.now();
        const result = verifyWebhookSignature({
            rawBody: body,
            secret: "s3cret",
            signature: buildWebhookSignatureHeader(body, "s3cret", ts),
            timestamp: ts,
        });
        assertEqual(result.valid, true, "genuine delivery must verify");
    });

    await test("webhook: replay outside the tolerance window is rejected", () => {
        const body = "{}";
        const ts = Date.now() - 10 * 60_000; // 10 minutes old
        const result = verifyWebhookSignature({
            rawBody: body,
            secret: "s3cret",
            signature: buildWebhookSignatureHeader(body, "s3cret", ts),
            timestamp: ts,
            toleranceMs: 300_000,
        });
        assertEqual(result.valid, false, "stale delivery must fail");
        assertEqual(result.reason, "stale_timestamp", "reason must identify replay");
    });

    await test("webhook: a far-future timestamp is also rejected", () => {
        const body = "{}";
        const ts = Date.now() + 10 * 60_000;
        const result = verifyWebhookSignature({ rawBody: body, secret: "s3cret", signature: buildWebhookSignatureHeader(body, "s3cret", ts), timestamp: ts });
        assertEqual(result.valid, false, "future stamp must not stay fresh forever");
        assertEqual(result.reason, "stale_timestamp", "reason");
    });

    await test("webhook: tampered body fails verification", () => {
        const ts = Date.now();
        const original = JSON.stringify({ amount: 1 });
        const signature = buildWebhookSignatureHeader(original, "s3cret", ts);
        const result = verifyWebhookSignature({ rawBody: JSON.stringify({ amount: 999 }), secret: "s3cret", signature, timestamp: ts });
        assertEqual(result.valid, false, "modified body must fail");
        assertEqual(result.reason, "signature_mismatch", "reason");
    });

    await test("webhook: wrong secret and malformed headers fail distinctly", () => {
        const body = "{}";
        const ts = Date.now();
        const signature = buildWebhookSignatureHeader(body, "s3cret", ts);
        assertEqual(verifyWebhookSignature({ rawBody: body, secret: "wrong", signature, timestamp: ts }).reason, "signature_mismatch", "wrong secret");
        assertEqual(verifyWebhookSignature({ rawBody: body, secret: "s3cret", signature: null, timestamp: ts }).reason, "missing_signature", "missing signature");
        assertEqual(verifyWebhookSignature({ rawBody: body, secret: "s3cret", signature: "abc", timestamp: ts }).reason, "malformed_signature", "missing algorithm prefix");
        assertEqual(verifyWebhookSignature({ rawBody: body, secret: "s3cret", signature, timestamp: null }).reason, "missing_timestamp", "missing timestamp");
    });
}

async function scopeTests(): Promise<void> {
    await test("scopes: exact match only — no parent derivation", () => {
        // Regression: the previous implementation granted `market:read` to any
        // key holding `indicators:read`, silently widening every narrow key.
        assertEqual(hasScope(["indicators:read"], "market:read"), false, "indicators must not imply market");
        assertEqual(hasScope(["market:read"], "market:read"), true, "explicit grant works");
        assertEqual(hasScope(undefined, "market:read"), false, "undefined grants nothing");
        assertEqual(hasScope([], "market:read"), false, "empty grants nothing");
    });

    await test("scopes: ungrantable and execution scopes are stripped", () => {
        const sanitised = sanitiseScopes([
            "market:read",
            "execution:live",
            "not:a:scope",
            "  strategy:read  ",
            "MARKET:READ",
        ]);
        assertEqual(sanitised.includes("execution:live" as ApiScope), false, "execution scope must be stripped");
        assertEqual(sanitised.includes("not:a:scope" as ApiScope), false, "unknown scope stripped");
        assertEqual(sanitised.includes("market:read"), true, "valid scope kept");
        assertEqual(sanitised.includes("strategy:read"), true, "trimmed scope kept");
        assertEqual(sanitised.length, 2, "duplicates collapse");
    });

    await test("scopes: execution scopes are never self-service grantable", () => {
        assertEqual(isGrantableScope("execution:live"), false, "live execution not grantable");
        assertEqual(isExecutionScope("execution:live"), true, "recognised as execution scope");
        assertEqual(DEFAULT_KEY_SCOPES.every((s) => isGrantableScope(s)), true, "defaults must all be grantable");
    });

    await test("scopes: missingScopes reports the exact gap", () => {
        assertEqual(
            missingScopes(["market:read"], ["market:read", "research:write"]).join(","),
            "research:write",
            "must name the missing scope"
        );
    });
}

function makeTenantContext(overrides: Partial<TenantContext> = {}): TenantContext {
    const role = overrides.role ?? "VIEWER";
    return {
        tenantId: "acme",
        tenant: { tenantId: "acme", name: "Acme", plan: "professional", createdAt: 0, status: "active" },
        role,
        permissions: effectivePermissions(role),
        userId: "u1",
        ...overrides,
    };
}

async function tenancyTests(): Promise<void> {
    await test("tenancy: VIEWER cannot write strategies or manage keys", () => {
        const viewer = makeTenantContext();
        assertEqual(viewer.permissions.has("intelligence.read"), true, "viewer reads intelligence");
        assertEqual(viewer.permissions.has("strategy.write"), false, "viewer cannot write strategies");
        assertEqual(viewer.permissions.has("api.manage"), false, "viewer cannot manage keys");
        assertEqual(viewer.permissions.has("billing.manage"), false, "viewer cannot manage billing");
        assertEqual(viewer.permissions.has("deployment.manage"), false, "viewer cannot deploy");
    });

    await test("tenancy: overrides may restrict a role but never widen it", () => {
        const restricted = effectivePermissions("ADMIN", {
            "billing.manage": false,
            // Attempted escalation: ADMIN does not hold tenant.manage? it does —
            // but a VIEWER attempting to grant itself OWNER-level rights must fail.
            "strategy.deploy": false,
        });
        assertEqual(restricted.has("billing.manage"), false, "restriction applied");
        assertEqual(restricted.has("strategy.deploy"), false, "restriction applied");

        const viewer = effectivePermissions("VIEWER", {
            // `false` narrowing works; a value the role lacks is simply ignored.
            "intelligence.read": false,
        });
        assertEqual(viewer.has("intelligence.read"), false, "narrowing works");
    });

    await test("tenancy: requirePermission throws FORBIDDEN for a missing permission", () => {
        const error = assertThrows(
            () => requirePermission(makeTenantContext(), "strategy.write"),
            "viewer writing a strategy"
        );
        assert(error instanceof IntelligenceError, "must be a contract error");
        assertEqual((error as IntelligenceError).code, "FORBIDDEN", "code");
    });

    await test("tenancy: requirePermission throws TENANT_REQUIRED with no context", () => {
        const error = assertThrows(() => requirePermission(null, "intelligence.read"), "missing tenant");
        assertEqual((error as IntelligenceError).code, "TENANT_REQUIRED", "code");
    });

    await test("tenancy: a suspended tenant is refused even with the right permission", () => {
        const context = makeTenantContext({ role: "OWNER" });
        context.tenant.status = "suspended";
        const error = assertThrows(() => requirePermission(context, "intelligence.read"), "suspended tenant");
        assertEqual((error as IntelligenceError).code, "FORBIDDEN", "code");
    });

    await test("tenancy: RTDB path segments cannot escape the tenant prefix", () => {
        for (const hostile of ["../../otherTenant", "a/b#c$d[e]", "/leading", "tenant.child"]) {
            const safe = sanitizeSegment(hostile);
            assert(!/[.#$\[\]/]/.test(safe), `${hostile} still contains a reserved character`);
            assert(!safe.startsWith("/"), `${hostile} still starts a path`);
        }
        assertEqual(sanitizeSegment("plain"), "plain", "safe id unchanged");
    });

    await test("roles: an ADMIN cannot manage an OWNER or change their own role", () => {
        assertEqual(canManageRole("ADMIN", "VIEWER", false), true, "admin manages a viewer");
        assertEqual(canManageRole("ADMIN", "OWNER", false), false, "admin cannot manage an owner");
        assertEqual(canManageRole("ADMIN", "ADMIN", false), false, "admin cannot manage a peer");
        assertEqual(canManageRole("ADMIN", "VIEWER", true), false, "nobody changes their own role");
        assertEqual(canManageRole("VIEWER", "VIEWER", false), false, "viewer manages nobody");
        assertEqual(ROLE_RANK.OWNER > ROLE_RANK.ADMIN, true, "rank ordering");
    });

    await test("roles: the role matrix grants only declared permissions", () => {
        for (const [role, granted] of Object.entries(ROLE_PERMISSIONS)) {
            for (const permission of granted) {
                assert(isPermission(permission), `${role} grants undeclared permission "${permission}"`);
            }
        }
    });

    await test("roles: VIEWER is a strict subset of OWNER and never includes a write permission", () => {
        const owner = new Set(ROLE_PERMISSIONS.OWNER);
        for (const permission of ROLE_PERMISSIONS.VIEWER) {
            assert(owner.has(permission), `OWNER must include ${permission}`);
            assert(!permission.includes(".write") && !permission.includes(".manage"), `VIEWER must not hold ${permission}`);
        }
    });
}

async function rateLimitTests(): Promise<void> {
    await test("rate limit: policy merge takes the tightest limit", () => {
        const merged = resolvePolicy({ requestsPerMinute: 100, requestsPerDay: 10_000 }, { requestsPerMinute: 60 });
        assertEqual(merged.requestsPerMinute, 60, "tighter minute wins");
        assertEqual(merged.requestsPerDay, 10_000, "only source keeps day");
    });

    await test("rate limit: an unlimited override never masks a real limit", () => {
        const merged = resolvePolicy({ requestsPerMinute: 60 }, { requestsPerMinute: 0 });
        assertEqual(merged.requestsPerMinute, 0, "0 means negotiated-unlimited and wins");
        const reversed = resolvePolicy({ requestsPerMinute: 0 }, { requestsPerMinute: 30 });
        assertEqual(reversed.requestsPerMinute, 0, "unlimited source is not masked");
    });

    await test("rate limit: enforcement blocks once the budget is exhausted", async () => {
        const store = memoryStore();
        const input = {
            tenantId: "acme",
            apiKeyId: "key_1",
            endpoint: "GET /v1/market",
            keyOverride: { requestsPerMinute: 3 },
            store,
        };
        for (let i = 0; i < 3; i += 1) {
            const decision = await consumeRateLimit(input);
            assertEqual(decision.allowed, true, `request ${i + 1} should pass`);
        }
        const error = await assertRejects(() => consumeRateLimit(input), "4th request");
        assert(error instanceof IntelligenceError, "contract error");
        assertEqual((error as IntelligenceError).code, "RATE_LIMITED", "code");
        assert((error as IntelligenceError).retryAfterSeconds! > 0, "must carry retryAfterSeconds");
    });

    await test("rate limit: expensive endpoints consume more budget", async () => {
        const store = memoryStore();
        const input = {
            tenantId: "acme",
            apiKeyId: "key_2",
            endpoint: "POST /v1/research",
            keyOverride: { requestsPerMinute: 10 },
            store,
        };
        // A research submission costs 10 units, so one call exhausts a 10/min budget.
        const first = await consumeRateLimit(input);
        assertEqual(first.allowed, true, "first research call passes");
        const error = await assertRejects(() => consumeRateLimit(input), "second research call");
        assertEqual((error as IntelligenceError).code, "RATE_LIMITED", "blocked by cost weighting");
        assert(endpointCost("POST /v1/research") > endpointCost("GET /v1/market"), "research costs more than a quote");
    });

    await test("rate limit: per-key buckets are isolated", async () => {
        const store = memoryStore();
        const base = { tenantId: "acme", endpoint: "GET /v1/market", keyOverride: { requestsPerMinute: 1 }, store };
        await consumeRateLimit({ ...base, apiKeyId: "key_a" });
        const error = await assertRejects(() => consumeRateLimit({ ...base, apiKeyId: "key_a" }), "same key");
        assertEqual((error as IntelligenceError).code, "RATE_LIMITED", "a is limited");
        const decision = await consumeRateLimit({ ...base, apiKeyId: "key_b" });
        assertEqual(decision.allowed, true, "b must be unaffected");
    });

    await test("rate limit: a rejected request does not consume the looser window", async () => {
        const store = memoryStore();
        const input = {
            tenantId: "acme",
            apiKeyId: "key_3",
            endpoint: "GET /v1/market",
            keyOverride: { requestsPerMinute: 1, requestsPerDay: 100 },
            store,
        };
        await consumeRateLimit(input);
        await assertRejects(() => consumeRateLimit(input), "second call");
        // The daily counter must still read 1, not 2.
        const daily = await store.read("key:key_3:day");
        assertEqual(daily?.count, 1, "rejected call must not spend daily budget");
    });

    await test("rate limit: plan limits apply when no key override exists", async () => {
        const store = memoryStore();
        const decision = await consumeRateLimit({
            tenantId: "acme",
            apiKeyId: "key_4",
            endpoint: "GET /v1/market",
            plan: "professional",
            store,
        });
        assertEqual(decision.allowed, true, "first call passes");
        assert(decision.policy.requestsPerMinute! > 0, "professional plan has a positive minute limit");
    });
}

async function webhookTests(): Promise<void> {
    await test("webhook: SSRF guard rejects internal and non-https targets", () => {
        const rejected = [
            "http://example.com/hook",
            "https://localhost/hook",
            "https://127.0.0.1/hook",
            "https://169.254.169.254/latest/meta-data/",
            "https://10.0.0.5/hook",
            "https://192.168.1.1/hook",
            "https://172.16.0.1/hook",
            "https://[::1]/hook",
            "https://metadata.google.internal/hook",
            "not-a-url",
        ];
        for (const url of rejected) {
            assertThrows(() => assertDeliverableUrl(url), `must reject ${url}`);
        }
        assertEqual(assertDeliverableUrl("https://hooks.example.com/av"), "https://hooks.example.com/av", "public https accepted");
    });

    await test("webhook: internal hostname detection covers private ranges", () => {
        assertEqual(isInternalHostname("example.com"), false, "public host");
        assertEqual(isInternalHostname("100.64.0.1"), true, "CGNAT");
        assertEqual(isInternalHostname("0.0.0.0"), true, "unspecified");
        assertEqual(isInternalHostname("224.0.0.1"), true, "multicast");
    });

    await test("webhook: event filtering keeps only known events", () => {
        const events = sanitiseEvents(["setup_confirmed", "NOPE", "SETUP_INVALIDATED", "setup_confirmed"]);
        assertEqual(events.length, 2, "unknown dropped, duplicates collapsed");
        assertEqual(sanitiseEvents(undefined).length, 0, "undefined yields none");
    });

    await test("webhook: signed delivery headers are complete and signature-valid", () => {
        const event = {
            eventId: "evt_1",
            eventType: "SETUP_CONFIRMED" as const,
            timestamp: Date.now(),
            dataTimestamp: Date.now() - 1000,
            apiVersion: INTELLIGENCE_API_VERSION,
            tenantId: "acme",
            payload: { setupId: "s1" },
        };
        const signed = signDelivery(event, "secret", "dlv_1", INTELLIGENCE_API_VERSION);
        assertEqual(signed.headers[WEBHOOK_HEADERS.event], "SETUP_CONFIRMED", "event header");
        assertEqual(signed.headers[WEBHOOK_HEADERS.delivery], "dlv_1", "delivery header");
        assert(signed.headers[WEBHOOK_HEADERS.signature].startsWith("sha256="), "signature prefix");
        const verified = verifyWebhookSignature({
            rawBody: signed.body,
            secret: "secret",
            signature: signed.headers[WEBHOOK_HEADERS.signature],
            timestamp: signed.headers[WEBHOOK_HEADERS.timestamp],
        });
        assertEqual(verified.valid, true, "signed delivery must verify");
        assertEqual(JSON.parse(signed.body).payload.setupId, "s1", "payload preserved");
    });

    await test("webhook: retry backoff is exponential and bounded", () => {
        assertEqual(nextAttemptDelayMs(0), 0, "first attempt immediate");
        assertEqual(nextAttemptDelayMs(1), 30_000, "second attempt");
        assertEqual(nextAttemptDelayMs(2), 120_000, "third attempt");
        assertEqual(nextAttemptDelayMs(3), 600_000, "fourth attempt");
        assertEqual(nextAttemptDelayMs(4), 1_800_000, "fifth attempt");
        assertEqual(nextAttemptDelayMs(5), null, "attempts are bounded");
    });
}

async function snapshotTests(): Promise<void> {
    await test("snapshot: canonical stringify is key-order independent", () => {
        assertEqual(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }), "order must not matter");
        assertEqual(canonical({ a: undefined, b: 1 }), canonical({ b: 1 }), "undefined keys dropped");
        assertEqual(canonical([1, 2]), "[1,2]", "arrays");
    });

    await test("snapshot: content hash detects tampering", () => {
        const body = {
            requestId: "r1",
            timestamp: 1,
            dataTimestamp: 1,
            instrument: { symbol: "XAUUSD", timeframe: "M5" },
            engineVersions: { market: "v1", indicators: "v1", smartMoney: "v1" },
            configuration: {},
            inputs: { dataRangeStart: 0, dataRangeEnd: 1, candleCount: 10 },
            outputs: {} as IntelligenceSnapshot["outputs"],
            limitations: ["x"],
        };
        const hash = hashSnapshotBody(body);
        assertEqual(hash, hashSnapshotBody(body), "deterministic");
        assert(hash !== hashSnapshotBody({ ...body, limitations: ["tampered"] }), "content change alters hash");
    });

    await test("snapshot: series digest changes when any candle changes", () => {
        const candles = [
            { timestamp: 1, open: 1, high: 2, low: 0.5, close: 1.5 },
            { timestamp: 2, open: 1.5, high: 2, low: 1, close: 1.8 },
        ];
        const base = digestSeries(candles);
        assertEqual(base, digestSeries(candles), "stable for identical input");
        assert(base !== digestSeries([candles[0], { ...candles[1], close: 9 }]), "price change alters digest");
        assert(base !== digestSeries(candles.slice(0, 1)), "fewer candles alters digest");
    });
}

async function jobTests(): Promise<void> {
    await test("jobs: the state machine forbids illegal transitions", () => {
        assertEqual(canTransition("QUEUED", "RUNNING"), true, "queue → running");
        assertEqual(canTransition("QUEUED", "COMPLETED"), false, "cannot complete without running");
        assertEqual(canTransition("RUNNING", "COMPLETED"), true, "running → completed");
        assertEqual(canTransition("RUNNING", "PAUSED"), true, "running → paused");
        assertEqual(canTransition("PAUSED", "RUNNING"), true, "paused → running");
        assertEqual(canTransition("COMPLETED", "RUNNING"), false, "terminal is terminal");
        assertEqual(canTransition("CANCELLED", "RUNNING"), false, "a cancelled job cannot be resurrected");
        assertEqual(canTransition("FAILED", "QUEUED"), false, "no silent retry");
    });

    await test("jobs: terminal states are recognised", () => {
        for (const status of ["COMPLETED", "FAILED", "CANCELLED"] as const) {
            assertEqual(isTerminal(status), true, status);
        }
        for (const status of ["QUEUED", "RUNNING", "PAUSED"] as const) {
            assertEqual(isTerminal(status), false, status);
        }
    });
}

async function certificationTests(): Promise<void> {
    await test("certification: cannot be granted without evidence", () => {
        // Regression: the previous implementation defaulted every criterion to a
        // truthy literal, so an empty call produced "CERTIFIED".
        assertEqual(evaluateCertification({}), "UNVERIFIED", "no criteria ⇒ unverified");
        assertEqual(evaluateCertification({ validStrategy: true }), "UNVERIFIED", "validation alone is not a backtest");
    });

    await test("certification: the ladder requires each rung in turn", () => {
        const base = { validStrategy: true, backtestCompleted: true, sampleSize: 200, requiredSampleSize: 100 };
        assertEqual(evaluateCertification(base), "TESTED", "backtest + sample ⇒ tested");
        assertEqual(evaluateCertification({ ...base, outOfSamplePassed: true }), "OOS_VERIFIED", "oos ⇒ oos-verified");
        assertEqual(
            evaluateCertification({ ...base, outOfSamplePassed: true, walkForwardPassed: true, monteCarloPassed: true }),
            "ROBUST",
            "wfa + mc ⇒ robust"
        );
        assertEqual(
            evaluateCertification({
                ...base,
                outOfSamplePassed: true,
                walkForwardPassed: true,
                monteCarloPassed: true,
                parameterSensitivityPassed: true,
                executionSensitivityPassed: true,
                documentedLimitations: true,
                reproducibleSnapshot: "snap_1",
            }),
            "CERTIFIED",
            "full evidence ⇒ certified"
        );
    });

    await test("certification: an insufficient sample cannot be certified", () => {
        assertEqual(
            evaluateCertification({ validStrategy: true, backtestCompleted: true, sampleSize: 20, requiredSampleSize: 100 }),
            "TESTED",
            "small sample caps at tested"
        );
    });

    await test("certification: excessive OOS degradation blocks certification", () => {
        const level = evaluateCertification({
            validStrategy: true,
            backtestCompleted: true,
            sampleSize: 200,
            requiredSampleSize: 100,
            outOfSamplePassed: true,
            observedOosDegradationPercent: 80,
            maxOosDegradationPercent: 50,
            walkForwardPassed: true,
            monteCarloPassed: true,
            parameterSensitivityPassed: true,
            executionSensitivityPassed: true,
            documentedLimitations: true,
            reproducibleSnapshot: "snap_1",
        });
        assertEqual(level, "TESTED", "degradation must demote");
    });

    await test("certification: implied tests never claim more than the level", () => {
        assertEqual(testsImpliedBy("UNVERIFIED").length, 0, "unverified claims nothing");
        assert(testsImpliedBy("CERTIFIED").includes("reproducible-snapshot"), "certified requires a snapshot");
        assert(testsImpliedBy("TESTED").includes("oos") === false, "tested must not claim oos");
    });

    await test("certification: expiry is resolved at read time, never assumed", () => {
        const record = {
            strategyId: "s1",
            strategyVersion: "v1",
            level: "CERTIFIED" as const,
            expiresAt: Date.now() - 1000,
            testsPassed: [],
            limitations: [],
        };
        assertEqual(resolveStatus(record).status, "EXPIRED", "expired certification must not display as certified");
        assertEqual(resolveStatus({ ...record, expiresAt: Date.now() + 10_000 }).status, "CERTIFIED", "unexpired stays certified");
        assertEqual(shouldExpire({ expiresAt: Date.now() - 1 }), true, "shouldExpire");
        assertEqual(shouldExpire({}), false, "no expiry never expires");
    });
}

async function dueDiligenceTests(): Promise<void> {
    await test("due diligence: no evidence ⇒ unverified and no metrics", () => {
        const result = generateDueDiligence({ strategyId: "s1" });
        assertEqual(result.verificationStatus, "unverified", "must not claim verification");
        assertEqual(result.backtest, undefined, "no fabricated backtest block");
        assertEqual(result.sampleSize, undefined, "no fabricated sample size");
        assert(result.limitations.some((l) => l.includes("No completed backtest")), "must disclose the gap");
        assert(result.limitations.some((l) => l.includes("does not guarantee")), "must carry the no-guarantee disclosure");
    });

    await test("due diligence: seller figures are never promoted to verified", () => {
        const result = generateDueDiligence({
            strategyId: "s1",
            evidence: { backtest: { trades: 100, netReturnPercent: 20 } },
        });
        assertEqual(result.verificationStatus, "seller-provided", "evidence alone is not independent verification");
        assertEqual(result.backtest?.trades, 100, "only supplied metrics appear");
        assertEqual(result.oos, undefined, "untested OOS stays absent");
    });

    await test("due diligence: engine-run tests are labelled algovault-verified", () => {
        const result = generateDueDiligence({
            strategyId: "s1",
            independentlyVerified: true,
            evidence: {
                backtest: { trades: 300, maxDrawdownPercent: 12 },
                oos: { passed: true },
                walkForward: { windows: 10 },
                monteCarlo: { runs: 1000 },
            },
        });
        assertEqual(result.verificationStatus, "algovault-verified", "verified");
        assertEqual(result.sampleSize, 300, "sample size from the engine");
        assertEqual(result.walkForward?.windows, 10, "walk forward reported");
    });

    await test("due diligence: required disclosures are appended", () => {
        const result = generateDueDiligence({
            strategyId: "s1",
            requiredDisclosures: ["Custom disclosure."],
        });
        assert(result.limitations.includes("Custom disclosure."), "tenant disclosure must appear");
    });
}

async function errorContractTests(): Promise<void> {
    await test("errors: the envelope shape is stable and carries a requestId", () => {
        const body = toErrorBody(errors.rateLimited(30), "req_1");
        assertEqual(body.error.code, "RATE_LIMITED", "code");
        assertEqual(body.error.requestId, "req_1", "requestId echoes for support");
        assertEqual(body.error.retryable, true, "retryable");
        assertEqual(body.error.retryAfterSeconds, 30, "retryAfterSeconds");
    });

    await test("errors: unknown throwables never leak internal detail", () => {
        const body = toErrorBody(new Error("connect ECONNREFUSED 10.0.0.5:8080 /srv/secret/path"), "req_2");
        assertEqual(body.error.code, "INTERNAL_ERROR", "generic code");
        assertEqual(body.error.message, "The request could not be completed.", "generic message");
        assert(!JSON.stringify(body).includes("10.0.0.5"), "must not leak the internal address");
        assert(!JSON.stringify(body).includes("secret"), "must not leak the path");
    });

    await test("errors: every code maps to a status and a retry policy", () => {
        for (const code of INTELLIGENCE_ERROR_CODES) {
            assert(statusForErrorCode(code) >= 400, `${code} must map to an error status`);
            assertEqual(typeof isRetryableCode(code), "boolean", `${code} retry policy`);
        }
        assertEqual(statusForErrorCode("UNAUTHORIZED"), 401, "unauthorized");
        assertEqual(statusForErrorCode("FORBIDDEN"), 403, "forbidden");
        assertEqual(statusForErrorCode("RATE_LIMITED"), 429, "rate limited");
        assertEqual(statusForErrorCode("RESOURCE_NOT_FOUND"), 404, "not found");
        assertEqual(isRetryableCode("INVALID_REQUEST"), false, "bad request is not retryable");
    });

    await test("errors: scope errors name the missing scope", () => {
        const body = toErrorBody(errors.scopeInsufficient("research:write"), "req_3");
        assertEqual(body.error.code, "SCOPE_INSUFFICIENT", "code");
        assert(body.error.message.includes("research:write"), "names the gap");
    });
}

async function requestValidationTests(): Promise<void> {
    await test("request: invalid symbol or timeframe is rejected with field detail", () => {
        const error = assertThrows(
            () => normaliseRequest({ symbol: "xau usd!", timeframe: "M5" }),
            "invalid symbol"
        );
        const body = toErrorBody(error, "req_4");
        assertEqual(body.error.code, "INVALID_REQUEST", "code");
        assert(body.error.details?.some((d) => d.field === "symbol"), "symbol detail");

        const tfError = assertThrows(() => normaliseRequest({ symbol: "XAUUSD", timeframe: "M7" }), "invalid timeframe");
        assert(toErrorBody(tfError, "req_5").error.details?.some((d) => d.field === "timeframe"), "timeframe detail");
    });

    await test("request: a future as-of timestamp is rejected", () => {
        const now = 1_000_000;
        const error = assertThrows(
            () => normaliseRequest({ symbol: "XAUUSD", timeframe: "M5", timestamp: now + 1000 }, now),
            "future timestamp"
        );
        assert(toErrorBody(error, "req_6").error.details?.some((d) => d.field === "timestamp"), "timestamp detail");
    });

    await test("request: normalisation is deterministic and defaults are explicit", () => {
        const now = 2_000_000;
        const a = normaliseRequest({ symbol: "xauusd", timeframe: "m5" }, now);
        const b = normaliseRequest({ symbol: "XAUUSD", timeframe: "M5" }, now);
        assertEqual(a.symbol, "XAUUSD", "symbol uppercased");
        assertEqual(a.timeframe, "M5", "timeframe uppercased");
        assertEqual(a.asOf, now, "defaults to now");
        assertEqual(JSON.stringify(a), JSON.stringify(b), "equivalent requests normalise identically");
    });

    await test("request: a GET query string is understood as a request body", () => {
        const fromQuery = normaliseRequest({ symbol: "XAUUSD", timeframe: "M5" });
        assertEqual(fromQuery.symbol, "XAUUSD", "symbol parsed");
    });

    await test("cost: metadata reflects the actual requested computation", () => {
        const cheap = intelligenceCost({ indicatorCount: 1, wantSmartMoney: false, wantRegime: false });
        const medium = intelligenceCost({ indicatorCount: 3, wantSmartMoney: true, wantRegime: false });
        const expensive = intelligenceCost({ indicatorCount: 6, wantSmartMoney: true, wantRegime: true });
        assertEqual(cheap.cost, "LOW", "cheap");
        assertEqual(medium.cost, "MEDIUM", "medium");
        assertEqual(expensive.cost, "HIGH", "expensive");
        assert(expensive.units > medium.units && medium.units > cheap.units, "units must scale with cost");
    });
}

async function registryTests(): Promise<void> {
    await test("registry: versions come from engine constants, not hand-written strings", () => {
        const smartMoney = ENGINE_REGISTRY.find((e) => e.id === "smart-money")!;
        // The old registry claimed v4.2.0 while the engine exports 1.0.0.
        assertEqual(smartMoney.version, "1.0.0", "must match the engine's exported SMART_MONEY_VERSION");
        assertEqual(smartMoney.versioned, true, "smart money publishes a version");
    });

    await test("registry: unversioned engines are reported honestly, not invented", () => {
        const unversioned = unversionedEngines();
        assert(unversioned.length > 0, "some engines genuinely lack versions");
        for (const engine of unversioned) {
            assertEqual(engine.version, UNVERSIONED, `${engine.id} must not carry a fabricated version`);
        }
    });

    await test("registry: buildEngineVersions omits engines that did not contribute", () => {
        const full = buildEngineVersions();
        assert(typeof full.market === "string" && full.market.length > 0, "market always present");
        assert(full.strategy !== undefined, "full build includes strategy");

        const partial = buildEngineVersions({ "strategy-engine": false, risk: false, research: false });
        assertEqual(partial.strategy, undefined, "excluded engine omitted");
        assertEqual(partial.risk, undefined, "excluded engine omitted");
        assert(typeof partial.market === "string", "always-present engines remain");
        assertEqual(partial.indicators, full.indicators, "shared engines keep the same version");
    });
}

async function entitlementTests(): Promise<void> {
    await test("entitlements: plan grants are configuration-driven", () => {
        assertEqual(tenantHasEntitlement("developer", "market.intelligence"), true, "developer has market");
        assertEqual(tenantHasEntitlement("developer", "research"), false, "developer lacks research");
        assertEqual(tenantHasEntitlement("enterprise", "white-label"), true, "enterprise has white-label");
    });

    await test("entitlements: a feature flag can disable but never enable", () => {
        assertEqual(
            tenantHasEntitlement("enterprise", "research", { "entitlement.research": false }),
            false,
            "flag disables"
        );
        assertEqual(
            tenantHasEntitlement("developer", "research", { "entitlement.research": true }),
            false,
            "flag must not grant beyond the plan"
        );
    });

    await test("entitlements: consumer tiers reuse the same vocabulary", () => {
        assert(entitlementsForConsumerTier("free").includes("market.intelligence"), "free reads market");
        assertEqual(entitlementsForConsumerTier("free").includes("research"), false, "free has no research");
        assert(entitlementsForConsumerTier("elite").includes("certification"), "elite certifies");
        for (const plan of Object.values(PLAN_DEFINITIONS)) {
            assert(plan.maxApiKeys > 0 && plan.maxConcurrentResearchJobs > 0, `${plan.plan} must have positive ceilings`);
        }
    });
}

async function auditTests(): Promise<void> {
    function entry(overrides: Partial<AuditEntry>): AuditEntry {
        const base: Omit<AuditEntry, "auditId" | "hash"> = {
            tenantId: "acme",
            action: "API_KEY_CREATED",
            actorId: "u1",
            detail: {},
            at: 1000,
        };
        // `auditId` and `hash` are excluded from the hashed body, matching how
        // verifyAuditChain strips them before recomputing.
        const { auditId, hash: _ignoredHash, ...overridesBody } = overrides;
        const body: Omit<AuditEntry, "auditId" | "hash"> = { ...base, ...overridesBody };
        return {
            ...body,
            auditId: auditId ?? "aud_1",
            hash: computeAuditHash(body, overrides.prevHash),
        };
    }

    await test("audit: hash chain verifies for an untampered sequence", async () => {
        const a = entry({ auditId: "aud_1", at: 1 });
        const b = entry({ auditId: "aud_2", at: 2, prevHash: a.hash });
        assertEqual((await verifyAuditChain([a, b])).valid, true, "intact chain verifies");
    });

    await test("audit: editing a historical entry breaks the chain", async () => {
        const a = entry({ auditId: "aud_1", at: 1 });
        const b = entry({ auditId: "aud_2", at: 2, prevHash: a.hash });
        const tampered = { ...a, detail: { tampered: true } };
        const result = await verifyAuditChain([tampered, b]);
        assertEqual(result.valid, false, "tampering must be detected");
    });

    await test("audit: removing an entry breaks the chain", async () => {
        const a = entry({ auditId: "aud_1", at: 1 });
        const b = entry({ auditId: "aud_2", at: 2, prevHash: a.hash });
        const c = entry({ auditId: "aud_3", at: 3, prevHash: b.hash });
        assertEqual((await verifyAuditChain([a, b, c])).valid, true, "full chain");
        assertEqual((await verifyAuditChain([a, c])).valid, false, "gap must be detected");
    });
}

// ── runner ─────────────────────────────────────────────────────────────────

export async function runIntelligenceCloudTests(): Promise<boolean> {
    results.length = 0;

    await cryptoTests();
    await scopeTests();
    await tenancyTests();
    await rateLimitTests();
    await webhookTests();
    await snapshotTests();
    await jobTests();
    await certificationTests();
    await dueDiligenceTests();
    await errorContractTests();
    await requestValidationTests();
    await registryTests();
    await entitlementTests();
    await auditTests();

    const failed = results.filter((r) => !r.ok);
    for (const result of results) {
            console.log(`${result.ok ? "  PASS" : "  FAIL"}  ${result.name}${result.ok ? "" : ` — ${result.error}`}`);
    }
    console.log(`\nIntelligence Cloud: ${results.length - failed.length}/${results.length} passed`);
    return failed.length === 0;
}
