/**
 * Intelligence Cloud — Shared Route Pipeline (Phase 13)
 *
 * Every public intelligence endpoint runs through this one pipeline, so no
 * route can accidentally skip authentication, scope enforcement, rate limiting,
 * usage metering or the error contract. The order is deliberate:
 *
 *   requestId → authenticate → authorise (scope + entitlement)
 *   → rate limit → compute → snapshot → meter usage → respond
 *
 * Rate limiting sits *after* authentication so an anonymous flood cannot
 * consume an authenticated tenant's budget, and *before* computation so a
 * rejected request never costs a smart-money pass.
 *
 * Usage is metered on every outcome, including failures: billing-grade records
 * must reflect what actually happened, not only the happy path.
 */

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { IntelligenceErrorCode } from "./errors";
import { IntelligenceError, toErrorBody } from "./errors";
import { authenticateWithScope, type VerifiedApiKey } from "./api-keys";
import { consumeRateLimit, recordUsage, type UsageCategory, type UsageResult } from "./rate-limit";
import { tenantHasEntitlement, type Entitlement } from "./entitlements";
import { createSnapshot } from "./snapshots";
import type { IntelligenceRequest, IntelligenceResponse } from "./contracts";
import { loadTenantForRequest } from "./tenant-lookup";

export interface PipelineOptions {
    /** Scope the key must hold. */
    requiredScope: Parameters<typeof authenticateWithScope>[1];
    /** Plan entitlement the tenant must hold. */
    requiredEntitlement?: Entitlement;
    /** Endpoint label used for rate-limit buckets and usage records. */
    endpoint: string;
    /** Usage category recorded for billing. */
    usageCategory: UsageCategory;
    /** Billable units for one success, used when the response carries no cost metadata. */
    unitsPerSuccess?: number;
    apiVersion: string;
    /** Build the success payload from the computed intelligence. */
    build: (intelligence: IntelligenceResponse, key: VerifiedApiKey) => unknown;
}

export interface PipelineRequestInit {
    request: Request;
    options: PipelineOptions;
    /** Runs after authorisation. Receives the verified key and parsed body. */
    run: (
        body: Record<string, unknown>,
        key: VerifiedApiKey
    ) => Promise<IntelligenceResponse | null> | { intelligence?: IntelligenceResponse } | Promise<unknown>;
}

/** Extract a bearer token from the Authorization header. */
export function readBearerToken(request: Request): string {
    const header = request.headers.get("authorization") ?? "";
    if (!header.toLowerCase().startsWith("bearer ")) return "";
    return header.slice(7).trim();
}

/**
 * Execute one intelligence request end to end.
 *
 * Always returns the contract envelope: either the built payload or the
 * uniform error body. It never throws to the route, so a route is a single
 * `return runPipeline(...)`.
 */
export async function runIntelligencePipeline(init: PipelineRequestInit): Promise<NextResponse> {
    const { request, options } = init;
    const requestId = request.headers.get("x-request-id") ?? `req_${randomUUID()}`;
    const startedAt = Date.now();

    let outcome: UsageResult = "error";
    let status = 500;
    // Captured once the caller is authenticated so metering does not have to
    // re-verify the token (a second database read per request).
    let verifiedKey: VerifiedApiKey | null = null;
    // Billable weight taken from the response's own cost metadata, so metering
    // reflects the computation that actually happened.
    let billableUnits: number | undefined;

    try {
        const key = await authenticateWithScope(readBearerToken(request), options.requiredScope);
        verifiedKey = key;

        const tenant = await loadTenantForRequest(key.tenantId);
        if (options.requiredEntitlement && !tenantHasEntitlement(tenant.plan, options.requiredEntitlement, tenant.featureFlags)) {
            throw new IntelligenceError("FORBIDDEN", `The ${tenant.plan} plan does not include ${options.requiredEntitlement}.`);
        }

        await consumeRateLimit({
            tenantId: key.tenantId,
            apiKeyId: key.keyId,
            ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
            endpoint: options.endpoint,
            plan: tenant.plan,
            keyOverride: key.rateLimit,
        });

        const rawBody = await readJsonBody(request);
        const result = await init.run(rawBody, key);

        let intelligence: IntelligenceResponse | null = null;
        let payload: unknown;
        if (isIntelligenceResult(result)) {
            intelligence = result.intelligence ?? null;
            payload = options.build(result.intelligence, key);
            billableUnits = intelligence?.cost?.units;
        } else {
            payload = result;
        }

        // Snapshot only real intelligence, and only when the caller asked for it.
        const requested = rawBody as unknown as IntelligenceRequest;
        let snapshotId: string | undefined;
        if (intelligence && requested?.includeSnapshot !== false) {
            const snapshot = await createSnapshot({
                tenantId: key.tenantId,
                response: intelligence,
                configuration: {
                    context: requested?.context ?? {},
                    includeLineage: requested?.includeLineage !== false,
                },
            });
            snapshotId = snapshot.snapshotId;
        }

        const body =
            payload && typeof payload === "object" && !Array.isArray(payload)
                ? { ...(payload as Record<string, unknown>), requestId, snapshotId }
                : payload;

        outcome = "success";
        status = 200;
        const response = NextResponse.json(body, { status });
        response.headers.set("x-request-id", requestId);
        response.headers.set("x-algovault-version", options.apiVersion);
        return response;
    } catch (error) {
        const body = toErrorBody(error, requestId);
        outcome = body.error.code === "UNAUTHORIZED" ? "unauthorized" : body.error.code === "RATE_LIMITED" ? "rate_limited" : "error";
        const response = NextResponse.json(body, { status: statusOf(error) });
        response.headers.set("x-request-id", requestId);
        return response;
    } finally {
        void meter(verifiedKey, requestId, options, outcome, status, startedAt, billableUnits);
    }
}

function statusOf(error: unknown): number {
    return error instanceof IntelligenceError ? error.status : 500;
}

function isIntelligenceResult(value: unknown): value is { intelligence: IntelligenceResponse } {
    return Boolean(value) && typeof value === "object" && "intelligence" in (value as Record<string, unknown>);
}

/**
 * Record usage. Deliberately fire-and-forget so billing latency never reaches
 * the caller, and shielded so a metering failure cannot fail a served request.
 *
 * `units` come from the response's own cost metadata when present, so billing
 * reflects the real computation cost rather than a flat per-request charge.
 */
async function meter(
    key: VerifiedApiKey | null,
    requestId: string,
    options: PipelineOptions,
    outcome: UsageResult,
    status: number,
    startedAt: number,
    billableUnits: number | undefined
): Promise<void> {
    if (!key) return; // never authenticated — nothing billable to attribute
    try {
        await recordUsage({
            tenantId: key.tenantId,
            apiKeyId: key.keyId,
            requestId,
            category: options.usageCategory,
            endpoint: options.endpoint,
            at: Date.now(),
            latencyMs: Date.now() - startedAt,
            units: outcome === "success" ? (billableUnits ?? options.unitsPerSuccess ?? 1) : 0,
            result: outcome,
            status,
        });
    } catch {
        // Metering is best-effort; never surface it to the caller.
    }
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
    if (request.method === "GET" || request.method === "HEAD") {
        const url = new URL(request.url);
        return Object.fromEntries(url.searchParams.entries());
    }
    try {
        const text = await request.text();
        if (!text) return {};
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new IntelligenceError("INVALID_REQUEST", "The request body must be a JSON object.");
        }
        return parsed as Record<string, unknown>;
    } catch (error) {
        if (error instanceof IntelligenceError) throw error;
        throw new IntelligenceError("INVALID_REQUEST", "The request body is not valid JSON.");
    }
}

export type { IntelligenceErrorCode };
