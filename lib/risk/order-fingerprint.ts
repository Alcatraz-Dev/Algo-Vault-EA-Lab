/**
 * AlgoVault — order fingerprints, typed confirmation and the execution
 * authorization record.
 *
 * Three gaps this closes for the non-gate execution paths:
 *
 *   1. ORDER IDENTITY — two submissions of the same economic order (different
 *      client request ids) must be recognisable as the same order. The
 *      fingerprint is a canonical, deterministic string + digest over the
 *      fields that define the order, scoped by tenant AND account so one
 *      tenant's order can never suppress another's.
 *
 *   2. TYPED CONFIRMATION — "click OK" is not confirmation. The required phrase
 *      is derived from the order itself ("BUY 0.50 XAUUSD"), so a stale or
 *      generic confirmation cannot authorize a different order.
 *
 *   3. AUTHORIZATION RECORD — one place that composes policy (evaluatePolicy),
 *      the Risk Engine decision and duplicate prevention into an auditable
 *      allow/deny. No AI, no hidden defaults; missing scope or policy state
 *      denies.
 *
 * Pure and dependency-free (apart from the canonical hash helper), so it is
 * usable from server routes, the agent policy layer and tests alike.
 */

import { roundTo, stableHash } from "@/lib/quant/canonical";

export type FingerprintSide = "BUY" | "SELL";
export type FingerprintKind = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";

export interface FingerprintableOrder {
    symbol: string;
    side: FingerprintSide;
    kind: FingerprintKind;
    volume: number;
    price?: number | null;
    stopLoss?: number | null;
    takeProfit?: number | null;
}

export interface OrderIdentity {
    scope: string;
    /** Human-readable canonical string (stored with the digest for audit). */
    canonical: string;
    fingerprint: string;
}

/** Tenant + account scope. Empty components are rejected — never merged. */
export function fingerprintScope(tenantId: string, accountId: string): string {
    const tenant = String(tenantId ?? "").trim();
    const account = String(accountId ?? "").trim();
    if (!tenant || !account) {
        throw new Error("Order fingerprints require both a tenant id and an account id.");
    }
    return `${tenant}:${account}`;
}

/**
 * Canonical order identity.
 *
 * Precision is fixed so trivially different float representations of the same
 * order (1.0800000001 vs 1.08) fingerprint identically: volume 6dp, prices 5dp.
 * MARKET orders ignore price (there is no reference price until fill).
 */
export function computeOrderIdentity(tenantId: string, accountId: string, order: FingerprintableOrder): OrderIdentity {
    const scope = fingerprintScope(tenantId, accountId);
    const symbol = String(order.symbol ?? "").trim().toUpperCase();
    if (!symbol) throw new Error("Order fingerprint requires a symbol.");
    if (!Number.isFinite(order.volume) || order.volume <= 0) {
        throw new Error("Order fingerprint requires a positive finite volume.");
    }
    const price = order.kind === "MARKET" ? "" : pricePart(order.price);
    const canonical = [
        symbol,
        order.side,
        order.kind,
        roundTo(order.volume, 6).toFixed(6),
        price,
        pricePart(order.stopLoss),
        pricePart(order.takeProfit),
    ].join("|");
    return { scope, canonical, fingerprint: stableHash(`${scope}|${canonical}`) };
}

function pricePart(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return "";
    return roundTo(value, 5).toFixed(5);
}

// ── Duplicate prevention ────────────────────────────────────────────────────

export interface DuplicateGuardOptions {
    /** How long a fingerprint is considered "recent". Default 2 000 ms. */
    windowMs?: number;
    /** Bounded memory; oldest entries are evicted first. Default 1 000. */
    maxEntries?: number;
}

export type DuplicateClaim =
    | { accepted: true; scope: string; fingerprint: string; firstSeenAt: number }
    | { accepted: false; code: "DUPLICATE_ORDER"; scope: string; fingerprint: string; firstSeenAt: number; expiresAt: number };

/**
 * In-memory fingerprint window.
 *
 * Deliberately per-process: it is the last line of defence against burst
 * duplicates (double-clicks, retries across channels) and does NOT replace the
 * durable `clientRequestId` idempotency record. Callers that need a
 * cross-process window must use the idempotency store; this guard never claims
 * to be durable.
 */
export class OrderFingerprintGuard {
    private readonly windowMs: number;
    private readonly maxEntries: number;
    private readonly seen = new Map<string, number>();

    constructor(options: DuplicateGuardOptions = {}) {
        this.windowMs = Math.max(0, options.windowMs ?? 2_000);
        this.maxEntries = Math.max(1, options.maxEntries ?? 1_000);
    }

    claim(scope: string, fingerprint: string, now: number): DuplicateClaim {
        if (!scope || !fingerprint) {
            throw new Error("Duplicate guard requires a scope and a fingerprint.");
        }
        this.prune(now);
        const key = `${scope}::${fingerprint}`;
        const firstSeenAt = this.seen.get(key);
        if (firstSeenAt !== undefined && now - firstSeenAt < this.windowMs) {
            return { accepted: false, code: "DUPLICATE_ORDER", scope, fingerprint, firstSeenAt, expiresAt: firstSeenAt + this.windowMs };
        }
        this.seen.set(key, now);
        this.evictIfNeeded();
        return { accepted: true, scope, fingerprint, firstSeenAt: now };
    }

    /** Release a claim (e.g. the submission failed before reaching the provider). */
    release(scope: string, fingerprint: string): void {
        this.seen.delete(`${scope}::${fingerprint}`);
    }

    reset(scope?: string): void {
        if (!scope) {
            this.seen.clear();
            return;
        }
        for (const key of this.seen.keys()) {
            if (key.startsWith(`${scope}::`)) this.seen.delete(key);
        }
    }

    size(): number {
        return this.seen.size;
    }

    private prune(now: number): void {
        if (this.windowMs === 0) {
            this.seen.clear();
            return;
        }
        for (const [key, at] of this.seen) {
            if (now - at >= this.windowMs) this.seen.delete(key);
        }
    }

    private evictIfNeeded(): void {
        while (this.seen.size > this.maxEntries) {
            const oldest = this.seen.keys().next();
            if (oldest.done) break;
            this.seen.delete(oldest.value);
        }
    }
}

// ── Typed confirmation ─────────────────────────────────────────────────────

/**
 * The exact phrase a human must type. Derived from the order, so it cannot be
 * reused for a different symbol, side or size.
 */
export function typedConfirmationPhrase(order: FingerprintableOrder): string {
    const volume = Number.isFinite(order.volume) ? roundTo(order.volume, 2).toFixed(2) : "0.00";
    const symbol = String(order.symbol ?? "").trim().toUpperCase();
    const base = `${order.side} ${volume} ${symbol}`;
    if (order.kind !== "MARKET" && order.price && order.price > 0) {
        return `${base} @ ${roundTo(order.price, 5)}`;
    }
    return base;
}

export function normalizeTypedConfirmation(value: string): string {
    return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

export function verifyTypedConfirmation(order: FingerprintableOrder, typed: string | undefined | null): boolean {
    if (typeof typed !== "string" || !typed.trim()) return false;
    return normalizeTypedConfirmation(typed) === normalizeTypedConfirmation(typedConfirmationPhrase(order));
}

// ── Authorization record ───────────────────────────────────────────────────

export interface PolicyVerdict {
    allowed: boolean;
    needsConfirmation?: boolean;
    code?: string;
    reason?: string;
}

export interface RiskVerdict {
    approved: boolean;
    code: string;
    reason?: string;
}

export interface ExecutionAuthorizationInput {
    tenantId: string;
    accountId: string;
    order: FingerprintableOrder;
    risk: RiskVerdict;
    /** Result of the Agent Permission Engine for the calling skill/tool. */
    policy?: PolicyVerdict;
    /** Confirmation typed by the human, when confirmation is required. */
    typedConfirmation?: string;
    /**
     * Force the typed-phrase check even when policy does not demand it.
     * Automation paths set this to false; human approval paths set it to true.
     */
    requireTypedConfirmation?: boolean;
    guard?: OrderFingerprintGuard;
    now: number;
}

export type ExecutionAuthorizationCode =
    | "AUTHORIZED"
    | "MISSING_SCOPE"
    | "INVALID_ORDER"
    | "POLICY_DENIED"
    | "CONFIRMATION_REQUIRED"
    | "RISK_REJECTED"
    | "DUPLICATE_ORDER";

export interface ExecutionAuthorization {
    allowed: boolean;
    code: ExecutionAuthorizationCode;
    reason?: string;
    scope: string | null;
    canonical: string | null;
    fingerprint: string | null;
    requiredConfirmationPhrase: string;
    confirmationVerified: boolean;
    audit: {
        tenantId: string;
        accountId: string;
        decidedAt: number;
        riskCode: string;
        policyCode: string | null;
        duplicateChecked: boolean;
        aiAuthorization: false;
    };
}

/**
 * Compose policy + risk + duplicate prevention into one auditable decision.
 * Fail-closed: missing scope, missing policy approval, missing confirmation,
 * unknown risk state and duplicate claims all deny.
 */
export function authorizeExecution(input: ExecutionAuthorizationInput): ExecutionAuthorization {
    const baseAudit = {
        tenantId: String(input.tenantId ?? ""),
        accountId: String(input.accountId ?? ""),
        decidedAt: input.now,
        riskCode: input.risk?.code ?? "MISSING_RISK_DECISION",
        policyCode: input.policy?.code ?? null,
        duplicateChecked: false,
        aiAuthorization: false as const,
    };
    const phrase = safePhrase(input.order);

    const deny = (code: ExecutionAuthorizationCode, reason: string, extra?: Partial<ExecutionAuthorization>): ExecutionAuthorization => ({
        allowed: false,
        code,
        reason,
        scope: null,
        canonical: null,
        fingerprint: null,
        requiredConfirmationPhrase: phrase,
        confirmationVerified: false,
        ...extra,
        audit: { ...baseAudit, duplicateChecked: extra?.audit?.duplicateChecked ?? false },
    });

    if (!String(input.tenantId ?? "").trim() || !String(input.accountId ?? "").trim()) {
        return deny("MISSING_SCOPE", "Tenant or account scope is missing — execution authorization denied.");
    }

    let identity: OrderIdentity;
    try {
        identity = computeOrderIdentity(input.tenantId, input.accountId, input.order);
    } catch (error) {
        return deny("INVALID_ORDER", error instanceof Error ? error.message : "Order cannot be fingerprinted.");
    }

    const withIdentity = {
        scope: identity.scope,
        canonical: identity.canonical,
        fingerprint: identity.fingerprint,
    };

    if (input.policy && !input.policy.allowed) {
        return deny("POLICY_DENIED", input.policy.reason ?? "Permission policy denied this execution.", withIdentity);
    }

    const confirmationRequired = input.requireTypedConfirmation === true || input.policy?.needsConfirmation === true;
    const confirmationVerified = confirmationRequired
        ? verifyTypedConfirmation(input.order, input.typedConfirmation)
        : false;
    if (confirmationRequired && !confirmationVerified) {
        return deny(
            "CONFIRMATION_REQUIRED",
            `Type exactly "${phrase}" to authorize this order.`,
            withIdentity,
        );
    }

    if (!input.risk || !input.risk.approved) {
        return deny("RISK_REJECTED", input.risk?.reason ?? "The risk engine rejected this order.", withIdentity);
    }

    if (input.guard) {
        const claim = input.guard.claim(identity.scope, identity.fingerprint, input.now);
        if (!claim.accepted) {
            return deny("DUPLICATE_ORDER", "An identical order for this account was submitted moments ago.", {
                ...withIdentity,
                audit: { ...baseAudit, duplicateChecked: true },
            });
        }
    }

    return {
        allowed: true,
        code: "AUTHORIZED",
        scope: identity.scope,
        canonical: identity.canonical,
        fingerprint: identity.fingerprint,
        requiredConfirmationPhrase: phrase,
        confirmationVerified,
        audit: { ...baseAudit, duplicateChecked: Boolean(input.guard) },
    };
}

function safePhrase(order: FingerprintableOrder | undefined): string {
    if (!order) return "";
    try {
        return typedConfirmationPhrase(order);
    } catch {
        return "";
    }
}
