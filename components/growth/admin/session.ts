"use client";

import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";

/**
 * Resolves a Firebase ID token once auth is ready (AdminGuard guarantees a
 * signed-in session before these pages render, but currentUser can still be
 * null on first paint).
 */
export function getGrowthAuthToken(): Promise<string> {
    return new Promise((resolve, reject) => {
        const current = auth.currentUser;
        if (current) {
            current.getIdToken().then(resolve, reject);
            return;
        }
        const unsub = onAuthStateChanged(auth, (user) => {
            unsub();
            if (user) user.getIdToken().then(resolve, reject);
            else reject(new Error("You need to be signed in."));
        });
    });
}

/**
 * Admin API fetch wrapper. Attaches the Bearer token, surfaces HTTP errors as
 * readable messages, and never leaks raw stack traces to the UI.
 */
export async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await getGrowthAuthToken();
    let res: Response;
    try {
        res = await fetch(path, {
            ...init,
            headers: {
                ...(init?.headers || {}),
                Authorization: `Bearer ${token}`,
            },
        });
    } catch {
        throw new Error("Network error — check your connection and try again.");
    }
    if (res.status === 401 || res.status === 403) {
        throw new Error("You don't have access to this data.");
    }
    if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string; message?: string; reason?: string } | null;
        throw new Error(body?.error || body?.message || body?.reason || `Request failed (${res.status}).`);
    }
    return res.json() as Promise<T>;
}