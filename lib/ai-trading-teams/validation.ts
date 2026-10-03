/**
 * Validation layer for AI Trading Teams.
 *
 * Everything that crosses a trust boundary is validated here:
 *  - team configurations (including NL-generated ones — never trusted blindly)
 *  - agent definitions (built-in, admin, custom)
 *  - agent outputs (structured protocol + FACT reference checking)
 *  - ids, ownership and tool permissions
 *
 * No I/O in this module.
 */

import {
    AITradingTeam,
    AgentObservation,
    AgentRunOutput,
    ALLOWED_AGENT_TOOLS,
    AgentTool,
    CustomAgentInput,
    EVIDENCE_KINDS,
    EvidenceKind,
    TeamAgentDefinition,
    TeamConfig,
    TeamDataMode,
    TradingStyle,
    RiskProfile,
    TeamBehavior,
    TeamMemoryRecord,
} from "./types";

// ─── primitives ─────────────────────────────────────────────────────────────

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MARKET_RE = /^[A-Za-z0-9/_:-]{2,20}$/;
const TIMEFRAME_RE = /^[0-9]*[mMdDwWhH][0-9]*$|^(M|H|D|W|W1|MN)[0-9]*$/i;

export function isValidId(id: unknown): id is string {
    return typeof id === "string" && ID_RE.test(id);
}

export function isValidMarket(market: unknown): market is string {
    return typeof market === "string" && MARKET_RE.test(market.trim());
}

export function isValidTimeframe(tf: unknown): tf is string {
    return typeof tf === "string" && tf.length <= 6 && TIMEFRAME_RE.test(tf.trim());
}

export function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}

export function asString(value: unknown, fallback = "", max = 2000): string {
    if (typeof value !== "string") return fallback;
    return value.slice(0, max);
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    /** Sanitized value — only meaningful when `valid` is true. */
    value?: unknown;
}

const ok = (value: unknown): ValidationResult => ({ valid: true, errors: [], value });
const fail = (...errors: string[]): ValidationResult => ({ valid: false, errors });

// ─── team configuration ─────────────────────────────────────────────────────

const TRADING_STYLES: TradingStyle[] = ["scalping", "intraday", "swing", "position", "research"];
const RISK_PROFILES: RiskProfile[] = ["conservative", "balanced", "aggressive"];
const TEAM_BEHAVIORS: TeamBehavior[] = [
    "consensus",
    "evidence-weighted",
    "risk-first",
    "research-first",
    "custom",
];

export const MAX_AGENTS_PER_TEAM = 12;

/**
 * Validates a team configuration. Used for user-created, template-derived AND
 * LLM-generated (natural-language) configurations — raw model output is never
 * stored blindly (spec §6).
 */
export function validateTeamConfig(input: unknown): ValidationResult {
    if (!input || typeof input !== "object") return fail("Config must be an object.");
    const raw = input as Record<string, unknown>;
    const errors: string[] = [];

    const market = typeof raw.market === "string" ? raw.market.trim().toUpperCase() : "";
    if (!isValidMarket(market)) errors.push("Invalid market symbol.");

    const style = raw.style as TradingStyle;
    if (!TRADING_STYLES.includes(style)) errors.push(`Invalid trading style: ${String(raw.style)}.`);

    const entryTimeframe = asString(raw.entryTimeframe).trim().toUpperCase();
    const confirmationTimeframe = asString(raw.confirmationTimeframe).trim().toUpperCase();
    const contextTimeframe = asString(raw.contextTimeframe).trim().toUpperCase();
    if (!isValidTimeframe(entryTimeframe)) errors.push("Invalid entry timeframe.");
    if (!isValidTimeframe(confirmationTimeframe)) errors.push("Invalid confirmation timeframe.");
    if (!isValidTimeframe(contextTimeframe)) errors.push("Invalid context timeframe.");

    const riskProfile = raw.riskProfile as RiskProfile;
    if (!RISK_PROFILES.includes(riskProfile)) errors.push(`Invalid risk profile: ${String(raw.riskProfile)}.`);

    const behavior = (raw.behavior ?? "evidence-weighted") as TeamBehavior;
    if (!TEAM_BEHAVIORS.includes(behavior)) errors.push(`Invalid team behavior: ${String(raw.behavior)}.`);

    const intents = Array.isArray(raw.intents)
        ? raw.intents.filter((i): i is string => typeof i === "string").slice(0, 16)
        : [];

    let behaviorRules: TeamConfig["behaviorRules"] | undefined;
    if (raw.behaviorRules && typeof raw.behaviorRules === "object") {
        const rr = raw.behaviorRules as Record<string, unknown>;
        behaviorRules = {};
        if (typeof rr.requireRiskValidation === "boolean") behaviorRules.requireRiskValidation = rr.requireRiskValidation;
        if (typeof rr.requireQuantValidation === "boolean") behaviorRules.requireQuantValidation = rr.requireQuantValidation;
        if (typeof rr.minConsensusConfidence === "number") {
            behaviorRules.minConsensusConfidence = clamp(rr.minConsensusConfidence, 0, 1);
        }
    }

    if (errors.length) return fail(...errors);

    const config: TeamConfig = {
        market,
        style,
        entryTimeframe,
        confirmationTimeframe,
        contextTimeframe,
        riskProfile,
        behavior,
        intents,
    };
    if (behaviorRules) config.behaviorRules = behaviorRules;
    return ok(config);
}

/**
 * Natural-language intent → keywords used for relevance filtering.
 * Deliberately simple and deterministic: it never produces configuration
 * directly, only hints. `parseTeamRequest` in the API runs the LLM step and
 * always funnels the result through `validateTeamConfig`.
 */
export function extractIntentsFromRequest(request: string): string[] {
    const text = request.toLowerCase();
    const intents = new Set<string>();
    const has = (...words: string[]) => words.some((w) => text.includes(w));

    if (has("scalp", "scalping")) intents.add("scalping");
    if (has("trend", "regime", "range", "market environment")) intents.add("regime");
    if (has("smart money", "order block", "bos", "choch", "sweep", "fvg", "liquidity sweep")) intents.add("smart-money");
    if (has("structure", "support", "resistance", "indicator", "rsi", "divergence", "ema", "macd", "technical")) intents.add("technical");
    if (has("market structure", "structure", "swing high", "swing low", "bos", "choch")) intents.add("structure");
    if (has("price action", "candlestick", "pin bar", "engulf", "rejection")) intents.add("price-action");
    if (has("liquidity", "equal high", "equal low", "pool")) intents.add("liquidity");
    if (has("news", "macro", "event", "cpi", "nfp", "fed", "economic")) intents.add("macro");
    if (has("quant", "statistics", "volatility", "distribution", "correlation", "backtest")) intents.add("quant");
    if (has("research", "hypothesis", "walk forward", "monte carlo", "robustness")) intents.add("research");
    if (has("risk", "exposure", "drawdown", "stop", "position size")) intents.add("risk");
    if (has("contrarian", "counter", "against the crowd", "alternative")) intents.add("contrarian");
    if (has("validate", "setup", "entry", "confirmation", "checklist")) intents.add("setup-validation");
    if (has("watching", "waiting", "monitor")) intents.add("monitoring");

    // NOTE: when nothing matches, NO intent is returned — the orchestrator
    // then runs the full team (conservative default: under-filtering beats
    // over-filtering for a general market question).
    return Array.from(intents);
}

// ─── agent ids & team assembly ──────────────────────────────────────────────

export function validateAgentIdList(ids: unknown): ValidationResult {
    if (!Array.isArray(ids)) return fail("agentIds must be an array.");
    if (ids.length === 0) return fail("A team needs at least one agent.");
    if (ids.length > MAX_AGENTS_PER_TEAM) {
        return fail(`A team may contain at most ${MAX_AGENTS_PER_TEAM} agents.`);
    }
    const seen = new Set<string>();
    for (const id of ids) {
        if (!isValidId(id)) return fail(`Invalid agent id: ${String(id)}.`);
        if (seen.has(id)) return fail(`Duplicate agent id: ${id}.`);
        seen.add(id);
    }
    return ok(ids as string[]);
}

// ─── agent definitions ──────────────────────────────────────────────────────

const AGENT_CATEGORIES = [
    "regime",
    "smart-money",
    "technical",
    "price-action",
    "liquidity",
    "macro",
    "quant",
    "research",
    "risk",
    "contrarian",
    "validation",
    "chief",
];

const VISUAL_TYPES = [
    "market-pulse",
    "radar",
    "analytical-sphere",
    "signal-node",
    "liquidity-radar",
    "event-radar",
    "research-prism",
    "research-lens",
    "shield",
    "contrarian-core",
    "validation-gate",
    "chief-core",
];

export function sanitizeTools(input: unknown): { tools: AgentTool[]; rejected: string[] } {
    const list = Array.isArray(input) ? input : [];
    const tools: AgentTool[] = [];
    const rejected: string[] = [];
    for (const item of list) {
        if (typeof item === "string" && (ALLOWED_AGENT_TOOLS as string[]).includes(item)) {
            if (!tools.includes(item as AgentTool)) tools.push(item as AgentTool);
        } else {
            rejected.push(String(item).slice(0, 60));
        }
    }
    return { tools, rejected };
}

/**
 * Validates an agent definition (admin factory output or user custom agent).
 * Custom agents are constrained more tightly than admin/built-in ones.
 */
export function validateAgentDefinition(
    input: unknown,
    opts: { custom?: boolean; ownerUid?: string } = {},
): ValidationResult {
    if (!input || typeof input !== "object") return fail("Agent definition must be an object.");
    const raw = input as Record<string, unknown>;
    const errors: string[] = [];

    if (!isValidId(raw.id)) errors.push("Invalid agent id (alphanumeric, - and _ only).");
    const name = asString(raw.name, "", 80).trim();
    if (name.length < 3) errors.push("Agent name must be at least 3 characters.");
    const description = asString(raw.description, "", 600).trim();
    if (description.length < 10) errors.push("Agent description must be at least 10 characters.");

    if (!AGENT_CATEGORIES.includes(String(raw.category))) errors.push("Invalid agent category.");
    if (!VISUAL_TYPES.includes(String(raw.visualType))) errors.push("Invalid visual type.");

    const systemInstructions = asString(raw.systemInstructions, "", 8000).trim();
    if (systemInstructions.length < 20) {
        errors.push("System instructions must be at least 20 characters.");
    }
    if (opts.custom && systemInstructions.length > 4000) {
        errors.push("Custom agent system instructions are limited to 4000 characters.");
    }

    const { tools, rejected } = sanitizeTools(raw.tools);
    if (rejected.length) errors.push(`Disallowed tools: ${rejected.join(", ")}.`);
    if (tools.length === 0) errors.push("At least one allowed tool is required.");

    const capabilities = Array.isArray(raw.capabilities)
        ? raw.capabilities.filter((c): c is string => typeof c === "string").map((c) => c.slice(0, 80)).slice(0, 20)
        : [];

    const limitations = Array.isArray(raw.limitations)
        ? raw.limitations.filter((l): l is string => typeof l === "string").map((l) => l.slice(0, 300)).slice(0, 12)
        : [];

    const activationTags = Array.isArray(raw.activationTags)
        ? raw.activationTags.filter((t): t is string => typeof t === "string").map((t) => t.slice(0, 40)).slice(0, 16)
        : [];

    const requiredSections = Array.isArray(raw.requiredSections)
        ? raw.requiredSections.filter((s): s is string => typeof s === "string").map((s) => s.slice(0, 40)).slice(0, 12)
        : [];

    if (errors.length) return fail(...errors);

    const version = asString(raw.version, "1.0.0", 20) || "1.0.0";
    const definition: TeamAgentDefinition = {
        id: raw.id as string,
        name,
        description,
        category: raw.category as TeamAgentDefinition["category"],
        icon: asString(raw.icon, "Brain", 40) || "Brain",
        visualType: raw.visualType as TeamAgentDefinition["visualType"],
        version,
        enabled: raw.enabled !== false,
        builtin: opts.custom ? false : raw.builtin === true,
        systemInstructions,
        capabilities,
        tools,
        requiredInputs: Array.isArray(raw.requiredInputs)
            ? raw.requiredInputs.filter((i): i is string => typeof i === "string").slice(0, 12)
            : [],
        optionalInputs: Array.isArray(raw.optionalInputs)
            ? raw.optionalInputs.filter((i): i is string => typeof i === "string").slice(0, 12)
            : [],
        outputSchema: Array.isArray(raw.outputSchema)
            ? (raw.outputSchema as TeamAgentDefinition["outputSchema"]).slice(0, 24)
            : [],
        limitations,
        activationTags,
        requiredSections,
        status: raw.status === "disabled" || raw.status === "testing" || raw.status === "draft" ? raw.status : "active",
    };
    if (opts.ownerUid) definition.ownerUid = opts.ownerUid;
    if (typeof raw.maxOutputTokens === "number") definition.maxOutputTokens = clamp(raw.maxOutputTokens, 256, 8000);
    if (typeof raw.temperature === "number") definition.temperature = clamp(raw.temperature, 0, 1);
    if (typeof raw.timeoutMs === "number") definition.timeoutMs = clamp(raw.timeoutMs, 3000, 120000);
    if (typeof raw.maxRetries === "number") definition.maxRetries = clamp(raw.maxRetries, 0, 3);
    if (Array.isArray(raw.dependsOn)) {
        definition.dependsOn = raw.dependsOn.filter((d): d is string => isValidId(d)).slice(0, 6);
    }

    return ok(definition);
}

/** Custom-agent-specific security boundaries (spec §16). */
export function validateCustomAgentInput(input: unknown, ownerUid: string): ValidationResult {
    if (!ownerUid) return fail("Authentication required.");
    const base = validateAgentDefinition(
        {
            ...(typeof input === "object" && input !== null ? input : {}),
            id: `custom_${ownerUid.slice(0, 8)}_${Math.random().toString(36).slice(2, 8)}`,
            builtin: false,
            status: "active",
        },
        { custom: true, ownerUid },
    );
    if (!base.valid) return base;

    const agent = base.value as TeamAgentDefinition;
    // Custom agents may never claim chief status or run as system components.
    agent.isChief = false;
    agent.category = agent.category === "chief" ? "research" : agent.category;

    const custom = input as CustomAgentInput;
    // Custom agents cannot depend on other custom agents (only built-ins),
    // preventing unbounded dependency chains.
    if (Array.isArray((custom as { dependsOn?: unknown }).dependsOn)) {
        const deps = (custom as { dependsOn: unknown[] }).dependsOn;
        for (const dep of deps) {
            if (typeof dep === "string" && dep.startsWith("custom_")) {
                return fail("Custom agents cannot depend on other custom agents.");
            }
        }
    }
    return ok(agent);
}

// ─── agent output protocol ──────────────────────────────────────────────────

export interface OutputValidationResult {
    valid: boolean;
    errors: string[];
    /** Sanitized output when structurally acceptable. */
    value?: AgentRunOutput;
    /** Observations demoted because their FACT reference was not provided. */
    demoted: string[];
}

const STANCES = ["bullish", "bearish", "neutral", "mixed", "unclear"];

function sanitizeObservations(
    input: unknown,
    allowedRefs: Set<string>,
): { observations: AgentObservation[]; demoted: string[]; errors: string[] } {
    const observations: AgentObservation[] = [];
    const demoted: string[] = [];
    const errors: string[] = [];
    if (!Array.isArray(input)) return { observations, demoted, errors: ["observations must be an array."] };

    input.slice(0, 40).forEach((raw, index) => {
        if (!raw || typeof raw !== "object") return;
        const item = raw as Record<string, unknown>;
        const kind = String(item.kind || "").toUpperCase() as EvidenceKind;
        const text = asString(item.text, "", 800).trim();
        if (!text) return;
        if (!EVIDENCE_KINDS.includes(kind)) {
            errors.push(`Observation ${index}: invalid kind "${String(item.kind)}".`);
            return;
        }
        const reference = typeof item.reference === "string" ? item.reference.trim().slice(0, 120) : undefined;

        if (kind === "FACT") {
            if (!reference || !allowedRefs.has(reference)) {
                // Never allow an unverifiable claim to be presented as fact.
                demoted.push(text.slice(0, 120));
                observations.push({
                    id: `obs_${index}`,
                    kind: "UNKNOWN",
                    text: `${text} (unverified: reference not present in provided market data)`,
                    ...(reference ? { reference } : {}),
                });
                return;
            }
        }
        observations.push({
            id: `obs_${index}`,
            kind,
            text,
            ...(reference ? { reference } : {}),
        });
    });
    return { observations, demoted, errors };
}

/**
 * Validates one agent's structured output against the protocol (spec §9/§10).
 *
 * `allowedRefs` are the dossier source ids that were actually provided to the
 * agent. FACT observations without a valid reference are demoted to UNKNOWN —
 * the AI can never present an unverifiable claim as verified market fact.
 */
export function validateAgentOutput(
    agentId: string,
    input: unknown,
    allowedRefs: Set<string>,
    opts: { agentVersion?: string } = {},
): OutputValidationResult {
    if (!input || typeof input !== "object") {
        return { valid: false, errors: ["Output must be an object."], demoted: [] };
    }
    const raw = input as Record<string, unknown>;
    const errors: string[] = [];

    const summary = asString(raw.summary, "", 1200).trim();
    if (!summary) errors.push("summary is required.");

    const interpretation = asString(raw.interpretation, "", 2000).trim();

    const stanceRaw = String(raw.stance || "unclear").toLowerCase();
    const stance = (STANCES.includes(stanceRaw) ? stanceRaw : "unclear") as AgentRunOutput["stance"];

    const confidence = clamp(Number(raw.confidence ?? 0), 0, 1);

    const evidence = Array.isArray(raw.evidence)
        ? raw.evidence
            .slice(0, 30)
            .map((item, index) => {
                if (!item || typeof item !== "object") return null;
                const ev = item as Record<string, unknown>;
                const source = asString(ev.source, "", 160).trim();
                if (!source) return null;
                const out: AgentRunOutput["evidence"][number] = {
                    id: typeof ev.id === "string" ? ev.id.slice(0, 64) : `ev_${index}`,
                    source,
                };
                if (typeof ev.value === "string" || typeof ev.value === "number" || typeof ev.value === "boolean") {
                    out.value = ev.value;
                }
                if (typeof ev.note === "string") out.note = ev.note.slice(0, 400);
                return out;
            })
            .filter((item): item is NonNullable<typeof item> => item !== null)
        : [];

    const { observations, demoted, errors: obsErrors } = sanitizeObservations(raw.observations, allowedRefs);
    errors.push(...obsErrors);

    const invalidations = Array.isArray(raw.invalidations)
        ? raw.invalidations.filter((i): i is string => typeof i === "string").map((i) => i.slice(0, 300)).slice(0, 10)
        : [];
    const risks = Array.isArray(raw.risks)
        ? raw.risks.filter((r): r is string => typeof r === "string").map((r) => r.slice(0, 300)).slice(0, 10)
        : [];
    const limitations = Array.isArray(raw.limitations)
        ? raw.limitations.filter((l): l is string => typeof l === "string").map((l) => l.slice(0, 300)).slice(0, 10)
        : [];
    const toolsUsed = Array.isArray(raw.toolsUsed)
        ? raw.toolsUsed.filter((t): t is string => typeof t === "string").map((t) => t.slice(0, 40)).slice(0, 20)
        : [];

    if (errors.length) return { valid: false, errors, demoted };

    const value: AgentRunOutput = {
        agentId,
        agentVersion: opts.agentVersion ?? (asString(raw.agentVersion, "1.0.0", 20) || "1.0.0"),
        status: "completed",
        summary,
        observations,
        evidence,
        interpretation,
        stance,
        confidence,
        invalidations,
        risks,
        dataTimestamp: asString(raw.dataTimestamp, "", 40) || new Date().toISOString(),
        toolsUsed,
        limitations,
        reasoningSummary: asString(raw.reasoningSummary, "", 1200) || undefined,
    };

    return { valid: true, errors: [], value, demoted };
}

/** Required fields for the Chief Analyst synthesis output. */
export function validateSynthesis(input: unknown): ValidationResult {
    if (!input || typeof input !== "object") return fail("Synthesis must be an object.");
    const raw = input as Record<string, unknown>;
    const errors: string[] = [];

    const marketContext = asString(raw.marketContext, "", 2000).trim();
    if (!marketContext) errors.push("marketContext is required.");
    const researchNextStep = asString(raw.researchNextStep, "", 1200).trim();
    if (!researchNextStep) errors.push("researchNextStep is required.");

    const setupStates: SetupStateLike[] = ["WAITING", "WATCHING", "VALIDATING", "CONFIRMED", "INVALIDATED", "CANCELLED"];
    const setupState = String(raw.setupState || "").toUpperCase() as SetupStateLike;
    if (!setupStates.includes(setupState)) errors.push(`Invalid setup state: ${String(raw.setupState)}.`);

    if (errors.length) return fail(...errors);

    const listOf = (key: string, max = 8): string[] =>
        Array.isArray(raw[key])
            ? (raw[key] as unknown[]).filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 400)).slice(0, max)
            : [];

    return ok({
        setupState,
        marketContext,
        bullishCase: listOf("bullishCase"),
        bearishCase: listOf("bearishCase"),
        risks: listOf("risks"),
        invalidations: listOf("invalidations"),
        researchNextStep,
        confidence: clamp(Number(raw.confidence ?? 0), 0, 1),
    });
}

type SetupStateLike = "WAITING" | "WATCHING" | "VALIDATING" | "CONFIRMED" | "INVALIDATED" | "CANCELLED";

// ─── ownership & authorization helpers ──────────────────────────────────────

export function assertTeamOwnership(team: Pick<AITradingTeam, "userId">, uid: string, isAdmin: boolean): ValidationResult {
    if (team.userId === uid) return ok(true);
    if (isAdmin) return ok(true);
    return fail("You do not have access to this team.");
}

// ─── data mode / point-in-time safety (spec §33/§34) ────────────────────────

const DATA_MODES: TeamDataMode[] = ["live", "replay", "backtest", "research", "historical"];

/**
 * Validates the execution mode of a run. Any non-live mode MUST provide an
 * `asOf` cutoff so no future candles can reach the agents.
 */
export function validateRunMode(input: { mode?: unknown; asOf?: unknown }): ValidationResult {
    const mode = String(input.mode ?? "live") as TeamDataMode;
    if (!DATA_MODES.includes(mode)) return fail(`Invalid data mode: ${String(input.mode)}.`);

    if (mode === "live") {
        return ok({ mode: "live" as TeamDataMode, asOf: null });
    }

    const asOf = Number(input.asOf);
    if (!Number.isFinite(asOf) || asOf <= 0) {
        return fail(`Mode "${mode}" requires a point-in-time asOf timestamp.`);
    }
    if (asOf > Date.now() + 60_000) {
        return fail("asOf cannot be in the future.");
    }
    return ok({ mode, asOf: Math.floor(asOf) });
}

/**
 * Definitive future-leakage guard: filters a candle series to the point-in-time
 * cutoff. Called by the context builder AND covered by tests.
 */
export function enforcePointInTime<T extends { timestamp: number }>(
    candles: T[],
    asOf: number | null,
): T[] {
    if (!Array.isArray(candles)) return [];
    if (asOf === null) return candles;
    return candles.filter((c) => Number.isFinite(c.timestamp) && c.timestamp <= asOf);
}

/** Filters RTDB-styled records to the requesting owner (defense in depth). */
export function filterOwned<T extends { userId?: string }>(records: T[], uid: string, isAdmin: boolean): T[] {
    if (isAdmin) return records;
    return records.filter((r) => r.userId === uid);
}

// ─── team memory validation (spec §17) ──────────────────────────────────────

const MAX_MEMORY_PREFERENCES = 40;
const MAX_MEMORY_STRATEGY_PREFS = 20;

/**
 * Validates a structured team-memory update. Pure and Firebase-free so it can
 * run in tests and in any layer. Rejects non-scalar preferences instead of
 * silently dropping them — callers deserve an explicit error (spec §17).
 */
export function sanitizeMemoryUpdates(
    input: unknown,
): { valid: boolean; updates?: Partial<TeamMemoryRecord>; errors: string[] } {
    if (!input || typeof input !== "object") return { valid: false, errors: ["Memory update must be an object."] };
    const raw = input as Record<string, unknown>;
    const updates: Partial<TeamMemoryRecord> = {};
    const errors: string[] = [];

    if (raw.preferences !== undefined) {
        if (raw.preferences && typeof raw.preferences === "object" && !Array.isArray(raw.preferences)) {
            const entries = Object.entries(raw.preferences as Record<string, unknown>);
            const nonScalar = entries.filter(([, v]) => !["string", "number", "boolean"].includes(typeof v));
            if (nonScalar.length) {
                errors.push(`preferences must be scalar values (invalid: ${nonScalar.map(([k]) => k).slice(0, 5).join(", ")}).`);
            } else {
                updates.preferences = Object.fromEntries(entries.slice(0, MAX_MEMORY_PREFERENCES)) as Record<string, string | number | boolean>;
            }
        } else {
            errors.push("preferences must be an object of scalar values.");
        }
    }
    if (raw.strategyPreferences !== undefined) {
        if (Array.isArray(raw.strategyPreferences)) {
            updates.strategyPreferences = raw.strategyPreferences
                .filter((s): s is string => typeof s === "string")
                .map((s) => s.slice(0, 120))
                .slice(0, MAX_MEMORY_STRATEGY_PREFS);
        } else {
            errors.push("strategyPreferences must be an array of strings.");
        }
    }
    if (raw.notes !== undefined) {
        if (typeof raw.notes === "string") updates.notes = raw.notes.slice(0, 2000);
        else errors.push("notes must be a string.");
    }

    return errors.length ? { valid: false, errors } : { valid: true, updates, errors: [] };
}
