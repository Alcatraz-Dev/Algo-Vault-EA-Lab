/**
 * Growth Engine — multi-agent marketing pipeline.
 *
 * Barrel: contracts (agent definitions), executors (workflow-engine
 * registrations) and the pipeline runner. Importing this module registers the
 * growth agents + executors into the existing workflow engine (idempotent).
 */
export * from "./contracts";
export * from "./executors";
export * from "./pipeline";