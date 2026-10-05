/**
 * Intelligence Cloud — Engine Version Registry (Phase 13)
 *
 * Every intelligence result must be able to say which engine produced it.
 *
 * The registry previously held hand-written version strings ("v2.4.1",
 * "v4.2.0", …) that had drifted from the code they claimed to describe — the
 * registry said the Smart Money engine was v4.2.0 while the engine actually
 * exports 1.0.0. That is worse than no registry, because it produces confident,
 * wrong lineage. Versions here are now *imported from the engines themselves*,
 * so a bump in an engine propagates automatically and cannot silently disagree.
 *
 * Engines that have no exported version constant are reported as "unversioned"
 * rather than being given an invented number.
 */

import { SMART_MONEY_VERSION } from "@/lib/market-core/smart-money/engine";
import {
    ENGINE_VERSIONS,
    INDICATOR_ENGINE_VERSION,
    STRATEGY_ENGINE_VERSION,
} from "@/lib/strategy-engine/versioning";
import type { EngineVersions } from "./contracts";

/** Sentinel for an engine that does not publish a version constant. */
export const UNVERSIONED = "unversioned";

export type EngineId =
    | "market-data"
    | "indicators"
    | "smart-money"
    | "strategy-engine"
    | "risk"
    | "research"
    | "intelligence"
    | "ai-router";

export interface EngineVersionRecord {
    id: EngineId;
    name: string;
    /** Read from the engine's own exported constant. */
    version: string;
    sourcePath: string;
    /** False when the engine publishes no version constant yet. */
    versioned: boolean;
}

/**
 * Indicator engine version as declared by the strategy engine's manifest, which
 * is the same constant the indicator computation path uses.
 */
export const INDICATORS_VERSION = INDICATOR_ENGINE_VERSION;

/**
 * The registry.
 *
 * Entries are intentionally explicit about what they read, so a reviewer can
 * trace each version back to its declaration without opening every engine.
 */
export const ENGINE_REGISTRY: EngineVersionRecord[] = [
    {
        id: "market-data",
        name: "Market Data Engine",
        // market-truth.ts does not export a version constant yet.
        version: UNVERSIONED,
        sourcePath: "lib/market-data/market-truth.ts",
        versioned: false,
    },
    {
        id: "indicators",
        name: "Indicator Engine",
        version: INDICATORS_VERSION,
        sourcePath: "lib/strategy-engine/versioning.ts (INDICATOR_ENGINE_VERSION)",
        versioned: true,
    },
    {
        id: "smart-money",
        name: "Smart Money Engine",
        version: String(SMART_MONEY_VERSION),
        sourcePath: "lib/market-core/smart-money/engine.ts (SMART_MONEY_VERSION)",
        versioned: true,
    },
    {
        id: "strategy-engine",
        name: "Strategy Engine",
        version: String(STRATEGY_ENGINE_VERSION),
        sourcePath: "lib/strategy-engine/versioning.ts (STRATEGY_ENGINE_VERSION)",
        versioned: true,
    },
    {
        id: "risk",
        name: "Risk Engine",
        version: UNVERSIONED,
        sourcePath: "lib/risk/risk-engine.ts",
        versioned: false,
    },
    {
        id: "research",
        name: "Research Engine",
        version: UNVERSIONED,
        sourcePath: "lib/strategy-research",
        versioned: false,
    },
    {
        id: "intelligence",
        name: "Intelligence Cloud Facade",
        version: INTELLIGENCE_FACADE_VERSION,
        sourcePath: "lib/intelligence-cloud/intelligence.ts",
        versioned: true,
    },
    {
        id: "ai-router",
        name: "AI Router",
        version: UNVERSIONED,
        sourcePath: "lib/intelligence",
        versioned: false,
    },
];

/** Version of this facade's own contract mapping. Bump when response shape changes. */
export const INTELLIGENCE_FACADE_VERSION = "1.0.0";

const BY_ID = new Map(ENGINE_REGISTRY.map((record) => [record.id, record]));

export function getEngineVersion(id: EngineId): string {
    return BY_ID.get(id)?.version ?? UNVERSIONED;
}

export function getEngineRecord(id: EngineId): EngineVersionRecord | undefined {
    return BY_ID.get(id);
}

/**
 * Engines that still need a version constant before their results can be
 * fully reproducible. Surfaced in the admin registry view as a work list rather
 * than hidden behind invented numbers.
 */
export function unversionedEngines(): EngineVersionRecord[] {
    return ENGINE_REGISTRY.filter((record) => !record.versioned);
}

/** The strategy engine's own combined manifest, for callers that need it verbatim. */
export function strategyEngineManifest(): typeof ENGINE_VERSIONS {
    return ENGINE_VERSIONS;
}

/**
 * Build the `engineVersions` block attached to every intelligence response.
 *
 * Only engines that actually contributed are included (optional fields stay
 * absent), so a consumer can tell a market-only response from a full one.
 */
export function buildEngineVersions(
    contributing?: Partial<Record<EngineId, boolean>>
): EngineVersions {
    const wanted = (id: EngineId) => contributing?.[id] !== false;
    const versions: EngineVersions = {
        market: getEngineVersion("market-data"),
        indicators: getEngineVersion("indicators"),
        smartMoney: getEngineVersion("smart-money"),
    };
    if (wanted("strategy-engine")) versions.strategy = getEngineVersion("strategy-engine");
    if (wanted("risk")) versions.risk = getEngineVersion("risk");
    if (wanted("research")) versions.research = getEngineVersion("research");
    if (wanted("intelligence")) versions.intelligence = INTELLIGENCE_FACADE_VERSION;
    if (wanted("ai-router")) versions.aiRouter = getEngineVersion("ai-router");
    return versions;
}
