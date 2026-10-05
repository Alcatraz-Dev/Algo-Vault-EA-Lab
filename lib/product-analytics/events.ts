/**
 * Product Analytics — canonical product event model.
 *
 * This is the single event vocabulary for the whole product. It is
 * deliberately SMALL and MEANINGFUL: every event below corresponds to a step a
 * real trader takes toward value. We do not track clicks, scrolls, hovers or
 * anything else that inflates volume without informing a product decision.
 *
 * Privacy rules enforced here (see `sanitizeProps` in `privacy.ts`):
 *  - no broker credentials, no account numbers, no private positions,
 *  - no free-text user content,
 *  - no email / name / phone,
 *  - symbol + timeframe only as market context.
 *
 * Pure module: no I/O. Every function here is unit-testable without Firebase.
 */

export const PRODUCT_EVENT_TYPES = [
  // ── Acquisition & onboarding ────────────────────────────────────────────
  "USER_SIGNUP",
  "ONBOARDING_STARTED",
  "ONBOARDING_COMPLETED",
  "INTENT_SELECTED",

  // ── Market intelligence (first value) ──────────────────────────────────
  "CHART_OPENED",
  "SYMBOL_SELECTED",
  "TIMEFRAME_SELECTED",
  "INDICATOR_ADDED",
  "SMART_MONEY_VIEWED",
  "MARKET_INTELLIGENCE_VIEWED",
  "AI_ANALYSIS_STARTED",
  "AI_ANALYSIS_COMPLETED",

  // ── Strategy & research ────────────────────────────────────────────────
  "STRATEGY_CREATED",
  "STRATEGY_BACKTESTED",
  "RESEARCH_STARTED",
  "RESEARCH_COMPLETED",
  "ROBUSTNESS_RUN",

  // ── Trading workflow ───────────────────────────────────────────────────
  "SETUP_CREATED",
  "ALERT_CREATED",
  "PAPER_TRADE_STARTED",
  "TRADE_COMPLETED",
  "JOURNAL_REVIEWED",

  // ── Marketplace ────────────────────────────────────────────────────────
  "MARKETPLACE_VIEWED",
  "PRODUCT_VIEWED",
  "MARKETPLACE_PURCHASED",

  // ── Conversion ─────────────────────────────────────────────────────────
  "PRO_FEATURE_VIEWED",
  "PRO_UPGRADE_CLICKED",
  "CHECKOUT_STARTED",
  "SUBSCRIPTION_STARTED",
  "UPGRADE_INTENT_RECORDED",

  // ── Retention / discovery ──────────────────────────────────────────────
  "DIGEST_OPENED",
  "REFERRAL_SHARED",
  "REFERRAL_LANDED",
  "FEATURE_DISCOVERY_CLICKED",
  "REENGAGEMENT_CLICKED",

  // ── Cross-device continuity (Phase 11) ─────────────────────────────────
  // These measure ONE thing: does the product feel like a single environment?
  // They are deliberately coarse — a count of merges and deep-link opens, not a
  // trace of what the user did on which device.
  "MOBILE_SESSION_STARTED",
  "WORKSPACE_SYNCED",
  "WORKSPACE_CONFLICT_RESOLVED",
  "DEEP_LINK_OPENED",
  "NOTIFICATION_OPENED",
  "STALE_DATA_BLOCKED_ACTION",
  "LIVE_ORDER_BLOCKED",
] as const;

export type ProductEventType = (typeof PRODUCT_EVENT_TYPES)[number];

/** Guard so a typo can never silently create a new event type. */
export function isProductEventType(value: unknown): value is ProductEventType {
    return typeof value === "string" && (PRODUCT_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Product surfaces. Used for funnel steps and per-feature conversion
 * attribution. Kept coarse on purpose — we need to know WHICH workflow a user
 * moved through, not which button they pressed.
 */
export const PRODUCT_SURFACES = [
  "dashboard",
  "chart",
  "terminal",
  "market-intelligence",
  "smart-money",
  "strategy-lab",
  "strategy-research",
  "monte-carlo",
  "walk-forward",
  "alerts",
  "trade-journal",
  "paper-trading",
  "marketplace",
  "pricing",
  "onboarding",
  "settings",
  "mobile",
  "other",
] as const;

export type ProductSurface = (typeof PRODUCT_SURFACES)[number];

export function isProductSurface(value: unknown): value is ProductSurface {
    return typeof value === "string" && (PRODUCT_SURFACES as readonly string[]).includes(value);
}

/**
 * The strongest product value moments. These are the behaviours that mean a
 * user actually got something useful — not merely a page view.
 */
export const VALUE_MOMENTS = [
  "MARKET_INTELLIGENCE",
  "STRATEGY_DISCOVERY",
  "RESEARCH",
  "SETUP_INTELLIGENCE",
  "PAPER_TRADING",
  "JOURNAL",
] as const;

export type ValueMoment = (typeof VALUE_MOMENTS)[number];

/** Maps an event to the value moment it represents, if any. */
export const VALUE_MOMENT_EVENTS: Partial<Record<ProductEventType, ValueMoment>> = {
  AI_ANALYSIS_COMPLETED: "MARKET_INTELLIGENCE",
  MARKET_INTELLIGENCE_VIEWED: "MARKET_INTELLIGENCE",
  STRATEGY_CREATED: "STRATEGY_DISCOVERY",
  STRATEGY_BACKTESTED: "STRATEGY_DISCOVERY",
  RESEARCH_COMPLETED: "RESEARCH",
  ROBUSTNESS_RUN: "RESEARCH",
  SETUP_CREATED: "SETUP_INTELLIGENCE",
  PAPER_TRADE_STARTED: "SETUP_INTELLIGENCE",
  TRADE_COMPLETED: "PAPER_TRADING",
  JOURNAL_REVIEWED: "JOURNAL",
  // A user who picks up a notification and lands on the exact record it named has
  // received the core value of the product from a different device.
  DEEP_LINK_OPENED: "SETUP_INTELLIGENCE",
};

/** A single product event as it is stored. */
export type ProductEvent = {
    id: string;
    /** Stable server-side id. */
    eventId: string;
    type: ProductEventType;
    /** Authenticated user, or null for anonymous traffic. */
    uid: string | null;
    anonymous: boolean;
    /** Random per-browser id — never tied to a person. */
    anonId: string | null;
    sessionId: string | null;
    surface: ProductSurface;
    /** Sanitized, privacy-checked property bag. */
    props: Record<string, string | number | boolean | null>;
    /** Deduplication key supplied by the client. */
    clientEventId: string;
    occurredAt: number;
    receivedAt: number;
    /** Denormalized day bucket `YYYY-MM-DD` for cheap cohort queries. */
    day: string;
};

export type NewProductEvent = {
    type: ProductEventType;
    uid?: string | null;
    anonId?: string | null;
    sessionId?: string | null;
    surface?: ProductSurface;
    props?: Record<string, unknown>;
    clientEventId?: string;
    occurredAt?: number;
};

let sequence = 0;

/** Monotonic-ish id. Not a security token — only needs to be collision-free. */
export function newEventId(prefix = "pa"): string {
    sequence = (sequence + 1) % 1_000_000;
    return `${prefix}_${Date.now().toString(36)}_${sequence.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** `YYYY-MM-DD` in UTC. */
export function dayBucket(ts: number): string {
    return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Build a canonical event. Pure — the caller persists it.
 *
 * `clientEventId` is required for deduplication. When omitted we synthesize a
 * deterministic id from (uid|type|props|bucket) so that a double-fired effect
 * in the same second collapses to a single event.
 */
export function createProductEvent(input: NewProductEvent): ProductEvent {
    if (!isProductEventType(input.type)) {
        throw new Error(`Unknown product event type: ${String(input.type)}`);
    }
    const occurredAt = Number.isFinite(input.occurredAt) ? (input.occurredAt as number) : Date.now();
    const props = (input.props ?? {}) as Record<string, string | number | boolean | null>;
    const uid = input.uid ?? null;
    const clientEventId =
        input.clientEventId?.slice(0, 120) ??
        deterministicClientEventId(input.type, uid, props, occurredAt);

    return {
        id: "",
        eventId: newEventId(),
        type: input.type,
        uid,
        anonymous: !uid,
        anonId: uid ? null : (input.anonId ?? null),
        sessionId: input.sessionId ?? null,
        surface: input.surface ?? "other",
        props,
        clientEventId,
        occurredAt,
        receivedAt: Date.now(),
        day: dayBucket(occurredAt),
    };
}

/**
 * Deterministic dedup key. Two identical events within the same 5s window
 * collapse. This is what makes `useEffect` double-fires (React StrictMode)
 * harmless without every call site having to invent a key.
 */
export function deterministicClientEventId(
    type: string,
    uid: string | null,
    props: Record<string, unknown>,
    occurredAt: number
): string {
    const keyProps = Object.keys(props)
        .sort()
        .map((k) => `${k}=${String(props[k])}`)
        .join(",");
    const window5s = Math.floor(occurredAt / 5000);
    return `auto_${type}_${uid ?? "anon"}_${window5s}_${hash(keyProps)}`;
}

/** Small deterministic string hash (FNV-1a). */
export function hash(input: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}

/** The value moment (if any) an event represents. */
export function valueMomentFor(type: ProductEventType): ValueMoment | null {
    return VALUE_MOMENT_EVENTS[type] ?? null;
}
