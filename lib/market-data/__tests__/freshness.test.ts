import { describe, it, expect } from "vitest";
import {
  describeFreshness,
  isLiveForExecution,
  isBlockingSignal,
  type FreshnessSignal,
  type TransportState,
} from "../freshness";
import type { FreshnessResult } from "../market-truth";

function signal(overrides: Partial<FreshnessSignal> = {}): FreshnessSignal {
  return {
    freshness: "live",
    dataStatus: "fresh",
    transport: "online",
    dataTimestamp: 0,
    evaluatedAt: 0,
    source: "Biquote",
    fromCache: false,
    ...overrides,
  };
}

function verdict(
  dataStatus: FreshnessResult["status"],
  transport: TransportState,
): FreshnessSignal {
  return describeFreshness({
    dataStatus,
    transport,
    dataTimestamp: 0,
    now: 1_700_000_000_000,
    source: "Biquote",
  });
}

describe("describeFreshness — maps verdicts to StatusBadge tokens", () => {
  it("fresh data + online transport → live", () => {
    expect(verdict("fresh", "online").freshness).toBe("live");
  });

  it("stale data + online transport → stale", () => {
    expect(verdict("stale", "online").freshness).toBe("stale");
  });

  it("unavailable data + online transport → unavailable (never live)", () => {
    const s = verdict("unavailable", "online");
    expect(s.freshness).toBe("unavailable");
    expect(s.freshness).not.toBe("live");
    expect(s.dataTimestamp).toBe(0);
  });

  it("offline transport → offline (wins even when data is fresh)", () => {
    const s = describeFreshness({
      dataStatus: "fresh",
      transport: "offline",
      dataTimestamp: 1_700_000_000_000,
      now: 1_700_000_000_000,
      source: "Biquote",
    });
    expect(s.freshness).toBe("offline");
    expect(s.transport).toBe("offline");
  });

  it("reconnecting transport → stale (no live view) — connecting, not live", () => {
    const s = describeFreshness({
      dataStatus: "fresh",
      transport: "reconnecting",
      dataTimestamp: 1_700_000_000_000,
      now: 1_700_000_000_000,
      source: "Biquote",
    });
    // reconnecting is a transport state; the badge must not claim LIVE.
    expect(s.freshness).not.toBe("live");
    expect(s.freshness).toBe("stale");
  });

  it("keeps the original data verdict inside the signal", () => {
    expect(verdict("stale", "offline").dataStatus).toBe("stale");
    expect(verdict("unavailable", "online").dataStatus).toBe("unavailable");
  });

  it("reports source and evaluator timestamp on every signal", () => {
    const s = describeFreshness({
      dataStatus: "fresh",
      transport: "online",
      dataTimestamp: 1_700_000_000,
      now: 1_700_001_000,
      source: "Biquote",
    });
    expect(s.source).toBe("Biquote");
    expect(s.evaluatedAt).toBe(1_700_001_000);
    expect(s.dataTimestamp).toBe(1_700_000_000);
  });
});

describe("isLiveForExecution / isBlockingSignal", () => {
  it("only live blocks everything else", () => {
    expect(isLiveForExecution(signal({ freshness: "live" }))).toBe(true);
    expect(isLiveForExecution(signal({ freshness: "stale" }))).toBe(false);
    expect(isLiveForExecution(signal({ freshness: "offline" }))).toBe(false);
    expect(isLiveForExecution(signal({ freshness: "unavailable" }))).toBe(false);
  });

  it("any non-live verdict blocks network actions", () => {
    expect(isBlockingSignal(signal({ freshness: "live" }))).toBe(false);
    expect(isBlockingSignal(signal({ freshness: "stale" }))).toBe(true);
    expect(isBlockingSignal(signal({ freshness: "offline" }))).toBe(true);
    expect(isBlockingSignal(signal({ freshness: "unavailable" }))).toBe(true);
  });
});
