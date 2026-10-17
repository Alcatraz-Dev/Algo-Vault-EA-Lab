/**
 * CRON AUTH REGRESSION SUITE.
 *
 * Guards the CRON_SECRET disclosure fix:
 *   1. next.config.ts must never publish CRON_SECRET as a response header.
 *   2. Unauthenticated POSTs to /api/growth/cron/[job] and
 *      /api/growth/cron/marketing-agent are rejected before any job runs,
 *      and the secret never appears in the response.
 *
 * Runs under the firebase-admin stub (see scripts/jiti-tsrun.mjs), so no
 * real credentials or network are involved.
 */

import { NextRequest } from "next/server";
import { createSuite } from "@/lib/performance-arena/__tests__/harness";
import nextConfig from "../../next.config";
import { POST as jobPost } from "@/app/api/growth/cron/[job]/route";
import { POST as marketingAgentPost } from "@/app/api/growth/cron/marketing-agent/route";

const s = createSuite("cron-auth");

const SECRET = "cron-regression-secret-value-0123456789";

function postRequest(url: string, headers: Record<string, string> = {}): NextRequest {
    return new NextRequest(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({}),
    });
}

function responseLeaksSecret(res: Response, body: string): boolean {
    const headerDump = JSON.stringify([...res.headers.entries()]);
    return headerDump.includes(SECRET) || body.includes(SECRET);
}

async function runCronAuthTests(): Promise<boolean> {
    const previousSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = SECRET;

    try {
        s.section("1. next.config.ts never exposes CRON_SECRET as a response header");
        const headerRules = await (nextConfig.headers as () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>>)();
        const allHeaders = headerRules.flatMap((rule) => rule.headers);
        s.check(
            !allHeaders.some((h) => h.key.toLowerCase() === "x-cron-secret"),
            "no x-cron-secret header rule is configured"
        );
        s.check(
            !allHeaders.some((h) => h.value === SECRET),
            "no configured header carries the CRON_SECRET value"
        );
        s.check(
            !headerRules.some((rule) => rule.source.startsWith("/api/growth/cron")),
            "no header rule targets /api/growth/cron/*"
        );

        s.section("2. Unauthenticated /api/growth/cron/[job] is rejected");
        const jobRes = await jobPost(
            postRequest("http://localhost/api/growth/cron/reports", {}),
            { params: Promise.resolve({ job: "reports" }) }
        );
        const jobBody = await jobRes.text();
        s.check(jobRes.status === 403, `no-credential request returns 403 (got ${jobRes.status})`);
        s.check(!responseLeaksSecret(jobRes, jobBody), "rejection response does not leak CRON_SECRET");

        const jobForgedRes = await jobPost(
            postRequest("http://localhost/api/growth/cron/reports", {
                authorization: "Bearer not-a-real-admin-token",
            }),
            { params: Promise.resolve({ job: "reports" }) }
        );
        const jobForgedBody = await jobForgedRes.text();
        s.check(jobForgedRes.status === 403, `forged bearer returns 403 (got ${jobForgedRes.status})`);
        s.check(!responseLeaksSecret(jobForgedRes, jobForgedBody), "forged-bearer response does not leak CRON_SECRET");

        s.section("3. Unauthenticated /api/growth/cron/marketing-agent is rejected");
        const maRes = await marketingAgentPost(postRequest("http://localhost/api/growth/cron/marketing-agent"));
        const maBody = await maRes.text();
        s.check(maRes.status === 403, `no-credential request returns 403 (got ${maRes.status})`);
        s.check(!responseLeaksSecret(maRes, maBody), "rejection response does not leak CRON_SECRET");

        const maWrongRes = await marketingAgentPost(
            postRequest("http://localhost/api/growth/cron/marketing-agent", {
                authorization: "Bearer wrong-secret-value",
            })
        );
        s.check(maWrongRes.status === 403, `wrong secret returns 403 (got ${maWrongRes.status})`);
    } finally {
        if (previousSecret === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = previousSecret;
    }

    return s.finish();
}

void (async (): Promise<void> => {
    const ok = await runCronAuthTests();
    process.exit(ok ? 0 : 1);
})();
