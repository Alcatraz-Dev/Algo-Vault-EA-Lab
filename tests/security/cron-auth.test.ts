/**
 * CRON AUTH REGRESSION SUITE.
 *
 * Guards the cron-authentication hardening:
 *   1. next.config.ts never publishes CRON_SECRET as a response header.
 *   2. The shared helper (lib/security/cron-auth.ts) trusts only a presented,
 *      matching secret: never a User-Agent, never a query-string secret, and
 *      never an unset or blank configured secret.
 *   3. The seven scheduled-job routes reject unauthenticated, forged, and
 *      User-Agent-spoofed requests before doing any work.
 *   4. /api/growth/cron/[job] fails closed with 503 when CRON_SECRET is unset
 *      (reached with a genuinely authenticated admin), and rejects forged or
 *      non-admin callers.
 *
 * Authorized happy paths for the seven routes are NOT exercised here: they
 * trigger live price fetches and scheduled work. The authorization decision
 * itself is covered by the helper tests in section 2.
 *
 * Runs under the firebase-admin stub (see scripts/jiti-tsrun.mjs), so no real
 * credentials or network are involved.
 */

import { NextRequest } from "next/server";
import { createSuite } from "@/lib/performance-arena/__tests__/harness";
import nextConfig from "../../next.config";
import {
    cronSecretsMatch,
    getConfiguredCronSecret,
    isCronRequest,
    presentedCronSecrets,
} from "@/lib/security/cron-auth";
import { POST as jobPost } from "@/app/api/growth/cron/[job]/route";
import { POST as marketingAgentPost } from "@/app/api/growth/cron/marketing-agent/route";
import { POST as tradeManagementPost } from "@/app/api/trade-management/monitor/route";
import { GET as proSignalsGet, POST as proSignalsPost } from "@/app/api/pro-signals/auto-update/route";
import { GET as signalsGet, POST as signalsPost } from "@/app/api/signals/auto-update/route";
import { GET as schedulerGet, POST as schedulerPost } from "@/app/api/workflows/scheduler/tick/route";
import { GET as pluginTickGet } from "@/app/api/plugins/runtime/tick/route";
import { GET as botStudioGet, POST as botStudioPost } from "@/app/api/bot-studio/cron/tick/route";
import { GET as alertsGet } from "@/app/api/alerts/check/route";
import { GET as aiSignalsMonitorGet } from "@/app/api/ai-signals/monitor/route";
import { rtDbStore } from "./firebase-admin-stub";

const s = createSuite("cron-auth");

const SECRET = "cron-regression-secret-value-0123456789";
const PLUGIN_SECRET = "plugin-regression-secret-value-9876543210";
const VERCEL_UA = "vercel-cron/1.0";
const ADMIN_UID = "cron-test-admin";
const CUSTOMER_UID = "cron-test-customer";

type Env = Record<string, string | undefined>;

/** Runs fn with the given env vars set (undefined deletes), then restores them. */
async function withEnv<T>(overrides: Env, fn: () => Promise<T>): Promise<T> {
    const keys = Object.keys(overrides);
    const previous = new Map(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) {
        const v = overrides[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    try {
        return await fn();
    } finally {
        for (const k of keys) {
            const v = previous.get(k);
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

function req(url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): NextRequest {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    let body: string | undefined;
    if (init.body !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(init.body);
    }
    return new NextRequest(url, { method: init.method ?? "POST", headers, body });
}

/** Mirrors the Firebase stub token shape used by requireGrowthAdmin. */
function firebaseToken(uid: string): string {
    const payload = btoa(JSON.stringify({ sub: uid }));
    return `Bearer-fake-token-${uid}.${payload}.sig`;
}

function seedUser(uid: string, role: string): void {
    rtDbStore.set(`users/${uid}`, { role });
}

function responseLeaksSecret(res: Response, body: string, secret: string): boolean {
    const headerDump = JSON.stringify([...res.headers.entries()]);
    return headerDump.includes(secret) || body.includes(secret);
}

async function readBody(res: Response): Promise<string> {
    return res.text();
}

async function runCronAuthTests(): Promise<boolean> {
    await withEnv({ CRON_SECRET: SECRET, PLUGIN_RUNTIME_CRON_SECRET: PLUGIN_SECRET }, async () => {
        s.section("1. next.config.ts never exposes CRON_SECRET as a response header");
        const headerRules = await (nextConfig.headers as () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>>)();
        const allHeaders = headerRules.flatMap((rule) => rule.headers);
        s.check(!allHeaders.some((h) => h.key.toLowerCase() === "x-cron-secret"), "no x-cron-secret header rule is configured");
        s.check(!allHeaders.some((h) => h.value === SECRET), "no configured header carries the CRON_SECRET value");
        s.check(!headerRules.some((rule) => rule.source.startsWith("/api/growth/cron")), "no header rule targets /api/growth/cron/*");
    });

    s.section("2. Shared helper trusts only a matching presented secret");
    await withEnv({ CRON_SECRET: SECRET }, async () => {
        s.check(getConfiguredCronSecret() === SECRET, "configured secret is read from CRON_SECRET");
        s.check(isCronRequest(req("http://localhost/x", { method: "GET" })) === false, "no credentials -> not cron");
        s.check(
            isCronRequest(req("http://localhost/x", { method: "GET", headers: { "user-agent": VERCEL_UA } })) === false,
            "User-Agent vercel-cron alone -> not cron (UA spoofing)"
        );
        s.check(
            isCronRequest(req(`http://localhost/x?secret=${SECRET}`, { method: "GET" })) === false,
            "secret in query string -> not cron"
        );
        s.check(
            isCronRequest(req("http://localhost/x", { method: "GET", headers: { authorization: "Bearer wrong-value" } })) === false,
            "wrong bearer -> not cron"
        );
        s.check(
            isCronRequest(req("http://localhost/x", { method: "GET", headers: { "x-cron-secret": "wrong-value" } })) === false,
            "wrong x-cron-secret -> not cron"
        );
        s.check(
            isCronRequest(req("http://localhost/x", { method: "GET", headers: { authorization: `Bearer ${SECRET}` } })) === true,
            "matching Authorization bearer -> cron"
        );
        s.check(
            isCronRequest(req("http://localhost/x", { method: "GET", headers: { "x-cron-secret": SECRET } })) === true,
            "matching x-cron-secret -> cron"
        );
        s.check(
            presentedCronSecrets(req("http://localhost/x", { method: "GET", headers: { authorization: "Basic abc" } })).length === 0,
            "non-Bearer Authorization scheme is ignored"
        );
    });

    await withEnv({ CRON_SECRET: undefined }, async () => {
        s.check(
            isCronRequest(req("http://localhost/x", { method: "GET", headers: { authorization: `Bearer ${SECRET}` } })) === false,
            "unset CRON_SECRET fails closed even when a bearer is presented"
        );
    });
    await withEnv({ CRON_SECRET: "   " }, async () => {
        s.check(
            isCronRequest(req("http://localhost/x", { method: "GET", headers: { authorization: "Bearer    " } })) === false,
            "blank CRON_SECRET and blank bearer -> not cron"
        );
    });

    s.check(cronSecretsMatch(SECRET, SECRET), "cronSecretsMatch accepts equal secrets");
    s.check(!cronSecretsMatch(SECRET + "x", SECRET), "cronSecretsMatch rejects a longer candidate");
    s.check(!cronSecretsMatch("", SECRET), "cronSecretsMatch rejects an empty candidate");
    s.check(!cronSecretsMatch(null, SECRET), "cronSecretsMatch rejects a missing candidate");
    s.check(!cronSecretsMatch(SECRET, null), "cronSecretsMatch rejects when the expected secret is unset");

    await withEnv({ CRON_SECRET: SECRET, PLUGIN_RUNTIME_CRON_SECRET: PLUGIN_SECRET }, async () => {
        s.check(
            isCronRequest(req("http://localhost/x", { method: "GET", headers: { authorization: `Bearer ${PLUGIN_SECRET}` } })) === false,
            "default helper does not accept the plugin-specific secret"
        );
        s.check(
            isCronRequest(req("http://localhost/x", { method: "GET", headers: { authorization: `Bearer ${PLUGIN_SECRET}` } }), "PLUGIN_RUNTIME_CRON_SECRET") === true,
            "named env accepts its own secret"
        );
    });

    s.section("3. Growth /api/growth/cron/[job]");
    await withEnv({ CRON_SECRET: SECRET }, async () => {
        seedUser(ADMIN_UID, "admin");
        seedUser(CUSTOMER_UID, "customer");
        const adminHeader = firebaseToken(ADMIN_UID);

        const noAuth = await jobPost(req("http://localhost/api/growth/cron/reports"), { params: Promise.resolve({ job: "reports" }) });
        const noAuthBody = await readBody(noAuth);
        s.check(noAuth.status === 403, `no admin session -> 403 (got ${noAuth.status})`);
        s.check(!responseLeaksSecret(noAuth, noAuthBody, SECRET), "rejection does not leak CRON_SECRET");

        const forged = await jobPost(req("http://localhost/api/growth/cron/reports", { headers: { authorization: "Bearer not-a-real-token" } }), { params: Promise.resolve({ job: "reports" }) });
        s.check(forged.status === 403, `forged admin token -> 403 (got ${forged.status})`);

        const uaSpoof = await jobPost(
            req("http://localhost/api/growth/cron/reports", { headers: { "user-agent": VERCEL_UA }, body: { cronSecret: "wrong" } }),
            { params: Promise.resolve({ job: "reports" }) }
        );
        s.check(uaSpoof.status === 403, `vercel-cron User-Agent alone -> 403 (got ${uaSpoof.status})`);

        const customer = await jobPost(
            req("http://localhost/api/growth/cron/reports", { headers: { authorization: firebaseToken(CUSTOMER_UID) }, body: { cronSecret: SECRET } }),
            { params: Promise.resolve({ job: "reports" }) }
        );
        s.check(customer.status === 403, `non-admin with correct body secret -> 403 (got ${customer.status})`);

        const wrongBodySecret = await jobPost(
            req("http://localhost/api/growth/cron/reports", { headers: { authorization: adminHeader }, body: { cronSecret: "wrong-value" } }),
            { params: Promise.resolve({ job: "reports" }) }
        );
        const wrongBodyText = await readBody(wrongBodySecret);
        s.check(wrongBodySecret.status === 403, `admin with wrong body cronSecret -> 403 (got ${wrongBodySecret.status})`);
        s.check(!responseLeaksSecret(wrongBodySecret, wrongBodyText, SECRET), "wrong-secret rejection does not leak CRON_SECRET");

        const authed = await jobPost(
            req("http://localhost/api/growth/cron/unknown-job", { headers: { authorization: adminHeader }, body: { cronSecret: SECRET } }),
            { params: Promise.resolve({ job: "unknown-job" }) }
        );
        s.check(authed.status !== 403 && authed.status !== 503, `admin + correct body secret passes auth (got ${authed.status})`);
        const authedText = await readBody(authed);
        s.check(!responseLeaksSecret(authed, authedText, SECRET), "authorized response does not leak CRON_SECRET");
    });

    await withEnv({ CRON_SECRET: undefined }, async () => {
        s.section("3b. Growth [job] fails closed with 503 when CRON_SECRET is unset");
        const res = await jobPost(
            req("http://localhost/api/growth/cron/reports", { headers: { authorization: firebaseToken(ADMIN_UID) }, body: { cronSecret: "anything" } }),
            { params: Promise.resolve({ job: "reports" }) }
        );
        const body = await readBody(res);
        s.check(res.status === 503, `authenticated admin with CRON_SECRET unset -> 503 (got ${res.status})`);
        s.check(body.includes("CRON_SECRET is not configured"), "503 body explains the missing configuration");
    });

    s.section("3c. Growth marketing-agent rejects unauthenticated and UA-spoofed calls");
    await withEnv({ CRON_SECRET: SECRET }, async () => {
        const none = await marketingAgentPost(req("http://localhost/api/growth/cron/marketing-agent"));
        const noneText = await readBody(none);
        s.check(none.status === 403, `no credentials -> 403 (got ${none.status})`);
        s.check(!responseLeaksSecret(none, noneText, SECRET), "rejection does not leak CRON_SECRET");

        const wrong = await marketingAgentPost(req("http://localhost/api/growth/cron/marketing-agent", { headers: { authorization: "Bearer wrong-value" } }));
        s.check(wrong.status === 403, `wrong bearer -> 403 (got ${wrong.status})`);

        const ua = await marketingAgentPost(req("http://localhost/api/growth/cron/marketing-agent", { headers: { "user-agent": VERCEL_UA } }));
        s.check(ua.status === 403, `vercel-cron User-Agent alone -> 403 (got ${ua.status})`);
    });

    s.section("4. Seven scheduled-job routes reject credential-less and UA-spoofed requests");
    await withEnv({ CRON_SECRET: SECRET, PLUGIN_RUNTIME_CRON_SECRET: PLUGIN_SECRET }, async () => {
        const spoof = { "user-agent": VERCEL_UA };
        const cases: Array<{ name: string; run: () => Promise<Response> }> = [
            { name: "trade-management/monitor", run: () => tradeManagementPost(req("http://localhost/api/trade-management/monitor", { headers: spoof })) },
            { name: "pro-signals/auto-update", run: () => proSignalsPost(req("http://localhost/api/pro-signals/auto-update", { headers: spoof })) },
            { name: "signals/auto-update", run: () => signalsPost(req("http://localhost/api/signals/auto-update", { headers: spoof })) },
            { name: "plugins/runtime/tick", run: () => pluginTickGet(req("http://localhost/api/plugins/runtime/tick", { method: "GET", headers: spoof })) },
            { name: "bot-studio/cron/tick (GET)", run: () => botStudioGet(req("http://localhost/api/bot-studio/cron/tick", { method: "GET", headers: spoof })) },
            { name: "bot-studio/cron/tick (POST)", run: () => botStudioPost(req("http://localhost/api/bot-studio/cron/tick", { headers: spoof })) },
            { name: "alerts/check", run: () => alertsGet(req("http://localhost/api/alerts/check", { method: "GET", headers: spoof })) },
            { name: "ai-signals/monitor", run: () => aiSignalsMonitorGet(req("http://localhost/api/ai-signals/monitor", { method: "GET", headers: spoof })) },
        ];
        for (const c of cases) {
            const res = await c.run();
            const text = await readBody(res);
            s.check(res.status === 401 || res.status === 403, `${c.name}: UA spoof without credentials -> rejected (got ${res.status})`);
            s.check(!responseLeaksSecret(res, text, SECRET), `${c.name}: rejection does not leak CRON_SECRET`);
        }

        s.section("4b. Seven routes reject forged bearers and query-string secrets");
        const forgedCases: Array<{ name: string; run: () => Promise<Response> }> = [
            { name: "trade-management/monitor", run: () => tradeManagementPost(req("http://localhost/api/trade-management/monitor", { headers: { authorization: "Bearer forged" } })) },
            { name: "pro-signals/auto-update", run: () => proSignalsPost(req("http://localhost/api/pro-signals/auto-update", { headers: { authorization: "Bearer forged" } })) },
            { name: "signals/auto-update", run: () => signalsPost(req("http://localhost/api/signals/auto-update", { headers: { authorization: "Bearer forged" } })) },
            { name: "alerts/check (query secret)", run: () => alertsGet(req(`http://localhost/api/alerts/check?secret=${SECRET}`, { method: "GET", headers: spoof })) },
            { name: "ai-signals/monitor (query secret)", run: () => aiSignalsMonitorGet(req(`http://localhost/api/ai-signals/monitor?secret=${SECRET}`, { method: "GET", headers: spoof })) },
            { name: "plugins/runtime/tick (query secret)", run: () => pluginTickGet(req(`http://localhost/api/plugins/runtime/tick?secret=${SECRET}`, { method: "GET", headers: spoof })) },
        ];
        for (const c of forgedCases) {
            const res = await c.run();
            s.check(res.status === 401 || res.status === 403, `${c.name} -> rejected (got ${res.status})`);
        }
    });

    s.section("4c. Unset CRON_SECRET fails closed for cron-only routes");
    await withEnv({ CRON_SECRET: undefined, PLUGIN_RUNTIME_CRON_SECRET: undefined }, async () => {
        const bearer = { authorization: `Bearer ${SECRET}` };
        const alerts = await alertsGet(req("http://localhost/api/alerts/check", { method: "GET", headers: bearer }));
        s.check(alerts.status === 401, `alerts/check with unset CRON_SECRET -> 401 (got ${alerts.status})`);
        const plugin = await pluginTickGet(req("http://localhost/api/plugins/runtime/tick", { method: "GET", headers: bearer }));
        s.check(plugin.status === 401, `plugins/runtime/tick with nothing configured -> 401 (got ${plugin.status})`);
    });

    s.section("5. Authorized paths (empty store: no price fetch, no scheduled side effects)");
    rtDbStore.clear();
    await withEnv({ CRON_SECRET: SECRET, PLUGIN_RUNTIME_CRON_SECRET: PLUGIN_SECRET }, async () => {
        const bearer = { authorization: `Bearer ${SECRET}` };
        const xSecret = { "x-cron-secret": SECRET };
        const adminFirebase = { authorization: `Bearer ${firebaseToken(ADMIN_UID)}` };

        const sigGet = await signalsGet(req("http://localhost/api/signals/auto-update", { method: "GET", headers: bearer }));
        const sigBody = (await sigGet.json()) as { success?: boolean; checked?: number };
        s.check(sigGet.status === 200 && sigBody.success === true && sigBody.checked === 0, `signals GET with cron bearer -> 200 (got ${sigGet.status})`);

        const sigPost = await signalsPost(req("http://localhost/api/signals/auto-update", { headers: xSecret }));
        s.check(sigPost.status === 200, `signals POST with x-cron-secret -> 200 (got ${sigPost.status})`);

        const sigFb = await signalsPost(req("http://localhost/api/signals/auto-update", { headers: adminFirebase }));
        s.check(sigFb.status === 200, `signals POST with valid Firebase identity -> 200 (got ${sigFb.status})`);

        const proGet = await proSignalsGet(req("http://localhost/api/pro-signals/auto-update", { method: "GET", headers: bearer }));
        s.check(proGet.status === 200, `pro-signals GET with cron bearer -> 200 (got ${proGet.status})`);

        const proPost = await proSignalsPost(req("http://localhost/api/pro-signals/auto-update", { headers: adminFirebase }));
        s.check(proPost.status === 200, `pro-signals POST with valid Firebase identity -> 200 (got ${proPost.status})`);

        const schedGet = await schedulerGet(req("http://localhost/api/workflows/scheduler/tick", { method: "GET", headers: bearer }));
        s.check(schedGet.status === 200, `workflows scheduler GET with cron bearer -> 200 (got ${schedGet.status})`);
        const schedPost = await schedulerPost(req("http://localhost/api/workflows/scheduler/tick", { headers: xSecret }));
        s.check(schedPost.status === 200, `workflows scheduler POST with x-cron-secret -> 200 (got ${schedPost.status})`);

        s.section("5b. Workflow scheduler rejects query-string and forged credentials");
        const qs = await schedulerGet(req(`http://localhost/api/workflows/scheduler/tick?secret=${SECRET}`, { method: "GET", headers: { "user-agent": VERCEL_UA } }));
        s.check(qs.status === 401, `scheduler query-string secret -> 401 (got ${qs.status})`);
        const none = await schedulerGet(req("http://localhost/api/workflows/scheduler/tick", { method: "GET", headers: { "user-agent": VERCEL_UA } }));
        s.check(none.status === 401, `scheduler UA spoof without secret -> 401 (got ${none.status})`);
        const wrong = await schedulerPost(req("http://localhost/api/workflows/scheduler/tick", { headers: { authorization: "Bearer wrong-value" } }));
        s.check(wrong.status === 401, `scheduler wrong bearer -> 401 (got ${wrong.status})`);
        const forgedFb = await schedulerGet(req("http://localhost/api/workflows/scheduler/tick", { method: "GET", headers: { authorization: "Bearer forged" } }));
        s.check(forgedFb.status === 401, `scheduler forged Firebase token -> 401 (got ${forgedFb.status})`);
    });

    s.section("5c. Plugin runtime tick: plugin-specific secret and admin-token fallback");
    await withEnv({ CRON_SECRET: SECRET, PLUGIN_RUNTIME_CRON_SECRET: PLUGIN_SECRET }, async () => {
        const pluginBearer = await pluginTickGet(req("http://localhost/api/plugins/runtime/tick", { method: "GET", headers: { authorization: `Bearer ${PLUGIN_SECRET}` } }));
        s.check(pluginBearer.status === 200, `plugin tick with PLUGIN_RUNTIME_CRON_SECRET bearer -> 200 (got ${pluginBearer.status})`);
    });
    await withEnv({ CRON_SECRET: undefined, PLUGIN_RUNTIME_CRON_SECRET: undefined }, async () => {
        seedUser(ADMIN_UID, "admin");
        const admin = await pluginTickGet(req("http://localhost/api/plugins/runtime/tick", { method: "GET", headers: { authorization: `Bearer ${firebaseToken(ADMIN_UID)}` } }));
        s.check(admin.status === 200, `plugin tick, no cron secret configured, admin Firebase token -> 200 (got ${admin.status})`);
        seedUser(CUSTOMER_UID, "customer");
        const customer = await pluginTickGet(req("http://localhost/api/plugins/runtime/tick", { method: "GET", headers: { authorization: `Bearer ${firebaseToken(CUSTOMER_UID)}` } }));
        s.check(customer.status === 401, `plugin tick, no cron secret configured, non-admin Firebase token -> 401 (got ${customer.status})`);
    });

    await withEnv({ CRON_SECRET: undefined, PLUGIN_RUNTIME_CRON_SECRET: undefined }, async () => {
        const unset = await schedulerGet(req("http://localhost/api/workflows/scheduler/tick", { method: "GET", headers: { authorization: `Bearer ${SECRET}` } }));
        s.check(unset.status === 401, `scheduler with CRON_SECRET unset fails closed (got ${unset.status})`);
    });

    return s.finish();
}

void (async (): Promise<void> => {
    const ok = await runCronAuthTests();
    process.exit(ok ? 0 : 1);
})();
