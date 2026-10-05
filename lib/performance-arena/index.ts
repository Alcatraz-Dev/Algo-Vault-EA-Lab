// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — public module surface.
//
// Import from "@/lib/performance-arena" in routes, pages and tests.
// Layering: types → pure engines (money/rules/metrics/execution/settlement/
// rewards/leaderboard/fraud/eligibility) → store (RTDB) → service (server).
// ─────────────────────────────────────────────────────────────────────────────

export * from "./types";
export * from "./money";
export * from "./flags";
export * from "./policies";
export * from "./state-machine";
export * from "./metrics";
export * from "./execution";
export * from "./partial-close";
export * from "./rules";
export * from "./settlement";
export * from "./guardian";
export * from "./rewards";
export * from "./eligibility";
export * from "./payout";
export * from "./fraud";
export * from "./leaderboard";
export * from "./profile";
export * from "./compatibility";
export { ArenaError } from "./service";
export type { AccessEvaluation, AttemptState, CatalogItem, PlaceOrderInput, PlaceOrderResult, SettleOutcome } from "./service";
export { previewPartialClose } from "./service";
