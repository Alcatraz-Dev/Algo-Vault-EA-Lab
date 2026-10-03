"use client";

/**
 * Client API helper for AI Trading Teams.
 * Always attaches the Firebase ID token so every route can enforce
 * authentication + entitlement server-side.
 */

import { auth } from "@/lib/firebase";

export class TeamsApiError extends Error {
    status: number;
    body: Record<string, unknown>;
    constructor(message: string, status: number, body: Record<string, unknown> = {}) {
        super(message);
        this.status = status;
        this.body = body;
    }
}

async function headers(): Promise<Record<string, string>> {
    const user = auth.currentUser;
    const base: Record<string, string> = { "Content-Type": "application/json" };
    if (user) {
        const token = await user.getIdToken();
        base.Authorization = `Bearer ${token}`;
    }
    return base;
}

export async function teamsApi<T = unknown>(
    path: string,
    init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
    const res = await fetch(`/api/ai-trading-teams${path}`, {
        method: init.method ?? "GET",
        headers: await headers(),
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: init.signal,
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
        throw new TeamsApiError(
            String(body.error ?? `Request failed (${res.status})`),
            res.status,
            body,
        );
    }
    return body as T;
}

export async function adminTeamsApi<T = unknown>(
    path: string,
    init: { method?: string; body?: unknown } = {},
): Promise<T> {
    const user = auth.currentUser;
    if (!user) throw new TeamsApiError("Authentication required.", 401);
    const token = await user.getIdToken();
    const res = await fetch(`/api/admin${path}`, {
        method: init.method ?? "GET",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
        throw new TeamsApiError(String(body.error ?? `Request failed (${res.status})`), res.status, body);
    }
    return body as T;
}
