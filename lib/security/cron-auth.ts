/**
 * Shared cron authentication for scheduled-job HTTP endpoints.
 *
 * A request is a trusted cron call only when it presents the configured
 * secret. A User-Agent value is never proof of identity (anyone can send
 * `vercel-cron`), and secrets are never accepted in the query string (URLs
 * are logged by proxies and the platform).
 *
 * Accepted presentation, both verified against the configured secret:
 *   - `Authorization: Bearer <secret>`: Vercel Cron attaches this header
 *     automatically when `CRON_SECRET` is set in the project environment.
 *   - `x-cron-secret: <secret>`: for manual or operator invocations.
 *
 * Fail closed: an unset or blank secret never authorizes anything.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const CRON_SECRET_ENV = "CRON_SECRET";

/** Returns the configured secret, or null when unset or blank. */
export function getConfiguredCronSecret(envName: string = CRON_SECRET_ENV): string | null {
    const value = process.env[envName];
    return value && value.trim() !== "" ? value : null;
}

/**
 * Constant-time equality for secrets. Both sides are hashed first so the
 * comparison runs over fixed-length digests and does not leak length.
 * Returns false when either side is missing or empty.
 */
export function cronSecretsMatch(
    provided: string | null | undefined,
    expected: string | null | undefined
): boolean {
    if (!provided || !expected) return false;
    const a = createHash("sha256").update(provided, "utf8").digest();
    const b = createHash("sha256").update(expected, "utf8").digest();
    return timingSafeEqual(a, b);
}

/** Secrets presented by the caller in headers (never the query string). */
export function presentedCronSecrets(request: NextRequest): string[] {
    const candidates: string[] = [];
    const authorization = request.headers.get("authorization") ?? "";
    if (authorization.startsWith("Bearer ")) {
        const bearer = authorization.slice(7).trim();
        if (bearer) candidates.push(bearer);
    }
    const headerSecret = (request.headers.get("x-cron-secret") ?? "").trim();
    if (headerSecret) candidates.push(headerSecret);
    return candidates;
}

/**
 * True only when the request presents the configured cron secret.
 * `envName` lets a route keep its own dedicated secret variable.
 */
export function isCronRequest(request: NextRequest, envName: string = CRON_SECRET_ENV): boolean {
    const expected = getConfiguredCronSecret(envName);
    if (!expected) return false;
    return presentedCronSecrets(request).some((candidate) => cronSecretsMatch(candidate, expected));
}
