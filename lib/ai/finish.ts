/**
 * Shared helpers for extracting OpenAI-compatible finish reasons from
 * provider responses. finish_reason === "length" means the model hit its
 * output token limit and the response is a partial one — clients must not
 * display it as complete.
 */

type OpenAICompatRaw =
    | { choices?: Array<{ finish_reason?: string | null; message?: { content?: string } }> }
    | Record<string, unknown>;

export function extractFinishReason(raw: unknown): string | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const data = raw as OpenAICompatRaw;
    const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
    if (!choice || typeof choice !== "object") return undefined;
    const reason = choice.finish_reason;
    return typeof reason === "string" && reason.length > 0 ? reason : undefined;
}

export function isTruncated(raw: unknown): boolean {
    return extractFinishReason(raw) === "length";
}