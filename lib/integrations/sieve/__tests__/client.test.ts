// Sieve client — request building, error mapping, POST retry rules.

import {
    createSuite,
    withFetch,
    jsonResponse,
    abortError,
} from "./harness";
import {
    createScrape,
    createScrapeWithSafeRetry,
    getScrape,
    sendMessage,
    buildStartBody,
    fileUrl,
    parseRetryAfter,
} from "../client";
import { isSieveError, type SieveError } from "../errors";
import type { SieveFile } from "../types";

interface Captured {
    url: string;
    init: RequestInit;
}

function capture(): { calls: Captured[]; mock: (input: any, init?: any) => Promise<Response> } {
    const calls: Captured[] = [];
    return {
        calls,
        mock: async (input: any, init?: any) => {
            calls.push({ url: String(input), init: init ?? {} });
            return jsonResponse(200, {});
        },
    };
}

function noSleep(): Promise<void> {
    return Promise.resolve();
}

export async function runClientTests(): Promise<boolean> {
    const s = createSuite("sieve/client");
    const originalKey = process.env.SIEVE_API_KEY;
    process.env.SIEVE_API_KEY = "dc_sk_test_value";
    delete process.env.SIEVE_BASE_URL;

    try {
        s.section("Request building");
        {
            const { calls, mock } = capture();
            await withFetch(mock, () =>
                createScrape({
                    instruction: "Extract quotes",
                    target_urls: ["https://quotes.toscrape.com"],
                    fields: ["text", "author"],
                    compliance_mode: "regular",
                }),
            );
            const call = calls[0];
            s.check(calls.length === 1, "one POST for one start");
            s.check(call.url === "https://scrape.usesieve.com/api/scrapes", "URL is POST /api/scrapes");
            s.check(call.init.method === "POST", "method POST");
            const headers = call.init.headers as Record<string, string>;
            s.check(headers.Authorization === "Bearer dc_sk_test_value", "Bearer auth header");
            s.check(headers["Content-Type"] === "application/json", "JSON content type");
            const body = JSON.parse(String(call.init.body));
            s.check(body.instruction === "Extract quotes", "instruction forwarded");
            s.check(Array.isArray(body.target_urls) && body.target_urls[0] === "https://quotes.toscrape.com", "target_urls forwarded");
            s.check(body.compliance_mode === "regular", "compliance_mode forwarded");
        }

        s.section("buildStartBody omits empty/undefined fields");
        {
            const body = buildStartBody({ instruction: "x" });
            s.check(Object.keys(body).length === 1 && body.instruction === "x", "only instruction present");
            const withSchema = buildStartBody({ instruction: "x", output_schema: { type: "object" } });
            s.check(!!withSchema.output_schema, "output_schema included when provided");
        }

        s.section("Error mapping");
        const statusCases: Array<[number, string]> = [
            [400, "BAD_REQUEST"],
            [401, "UNAUTHORIZED"],
            [402, "INSUFFICIENT_CREDITS"],
            [404, "NOT_FOUND"],
            [429, "RATE_LIMITED"],
            [500, "SERVER_ERROR"],
            [503, "SERVER_ERROR"],
        ];
        for (const [status, expected] of statusCases) {
            let error: SieveError | undefined;
            await withFetch(
                async () => jsonResponse(status, { error: "boom" }, status === 429 ? { "retry-after": "7" } : {}),
                async () => {
                    try {
                        await createScrapeWithSafeRetry(
                            { instruction: "x" },
                            { retry: { retries: 0, sleep: noSleep } },
                        );
                    } catch (err) {
                        error = err as SieveError;
                    }
                },
            );
            s.check(!!error && isSieveError(error) && error.code === expected, `HTTP ${status} → ${expected}`);
            if (status === 429) {
                s.check(error?.retryAfterSeconds === 7, "Retry-After header parsed to 7s");
                s.check(error?.safeToRetry === true, "429 is safe to retry");
            }
            if (status === 400 || status === 401 || status === 402 || status === 404) {
                s.check(error?.safeToRetry === false, `HTTP ${status} is not safe to retry`);
            }
        }

        s.section("Never auto-retry POST /api/scrapes on timeout");
        {
            const calls: number[] = [];
            const mock = async () => {
                calls.push(1);
                throw abortError();
            };
            let error: SieveError | undefined;
            await withFetch(mock, async () => {
                try {
                    await createScrape({ instruction: "x" });
                } catch (err) {
                    error = err as SieveError;
                }
            });
            s.check(calls.length === 1, "fetch called exactly once despite timeout");
            s.check(error?.code === "TIMEOUT", "timeout surfaces TIMEOUT");
            s.check(error?.safeToRetry === false, "timeout is not safe to retry");
        }

        s.section("Never auto-retry POST on network error");
        {
            let count = 0;
            const mock = async () => {
                count += 1;
                throw new TypeError("fetch failed");
            };
            let error: SieveError | undefined;
            await withFetch(mock, async () => {
                try {
                    await createScrape({ instruction: "x" });
                } catch (err) {
                    error = err as SieveError;
                }
            });
            s.check(count === 1, "network error does not retry POST");
            s.check(error?.code === "NETWORK_ERROR", "network error code");
        }

        s.section("Safe retry only for 429/5xx");
        {
            let count = 0;
            const mock = async () => {
                count += 1;
                if (count === 1) return jsonResponse(500, { error: "down" });
                return jsonResponse(202, { status: "queued", session_id: "s1", poll: "/api/scrapes/s1" });
            };
            const result = await withFetch(mock, () =>
                createScrapeWithSafeRetry({ instruction: "x" }, { retry: { retries: 2, sleep: noSleep } }),
            );
            s.check(count === 2, "500 then success → retried once");
            s.check(result.session_id === "s1", "accepted run returned after retry");
        }
        {
            let count = 0;
            const mock = async () => {
                count += 1;
                return jsonResponse(400, { error: "bad" });
            };
            let error: SieveError | undefined;
            await withFetch(mock, async () => {
                try {
                    await createScrapeWithSafeRetry({ instruction: "x" }, { retry: { retries: 2, sleep: noSleep } });
                } catch (err) {
                    error = err as SieveError;
                }
            });
            s.check(count === 1, "400 is never retried");
            s.check(error?.code === "BAD_REQUEST", "400 maps to BAD_REQUEST");
        }

        s.section("GET retries 5xx with backoff");
        {
            let count = 0;
            const mock = async () => {
                count += 1;
                if (count < 3) return jsonResponse(503, { error: "down" });
                return jsonResponse(200, { session_id: "s1", status: "running", turns: 0 });
            };
            const run = await withFetch(mock, () =>
                getScrape("s1", { retry: { retries: 4, sleep: noSleep } }),
            );
            s.check(count === 3, "GET retried twice then succeeded");
            s.check(run.status === "running", "GET returns parsed run");
        }

        s.section("sendMessage 409 → TURN_IN_FLIGHT");
        {
            const mock = async () => jsonResponse(409, { error: "turn in flight" });
            let error: SieveError | undefined;
            await withFetch(mock, async () => {
                try {
                    await sendMessage("s1", { instruction: "more" });
                } catch (err) {
                    error = err as SieveError;
                }
            });
            s.check(error?.code === "TURN_IN_FLIGHT", "409 mapped to TURN_IN_FLIGHT");
            s.check(error?.safeToRetry === true, "409 is safe to resend");
        }

        s.section("fileUrl + parseRetryAfter");
        {
            const rel: SieveFile = { name: "a.csv", size: 1, ext: "csv", url: "/files/a.csv" };
            s.check(fileUrl(rel).startsWith("https://scrape.usesieve.com/"), "relative file URL prefixed with base");
            const abs: SieveFile = { name: "a.csv", size: 1, ext: "csv", url: "https://cdn.example.com/a.csv" };
            s.check(fileUrl(abs) === "https://cdn.example.com/a.csv", "absolute file URL preserved");
            s.check(parseRetryAfter("12") === 12, "Retry-After seconds parsed");
            s.check(parseRetryAfter(null) === undefined, "missing Retry-After → undefined");
        }
    } finally {
        if (originalKey === undefined) delete process.env.SIEVE_API_KEY;
        else process.env.SIEVE_API_KEY = originalKey;
    }

    return s.finish();
}
