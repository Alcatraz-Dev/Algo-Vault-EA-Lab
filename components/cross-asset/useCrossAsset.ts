"use client";

/**
 * Market Relationship Explorer data hook (Phase 16 §22).
 *
 * One fetch path for every Explorer surface. Auth is the standard Firebase
 * Bearer idToken; the server decides the tier — nothing about free/pro is
 * trusted from this client.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";

export interface GraphEvidence {
    id: string;
    kind: string;
    text: string;
    source?: string;
    value?: number;
    dataTimestamp?: number;
}

export interface GraphObservation {
    id: string;
    observedAt: number;
    window: { timeframe: string; bars: number };
    method: string;
    coefficient: number | null;
    sampleSize: number;
    dataQuality: { status: string; dataCoverage: number; reason?: string };
}

export interface GraphNode {
    id: string;
    kind: string;
    symbol?: string;
    assetClass?: string;
    currency?: string;
    label: string;
    measurable: boolean;
}

export interface GraphEdge {
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    relationshipType: string;
    strength: number;
    coefficient: number | null;
    window: { timeframe: string; bars: number };
    term: string;
    stability: string;
    dataTimestamp: number;
    calculatedAt: number;
    confidence: number;
    evidence: GraphObservation[];
    claims: GraphEvidence[];
    dataQuality: { status: string; reason?: string };
    userDefined: boolean;
}

export interface GraphRelationshipRow {
    a: string;
    b: string;
    coefficient: number | null;
    previousCoefficient: number | null;
    delta: number | null;
    type: string | null;
    stability: string;
    term: string;
    window: { timeframe: string; bars: number };
    sampleSize: number;
    dataQuality: { status: string };
    confidence: number;
    claims: GraphEvidence[];
    observations: GraphObservation[];
}

export interface GraphCluster {
    id: string;
    label: string;
    memberNodeIds: string[];
    meanCorrelation: number | null;
    window: { timeframe: string; bars: number };
    evidence: GraphEvidence[];
    limitations: string[];
}

export interface GraphFactor {
    id: string;
    name: string;
    kind: string;
    status: string;
    definition: string;
    formula: string;
    value: number | null;
    inputs: Array<{ symbol: string; weight: number; used: boolean }>;
    confidence: number;
    evidence: GraphEvidence[];
    limitations: string[];
}

export interface GraphRegime {
    id: string;
    axes: Array<{ axis: string; state: string; confidence: number; evidence: GraphEvidence[]; limitations: string[] }>;
    states: Record<string, string>;
    activeStates: string[];
    calculatedAt: number;
    dataTimestamp: number;
    notComputed: string[];
    limitations: string[];
}

export interface GraphSignal {
    id: string;
    type: string;
    status: string;
    summary: string;
    confidence: number;
    timestamp: number;
    dataTimestamp: number;
    evidence: GraphEvidence[];
}

export interface GraphResponse {
    success: boolean;
    tier: "FREE" | "PRO";
    limits?: { maxSymbols: number; maxWindows: number; leadLag: boolean; clusters: boolean };
    upgrade?: string[];
    window: { timeframe: string; bars: number };
    universe: string[];
    unavailableSymbols: Array<{ symbol: string; reason: string }>;
    snapshot: {
        snapshotId: string;
        createdAt: number;
        dataTimestamp: number;
        engineVersions: Record<string, string>;
        dataQuality: { status: string; dataCoverage: number };
        observability: Record<string, number>;
        limitations: string[];
    };
    nodes: GraphNode[];
    edges: GraphEdge[];
    relationships: GraphRelationshipRow[];
    matrix?: Array<{ a: string; b: string; coefficient: number | null; status: string }>;
    clusters?: GraphCluster[];
    clusterChanges?: Array<{ kind: string; text: string }>;
    factors?: GraphFactor[];
    regime?: GraphRegime;
    regimeTransitions?: Array<{ axis: string; previousState: string; newState: string; timestamp: number }>;
    signals?: GraphSignal[];
    leadLag?: Array<{
        leader: string;
        follower: string;
        lag: number;
        coefficient: number;
        pValue: number | null;
        sampleSize: number;
        stable: boolean;
        stabilityNote: string;
        limitations: string[];
    }>;
    limitations: string[];
}

export interface UseCrossAssetResult {
    data: GraphResponse | null;
    loading: boolean;
    error: string | null;
    reload: (force?: boolean) => void;
}

const INCLUDE_PRO = "matrix,clusters,factors,signals,regime,leadlag";

export function useCrossAsset(params: {
    symbol: string;
    timeframe: string;
    bars: number;
    autoRefresh?: boolean;
}): UseCrossAssetResult {
    const [user, setUser] = useState<User | null>(null);
    const [authReady, setAuthReady] = useState(false);
    const [data, setData] = useState<GraphResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const requestRef = useRef(0);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setAuthReady(true);
        });
        return () => unsub();
    }, []);

    const reload = useCallback(
        async (force = false) => {
            if (!authReady) return;
            if (!user) {
                setError("Sign in to explore market relationships.");
                return;
            }
            const ticket = ++requestRef.current;
            setLoading(true);
            setError(null);
            try {
                const token = await user.getIdToken();
                const query = new URLSearchParams({
                    symbol: params.symbol,
                    timeframe: params.timeframe,
                    bars: String(params.bars),
                    include: INCLUDE_PRO,
                });
                if (force) query.set("force", "1");
                const res = await fetch(`/api/cross-asset?${query.toString()}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const body = (await res.json()) as GraphResponse & { error?: string; detail?: string };
                if (!res.ok || !body.success) {
                    throw new Error(body.detail ?? body.error ?? `Request failed (${res.status})`);
                }
                if (ticket === requestRef.current) setData(body);
            } catch (err) {
                if (ticket === requestRef.current) {
                    setError(err instanceof Error ? err.message : "Failed to load the market graph.");
                }
            } finally {
                if (ticket === requestRef.current) setLoading(false);
            }
        },
        [authReady, user, params.symbol, params.timeframe, params.bars]
    );

    useEffect(() => {
        // Deferred like every other fetch effect in this codebase: setState
        // never runs synchronously inside the effect body (react-hooks rule).
        void Promise.resolve().then(() => reload(false));
    }, [reload]);

    return { data, loading, error, reload };
}
