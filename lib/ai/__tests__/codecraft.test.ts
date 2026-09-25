import { CodeCraftProvider } from "../providers/codecraft";
import { defaultRouter } from "../router";
import { AIConfig } from "../config";
import { AIProviderError } from "../types";
import { aiUsageTracker, AIProviderUsageMetric } from "../usage";
import { callAgentAI } from "@/lib/agents/ai-provider";
import { AgentContract } from "@/lib/agents/types";

export async function runCodeCraftTests(): Promise<boolean> {
    console.log("--- CodeCraft Provider Integration & QA Hardening Tests ---");
    let passed = true;
    const check = (cond: boolean, label: string) => {
        if (cond) {
            console.log(`  PASS: ${label}`);
        } else {
            console.error(`  FAIL: ${label}`);
            passed = false;
        }
    };

    // Backup original env
    const origKey = process.env.CODECRAFT_API_KEY;
    const origBaseUrl = process.env.CODECRAFT_BASE_URL;
    const origModel = process.env.CODECRAFT_MODEL;
    const originalFetch = global.fetch;

    try {
        // 1. Provider registration & resolution
        const provider = defaultRouter.getProvider("codecraft");
        check(Boolean(provider), "CodeCraft provider is registered in defaultRouter");
        check(provider?.id === "codecraft", "Provider ID is 'codecraft'");
        check(provider?.name === "CodeCraft API", "Provider name is 'CodeCraft API'");

        // 2. Availability when API key is missing vs present
        delete process.env.CODECRAFT_API_KEY;
        check(provider?.isAvailable() === false, "isAvailable() returns false when CODECRAFT_API_KEY is not set");

        process.env.CODECRAFT_API_KEY = "test_codecraft_api_key_secret_12345";
        check(provider?.isAvailable() === true, "isAvailable() returns true when CODECRAFT_API_KEY is configured");

        // 3. Base URL configuration
        check(
            AIConfig.codecraftBaseUrl === "https://www.codecraftapi.com/v1",
            "Default Base URL is https://www.codecraftapi.com/v1"
        );

        process.env.CODECRAFT_BASE_URL = "https://custom.codecraftapi.com/v1/";
        check(
            AIConfig.codecraftBaseUrl === "https://custom.codecraftapi.com/v1",
            "Base URL trims trailing slash correctly"
        );
        delete process.env.CODECRAFT_BASE_URL;

        // 4. API Key server-side audit
        check(!("NEXT_PUBLIC_CODECRAFT_API_KEY" in process.env), "CODECRAFT_API_KEY is server-side only");

        // 5. Provider Usage Telemetry Hook Integration
        {
            let recordedMetric: AIProviderUsageMetric | null = null;
            const unsubscribe = aiUsageTracker.subscribe((metric) => {
                if (metric.provider === "codecraft") {
                    recordedMetric = metric;
                }
            });

            global.fetch = async () => {
                return new Response(
                    JSON.stringify({
                        id: "chatcmpl-test-usage",
                        choices: [{ message: { role: "assistant", content: "Usage test response" } }],
                        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
                    }),
                    { status: 200, headers: { "Content-Type": "application/json" } }
                );
            };

            const instance = new CodeCraftProvider();
            await instance.chat({ messages: [{ role: "user", content: "test telemetry" }] });

            check(recordedMetric !== null, "aiUsageTracker receives usage events from CodeCraft");
            check((recordedMetric as unknown as AIProviderUsageMetric)?.provider === "codecraft", "Usage metric provider is 'codecraft'");
            check((recordedMetric as unknown as AIProviderUsageMetric)?.totalTokens === 15, "Usage metric totalTokens matches API payload");

            unsubscribe();
        }

        // 6. AIRouter Fallback Matrix Testing (A-I)
        // Scenario A: CodeCraft succeeds
        {
            global.fetch = async () => {
                return new Response(
                    JSON.stringify({
                        choices: [{ message: { role: "assistant", content: "Scenario A: Success" } }],
                    }),
                    { status: 200 }
                );
            };

            const res = await defaultRouter.chat({
                provider: "codecraft",
                messages: [{ role: "user", content: "ping" }],
            });

            check(res.success === true, "Scenario A: Router succeeds when CodeCraft returns 200");
            check(res.provider === "codecraft", "Scenario A: Router returns provider 'codecraft'");
            check(res.content === "Scenario A: Success", "Scenario A: Router returns CodeCraft content");
        }

        // Scenario B: CodeCraft returns 401 -> Fallback to next provider
        {
            global.fetch = async (input) => {
                const url = String(input);
                if (url.includes("codecraft")) {
                    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
                }
                // Fallback mock
                return new Response(
                    JSON.stringify({
                        choices: [{ message: { role: "assistant", content: "Fallback from 401" } }],
                    }),
                    { status: 200 }
                );
            };

            const res = await defaultRouter.chat({
                provider: "codecraft",
                messages: [{ role: "user", content: "ping" }],
            });

            check(res.provider !== "codecraft", "Scenario B: 401 triggers fallback to next available provider");
            check(res.fallbackErrors?.some((e) => e.provider === "codecraft" && e.code === "INVALID_API_KEY") === true, "Scenario B: 401 records INVALID_API_KEY error code");
        }

        // Scenario C: CodeCraft returns 402 -> Fallback
        {
            global.fetch = async (input) => {
                const url = String(input);
                if (url.includes("codecraft")) {
                    return new Response(JSON.stringify({ error: "Payment required" }), { status: 402 });
                }
                return new Response(
                    JSON.stringify({
                        choices: [{ message: { role: "assistant", content: "Fallback from 402" } }],
                    }),
                    { status: 200 }
                );
            };

            const res = await defaultRouter.chat({
                provider: "codecraft",
                messages: [{ role: "user", content: "ping" }],
            });

            check(res.provider !== "codecraft", "Scenario C: 402 triggers fallback to next available provider");
            check(res.fallbackErrors?.some((e) => e.provider === "codecraft" && e.code === "QUOTA_EXCEEDED") === true, "Scenario C: 402 records QUOTA_EXCEEDED error code");
        }

        // Scenario D: CodeCraft returns 429 -> Fallback
        {
            global.fetch = async (input) => {
                const url = String(input);
                if (url.includes("codecraft")) {
                    return new Response(JSON.stringify({ error: "Rate limit" }), { status: 429 });
                }
                return new Response(
                    JSON.stringify({
                        choices: [{ message: { role: "assistant", content: "Fallback from 429" } }],
                    }),
                    { status: 200 }
                );
            };

            const res = await defaultRouter.chat({
                provider: "codecraft",
                messages: [{ role: "user", content: "ping" }],
            });

            check(res.provider !== "codecraft", "Scenario D: 429 triggers fallback to next available provider");
            check(res.fallbackErrors?.some((e) => e.provider === "codecraft" && e.code === "RATE_LIMITED") === true, "Scenario D: 429 records RATE_LIMITED error code");
        }

        // Scenario E: CodeCraft returns 404 -> Fallback
        {
            global.fetch = async (input) => {
                const url = String(input);
                if (url.includes("codecraft")) {
                    return new Response(JSON.stringify({ error: "Model not found" }), { status: 404 });
                }
                return new Response(
                    JSON.stringify({
                        choices: [{ message: { role: "assistant", content: "Fallback from 404" } }],
                    }),
                    { status: 200 }
                );
            };

            const res = await defaultRouter.chat({
                provider: "codecraft",
                messages: [{ role: "user", content: "ping" }],
            });

            check(res.provider !== "codecraft", "Scenario E: 404 triggers fallback to next available provider");
            check(res.fallbackErrors?.some((e) => e.provider === "codecraft" && e.code === "MODEL_UNAVAILABLE") === true, "Scenario E: 404 records MODEL_UNAVAILABLE error code");
        }

        // Scenario F: CodeCraft times out (408 or AbortController)
        {
            global.fetch = async (input) => {
                const url = String(input);
                if (url.includes("codecraft")) {
                    return new Response(JSON.stringify({ error: "Request timeout" }), { status: 408 });
                }
                return new Response(
                    JSON.stringify({
                        choices: [{ message: { role: "assistant", content: "Fallback from 408" } }],
                    }),
                    { status: 200 }
                );
            };

            const res = await defaultRouter.chat({
                provider: "codecraft",
                messages: [{ role: "user", content: "ping" }],
            });

            check(res.provider !== "codecraft", "Scenario F: Timeout triggers fallback to next available provider");
            check(res.fallbackErrors?.some((e) => e.provider === "codecraft" && e.code === "TIMEOUT") === true, "Scenario F: Timeout records TIMEOUT error code");
        }

        // Scenario G: CodeCraft network connection fails
        {
            global.fetch = async (input) => {
                const url = String(input);
                if (url.includes("codecraft")) {
                    throw new TypeError("Failed to fetch (NetworkError)");
                }
                return new Response(
                    JSON.stringify({
                        choices: [{ message: { role: "assistant", content: "Fallback from network error" } }],
                    }),
                    { status: 200 }
                );
            };

            const res = await defaultRouter.chat({
                provider: "codecraft",
                messages: [{ role: "user", content: "ping" }],
            });

            check(res.provider !== "codecraft", "Scenario G: Network failure triggers fallback to next available provider");
            check(res.fallbackErrors?.some((e) => e.provider === "codecraft") === true, "Scenario G: Network error captured in fallback errors");
        }

        // Scenario H: CodeCraft returns malformed JSON
        {
            global.fetch = async (input) => {
                const url = String(input);
                if (url.includes("codecraft")) {
                    return new Response("<html>Gateway Bad Response</html>", { status: 200, headers: { "Content-Type": "text/html" } });
                }
                return new Response(
                    JSON.stringify({
                        choices: [{ message: { role: "assistant", content: "Fallback from malformed JSON" } }],
                    }),
                    { status: 200 }
                );
            };

            const res = await defaultRouter.chat({
                provider: "codecraft",
                messages: [{ role: "user", content: "ping" }],
            });

            check(res.provider !== "codecraft", "Scenario H: Malformed JSON triggers fallback to next available provider");
            check(res.fallbackErrors?.some((e) => e.provider === "codecraft") === true, "Scenario H: Malformed JSON error captured");
        }

        // Scenario I: CodeCraft returns an empty response content
        {
            global.fetch = async (input) => {
                const url = String(input);
                if (url.includes("codecraft")) {
                    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "   " } }] }), { status: 200 });
                }
                return new Response(
                    JSON.stringify({
                        choices: [{ message: { role: "assistant", content: "Fallback from empty response" } }],
                    }),
                    { status: 200 }
                );
            };

            const res = await defaultRouter.chat({
                provider: "codecraft",
                messages: [{ role: "user", content: "ping" }],
            });

            check(res.provider !== "codecraft", "Scenario I: Empty response triggers fallback to next available provider");
            check(res.fallbackErrors?.some((e) => e.provider === "codecraft" && e.code === "UNKNOWN_ERROR") === true, "Scenario I: Empty response error captured");
        }

        // 7. Error Sanitization & Secret Redaction Audit
        {
            const secretVal = "CODECRAFT_SECRET_TEST_VALUE_998877";
            process.env.CODECRAFT_API_KEY = secretVal;

            global.fetch = async () => {
                return new Response(`Error: Unauthorized request using Bearer ${secretVal}`, { status: 500 });
            };

            const instance = new CodeCraftProvider();
            let thrownMessage = "";
            try {
                await instance.chat({ messages: [{ role: "user", content: "test error leak" }] });
            } catch (err: unknown) {
                thrownMessage = String((err as { message?: string }).message || "");
            }

            check(!thrownMessage.includes(secretVal), "Upstream error response containing secret API key is redacted from thrown error");
            check(thrownMessage.includes("[REDACTED]"), "Redacted placeholder is inserted in error message");

            process.env.CODECRAFT_API_KEY = "test_codecraft_api_key_secret_12345";
        }

        // 8. Model Configuration Verification
        {
            process.env.CODECRAFT_MODEL = "codecraft-custom-default";
            let sentModel = "";

            global.fetch = async (input, init) => {
                const body = JSON.parse(String(init?.body || "{}")) as { model?: string };
                sentModel = body.model || "";
                return new Response(
                    JSON.stringify({ choices: [{ message: { role: "assistant", content: "Model test OK" } }] }),
                    { status: 200 }
                );
            };

            const instance = new CodeCraftProvider();
            
            // Test 1: Configured default model is used when request.model is omitted
            await instance.chat({ messages: [{ role: "user", content: "model test" }] });
            check(sentModel === "codecraft-custom-default", "CODECRAFT_MODEL environment variable is respected by default");

            // Test 2: Explicit request.model overrides configured default
            await instance.chat({ model: "codecraft-default", messages: [{ role: "user", content: "model test" }] });
            check(sentModel === "codecraft-default", "Explicit request.model overrides configured default model");

            delete process.env.CODECRAFT_MODEL;
        }

        // 9. Multi-agent integration verification
        {
            global.fetch = async () => {
                return new Response(
                    JSON.stringify({
                        choices: [{ message: { role: "assistant", content: `{"summary": "Agent CodeCraft output"}` } }],
                    }),
                    { status: 200 }
                );
            };

            const agentContract: AgentContract = {
                id: "test-codecraft-agent",
                name: "CodeCraft Agent",
                version: "1.0.0",
                role: "context",
                description: "Test agent targeting codecraft",
                capabilities: ["market_data"],
                requiredPermissions: ["market_data"],
                inputSchema: {},
                outputSchema: {},
                systemInstructions: "You are an agent.",
                tools: [],
                modelConfiguration: {
                    poweredBy: "hybrid",
                    provider: "codecraft",
                    model: "codecraft-default",
                    responseFormat: "json_object",
                },
                timeoutMs: 5000,
                retryPolicy: { maxRetries: 0, backoffMs: 100 },
                validationRules: {},
                status: "active",
            };

            const agentRes = await callAgentAI(agentContract, "Run analysis", "System prompt");
            check(agentRes.ok === true, "Multi-agent callAgentAI returns ok");
            check(agentRes.provider === "codecraft", "modelConfiguration.provider = 'codecraft' correctly reaches CodeCraft");
            check(agentRes.text.includes("Agent CodeCraft output"), "Multi-agent output content received from CodeCraft");
        }

        // 10. Concurrency Testing
        {
            let activeRequests = 0;
            let maxConcurrent = 0;

            global.fetch = async (input, init) => {
                activeRequests++;
                maxConcurrent = Math.max(maxConcurrent, activeRequests);
                await new Promise((resolve) => setTimeout(resolve, 50));
                const body = JSON.parse(String(init?.body || "{}")) as { messages?: Array<{ content?: string }> };
                const reqText = body.messages?.[0]?.content || "";
                activeRequests--;
                return new Response(
                    JSON.stringify({
                        choices: [{ message: { role: "assistant", content: `Echo: ${reqText}` } }],
                    }),
                    { status: 200 }
                );
            };

            const instance = new CodeCraftProvider();
            const promises = Array.from({ length: 10 }, (_, i) =>
                instance.chat({ messages: [{ role: "user", content: `Concurrent req ${i}` }] })
            );

            const results = await Promise.all(promises);
            check(maxConcurrent > 1, "Concurrent requests execute in parallel");
            check(results.length === 10, "All 10 concurrent requests completed successfully");
            check(
                results.every((res, i) => res.content === `Echo: Concurrent req ${i}`),
                "No cross-request data corruption or key collision under concurrent load"
            );
        }

        // Restore global fetch
        global.fetch = originalFetch;

    } catch (err) {
        console.error("Test execution failed with error:", err);
        passed = false;
    } finally {
        // Restore env
        if (origKey !== undefined) process.env.CODECRAFT_API_KEY = origKey;
        else delete process.env.CODECRAFT_API_KEY;

        if (origBaseUrl !== undefined) process.env.CODECRAFT_BASE_URL = origBaseUrl;
        else delete process.env.CODECRAFT_BASE_URL;

        if (origModel !== undefined) process.env.CODECRAFT_MODEL = origModel;
        else delete process.env.CODECRAFT_MODEL;

        global.fetch = originalFetch;
    }

    console.log("--- CodeCraft Integration & QA Hardening Tests Complete ---");
    return passed;
}
