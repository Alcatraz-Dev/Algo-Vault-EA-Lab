/**
 * Freshness signals — backend (task t_f133064c).
 *
 * Translates the canonical market-data verdicts owned by
 * `lib/market-data/market-truth.ts` plus the transport state into the exact
 * `StatusBadge` token set the AlgoVault UI renders (DESIGN.md §13/§17):
 *
 *   live | stale | offline | unavailable
 *
 * Rules this file enforces (the refusal list is never softened):
 *   1. OFFLINE transport wins. No amount of recent data makes a view live if
 *      the app is offline — the badge becomes OFFLINE and consuming components
 *      disable network-dependent actions.
 *   2. UNAVAILABLE must never be promoted to LIVE. `unavailable` means there is
 *      nothing to show; presenting a blank/missing field as live is how fake
 *      prices get in. It maps to the badge token `unavailable`.
 *   3. STALE is the fallthrough for any data that is not live and not offline.
 *   4. Data-driven verdicts stay pure functions of timestamps: deterministic,
 *      unit-testable without a network, identical on phone + desktop + server.
 *
 * Companion rules live in `lib/mobile/freshness.ts` for the Phase-11
 * cross-device transport model; this module does not re-answer the
 * decision — it maps it onto the UI token set. The two must agree, which is
 * exactly why this is the only place the bridge is written.
 */

import type { FreshnessResult, MarketSnapshot } from "./market-truth";

/** Transport-level connectivity, independent of how old the data is. */
export type TransportState = "online" | "offline" | "reconnecting";

/** Numeric tokens of the AlgoVault StatusBadge. */
export type DataFreshness =
  | "live"
  | "stale"
  | "offline"
  | "unavailable";

/**
 * One evaluated freshness snapshot: the verdict the UI must render, and the
 * raw votes it was composed from so a component can never silently guess.
 */
export interface FreshnessSignal {
  /**
   * The exact `StatusBadge` token to paint: `live` | `stale` | `offline` |
   * `unavailable`.
   */
  freshness: DataFreshness;
  /** Data verdict the canonical engine produced (`fresh | stale |
   * unavailable`). Mirrors `MarketSnapshot.freshnessStatus`.
   */
  dataStatus: "fresh" | "stale" | "unavailable";
  /** Transport verdict at evaluation time. */
  transport: TransportState;
  /** Epoch ms of the newest datum actually rendered. `0` when there is no
   * datum to timestamp.
   */
  dataTimestamp: number;
  /** Epoch ms the verdict was computed. */
  evaluatedAt: number;
  /** Where the numbers came from, e.g. `Biquote` (MarketSnapshot.provider) or
   * `server-cache`. Never a secret; used for the `title` audit tooltip and for
   * distinguishing "local cache" from "wire".
   */
  source: string;
  /**
   * True when the value shown came from a local cache rather than the wire.
   * Must not make a stale view look live.
   */
  fromCache: boolean;
  /** Feed-reported latency, if the provider publishes one. */
  providerDelayMs?: number;
}

/**
 * Classify a canonical market-data verdict (+ the current transport state) into
 * the four `StatusBadge` tokens.
 *
 * Precedence is deliberate and is the whole point of this function:
 *   1. offline transport  → OFFLINE (the screen is not lying about connectivity)
 *   2. unavailable verdict → UNAVAILABLE (nothing to show; never live)
 *   3. stale verdict      → STALE (data is real but no longer updating)
 *   4. fresh verdict      → LIVE (only then may a live order be gated on it)
 *
 * The caller decides whether `live` needs to be gated by freshness, and this
 * function reports the badge token it should paint.
 */
export function describeFreshness(
  input: {
    /** The canonical data verdict. */
    dataStatus: FreshnessResult["status"];
    /** Transport-level connectivity. */
    transport: TransportState;
    /**
     * Epoch ms of the newest datum actually rendered. `0` when the data verdict
     * is `unavailable` / there is no datum to timestamp.
     */
    dataTimestamp: number;
    /** Epoch ms now. Injected so tests are deterministic. */
    now: number;
    /** Where the data came from. */
    source: string;
    /** True when served from the local cache. */
    fromCache?: boolean;
    /** Feed-reported latency, if the provider publishes one. */
    providerDelayMs?: number;
    /**
     * Optional hint carrying the DataSnapshot.timestamp (epoch ms) when the
     * engine already tracks it. When provided this shadows `dataTimestamp`.
     */
    snapshotTimestamp?: number | null;
  },
): FreshnessSignal {
  const now = input.now;
  const effectiveTimestamp =
    input.snapshotTimestamp !== undefined && Number.isFinite(input.snapshotTimestamp)
      ? Math.max(0, input.snapshotTimestamp ?? 0)
      : input.dataTimestamp;

  const offline = input.transport === "offline";
  const reconnecting = input.transport === "reconnecting";
  const dataUnavailable = input.dataStatus === "unavailable";
  const dataStale = input.dataStatus === "stale";
  const dataFresh = input.dataStatus === "fresh";

  // Offline transport wins: report connectivity, never a fabricated live view.
  if (offline) {
    return {
      freshness: "offline",
      dataStatus: input.dataStatus,
      transport: "offline",
      dataTimestamp: effectiveTimestamp,
      evaluatedAt: now,
      source: input.source,
      fromCache: false,
      providerDelayMs: input.providerDelayMs,
    };
  }

  // `reconnecting` is a transport state, not a data verdict. It never earns
  // LIVE: the screen is rebuilding the transport, so the badge is STALE and
  // any network-dependent action stays disabled.
  if (reconnecting) {
    return {
      freshness: "stale",
      dataStatus: dataStale ? "stale" : (dataUnavailable ? "unavailable" : "fresh"),
      transport: "reconnecting",
      dataTimestamp: effectiveTimestamp,
      evaluatedAt: now,
      source: input.source,
      fromCache: input.fromCache ?? false,
      providerDelayMs: input.providerDelayMs,
    };
  }

  // `unavailable` is a data verdict, not a neutral state. There is nothing to
  // show; pretending otherwise is how fake data gets into a trader's screen.
  if (dataUnavailable) {
    return {
      freshness: "unavailable",
      dataStatus: "unavailable",
      transport: input.transport,
      dataTimestamp: 0,
      evaluatedAt: now,
      source: input.source,
      fromCache: input.fromCache ?? false,
      providerDelayMs: input.providerDelayMs,
    };
  }

  if (dataStale) {
    return {
      freshness: "stale",
      dataStatus: "stale",
      transport: input.transport,
      dataTimestamp: effectiveTimestamp,
      evaluatedAt: now,
      source: input.source,
      fromCache: input.fromCache ?? false,
      providerDelayMs: input.providerDelayMs,
    };
  }

  // `fresh` is the only state that earns `LIVE`.
  return {
    freshness: "live",
    dataStatus: "fresh",
    transport: input.transport,
    dataTimestamp: effectiveTimestamp,
    evaluatedAt: now,
    source: input.source,
    fromCache: input.fromCache ?? false,
    providerDelayMs: input.providerDelayMs,
  };
}

/** Cadence gate for a single live quote. Classifies the datum at the
 *  symbol's own timeframe threshold so a 1-minute chart is not judged by a
 *  daily bar's expiry, and a stale-but-real quote is never promoted to live.
 *  Deterministic: identical on phone + desktop + server. Returns the numeric
 *  verdict the canonical engine produced; the transport-vs-data decision is
 *  applied by `describeFreshness` at the surface.
 */

/** Cadence gate for a single live quote. Classifies the datum at the
 *  symbol's own timeframe threshold so a 1-minute chart is not judged by a
 *  daily bar's expiry, and a stale-but-real quote is never promoted to live.
 *  Deterministic: identical on phone + desktop + server. Returns the numeric
 *  verdict the canonical engine produced; `describeFreshness` applies the
 *  transport-vs-data decision at the surface.
 *
 *  Precedence: no datum → UNAVAILABLE (never live); offline transport → OFFLINE;
 *  data age past the timeframe threshold → STALE; otherwise LIVE.
 */
export function isLiveForExecution(signal: FreshnessSignal): boolean {
  return signal.freshness === "live";
}

/** Verdict that blocks any network-dependent action. */
export function isBlockingSignal(signal: FreshnessSignal): boolean {
  return signal.freshness !== "live";
}
