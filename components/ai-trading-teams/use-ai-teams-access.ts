"use client";

/**
 * Shared client state for AI Trading Teams: authentication, server-side
 * Pro entitlement (mirrored from the subscription record) and feature flags.
 */

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { onSubscriptionChange } from "@/lib/subscription";
import { teamsApi } from "./api";
import type { TeamAgentDefinition, TeamTemplate } from "@/lib/ai-trading-teams/types";

export interface TeamsEntitlement {
    isAuthenticated: boolean;
    isPro: boolean;
    canRun: boolean;
    canCreateCustomAgents: boolean;
    isAdmin: boolean;
}

export interface LibraryResponse {
    agents: TeamAgentDefinition[];
    templates: TeamTemplate[];
    flags: { aiTeamsEnabled: boolean; customAgentsEnabled: boolean; adminAgentFactoryEnabled: boolean };
    entitlement: TeamsEntitlement;
}

export function useAITeamsAccess() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [isPro, setIsPro] = useState(false);
    const [library, setLibrary] = useState<LibraryResponse | null>(null);
    const [libraryError, setLibraryError] = useState<string | null>(null);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setAuthLoading(false);
        });
        return () => unsub();
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (user) {
                try {
                    const sub = await onSubscriptionChange(user.uid);
                    if (!cancelled) setIsPro(Boolean(sub.hasSubscription));
                } catch {
                    if (!cancelled) setIsPro(false);
                }
            } else if (!cancelled) {
                setIsPro(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [user]);

    const refreshLibrary = useCallback(async () => {
        try {
            const data = await teamsApi<LibraryResponse>("/library");
            setLibrary(data);
            setLibraryError(null);
            return data;
        } catch (err) {
            setLibraryError(err instanceof Error ? err.message : "Failed to load AI Trading Teams.");
            return null;
        }
    }, []);

    useEffect(() => {
        // Wait for Firebase to restore the session first: teamsApi reads
        // auth.currentUser for the ID token, so fetching earlier would come back
        // as "anonymous" and mis-report entitlement (Pro users seeing "Pro required").
        if (authLoading) return;
        let cancelled = false;
        const loadLibrary = async () => {
            try {
                const data = await teamsApi<LibraryResponse>("/library");
                if (cancelled) return;
                setLibrary(data);
                setLibraryError(null);
            } catch (err) {
                if (!cancelled) {
                    setLibraryError(err instanceof Error ? err.message : "Failed to load AI Trading Teams.");
                }
            }
        };
        void loadLibrary();
        return () => {
            cancelled = true;
        };
    }, [authLoading]);

    const flags = library?.flags ?? {
        aiTeamsEnabled: true,
        customAgentsEnabled: true,
        adminAgentFactoryEnabled: true,
    };

    const entitlement: TeamsEntitlement = library?.entitlement ?? {
        isAuthenticated: Boolean(user),
        isPro,
        canRun: false,
        canCreateCustomAgents: false,
        isAdmin: false,
    };

    const canRun = entitlement.canRun || (isPro && flags.aiTeamsEnabled && entitlement.isAuthenticated);

    return {
        user,
        authLoading,
        isPro,
        flags,
        entitlement,
        canRun,
        library,
        libraryError,
        loadingLibrary: !library && !libraryError,
        refreshLibrary,
    };
}
