/**
 * Intelligence Cloud — Public surface (Phase 13)
 *
 * Barrel for the Intelligence Cloud. Import from here rather than from
 * individual modules so the layer boundary stays visible.
 *
 * Architecture rule (Phase 13 §69): ONE intelligence core, MANY delivery
 * channels. Every symbol below is a reader over a canonical engine in
 * lib/market-data, lib/market-core, lib/strategy-engine or lib/strategy-research.
 * There is no second market, indicator, SMC, strategy or risk engine in this
 * layer, and none may be added.
 */

export * from "./contracts";
export * from "./errors";
export * from "./permissions";
export * from "./auth";
export * from "./crypto";
export * from "./tenancy";
export * from "./entitlements";
export * from "./engine-registry";
export * from "./intelligence";
export * from "./snapshots";
export * from "./jobs";
export * from "./api-keys";
export * from "./rate-limit";
export * from "./webhooks";
export * from "./audit";
