/**
 * Intelligence Cloud — Reproducible Intelligence Snapshots (Phase 13)
 *
 * A snapshot answers one question: "What did AlgoVault know when this result
 * was generated?" It is the substrate for certification, B2B reports, research
 * provenance, support and marketplace trust.
 *
 * Properties:
 *  - IMMUTABLE. Written once with `sensitive: false` semantics enforced by a
 *    root-scoped denial rule; no update path exists in this module.
 *  - SELF-CONTAINED. The snapshot stores the inputs, engine versions and
 *    outputs needed to reproduce the result, so an engine upgrade later cannot
 *    silently rewrite history.
 *  - ADDRESSABLE. `contentHash` is derived from the snapshot body, so two
 *    snapshots of the same knowledge state share an id.
 */

import { createHash } from "node:crypto";
import { adminDatabase } from "@/lib/firebase-admin";
import { CLOUD_ROOT } from "./api-keys";
import type {
    DataLineageEntry,
    EngineVersions,
    IntelligenceResponse,
} from "./contracts";
import { sanitizeSegment } from "./tenancy";

export interface IntelligenceSnapshot {
    snapshotId: string;
    requestId: string;
    /** ms epoch the snapshot was taken. */
    timestamp: number;
    /** ms epoch of the newest market datum behind the intelligence. */
    dataTimestamp: number;
    instrument: { symbol: string; timeframe: string };
    marketDataSource?: string;
    engineVersions: EngineVersions;
    /** Exact configuration that produced the result (indicator params, request context). */
    configuration: Record<string, unknown>;
    /** Input digest and bounds, so a reproduction can be scoped identically. */
    inputs: {
        dataRangeStart: number;
        dataRangeEnd: number;
        candleCount: number;
        /** Hash of the input series — identical inputs give an identical hash. */
        inputDigest?: string;
    };
    /** The intelligence itself, verbatim. */
    outputs: IntelligenceResponse;
    dataLineage?: DataLineageEntry[];
    limitations: string[];
    /** SHA-256 over the canonical body; also the identity of the snapshot. */
    contentHash: string;
    tenantId?: string;
}

/** Stable stringify so hashing is insensitive to key insertion order. */
function canonical(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export function hashSnapshotBody(body: Omit<IntelligenceSnapshot, "snapshotId" | "contentHash">): string {
    return createHash("sha256").update(canonical(body)).digest("hex");
}

/**
 * Digest of a candle series, used to prove that a reproduction used the same
 * inputs. Cheap to compute and independent of engine version.
 */
export function digestSeries(
    candles: ReadonlyArray<{ timestamp: number; open: number; high: number; low: number; close: number; volume?: number }>
): string {
    const hash = createHash("sha256");
    for (const candle of candles) {
        hash.update(`${candle.timestamp}:${candle.open}:${candle.high}:${candle.low}:${candle.close}:${candle.volume ?? 0}|`);
    }
    return hash.digest("hex");
}

export interface CreateSnapshotInput {
    tenantId?: string;
    response: IntelligenceResponse;
    configuration?: Record<string, unknown>;
    candleCount?: number;
    inputDigest?: string;
}

/**
 * Persist a snapshot and return its id.
 *
 * The snapshot id is derived from the content hash, so writing the same
 * knowledge state twice is idempotent and cannot produce two ids for one fact.
 */
export async function createSnapshot(input: CreateSnapshotInput): Promise<IntelligenceSnapshot> {
    const { response } = input;
    const lineage = response.dataLineage ?? [];
    const start = lineage[0]?.dataPeriodStart ?? response.dataTimestamp;
    const end = lineage[0]?.dataPeriodEnd ?? response.dataTimestamp;

    const body: Omit<IntelligenceSnapshot, "snapshotId" | "contentHash"> = {
        requestId: response.requestId,
        timestamp: response.timestamp,
        dataTimestamp: response.dataTimestamp,
        instrument: {
            symbol: response.instrument.symbol,
            timeframe: response.instrument.timeframe,
        },
        marketDataSource: response.instrument.dataSource,
        engineVersions: response.engineVersions,
        configuration: input.configuration ?? {},
        inputs: {
            dataRangeStart: start,
            dataRangeEnd: end,
            candleCount: input.candleCount ?? 0,
            inputDigest: input.inputDigest,
        },
        outputs: response,
        dataLineage: response.dataLineage,
        limitations: response.limitations,
        tenantId: input.tenantId,
    };

    const contentHash = hashSnapshotBody(body);
    const snapshot: IntelligenceSnapshot = {
        ...body,
        snapshotId: `snap_${contentHash.slice(0, 24)}`,
        contentHash,
    };

    const scope = input.tenantId ? sanitizeSegment(input.tenantId) : "platform";
    await adminDatabase
        .ref(`${CLOUD_ROOT}/snapshots/${scope}/${snapshot.snapshotId}`)
        .set(snapshot);

    return snapshot;
}

export async function getSnapshot(
    snapshotId: string,
    tenantId?: string
): Promise<IntelligenceSnapshot | null> {
    const scope = tenantId ? sanitizeSegment(tenantId) : "platform";
    const snap = await adminDatabase
        .ref(`${CLOUD_ROOT}/snapshots/${scope}/${sanitizeSegment(snapshotId)}`)
        .get();
    return snap.exists() ? (snap.val() as IntelligenceSnapshot) : null;
}

/**
 * Verify a snapshot has not been altered.
 *
 * The content hash is recomputed from the stored body, so tampering with a
 * stored output (e.g. rewriting a drawdown figure) is detectable.
 */
export async function verifySnapshotIntegrity(snapshot: IntelligenceSnapshot): Promise<boolean> {
    const { snapshotId, contentHash, ...body } = snapshot;
    void snapshotId;
    return hashSnapshotBody(body) === contentHash;
}
