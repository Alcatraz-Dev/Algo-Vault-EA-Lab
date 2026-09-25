// Provider usage tracking interface & telemetry hook
// Tracks token usage, latency, provider, model, status, and error categories
// without persisting prompts or API keys.

export interface AIProviderUsageMetric {
    provider: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    latencyMs: number;
    status: number | "success" | "error";
    errorCategory?: string;
    timestamp: number;
}

export type AIUsageListener = (metric: AIProviderUsageMetric) => void;

class AIUsageTracker {
    private listeners: Set<AIUsageListener> = new Set();

    subscribe(listener: AIUsageListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    recordUsage(metric: AIProviderUsageMetric): void {
        const inTok = metric.inputTokens ?? "n/a";
        const outTok = metric.outputTokens ?? "n/a";
        const totTok = metric.totalTokens ?? "n/a";
        const errCat = metric.errorCategory ? ` errorCategory=${metric.errorCategory}` : "";

        console.log(
            `[AI Usage] provider=${metric.provider} model=${metric.model} status=${metric.status} latencyMs=${metric.latencyMs} inTokens=${inTok} outTokens=${outTok} totalTokens=${totTok}${errCat}`
        );

        for (const listener of Array.from(this.listeners)) {
            try {
                listener(metric);
            } catch (err) {
                console.error("[AI Usage] Telemetry listener error:", err);
            }
        }
    }
}

export const aiUsageTracker = new AIUsageTracker();
