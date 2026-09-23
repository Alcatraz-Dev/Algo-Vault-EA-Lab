/**
 * Deterministic id generation for workflow entities.
 */

let counter = 0;

export function safeId(prefix: string): string {
    const rand = Math.random().toString(36).slice(2, 8);
    const ts = Date.now().toString(36);
    const n = (counter++ % 1000).toString().padStart(3, "0");
    return `${prefix}_${ts}_${rand}_${n}`;
}

/** Human-friendly run id suffix. */
export function shortId(): string {
    return Math.random().toString(36).slice(2, 8);
}