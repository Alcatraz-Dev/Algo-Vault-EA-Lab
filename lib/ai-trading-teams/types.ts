/**
 * AlgoVault AI Trading Teams — domain types.
 *
 * This is the contract layer for the multi-agent trading research desk.
 * Nothing in this module performs I/O.
 *
 * Design principles (see docs/ai-trading-teams.md):
 *  - Agents return STRUCTURED data. Free-form text is never the internal protocol.
 *  - Every observation is classified FACT / INTERPRETATION / HYPOTHESIS / RISK /
 *    INVALIDATION / UNKNOWN and FACTs must reference a real dossier source.
 *  - The Chief Analyst synthesizes evidence; it never "votes" and never invents
 *    market data.
 */

// ─── Market / run context ───────────────────────────────────────────────────

/**
 * How the run's market data must be interpreted. Mirrors the existing
 * Market Intelligence `mode` vocabulary plus the explicit labels required for
 * team runs. NEVER mixed silently in the UI.
 */
export type TeamDataMode = "live" | "replay" | "backtest" | "research" | "historical";

export type TradingStyle = "scalping" | "intraday" | "swing" | "position" | "research";

export type RiskProfile = "conservative" | "balanced" | "aggressive";

export type TeamBehavior =
    | "consensus"
    | "evidence-weighted"
    | "risk-first"
    | "research-first"
    | "custom";

export type TimeframeKey = "entry" | "confirmation" | "context";

export interface TeamConfig {
    market: string;
    style: TradingStyle;
    entryTimeframe: string;
    confirmationTimeframe: string;
    contextTimeframe: string;
    riskProfile: RiskProfile;
    behavior: TeamBehavior;
    /** Activation intents used by relevance filtering (e.g. "setup-validation"). */
    intents?: string[];
    behaviorRules?: {
        /** Chief Analyst must not finalize while this agent family failed. */
        requireRiskValidation?: boolean;
        requireQuantValidation?: boolean;
        /** Minimum mean confidence across agents before a CONFIRMED state. */
        minConsensusConfidence?: number;
    };
}

export type TeamStatus = "active" | "paused" | "archived";

export interface AITradingTeam {
    id: string;
    userId: string;
    name: string;
    description?: string;
    config: TeamConfig;
    /** Ordered agent ids; the Chief Analyst is always last in execution order. */
    agentIds: string[];
    /** Pinned agent versions at creation time; runs snapshot their own copies. */
    pinnedAgentVersions?: Record<string, string>;
    status: TeamStatus;
    /** Team config version, bumped on every structural edit. */
    version: number;
    templateId?: string;
    source: "user" | "admin-template" | "builtin-template" | "generated";
    createdAt: number;
    updatedAt: number;
}

// ─── Evidence protocol ──────────────────────────────────────────────────────

export type EvidenceKind =
    | "FACT"
    | "INTERPRETATION"
    | "HYPOTHESIS"
    | "RISK"
    | "INVALIDATION"
    | "UNKNOWN";

export const EVIDENCE_KINDS: EvidenceKind[] = [
    "FACT",
    "INTERPRETATION",
    "HYPOTHESIS",
    "RISK",
    "INVALIDATION",
    "UNKNOWN",
];

export type Stance = "bullish" | "bearish" | "neutral" | "mixed" | "unclear";

/**
 * A single observation. `reference` is REQUIRED for FACTs and must resolve to
 * a source id that was actually present in the intelligence dossier handed to
 * the agent (enforced by `validateAgentOutput`).
 */
export interface AgentObservation {
    id: string;
    kind: EvidenceKind;
    text: string;
    /** Dossier source id, e.g. "smartMoney.sweeps[0]" or "structure.trend". */
    reference?: string;
}

export interface AgentEvidenceRef {
    id: string;
    /** What was actually read, e.g. "smartMoney:orderBlocks" or "market:regime". */
    source: string;
    value?: string | number | boolean;
    note?: string;
}

export type AgentRunStatus =
    | "waiting"
    | "scheduled"
    | "analyzing"
    | "completed"
    | "partial"
    | "failed"
    | "skipped"
    | "blocked";

/** Structured agent output — the ONLY internal protocol (spec §9). */
export interface AgentRunOutput {
    agentId: string;
    agentName?: string;
    agentVersion: string;
    status: AgentRunStatus;
    summary: string;
    observations: AgentObservation[];
    evidence: AgentEvidenceRef[];
    interpretation: string;
    stance: Stance;
    /** Contextual confidence 0..1. Never a probability of profit. */
    confidence: number;
    invalidations: string[];
    risks: string[];
    dataTimestamp: string;
    toolsUsed: string[];
    limitations: string[];
    /** User-safe reasoning summary. Never hidden chain-of-thought. */
    reasoningSummary?: string;
    warnings?: string[];
    error?: string;
    durationMs?: number;
    /** AI provider used for narration (empty for deterministic-only agents). */
    provider?: string;
    model?: string;
}

// ─── Agent definition ───────────────────────────────────────────────────────

export type AgentCategory =
    | "regime"
    | "smart-money"
    | "technical"
    | "price-action"
    | "liquidity"
    | "macro"
    | "quant"
    | "research"
    | "risk"
    | "contrarian"
    | "validation"
    | "chief";

export type AgentVisualType =
    | "market-pulse"
    | "radar"
    | "analytical-sphere"
    | "signal-node"
    | "liquidity-radar"
    | "event-radar"
    | "research-prism"
    | "research-lens"
    | "shield"
    | "contrarian-core"
    | "validation-gate"
    | "chief-core";

/** Capability vocabulary. Custom agents may only reference whitelisted tools. */
export type AgentTool =
    | "smart_money"
    | "market_structure"
    | "liquidity_map"
    | "regime_classifier"
    | "volatility"
    | "sessions"
    | "multi_timeframe"
    | "setup_memory"
    | "research_engine"
    | "backtest_summary"
    | "risk_engine"
    | "account_state"
    | "economic_calendar"
    | "news_feed"
    | "strategy_lab"
    | "pattern_stats"
    | "price_action"
    | "technical_indicators";

export const ALLOWED_AGENT_TOOLS: AgentTool[] = [
    "smart_money",
    "market_structure",
    "liquidity_map",
    "regime_classifier",
    "volatility",
    "sessions",
    "multi_timeframe",
    "setup_memory",
    "research_engine",
    "backtest_summary",
    "risk_engine",
    "account_state",
    "economic_calendar",
    "news_feed",
    "strategy_lab",
    "pattern_stats",
    "price_action",
    "technical_indicators",
];

export interface AgentOutputField {
    name: string;
    type: "string" | "number" | "boolean" | "string[]" | "evidence[]" | "object";
    description: string;
    required: boolean;
}

export interface TeamAgentDefinition {
    id: string;
    name: string;
    description: string;
    category: AgentCategory;
    /** lucide icon name resolved in the UI layer. */
    icon: string;
    visualType: AgentVisualType;
    /** Semver-ish version, snapshotted onto every run. */
    version: string;
    enabled: boolean;
    builtin: boolean;
    ownerUid?: string;
    /** Specialized system instruction for this agent. */
    systemInstructions: string;
    capabilities: string[];
    tools: AgentTool[];
    requiredInputs: string[];
    optionalInputs: string[];
    outputSchema: AgentOutputField[];
    limitations: string[];
    /** Intents this agent is relevant for — drives relevance filtering. */
    activationTags: string[];
    /** Dossier sections required; if missing the agent is skipped, not faked. */
    requiredSections: string[];
    /** Hard cap on the agent's own AI narration output. */
    maxOutputTokens?: number;
    temperature?: number;
    timeoutMs?: number;
    maxRetries?: number;
    /** Dependency hints (a custom agent may depend on built-ins). */
    dependsOn?: string[];
    /** Structural flags. */
    isChief?: boolean;
    createdAt?: number;
    updatedAt?: number;
    createdBy?: string;
    status?: "active" | "disabled" | "draft" | "testing";
    /** Previous versions preserved for rollback. */
    previousVersions?: number;
}

// ─── Execution model ────────────────────────────────────────────────────────

export interface TeamTimelineEntry {
    t: number;
    agentId?: string;
    text: string;
    kind: "info" | "started" | "completed" | "warning" | "error" | "synthesis";
}

export interface ConflictGroup {
    id: string;
    label: string;
    kind: "stance" | "risk" | "missing-evidence" | "critical-risk";
    /** agentId → stance for stance conflicts. */
    positions?: Record<string, Stance>;
    detail: string;
}

export interface TeamConsensus {
    /** Simple majority stance, or "split" / "unclear". No numeric AI score. */
    stance: Stance | "split";
    agreementRatio: number;
    agentsByStance: Record<Stance, string[]>;
    missingEvidence: string[];
    criticalRisks: string[];
    invalidations: string[];
    conflicts: ConflictGroup[];
}

export type SetupState =
    | "WAITING"
    | "WATCHING"
    | "VALIDATING"
    | "CONFIRMED"
    | "INVALIDATED"
    | "CANCELLED";

export interface ChiefSynthesis {
    status: "final" | "partial" | "blocked";
    setupState: SetupState;
    marketContext: string;
    evidence: AgentObservation[];
    bullishCase: string[];
    bearishCase: string[];
    risks: string[];
    invalidations: string[];
    researchNextStep: string;
    dataFreshness: {
        mode: TeamDataMode;
        asOf: number | null;
        dataTimestamp: string;
        ageMs: number;
        stale: boolean;
    };
    confidence: number;
    missingEvidence: string[];
    blockedReason?: string;
    disclaimer: string;
    synthesisNotes?: string;
}

export interface RunBudget {
    agentsSelected: number;
    agentsExecuted: number;
    agentsSkipped: number;
    aiCalls: number;
    aiFailures: number;
    tokensHint?: number;
}

export type TeamRunStatus =
    | "queued"
    | "running"
    | "completed"
    | "partial"
    | "failed"
    | "cancelled";

/** Lightweight list-row projection of a run (history tables). */
export interface TeamRunSummary {
    id: string;
    teamId: string;
    teamName: string;
    status: TeamRunStatus;
    market: string;
    dataMode: TeamDataMode;
    startedAt: number;
    finishedAt: number | null;
    durationMs: number | null;
    setupState: SetupState | null;
    agentVersions: Record<string, string>;
}

export interface TeamRun {
    id: string;
    userId: string;
    teamId: string;
    teamName: string;
    teamVersion: number;
    status: TeamRunStatus;
    request?: string;
    dataMode: TeamDataMode;
    /** Point-in-time cutoff for replay/backtest/research runs. */
    asOf: number | null;
    market: string;
    config: TeamConfig;
    agentVersions: Record<string, string>;
    startedAt: number;
    finishedAt: number | null;
    durationMs: number | null;
    /** Execution waves: each inner array ran in parallel. */
    waves: string[][];
    agentOutputs: Record<string, AgentRunOutput>;
    skipped: { agentId: string; reason: string }[];
    timeline: TeamTimelineEntry[];
    consensus: TeamConsensus | null;
    synthesis: ChiefSynthesis | null;
    dossierMeta: {
        sources: string[];
        mode: TeamDataMode;
        asOf: number | null;
        dataTimestamp: string;
        candleCounts: Record<string, number>;
        quality: string;
        limitations: string[];
    } | null;
    budget: RunBudget;
    errors: string[];
    createdAt: number;
}

// ─── Templates ──────────────────────────────────────────────────────────────

export interface TeamTemplate {
    id: string;
    name: string;
    description: string;
    scope: "builtin" | "admin";
    config: Omit<TeamConfig, "intents"> & { intents?: string[] };
    agentIds: string[];
    tags?: string[];
    createdBy?: string;
    createdAt?: number;
    updatedAt?: number;
}

// ─── Custom agents ──────────────────────────────────────────────────────────

export interface CustomAgentInput {
    name: string;
    description: string;
    category: AgentCategory;
    visualType?: AgentVisualType;
    systemInstructions: string;
    tools: AgentTool[];
    requiredInputs?: string[];
    optionalInputs?: string[];
    limitations?: string[];
    activationTags?: string[];
    dependsOn?: string[];
    timeframes?: string[];
    indicators?: string[];
}

// ─── Memory ─────────────────────────────────────────────────────────────────

export interface TeamMemoryRecord {
    teamId: string;
    userId: string;
    updatedAt: number;
    preferences: Record<string, string | number | boolean>;
    preferredMarkets: string[];
    preferredTimeframes: string[];
    strategyPreferences: string[];
    previousResearch: { id: string; title: string; at: number; summary: string }[];
    validatedSetups: { id: string; market: string; at: number; note: string }[];
    rejectedSetups: { id: string; market: string; at: number; note: string }[];
    agentPerformance: Record<
        string,
        { runs: number; completed: number; failed: number; avgConfidence: number }
    >;
    notes?: string;
}

// ─── Agent run execution events (for live UI) ───────────────────────────────

export interface AgentStateEvent {
    agentId: string;
    state: AgentRunStatus;
    at: number;
    detail?: string;
}

// ─── Product analytics ──────────────────────────────────────────────────────

export type AITeamEventType =
    | "team_created"
    | "team_updated"
    | "team_deleted"
    | "team_run_started"
    | "team_run_completed"
    | "team_run_failed"
    | "team_run_cancelled"
    | "agent_run_started"
    | "agent_run_completed"
    | "agent_run_failed"
    | "agent_created"
    | "custom_agent_created"
    | "custom_agent_deleted"
    | "template_used";

export interface AITeamAnalyticsEvent {
    id: string;
    type: AITeamEventType;
    userId: string;
    teamId?: string;
    runId?: string;
    agentId?: string;
    templateId?: string;
    at: number;
    meta?: Record<string, string | number | boolean>;
}
