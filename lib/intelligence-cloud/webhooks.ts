/**
 * Intelligence Cloud — Webhook Platform (Phase 13)
 *
 * Outbound events only. Signatures are genuine HMAC-SHA256 over
 * `${timestamp}.${rawBody}` (see ./crypto), so a receiver can verify both
 * authenticity and freshness, and a captured delivery cannot be replayed
 * outside the tolerance window.
 *
 * This module is a *view over the existing event system*: it defines the
 * canonical event vocabulary and delivery mechanics. It does not produce
 * market events — the engines that already emit them do.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { CLOUD_ROOT } from "./api-keys";
import {
    buildWebhookSignatureHeader,
    generateApiKey,
    hashApiKey,
    safeEqualDigest,
} from "./crypto";
import { errors } from "./errors";
import { sanitizeSegment } from "./tenancy";

export const WEBHOOK_EVENTS = [
    "SETUP_CREATED",
    "SETUP_CONFIRMED",
    "SETUP_INVALIDATED",
    "ALERT_TRIGGERED",
    "RESEARCH_COMPLETED",
    "STRATEGY_STATUS_CHANGED",
    "STRATEGY_DEGRADED",
    "POSITION_CHANGED",
    "RISK_CHANGED",
    "CERTIFICATION_UPDATED",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export interface IntelligenceEvent<T = Record<string, unknown>> {
    eventId: string;
    eventType: WebhookEventType;
    /** ms epoch the event envelope was created. */
    timestamp: number;
    /** ms epoch of the market data the event describes — never the send time. */
    dataTimestamp: number;
    apiVersion: string;
    tenantId: string;
    payload: T;
}

export interface WebhookEndpoint {
    webhookId: string;
    tenantId: string;
    url: string;
    /** Only events this endpoint subscribed to. Empty ⇒ no deliveries. */
    events: WebhookEventType[];
    /** Peppered digest of the signing secret. Plaintext is shown once, then gone. */
    hashedSecret: string;
    /** Last 4 chars of the secret, for human identification in a portal UI. */
    secretHint?: string;
    status: "active" | "disabled";
    createdAt: number;
    createdBy: string;
    /** Optional per-endpoint rate cap on deliveries per hour. */
    maxDeliveriesPerHour?: number;
}

export type DeliveryStatus = "pending" | "delivered" | "failed" | "retrying" | "abandoned";

export interface WebhookDelivery {
    deliveryId: string;
    /** Stable per (event, endpoint) — lets the receiver deduplicate retries. */
    eventId: string;
    webhookId: string;
    tenantId: string;
    url: string;
    attempt: number;
    status: DeliveryStatus;
    createdAt: number;
    lastAttemptAt?: number;
    deliveredAt?: number;
    responseStatus?: number;
    responseBody?: string;
    error?: string;
    nextAttemptAt?: number;
}

// ── Endpoint management ─────────────────────────────────────────────────────

/**
 * Create an endpoint and return its signing secret exactly once.
 */
export async function createWebhookEndpoint(input: {
    tenantId: string;
    url: string;
    events: readonly string[];
    createdBy: string;
    maxDeliveriesPerHour?: number;
}): Promise<{ endpoint: Omit<WebhookEndpoint, "hashedSecret">; secret: string }> {
    const url = assertDeliverableUrl(input.url);
    const events = sanitiseEvents(input.events);
    if (events.length === 0) {
        throw errors.invalidRequest("At least one known event type is required.", [
            { field: "events", issue: "no recognised event types" },
        ]);
    }

    // Reuse the API key generator so secrets have identical strength and the
    // same parsing/entropy assumptions as the rest of the platform.
    const { secret, lookupPrefix } = generateApiKey();
    const webhookId = `wh_${lookupPrefix}`;
    const now = Date.now();

    const endpoint: WebhookEndpoint = {
        webhookId,
        tenantId: sanitizeSegment(input.tenantId),
        url,
        events,
        hashedSecret: hashApiKey(secret),
        secretHint: secret.slice(-4),
        status: "active",
        createdAt: now,
        createdBy: input.createdBy,
        maxDeliveriesPerHour: input.maxDeliveriesPerHour,
    };

    await adminDatabase
        .ref(`${CLOUD_ROOT}/webhooks/${sanitizeSegment(input.tenantId)}/${webhookId}`)
        .set(endpoint);

    const { hashedSecret: _h, ...safe } = endpoint;
    return { endpoint: safe, secret };
}

export function sanitiseEvents(events: readonly string[] | undefined | null): WebhookEventType[] {
    if (!Array.isArray(events)) return [];
    const unique = new Set<WebhookEventType>();
    for (const raw of events) {
        if (typeof raw !== "string") continue;
        const value = raw.trim().toUpperCase() as WebhookEventType;
        if ((WEBHOOK_EVENTS as readonly string[]).includes(value)) unique.add(value);
    }
    return Array.from(unique);
}

/**
 * Validate a subscriber URL.
 *
 * This is the SSRF boundary: an attacker who can register a webhook otherwise
 * turns AlgoVault into a proxy for `169.254.169.254` (cloud metadata), internal
 * admin hosts, or localhost services. Only https, and never a private,
 * loopback, link-local or otherwise internal address.
 */
export function assertDeliverableUrl(raw: string): string {
    let url: URL;
    try {
        url = new URL(String(raw));
    } catch {
        throw errors.invalidRequest("Webhook URL is not a valid URL.", [{ field: "url", issue: "malformed" }]);
    }
    if (url.protocol !== "https:") {
        throw errors.invalidRequest("Webhook URL must use https.", [
            { field: "url", issue: "protocol must be https" },
        ]);
    }
    const host = url.hostname.toLowerCase();
    if (isInternalHostname(host)) {
        throw errors.invalidRequest("Webhook URL must not target an internal host.", [
            { field: "url", issue: "internal or private address" },
        ]);
    }
    return url.toString();
}

export function isInternalHostname(hostname: string): boolean {
    const host = hostname.replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
        return true;
    }
    if (host === "::1" || host === "::") return true;
    // IPv4 private / loopback / link-local / CGNAT ranges.
    const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (v4) {
        const [a, b] = [Number(v4[1]), Number(v4[2])];
        if (a === 10 || a === 127 || a === 0) return true;
        if (a === 192 && b === 168) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 169 && b === 254) return true;
        if (a === 100 && b >= 64 && b <= 127) return true;
        if (a >= 224) return true; // multicast + reserved
    }
    return false;
}

// ── Delivery ────────────────────────────────────────────────────────────────

export const WEBHOOK_HEADERS = {
    event: "X-AlgoVault-Event",
    timestamp: "X-AlgoVault-Timestamp",
    signature: "X-AlgoVault-Signature",
    delivery: "X-AlgoVault-Delivery",
    /** Stable id so receivers can deduplicate redeliveries. */
    eventId: "X-AlgoVault-Event-Id",
    version: "X-AlgoVault-Version",
} as const;

export interface SignedDelivery {
    body: string;
    headers: Record<string, string>;
    deliveryId: string;
}

/**
 * Build the exact bytes and headers for one attempt.
 *
 * The body is serialised once and reused across retries so the signature stays
 * valid; the timestamp is regenerated per attempt, which is what makes replay
 * protection possible for the receiver.
 */
export function signDelivery(
    event: IntelligenceEvent,
    secret: string,
    deliveryId: string,
    apiVersion: string
): SignedDelivery {
    const body = JSON.stringify({
        eventId: event.eventId,
        eventType: event.eventType,
        timestamp: event.timestamp,
        dataTimestamp: event.dataTimestamp,
        apiVersion: event.apiVersion,
        tenantId: event.tenantId,
        payload: event.payload,
    });
    const sendAt = Date.now();
    return {
        body,
        deliveryId,
        headers: {
            "Content-Type": "application/json",
            [WEBHOOK_HEADERS.event]: event.eventType,
            [WEBHOOK_HEADERS.eventId]: event.eventId,
            [WEBHOOK_HEADERS.timestamp]: String(sendAt),
            [WEBHOOK_HEADERS.signature]: buildWebhookSignatureHeader(body, secret, sendAt),
            [WEBHOOK_HEADERS.delivery]: deliveryId,
            [WEBHOOK_HEADERS.version]: apiVersion,
        },
    };
}

/** Exponential backoff schedule, capped so a broken endpoint is not retried forever. */
export const RETRY_BACKOFF_MS = [0, 30_000, 120_000, 600_000, 1_800_000] as const;
export const MAX_DELIVERY_ATTEMPTS = RETRY_BACKOFF_MS.length;

export function nextAttemptDelayMs(attempt: number): number | null {
    if (attempt >= MAX_DELIVERY_ATTEMPTS) return null;
    return RETRY_BACKOFF_MS[attempt];
}

/**
 * Perform one delivery attempt and persist the outcome.
 *
 * `fetchImpl` is injectable so tests exercise retry/backoff/idempotency without
 * network access or a running server.
 */
export async function deliverWebhook(input: {
    endpoint: WebhookEndpoint;
    secret: string;
    event: IntelligenceEvent;
    attempt: number;
    apiVersion: string;
    fetchImpl?: typeof fetch;
}): Promise<WebhookDelivery> {
    const deliveryId = `dlv_${input.endpoint.webhookId}_${input.event.eventId}_${input.attempt}`;
    const signed = signDelivery(input.event, input.secret, deliveryId, input.apiVersion);
    const now = Date.now();
    const doFetch = input.fetchImpl ?? fetch;

    const delivery: WebhookDelivery = {
        deliveryId,
        eventId: input.event.eventId,
        webhookId: input.endpoint.webhookId,
        tenantId: input.endpoint.tenantId,
        url: input.endpoint.url,
        attempt: input.attempt,
        status: "pending",
        createdAt: now,
        lastAttemptAt: now,
    };

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        let response: Response;
        try {
            response = await doFetch(input.endpoint.url, {
                method: "POST",
                headers: signed.headers,
                body: signed.body,
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeout);
        }

        const ok = response.status >= 200 && response.status < 300;
        delivery.responseStatus = response.status;
        // Truncated: a subscriber echoing our whole payload back would bloat RTDB.
        delivery.responseBody = (await response.text().catch(() => "")).slice(0, 512);
        delivery.status = ok ? "delivered" : "failed";
        if (ok) delivery.deliveredAt = Date.now();
        else delivery.error = `HTTP ${response.status}`;
    } catch (error) {
        delivery.status = "failed";
        delivery.error = error instanceof Error ? error.message : "delivery failed";
    }

    const delay = delivery.status === "delivered" ? null : nextAttemptDelayMs(input.attempt);
    if (delivery.status === "delivered") {
        delivery.nextAttemptAt = undefined;
    } else if (delay === null || delay === 0) {
        delivery.status = delivery.status === "failed" && input.attempt + 1 >= MAX_DELIVERY_ATTEMPTS ? "abandoned" : "retrying";
        delivery.nextAttemptAt = delivery.status === "retrying" ? Date.now() + (delay ?? 0) : undefined;
    } else {
        delivery.status = "retrying";
        delivery.nextAttemptAt = Date.now() + delay;
    }

    await adminDatabase
        .ref(`${CLOUD_ROOT}/webhookDeliveries/${sanitizeSegment(input.endpoint.tenantId)}/${deliveryId}`)
        .set(delivery);

    return delivery;
}

/** Endpoints subscribed to an event, tenant-scoped. Never crosses tenants. */
export async function listEndpointsForEvent(
    tenantId: string,
    eventType: WebhookEventType
): Promise<WebhookEndpoint[]> {
    const snap = await adminDatabase.ref(`${CLOUD_ROOT}/webhooks/${sanitizeSegment(tenantId)}`).get();
    const out: WebhookEndpoint[] = [];
    snap.forEach((child) => {
        const endpoint = child.val() as WebhookEndpoint;
        if (endpoint?.status === "active" && endpoint.events.includes(eventType)) out.push(endpoint);
    });
    return out;
}

export async function getDeliveryHistory(
    tenantId: string,
    webhookId: string,
    limit = 50
): Promise<WebhookDelivery[]> {
    const snap = await adminDatabase
        .ref(`${CLOUD_ROOT}/webhookDeliveries/${sanitizeSegment(tenantId)}`)
        .orderByChild("webhookId")
        .equalTo(sanitizeSegment(webhookId))
        .limitToFirst(limit)
        .get();
    const out: WebhookDelivery[] = [];
    snap.forEach((child) => out.push(child.val() as WebhookDelivery));
    return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Test seam: constant-time compare re-export so sign/verify symmetry is obvious. */
export { safeEqualDigest };
