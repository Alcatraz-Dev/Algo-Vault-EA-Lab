// Sieve config — behavior unchanged when unconfigured.

import { createSuite } from "./harness";
import { loadSieveConfig, isSieveConfigured, SIEVE_DEFAULT_BASE_URL } from "../config";

export async function runConfigTests(): Promise<boolean> {
    const s = createSuite("sieve/config");
    const original = { ...process.env };

    try {
        s.section("Disabled by default");
        delete process.env.SIEVE_API_KEY;
        delete process.env.SIEVE_BASE_URL;
        const off = loadSieveConfig();
        s.check(off.enabled === false, "enabled=false when SIEVE_API_KEY is absent");
        s.check(isSieveConfigured(off) === false, "isSieveConfigured=false when unset");
        s.check(off.baseUrl === SIEVE_DEFAULT_BASE_URL, "default base URL is scrape.usesieve.com");

        s.section("Enabled when a key is present");
        process.env.SIEVE_API_KEY = "dc_sk_test_value";
        process.env.SIEVE_BASE_URL = "https://scrape.example.com/";
        const on = loadSieveConfig();
        s.check(on.enabled === true, "enabled=true with a key");
        s.check(isSieveConfigured(on) === true, "isSieveConfigured=true with a key");
        s.check(on.baseUrl === "https://scrape.example.com", "base URL trailing slash trimmed");

        s.section("Whitespace-only key stays disabled");
        process.env.SIEVE_API_KEY = "   ";
        s.check(isSieveConfigured(loadSieveConfig()) === false, "whitespace key is not a key");

        s.section("Poll interval clamping");
        process.env.SIEVE_API_KEY = "dc_sk_test_value";
        process.env.SIEVE_POLL_INITIAL_MS = "10";
        process.env.SIEVE_POLL_MAX_MS = "99999999";
        const clamped = loadSieveConfig();
        s.check(clamped.pollInitialMs === 1000, "poll initial clamped to >= 1000ms");
        s.check(clamped.pollMaxMs === 600000, "poll max clamped to <= 600000ms");

        delete process.env.SIEVE_POLL_INITIAL_MS;
        delete process.env.SIEVE_POLL_MAX_MS;
        const defaults = loadSieveConfig();
        s.check(defaults.pollInitialMs === 5000, "default initial poll 5s");
        s.check(defaults.pollMaxMs === 30000, "default max poll 30s");
    } finally {
        for (const key of Object.keys(process.env)) {
            if (!(key in original)) delete process.env[key];
        }
        Object.assign(process.env, original);
    }

    return s.finish();
}
