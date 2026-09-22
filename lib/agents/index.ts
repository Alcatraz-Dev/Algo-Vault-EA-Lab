// Public API for the Multi-Agent Intelligence Engine.
//
// Mostly `export *` barrels, with two exceptions where names collide:
//   - `getActiveAgents` exists in both catalog (sync) and orchestrator
//     (async) — the async registry helper is re-exported as
//     `getActiveAgentsAsync`.
//   - `PermissionSet` exists in both types (canonical) and permissions —
//     only the types definition is exported here.

export * from "./types";
export * from "./catalog";
export * from "./database";
// "./permissions" re-exported explicitly because it also defines `PermissionSet`,
// which collides with the canonical definition in "./types" above.
export {
    AGENT_PERMISSION_CATALOG,
    FORBIDDEN_AGENT_PERMISSIONS,
    PERSONAL_AGENT_PERMISSIONS,
    agentPermissionLabel,
    agentPermissionDescription,
    grantedAgentPermissions,
    sanitizeAgentPermissionSet,
    agentToPluginPermissions,
    missingPermissions,
} from "./permissions";
export * from "./permissions-runtime";
export * from "./ai-provider";
export * from "./notification-agent";
export * from "./schema";

// Orchestrator — the single entry point for all multi-agent intelligence.
// The async registry helpers are re-exported under distinct names so they do
// not collide with the sync catalog exports above.
export {
    orchestrate,
    registerAgent,
    getAllAgents,
    getAgentById,
    getActiveAgents as getActiveAgentsAsync,
    getBuiltInAgent,
    createWorkflow,
    getWorkflow,
    updateWorkflow,
    getAllWorkflows,
    generateFromPrompt,
    validateDraft,
    type OrchestratorResult,
} from "./orchestrator";

// Workflow engine — executors used by the orchestrator.
export {
    registerAgentExecutor,
    executeWorkflow,
    registerBuiltInExecutors,
    type EngineConfig,
    type EngineResult,
} from "./workflow-engine";