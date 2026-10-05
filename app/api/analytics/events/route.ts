import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { isProductEventType, isProductSurface, type ProductEventType, type ProductSurface } from "@/lib/product-analytics/events";
import { sanitizeProps } from "@/lib/product-analytics/privacy";
import { flushProductEvents, trackEvent } from "@/lib/product-analytics/store";

/**
 * Product Analytics — event ingestion.
 *
 * This is the ONLY public write path for product events. Guarantees:
 *
 *  - The uid ALWAYS comes from the verified Firebase ID token, never from the
 *    request body. A client cannot record events against another user.
 *  - Property bags go through `sanitizeProps`, so broker credentials, free text
 *    and personal data are dropped before anything is stored.
 *  - Writes are buffered and flushed off the request path, so instrumenting a
 *    trading screen never adds latency to the trading screen.
 *  - Per-session rate limiting bounds abuse without ever rejecting a legitimate
 *    burst of navigation events.
 */

const MAX_EVENTS_PER_REQUEST = 20;
const MAX_BODY_BYTES = 16 * 1024;
const RATE_LIMIT = 120; // events per session per minute
const RATE_WINDOW_MS = 60_000;

type RateEntry = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateEntry>();

function checkRateLimit(key: string): boolean {
    const now = Date.now();
    const entry = rateBuckets.get(key);
    if (!entry || entry.resetAt <= now) {
        rateBuckets.set(key, { count: 0, resetAt: now + RATE_WINDOW_MS });
        // Opportunistic cleanup so the map cannot grow without bound.
        if (rateBuckets.size > 5_000) {
            for (const [k, v] of rateBuckets) if (v.resetAt <= now) rateBuckets.delete(k);
        }
        return true;
    }
    entry.count += 1;
    return entry.count <= RATE_LIMIT;
}

async function resolveUid(request: NextRequest): Promise<{ uid: string | null; anonId: string | null }> {
    const header = request.headers.get("authorization") ?? "";
    const anonId = request.headers.get("x-anon-id");
    if (!header.startsWith("Bearer ")) {
        return { uid: null, anonId: anonId?.slice(0, 64) ?? null };
    }
    try {
        const decoded = await adminAuth.verifyIdToken(header.slice(7));
        return { uid: decoded.uid, anonId: null };
    } catch {
        // An invalid token is treated as anonymous rather than rejected, so a
        // stale session degrades to anonymous tracking instead of errors.
        return { uid: null, anonId: anonId?.slice(0, 64) ?? null };
    }
}

type IncomingEvent = {
    type?: unknown;
    surface?: unknown;
    props?: unknown;
    clientEventId?: unknown;
    occurredAt?: unknown;
};

export async function POST(request: NextRequest) {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_BODY_BYTES) {
        return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    let body: { events?: IncomingEvent[] };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const incoming = Array.isArray(body?.events) ? body.events : [];
    if (incoming.length === 0) {
        return NextResponse.json({ error: "No events supplied" }, { status: 400 });
    }
    if (incoming.length > MAX_EVENTS_PER_REQUEST) {
        return NextResponse.json({ error: `At most ${MAX_EVENTS_PER_REQUEST} events per request` }, { status: 400 });
    }

    const { uid, anonId } = await resolveUid(request);
    const rateKey = uid ?? anonId ?? "unknown";
    if (!checkRateLimit(rateKey)) {
        return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    const sessionId = request.headers.get("x-session-id")?.slice(0, 64) ?? null;
    const accepted: string[] = [];
    const rejected: { type: string; reason: string }[] = [];
    const droppedProps: string[] = [];

    for (const raw of incoming) {
        if (!isProductEventType(raw?.type)) {
            rejected.push({ type: String(raw?.type ?? ""), reason: "unknown event type" });
            continue;
        }
        const surface: ProductSurface = isProductSurface(raw?.surface) ? raw.surface : "other";
        const { props, dropped } = sanitizeProps(raw?.props);
        if (dropped.length > 0) droppedProps.push(...dropped);

        const occurredAt = Number(raw?.occurredAt);
        const clientEventId = typeof raw?.clientEventId === "string" ? raw.clientEventId.slice(0, 120) : undefined;

        const event = trackEvent({
            type: raw.type as ProductEventType,
            uid,
            anonId,
            sessionId,
            surface,
            props,
            clientEventId,
            occurredAt: Number.isFinite(occurredAt) ? occurredAt : undefined,
        });
        if (event) accepted.push(event.type);
    }

    // Fire-and-forget: the response does not wait on the database.
    void flushProductEvents();

    if (droppedProps.length > 0) {
        // Never echo the values back — only the key names, for debugging.
        console.warn("[analytics] dropped disallowed props:", [...new Set(droppedProps)].join(", "));
    }

    return NextResponse.json(
        { accepted: accepted.length, rejected },
        { status: 202, headers: { "Cache-Control": "no-store" } }
    );
}
