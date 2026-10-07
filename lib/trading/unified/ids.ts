/**
 * Small crypto helper for client-side idempotency keys.
 *
 * Split from client.ts so the randomness source can be imported without
 * pulling the whole execution client (and its React-facing types) into a
 * server context.
 */

/** 6 random bytes as 12 lowercase hex characters (crypto-backed). */
export function randomBytes(byteCount: number): string {
    const bytes = new Uint8Array(byteCount);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
