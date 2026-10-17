/**
 * GROWTH CRON DISPATCH SUITE.
 *
 * Covers the Vercel-Cron GET contract and the preserved POST contracts for
 * /api/growth/cron/[job] and /api/growth/cron/marketing-agent.
 *
 * Authorized paths run through an injected recording runner, so no growth job
 * executes and no external network call is made. Route-level tests only use
 * rejected requests, which never reach the runner.
 *
 * Runs under the firebase-admin stub (scripts/jiti-tsrun.mjs), so no real
 * credentials or network are involved.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { createSuite } from "@/lib/performance-arena/__tests__/harness";
import {
    SCHEDULED_GROWTH_JOBS,
    handleGrowthCronPost,
    handleMarketingAgentGet,
    handleMarketingAgentPost,
    handleScheduledGrowthJobGet,
    isScheduledGrowthJob,
    type CronJobRunner,
} from "@/lib/growth/cron-dispatch";
import { GET as jobGet } from "@/app/api/growth/cron/[job]/route";
import { GET as marketingAgentGet } from "@/app/api/growth/cron/marketing-agent/route";
import { rtDbStore } from "./firebase-admin-stub";

const s = createSuite("growth-cron-dispatch");

const SECRET = "growth-dispatch-secret-value-0123456789";
const VERCEL_UA = "vercel-cron/1.0";
const ADMIN_UID = "growth-dispatch-admin";
const CUSTOMER_UID = "growth-dispatch-customer";

type Env = Record<string, string | undefined>;

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

/** A runner that records every invocation and never does real work. */
function recordingRunner(): { runner: CronJobRunner; calls: Array<{ job: string; payload: Record<string, unknown> }> } {
    const calls: Array<{ job: string; payload: Record<string, unknown> }> = [];
    const runner: CronJobRunner = async (job, payload) => {
        calls.push({ job, payload });
        return { ok: true, result: { summary: `ran ${job}` } };
    };
    return { runner, calls };
}

async function responseText(res: Response): Promise<string> {
    return res.text();
}

function leaksSecret(res: Response, body: string): boolean {
    const headerDump = JSON.stringify([...res.headers.entries()]);
    return headerDump.includes(SECRET) || body.includes(SECRET);
}

function scheduledGrowthPathsFromVercelJson(): string[] {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
        crons: Array<{ path: string }>;
    };
    return config.crons.map((c) => c.path).filter((p) => p.startsWith("/api/growth/cron/"));
}

async function runGrowthDispatchTests(): Promise<boolean> {
    seedUser(ADMIN_UID, "admin");
    seedUser(CUSTOMER_UID, "customer");

    s.section("1. Allowlist matches the configured Vercel schedules");
    const scheduled = scheduledGrowthPathsFromVercelJson();
    const jobPaths = scheduled
        .filter((p) => p !== "/api/growth/cron/marketing-agent")
        .map((p) => p.replace("/api/growth/cron/", ""))
        .sort();
    s.check(
        JSON.stringify([...SCHEDULED_GROWTH_JOBS].sort()) === JSON.stringify(jobPaths),
        `SCHEDULED_GROWTH_JOBS equals the vercel.json [job] schedules (${jobPaths.join(", ")})`
    );
    s.check(scheduled.includes("/api/growth/cron/marketing-agent"), "marketing-agent is scheduled in vercel.json");
    s.check(!isScheduledGrowthJob("marketing-agent"), "marketing-agent is not in the [job] GET allowlist");
    s.check(!isScheduledGrowthJob("reports; drop"), "arbitrary job strings are not allowlisted");

    await withEnv({ CRON_SECRET: SECRET }, async () => {
        s.section("2. GET [job] rejects unauthenticated requests before any job runs");
        const cases: Array<{ name: string; request: NextRequest }> = [
            { name: "no credentials", request: req("http://localhost/api/growth/cron/reports", { method: "GET" }) },
            {
                name: "vercel-cron User-Agent alone",
                request: req("http://localhost/api/growth/cron/reports", { method: "GET", headers: { "user-agent": VERCEL_UA } }),
            },
            {
                name: "wrong bearer secret",
                request: req("http://localhost/api/growth/cron/reports", { method: "GET", headers: { authorization: "Bearer wrong-value" } }),
            },
            {
                name: "blank bearer secret",
                request: req("http://localhost/api/growth/cron/reports", { method: "GET", headers: { authorization: "Bearer    " } }),
            },
            {
                name: "secret in query string",
                request: req(`http://localhost/api/growth/cron/reports?secret=${SECRET}`, { method: "GET" }),
            },
            {
                name: "admin session token",
                request: req("http://localhost/api/growth/cron/reports", { method: "GET", headers: { authorization: firebaseToken(ADMIN_UID) } }),
            },
        ];
        for (const c of cases) {
            const { runner, calls } = recordingRunner();
            const res = await handleScheduledGrowthJobGet(c.request, "reports", runner);
            const text = await responseText(res);
            s.check(res.status === 401, `${c.name}: rejected with 401 (got ${res.status})`);
            s.check(calls.length === 0, `${c.name}: job executor not invoked`);
            s.check(!leaksSecret(res, text), `${c.name}: rejection does not leak CRON_SECRET`);
        }

        const routeNoAuth = await jobGet(req("http://localhost/api/growth/cron/reports", { method: "GET" }), {
            params: Promise.resolve({ job: "reports" }),
        });
        s.check(routeNoAuth.status === 401, `route GET without credentials -> 401 (got ${routeNoAuth.status})`);

        // Route-level authorized GET: the valid secret passes the wrapper and the
        // [job] param reaches the allowlist. An unknown name is used so the real
        // runCronJob is never reached and no scheduled work runs.
        const routeAuthedUnknown = await jobGet(
            req("http://localhost/api/growth/cron/not-a-job", { method: "GET", headers: { authorization: `Bearer ${SECRET}` } }),
            { params: Promise.resolve({ job: "not-a-job" }) }
        );
        const routeAuthedUnknownText = await responseText(routeAuthedUnknown);
        s.check(
            routeAuthedUnknown.status === 404 && !leaksSecret(routeAuthedUnknown, routeAuthedUnknownText),
            `route GET with valid secret -> job param validated, unknown name 404 before runner (got ${routeAuthedUnknown.status})`
        );

        s.section("3. GET [job] valid secret reaches the intended job");
        for (const job of SCHEDULED_GROWTH_JOBS) {
            const { runner, calls } = recordingRunner();
            const bearer = await handleScheduledGrowthJobGet(
                req(`http://localhost/api/growth/cron/${job}`, { method: "GET", headers: { authorization: `Bearer ${SECRET}` } }),
                job,
                runner
            );
            const bearerText = await responseText(bearer);
            s.check(bearer.status === 200, `${job}: bearer secret -> 200 (got ${bearer.status})`);
            s.check(calls.length === 1 && calls[0].job === job, `${job}: executor invoked exactly once with the job name`);
            s.check(!leaksSecret(bearer, bearerText), `${job}: success response does not leak CRON_SECRET`);
        }
        {
            const { runner, calls } = recordingRunner();
            const header = await handleScheduledGrowthJobGet(
                req("http://localhost/api/growth/cron/reports", { method: "GET", headers: { "x-cron-secret": SECRET } }),
                "reports",
                runner
            );
            s.check(header.status === 200 && calls.length === 1, `x-cron-secret header -> executed (got ${header.status})`);
        }

        s.section("4. GET [job] validates the job name before execution");
        {
            const { runner, calls } = recordingRunner();
            const unknown = await handleScheduledGrowthJobGet(
                req("http://localhost/api/growth/cron/marketing-agent", { method: "GET", headers: { authorization: `Bearer ${SECRET}` } }),
                "marketing-agent",
                runner
            );
            s.check(unknown.status === 404, `non-scheduled job name with valid secret -> 404 (got ${unknown.status})`);
            s.check(calls.length === 0, "unknown job name never reaches the executor");

            const garbage = await handleScheduledGrowthJobGet(
                req("http://localhost/api/growth/cron/x", { method: "GET", headers: { authorization: `Bearer ${SECRET}` } }),
                "../../etc",
                runner
            );
            s.check(garbage.status === 404 && calls.length === 0, `path-traversal-style job name -> 404 without execution (got ${garbage.status})`);
        }

        s.section("5. GET [job] reports executor failures without leaking secrets");
        {
            const failing: CronJobRunner = async () => {
                throw new Error("simulated job failure");
            };
            const res = await handleScheduledGrowthJobGet(
                req("http://localhost/api/growth/cron/reports", { method: "GET", headers: { authorization: `Bearer ${SECRET}` } }),
                "reports",
                failing
            );
            const text = await responseText(res);
            s.check(res.status === 500, `executor throws -> 500 (got ${res.status})`);
            s.check(text.includes("simulated job failure") && !leaksSecret(res, text), "500 body carries the error without the secret");
        }

        s.section("6. POST [job] keeps its admin-authenticated contract");
        {
            const { runner, calls } = recordingRunner();
            const anonymous = await handleGrowthCronPost(req("http://localhost/api/growth/cron/analysis", { body: {} }), "analysis", runner);
            s.check(anonymous.status === 403 && calls.length === 0, `anonymous analysis POST -> 403, not executed (got ${anonymous.status})`);

            const anonymousAffiliates = await handleGrowthCronPost(req("http://localhost/api/growth/cron/affiliates", { body: {} }), "affiliates", runner);
            s.check(anonymousAffiliates.status === 403 && calls.length === 0, `anonymous affiliates POST -> 403, not executed (got ${anonymousAffiliates.status})`);

            const none = await handleGrowthCronPost(req("http://localhost/api/growth/cron/reports", { body: { cronSecret: SECRET } }), "reports", runner);
            s.check(none.status === 403 && calls.length === 0, `no admin session with correct body secret -> 403, not executed (got ${none.status})`);

            const adminRunner = recordingRunner();
            const adminAnalysis = await handleGrowthCronPost(req("http://localhost/api/growth/cron/analysis", { headers: { authorization: firebaseToken(ADMIN_UID) }, body: {} }), "analysis", adminRunner.runner);
            s.check(adminAnalysis.status === 200 && adminRunner.calls.length === 1 && adminRunner.calls[0].job === "analysis", `admin session, no body cronSecret -> analysis executed (got ${adminAnalysis.status})`);

            const adminAffiliates = await handleGrowthCronPost(req("http://localhost/api/growth/cron/affiliates", { headers: { authorization: firebaseToken(ADMIN_UID) }, body: {} }), "affiliates", adminRunner.runner);
            s.check(adminAffiliates.status === 200 && adminRunner.calls.length === 2 && adminRunner.calls[1].job === "affiliates", `admin session, no body cronSecret -> affiliates executed (got ${adminAffiliates.status})`);

            const vercelBearer = await handleGrowthCronPost(
                req("http://localhost/api/growth/cron/reports", { headers: { authorization: `Bearer ${SECRET}` }, body: {} }),
                "reports",
                runner
            );
            s.check(vercelBearer.status === 403 && calls.length === 0, `POST does not accept a bare cron bearer (got ${vercelBearer.status})`);

            const customer = await handleGrowthCronPost(
                req("http://localhost/api/growth/cron/reports", { headers: { authorization: firebaseToken(CUSTOMER_UID) }, body: { cronSecret: SECRET } }),
                "reports",
                runner
            );
            s.check(customer.status === 403 && calls.length === 0, `non-admin with correct body secret -> 403, not executed (got ${customer.status})`);

            const wrong = await handleGrowthCronPost(
                req("http://localhost/api/growth/cron/reports", { headers: { authorization: firebaseToken(ADMIN_UID) }, body: { cronSecret: "wrong" } }),
                "reports",
                runner
            );
            const wrongText = await responseText(wrong);
            s.check(wrong.status === 403 && calls.length === 0, `admin with wrong body secret -> 403, not executed (got ${wrong.status})`);
            s.check(!leaksSecret(wrong, wrongText), "POST rejection does not leak CRON_SECRET");

            const ok = await handleGrowthCronPost(
                req("http://localhost/api/growth/cron/reports", { headers: { authorization: firebaseToken(ADMIN_UID) }, body: { cronSecret: SECRET, payload: { interval: "DAILY" } } }),
                "reports",
                runner
            );
            const okText = await responseText(ok);
            s.check(ok.status === 200 && calls.length === 1 && calls[0].job === "reports", `admin + correct body secret -> executed (got ${ok.status})`);
            s.check(calls[0]?.payload.interval === "DAILY", "POST forwards the body payload to the executor");
            s.check(!leaksSecret(ok, okText), "authorized POST response does not leak CRON_SECRET");
        }

        s.section("7. Marketing-agent GET is secret-only and uses the shared runner");
        {
            const { runner, calls } = recordingRunner();
            const none = await handleMarketingAgentGet(req("http://localhost/api/growth/cron/marketing-agent", { method: "GET", headers: { "user-agent": VERCEL_UA } }), runner);
            s.check(none.status === 401 && calls.length === 0, `GET with User-Agent only -> 401, not executed (got ${none.status})`);

            const adminOnly = await handleMarketingAgentGet(req("http://localhost/api/growth/cron/marketing-agent", { method: "GET", headers: { authorization: firebaseToken(ADMIN_UID) } }), runner);
            s.check(adminOnly.status === 401 && calls.length === 0, `GET with admin session only -> 401, not executed (got ${adminOnly.status})`);

            const ok = await handleMarketingAgentGet(req("http://localhost/api/growth/cron/marketing-agent", { method: "GET", headers: { authorization: `Bearer ${SECRET}` } }), runner);
            const okText = await responseText(ok);
            s.check(ok.status === 200 && calls.length === 1 && calls[0].job === "marketing-agent", `GET with bearer secret -> executed (got ${ok.status})`);
            s.check(typeof calls[0]?.payload.bucket === "string" && String(calls[0].payload.bucket).startsWith("t"), "GET supplies a 5-minute dedupe bucket");
            s.check(!leaksSecret(ok, okText), "marketing-agent GET response does not leak CRON_SECRET");

            const routeGet = await marketingAgentGet(req("http://localhost/api/growth/cron/marketing-agent", { method: "GET" }));
            s.check(routeGet.status === 401, `route GET without credentials -> 401 (got ${routeGet.status})`);
        }

        s.section("8. Marketing-agent POST keeps its admin-or-secret contract");
        {
            const { runner, calls } = recordingRunner();
            const none = await handleMarketingAgentPost(req("http://localhost/api/growth/cron/marketing-agent"), runner);
            s.check(none.status === 403 && calls.length === 0, `no credentials -> 403, not executed (got ${none.status})`);

            const wrong = await handleMarketingAgentPost(req("http://localhost/api/growth/cron/marketing-agent", { headers: { authorization: "Bearer wrong" } }), runner);
            s.check(wrong.status === 403 && calls.length === 0, `wrong bearer -> 403, not executed (got ${wrong.status})`);

            const header = await handleMarketingAgentPost(req("http://localhost/api/growth/cron/marketing-agent", { headers: { "x-cron-secret": SECRET } }), runner);
            s.check(header.status === 200 && calls.length === 1, `x-cron-secret -> executed (got ${header.status})`);

            const admin = await handleMarketingAgentPost(req("http://localhost/api/growth/cron/marketing-agent", { headers: { authorization: firebaseToken(ADMIN_UID) }, body: { bucket: "manual-1" } }), runner);
            s.check(admin.status === 200 && calls.length === 2 && calls[1].payload.bucket === "manual-1", `admin session -> executed with explicit bucket (got ${admin.status})`);
        }

        s.section("9. Fail closed when CRON_SECRET is unset");
    });

    await withEnv({ CRON_SECRET: undefined, PLUGIN_RUNTIME_CRON_SECRET: undefined }, async () => {
        const bearer = { authorization: "Bearer " };
        const { runner, calls } = recordingRunner();
        const get = await handleScheduledGrowthJobGet(req("http://localhost/api/growth/cron/reports", { method: "GET", headers: bearer }), "reports", runner);
        s.check(get.status === 503 && calls.length === 0, `[job] GET with CRON_SECRET unset -> 503, not executed (got ${get.status})`);

        const mkGet = await handleMarketingAgentGet(req("http://localhost/api/growth/cron/marketing-agent", { method: "GET", headers: { authorization: `Bearer ${SECRET}` } }), runner);
        s.check(mkGet.status === 503 && calls.length === 0, `marketing-agent GET with CRON_SECRET unset -> 503, not executed (got ${mkGet.status})`);

        const suppliedSecret = await handleGrowthCronPost(req("http://localhost/api/growth/cron/reports", { headers: { authorization: firebaseToken(ADMIN_UID) }, body: { cronSecret: "anything" } }), "reports", runner);
        s.check(suppliedSecret.status === 503 && calls.length === 0, `[job] POST admin with a body secret while CRON_SECRET unset -> 503, not executed (got ${suppliedSecret.status})`);

        const unsetRunner = recordingRunner();
        const adminNoSecret = await handleGrowthCronPost(req("http://localhost/api/growth/cron/analysis", { headers: { authorization: firebaseToken(ADMIN_UID) }, body: {} }), "analysis", unsetRunner.runner);
        s.check(adminNoSecret.status === 200 && unsetRunner.calls.length === 1, `[job] POST admin with no body secret while CRON_SECRET unset -> admin session authorizes (got ${adminNoSecret.status})`);

        const scheduledUnset = await handleScheduledGrowthJobGet(req("http://localhost/api/growth/cron/analysis", { method: "GET", headers: { authorization: `Bearer ${SECRET}` } }), "analysis", unsetRunner.runner);
        s.check(scheduledUnset.status === 503 && unsetRunner.calls.length === 1, `[job] GET with CRON_SECRET unset -> 503 even with a bearer (got ${scheduledUnset.status})`);
    });

    return s.finish();
}

void (async (): Promise<void> => {
    const ok = await runGrowthDispatchTests();
    process.exit(ok ? 0 : 1);
})();
