/**
 * Unified Intelligence Fabric — public entrypoint.
 *
 * Every consumer (signals, terminal, workflows, research, challenge) imports
 * from here so the internal module layout stays refactorsafe.
 */

export * from "./flags";
export * from "./versions";
export * from "./types";
export * from "./safety";
export * from "./provider-registry";
export * from "./health";
export * from "./market-context";
export * from "./router";
export * from "./jev";
export * from "./orchestrator";
export * from "./signal-bridge";
export * from "./store";
export * from "./research-bridge";
export * from "./challenge-bridge";
