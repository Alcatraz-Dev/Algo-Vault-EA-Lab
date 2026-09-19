// Global AI Gateway Configuration

export const AIConfig = {
    get freeOnly(): boolean {
        return process.env.AI_FREE_ONLY !== "false";
    },

    get defaultProvider(): string {
        return process.env.AI_DEFAULT_PROVIDER || "gemini";
    },

    get defaultModel(): string {
        return process.env.AI_DEFAULT_MODEL || "gemini-1.5-flash";
    },

    get maxAttempts(): number {
        const parsed = parseInt(process.env.AI_MAX_PROVIDER_ATTEMPTS || "3", 10);
        return isNaN(parsed) || parsed < 1 ? 3 : parsed;
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

    // OpenCode
    get opencodeApiKey(): string {
        return process.env.OPENCODE_API_KEY || "";
    },
    get opencodeBaseUrl(): string {
        return (process.env.OPENCODE_BASE_URL || "https://opencode.ai/api/v1").replace(/\/$/, "");
    },

    // B.AI
    get baiApiKey(): string {
        return process.env.BAI_API_KEY || "";
    },
    get baiBaseUrl(): string {
        return (process.env.BAI_BASE_URL || "https://api.b.ai/v1").replace(/\/$/, "");
    },
};
