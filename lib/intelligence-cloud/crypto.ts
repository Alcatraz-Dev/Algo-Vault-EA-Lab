/**
 * Intelligence Cloud — Cryptographic primitives (Phase 13)
 *
 * One place for every secret-handling primitive in the Intelligence Cloud so
 * that plaintext secrets are impossible to introduce accidentally:
 *
 *  - API key secrets are shown exactly once and only ever stored as a peppered
 *    HMAC-SHA256 digest.
 *  - Webhook payloads are signed with real HMAC-SHA256 over `${timestamp}.${body}`
 *    (the Stripe/GitHub convention), which binds the signature to the body AND
 *    to a timestamp so a captured delivery cannot be replayed indefinitely.
 *
 * All comparisons use `timingSafeEqual` to avoid leaking digest prefixes.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Public key identifier prefix. Carries no secret; safe to log and store in plaintext. */
const KEY_PREFIX = "av_live";
/** Number of random bytes in a generated secret (32 bytes = 256 bits). */
const SECRET_BYTES = 32;
/** Number of leading random bytes used for the public lookup prefix. */
const PREFIX_BYTES = 6;

/**
 * Domain separator for API-key digests, so a digest can never be replayed as
 * a webhook signature or any other HMAC this service produces.
 */
const API_KEY_DIGEST_INFO = "algovault/intelligence-cloud/api-key/v1";
/** Domain separator for webhook signatures. */
const WEBHOOK_SIGNATURE_INFO = "algovault/intelligence-cloud/webhook/v1";

/**
 * Pepper mixed into every API-key digest.
 *
 * Without it, a leaked RTDB dump could be brute-forced offline against the
 * small keyspace of a leaked-prefix lookup. Missing env var ⇒ keys are hashed
 * with an ephemeral random pepper (safe for dev, non-persistent across restarts).
 */
let cachedPepper: string | undefined;

export function apiKeyPepper(): string {
    if (cachedPepper) return cachedPepper;
    const fromEnv = process.env.ALGOVAULT_API_KEY_PEPPER;
    cachedPepper =
        fromEnv && fromEnv.length >= 16
            ? fromEnv
            : randomBytes(32).toString("hex");
    if (!fromEnv) {
        // Non-fatal in dev; loudly non-fatal risk in prod, so surface it once.
        console.warn(
            "[intelligence-cloud] ALGOVAULT_API_KEY_PEPPER is unset — using an ephemeral pepper. " +
                "API keys will not validate across restarts and digests are weaker. Set it in production."
        );
    }
    return cachedPepper;
}

/** Test seam: reset the memoised pepper. */
export function __resetPepperForTests(): void {
    cachedPepper = undefined;
}

export interface GeneratedApiKey {
    /** Returned to the user exactly once. Never persisted. */
    secret: string;
    /** Public identifier used to locate the key record without a full table scan. */
    lookupPrefix: string;
}

/**
 * Generate a new API key.
 *
 * Format: `av_live_<prefix>_<secret>` — the prefix segment is a random public
 * id that indexes the RTDB record, so verification is a single point read
 * instead of scanning every key (the previous implementation read the entire
 * `api_keys` node and compared plaintext).
 */
export function generateApiKey(): GeneratedApiKey {
    const prefix = randomBytes(PREFIX_BYTES).toString("hex"); // 12 hex chars
    const secret = randomBytes(SECRET_BYTES).toString("base64url");
    return { secret: `${KEY_PREFIX}_${prefix}_${secret}`, lookupPrefix: prefix };
}

/** `av_live_<12 hex prefix>_<secret>`. The secret is base64url and may itself contain `_`. */
const API_KEY_PATTERN = /^av_live_([0-9a-f]{12})_(.+)$/;

/**
 * Parse a presented bearer token into its lookup prefix.
 * Returns null for anything that is not a well-formed AlgoVault key, without
 * doing any hashing (cheap rejection before the database read).
 *
 * A regex is required rather than `split("_")`: the base64url secret alphabet
 * includes `_`, so a naive split yields more than four segments for a perfectly
 * valid key and would reject it.
 */
export function parseApiKeyPrefix(presented: string): { lookupPrefix: string } | null {
    if (!presented || typeof presented !== "string") return null;
    const match = API_KEY_PATTERN.exec(presented);
    if (!match) return null;
    const secret = match[2];
    if (secret.length < 20) return null;
    return { lookupPrefix: match[1] };
}

/**
 * Peppered digest of a full API key secret (including its prefix, so rotating
 * the prefix also invalidates the digest binding).
 */
export function hashApiKey(secret: string): string {
    return createHmac("sha256", apiKeyPepper())
        .update(`${API_KEY_DIGEST_INFO}:${secret}`)
        .digest("hex");
}

/** Constant-time digest comparison. */
export function safeEqualDigest(a: string, b: string): boolean {
    if (typeof a !== "string" || typeof b !== "string") return false;
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
}

/** Constant-time secret comparison, for webhook secrets held in plaintext. */
export function safeEqualSecret(a: string, b: string): boolean {
    return safeEqualDigest(a, b);
}

// ── Webhook signing ────────────────────────────────────────────────────────

/**
 * Signed payload string: `${timestamp}.${rawBody}`.
 *
 * Binding the timestamp into the signed material is what makes replay
 * detection possible — a verifier can reject a delivery whose timestamp is
 * outside the tolerance window, and an attacker cannot re-stamp a captured
 * body without the secret.
 */
export function webhookSignedPayload(timestamp: number, rawBody: string): string {
    return `${timestamp}.${rawBody}`;
}

/** Real HMAC-SHA256 signature over the signed payload. */
export function signWebhookPayload(
    rawBody: string,
    secret: string,
    timestamp: number
): string {
    return createHmac("sha256", secret)
        .update(`${WEBHOOK_SIGNATURE_INFO}:${webhookSignedPayload(timestamp, rawBody)}`)
        .digest("hex");
}

/** `sha256=<hex>` — the value sent in `X-AlgoVault-Signature`. */
export function buildWebhookSignatureHeader(
    rawBody: string,
    secret: string,
    timestamp: number
): string {
    return `sha256=${signWebhookPayload(rawBody, secret, timestamp)}`;
}

/**
 * Verify a received delivery.
 *
 * Guards, in order, so no oracle is exposed:
 *  1. timestamp present and parseable,
 *  2. timestamp inside the tolerance window (replay protection),
 *  3. signature well-formed,
 *  4. signature matches in constant time.
 *
 * The raw request body must be passed verbatim — re-serialising parsed JSON
 * changes byte order and breaks verification.
 */
export function verifyWebhookSignature(input: {
    rawBody: string;
    secret: string;
    signature: string | null | undefined;
    timestamp: string | number | null | undefined;
    toleranceMs?: number;
    now?: number;
}): { valid: boolean; reason?: "missing_timestamp" | "stale_timestamp" | "missing_signature" | "malformed_signature" | "signature_mismatch" } {
    const { rawBody, secret, signature, timestamp } = input;
    const toleranceMs = input.toleranceMs ?? 300_000;
    const now = input.now ?? Date.now();

    const ts = typeof timestamp === "string" ? Number(timestamp) : timestamp;
    if (ts == null || !Number.isFinite(ts)) return { valid: false, reason: "missing_timestamp" };
    // Reject both far-future and stale timestamps: a future stamp is how an
    // attacker tries to keep a captured delivery "fresh" indefinitely.
    if (Math.abs(now - ts) > toleranceMs) return { valid: false, reason: "stale_timestamp" };

    if (!signature) return { valid: false, reason: "missing_signature" };
    if (!signature.startsWith("sha256=")) return { valid: false, reason: "malformed_signature" };

    const expected = signWebhookPayload(rawBody, secret, ts);
    if (!safeEqualSecret(signature.slice("sha256=".length), expected)) {
        return { valid: false, reason: "signature_mismatch" };
    }
    return { valid: true };
}
