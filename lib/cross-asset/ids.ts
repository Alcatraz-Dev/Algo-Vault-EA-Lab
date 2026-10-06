/**
 * AlgoVault — canonical graph ids (Phase 16 §3).
 *
 * One id vocabulary for nodes and edges so every surface (Explorer, Terminal,
 * API, agents, alerts) addresses the same object the same way.
 */

export function instrumentNodeId(symbol: string): string {
    return `instrument:${String(symbol).toUpperCase()}`;
}

export function assetClassNodeId(assetClass: string): string {
    return `assetclass:${String(assetClass).toUpperCase()}`;
}

export function currencyNodeId(currency: string): string {
    return `currency:${String(currency).toUpperCase()}`;
}

export function factorNodeId(name: string): string {
    return `factor:${String(name).toUpperCase()}`;
}

export function regimeNodeId(): string {
    return "regime:global";
}

export function portfolioNodeId(portfolioId: string): string {
    return `portfolio:${portfolioId}`;
}

export function strategyNodeId(strategyId: string): string {
    return `strategy:${strategyId}`;
}

export function clusterNodeId(clusterId: string): string {
    return `cluster:${clusterId}`;
}

/** Stable edge id — deterministic across recomputations of the same fact. */
export function edgeId(
    sourceNodeId: string,
    targetNodeId: string,
    relationshipType: string,
    timeframe: string,
    bars: number
): string {
    const [a, b] = sourceNodeId <= targetNodeId ? [sourceNodeId, targetNodeId] : [targetNodeId, sourceNodeId];
    return `edge:${a}~${b}:${relationshipType}:${timeframe}:${bars}`;
}

/** `XAUUSD|DXY`-style pair key for a symbol pair (order-independent). */
export function symbolPairKey(a: string, b: string): string {
    const x = String(a).toUpperCase();
    const y = String(b).toUpperCase();
    return x <= y ? `${x}|${y}` : `${y}|${x}`;
}
