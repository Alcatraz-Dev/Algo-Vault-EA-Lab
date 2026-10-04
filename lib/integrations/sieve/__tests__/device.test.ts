// Sieve device login — request building and poll outcomes.

import { createSuite, withFetch, jsonResponse } from "./harness";
import { requestDeviceCode, pollDeviceToken } from "../client";

export async function runDeviceTests(): Promise<boolean> {
    const s = createSuite("sieve/device");
    const base = "https://scrape.usesieve.com";

    s.section("requestDeviceCode");
    {
        let capturedUrl = "";
        let capturedBody = "";
        let upstreamBody: unknown = {
            device_code: "dev-123",
            user_code: "WDJB-MJHT",
            verification_uri: `${base}/device`,
            verification_uri_complete: `${base}/device?code=WDJB-MJHT`,
            expires_in: 600,
            interval: 5,
        };
        const mock = async (input: any, init?: any) => {
            capturedUrl = String(input);
            capturedBody = String(init?.body ?? "");
            return jsonResponse(200, upstreamBody);
        };
        const code = await withFetch(mock, () => requestDeviceCode("freebuff", { baseUrl: base }));
        s.check(capturedUrl === `${base}/api/auth/device/code`, "POST to /api/auth/device/code");
        s.check(JSON.parse(capturedBody).client_name === "freebuff", "client_name forwarded");
        s.check(code.user_code === "WDJB-MJHT" && code.interval === 5, "device code parsed");
    }

    s.section("pollDeviceToken outcomes");
    const cases: Array<[number, unknown, string]> = [
        [200, { api_key: "dc_sk_abc", token_type: "Bearer", key_name: "freebuff" }, "approved"],
        [400, { error: "authorization_pending" }, "pending"],
        [400, { error: "slow_down" }, "slow_down"],
        [400, { error: "access_denied" }, "denied"],
        [400, { error: "expired_token" }, "expired"],
    ];
    for (const [status, body, expected] of cases) {
        const result = await withFetch(
            async () => jsonResponse(status, body),
            () => pollDeviceToken("dev-123", { baseUrl: base }),
        );
        s.check(result.status === expected, `${status} ${JSON.stringify(body)} → ${expected}`);
        if (expected === "approved") {
            s.check((result as { apiKey?: string }).apiKey === "dc_sk_abc", "api key surfaced only on approval");
        }
    }

    s.section("pollDeviceToken unknown 400 error is not silently swallowed");
    {
        let threw = false;
        await withFetch(
            async () => jsonResponse(400, { error: "something_else" }),
            async () => {
                try {
                    await pollDeviceToken("dev-123", { baseUrl: base });
                } catch {
                    threw = true;
                }
            },
        );
        s.check(threw, "unrecognized 400 raises instead of looping forever");
    }

    return s.finish();
}
