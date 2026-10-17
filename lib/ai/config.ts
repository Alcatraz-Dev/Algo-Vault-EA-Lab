// Global AI Gateway Configuration

export const AIConfig = {
    get freeOnly(): boolean {
        return process.env.AI_FREE_ONLY !== "false";
    },

    get defaultProvider(): string {
        return process.env.AI_DEFAULT_PROVIDER || "gemini";
    },

    get defaultModel(): string {
        return process.env.AI_DEFAULT_MODEL || "gemini-2.5-flash";
    },

    get maxAttempts(): number {
        const parsed = parseInt(process.env.AI_MAX_PROVIDER_ATTEMPTS || "4", 10);
        return isNaN(parsed) || parsed < 1 ? 4 : parsed;
    },

    get timeoutMs(): number {
        const parsed = parseInt(process.env.AI_REQUEST_TIMEOUT_MS || "30000", 10);
        return isNaN(parsed) || parsed < 1000 ? 30000 : parsed;
    },

    // Gemini
    get geminiApiKey(): string {
        return process.env.GEMINI_API_KEY || "";
    },

    // OpenAI
    get openaiApiKey(): string {
        return process.env.OPENAI_API_KEY || "";
    },

    // OpenRouter
    get openrouterApiKey(): string {
        return process.env.OPENROUTER_API_KEY || "";
    },
    get openrouterBaseUrl(): string {
        return (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
    },
    /**
     * How long the public OpenRouter model catalog is cached. The catalog is
     * public metadata; caching it keeps model discovery off the completion
     * path and avoids hammering the API. Default 5 minutes.
     */
    get openrouterCatalogTtlMs(): number {
        const parsed = parseInt(process.env.OPENROUTER_CATALOG_TTL_MS || "300000", 10);
        return Number.isFinite(parsed) && parsed >= 30_000 ? parsed : 300_000;
    },
    /** Short back-off after a failed catalog read, so an outage is not retried per request. */
    get openrouterCatalogFailureTtlMs(): number {
        const parsed = parseInt(process.env.OPENROUTER_CATALOG_FAILURE_TTL_MS || "30000", 10);
        return Number.isFinite(parsed) && parsed >= 1_000 ? parsed : 30_000;
    },
    /**
     * Hard ceiling on using the last good OpenRouter catalog during an outage.
     * Beyond this age the catalog is treated as unavailable and inference is
     * refused rather than trusting an unbounded stale free list. Default 30
     * minutes; 1 minute minimum, 24 hours maximum.
     */
    get openrouterCatalogMaxStaleMs(): number {
        const parsed = parseInt(process.env.OPENROUTER_CATALOG_MAX_STALE_MS || "1800000", 10);
        if (!Number.isFinite(parsed) || parsed < 60_000) return 1_800_000;
        return Math.min(parsed, 86_400_000);
    },

    // ── AI chat endpoint access control ────────────────────────────────────
    /**
     * Explicit cross-origin allowlist for POST /api/ai/chat. Same-origin and
     * chrome-extension origins are handled in code; this is for custom web
     * deployments. Never a wildcard.
     */
    get chatAllowedOrigins(): string[] {
        return (process.env.AI_CHAT_ALLOWED_ORIGINS || "")
            .split(",")
            .map((value) => value.trim())
            .filter((value) => value.length > 0);
    },
    /** Authenticated chat requests allowed per user per minute. */
    get chatRateLimitPerMinute(): number {
        const parsed = parseInt(process.env.AI_CHAT_RATE_LIMIT_PER_MINUTE || "20", 10);
        if (!Number.isFinite(parsed) || parsed < 1) return 20;
        return Math.min(parsed, 600);
    },

    // Ollama (local inference). Off by default; the desktop shell sets
    // ALGOVAULT_LOCAL_AI=1 for its embedded loopback server. A self-hosted
    // server may opt in with OLLAMA_ENABLED=true.
    get localAIEnabled(): boolean {
        return (
            process.env.ALGOVAULT_LOCAL_AI === "1" ||
            process.env.OLLAMA_ENABLED === "true"
        );
    },
    get ollamaBaseUrl(): string {
        return (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
    },
    /** Optional default. Explicit model selection is preferred; this is only a fallback. */
    get ollamaModel(): string {
        return process.env.OLLAMA_MODEL || "";
    },
    get ollamaTimeoutMs(): number {
        const parsed = parseInt(process.env.OLLAMA_TIMEOUT_MS || "120000", 10);
        if (!Number.isFinite(parsed) || parsed < 5_000) return 120_000;
        return Math.min(parsed, 600_000);
    },
    get ollamaProbeTimeoutMs(): number {
        const parsed = parseInt(process.env.OLLAMA_PROBE_TIMEOUT_MS || "3000", 10);
        return Number.isFinite(parsed) && parsed >= 500 ? Math.min(parsed, 30_000) : 3_000;
    },
    get ollamaCatalogTtlMs(): number {
        const parsed = parseInt(process.env.OLLAMA_CATALOG_TTL_MS || "300000", 10);
        return Number.isFinite(parsed) && parsed >= 5_000 ? parsed : 300_000;
    },

    // OpenCode Zen (https://opencode.ai/zen — OpenAI-compatible free models)
    get opencodeApiKey(): string {
        return process.env.OPENCODE_API_KEY || "";
    },
    get opencodeBaseUrl(): string {
        return (process.env.OPENCODE_BASE_URL || "https://opencode.ai/zen/v1").replace(/\/$/, "");
    },
    /**
     * How long OpenCode's model catalog (the source of pricing verification) is
     * cached. Keeps verification off the per-request path. Default 5 minutes.
     */
    get opencodeCatalogTtlMs(): number {
        const parsed = parseInt(process.env.OPENCODE_CATALOG_TTL_MS || "300000", 10);
        return Number.isFinite(parsed) && parsed >= 30_000 ? parsed : 300_000;
    },
    /** Short back-off after a failed catalog read. */
    get opencodeCatalogFailureTtlMs(): number {
        const parsed = parseInt(process.env.OPENCODE_CATALOG_FAILURE_TTL_MS || "30000", 10);
        return Number.isFinite(parsed) && parsed >= 1_000 ? parsed : 30_000;
    },
    /**
     * Hard ceiling on using the last good OpenCode catalog during an outage,
     * after which the reviewed static registry is used instead. Default 30
     * minutes.
     */
    get opencodeCatalogMaxStaleMs(): number {
        const parsed = parseInt(process.env.OPENCODE_CATALOG_MAX_STALE_MS || "1800000", 10);
        if (!Number.isFinite(parsed) || parsed < 60_000) return 1_800_000;
        return Math.min(parsed, 86_400_000);
    },

    // B.AI
    get baiApiKey(): string {
        return process.env.BAI_API_KEY || "";
    },
    get baiModel(): string {
        return process.env.BAI_MODEL || "";
    },
    get baiBaseUrl(): string {
        return (process.env.BAI_BASE_URL || "https://api.b.ai/v1").replace(/\/$/, "");
    },

    // Bytez (https://api.bytez.com — credit-based models; free-eligible models
    // are only those whose `meter` ends in `-free`). Auth is the raw key, no
    // "Bearer" prefix. Server-side only.
    get bytezApiKey(): string {
        return process.env.BYTEZ_API_KEY || "";
    },

    // CodeCraft API (https://www.codecraftapi.com/v1 — OpenAI compatible)
    get codecraftApiKey(): string {
        return process.env.CODECRAFT_API_KEY || "";
    },
    get codecraftBaseUrl(): string {
        return (process.env.CODECRAFT_BASE_URL || "https://www.codecraftapi.com/v1").replace(/\/$/, "");
    },
    /**
     * Operator-selected CodeCraft model, sent verbatim. Empty by default on
     * purpose: the live /models catalog does NOT contain a "codecraft-default",
     * and fabricating one would produce a silent 404. With no value the
     * provider resolves a real catalog model, or fails with a configuration
     * error — it never invents a model id.
     */
    get codecraftModel(): string {
        return process.env.CODECRAFT_MODEL || "";
    },
    /**
     * CodeCraft bills per token — a live /models check returned non-zero
     * pricing for all 33 catalog models — so the global AI_FREE_ONLY guard
     * rejects every one of them. This is a PER-PROVIDER opt-in: when it is
     * "true" only CodeCraft may use its metered models. AI_FREE_ONLY itself is
     * never modified, so every other provider keeps its existing protection.
     * Defaults to off (safe).
     */
    get codecraftAllowMetered(): boolean {
        return process.env.CODECRAFT_ALLOW_METERED === "true";
    },
};
