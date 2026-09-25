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

    // OpenCode Zen (https://opencode.ai/zen — OpenAI-compatible free models)
    get opencodeApiKey(): string {
        return process.env.OPENCODE_API_KEY || "";
    },
    get opencodeBaseUrl(): string {
        return (process.env.OPENCODE_BASE_URL || "https://opencode.ai/zen/v1").replace(/\/$/, "");
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
