/**
 * AI Trading Teams — offline test suite.
 *
 * Runs entirely without network or Firebase: synthetic candles, an injected
 * deterministic loader and a scripted AI function.
 *
 * Coverage (spec §38):
 *   agent schema validation · team schema validation · permissions/ownership ·
 *   feature-flag gating · orchestration · dependencies · parallel execution ·
 *   timeouts · failure handling · graceful provider failure · output
 *   validation · FACT grounding · historical replay isolation (no future
 *   leakage) · custom agent security · versioning · memory validation.
 */

import { validateRunMode } from "../validation";
import {
    extractIntentsFromRequest,
    isValidId,
    validateAgentDefinition,
    validateAgentIdList,
    validateAgentOutput,
    validateCustomAgentInput,
    validateTeamConfig,
    assertTeamOwnership,
    filterOwned,
    enforcePointInTime,
    sanitizeMemoryUpdates,
} from "../validation";
import { BUILTIN_TEAM_AGENTS, CHIEF_AGENT_ID, DEFAULT_TEAM_AGENT_IDS, getBuiltinTeamAgent } from "../agent-library";
import { BUILTIN_TEAM_TEMPLATES } from "../templates";
import { ALLOWED_AGENT_TOOLS } from "../types";
import type { AITradingTeam, TeamAgentDefinition, TeamRun } from "../types";
import { buildDossier, sliceDossierForAgent } from "../context";
import { analyzeConsensus, evaluateBehaviorGate, planWaves, runTeamAnalysis, selectRelevantAgents } from "../orchestrator";
import type { AICallRequest, AICallResult } from "../agent-executor";
import { nextVersion } from "../versioning";

// ─── harness ────────────────────────────────────────────────────────────────

export async function runAITradingTeamsTests(): Promise<boolean> {
    let passed = 0;
    let failed = 0;

    const check = (cond: boolean, label: string) => {
        if (cond) {
            passed += 1;
            console.log(`  ok   ${label}`);
        } else {
            failed += 1;
            console.error(`  FAIL ${label}`);
        }
    };

    const section = async (name: string, fn: () => Promise<void> | void) => {
        console.log(`\n▶ ${name}`);
        try {
            await fn();
        } catch (err) {
            failed += 1;
            console.error(`  FAIL section "${name}" threw:`, err);
        }
    };

    // ── fixtures ────────────────────────────────────────────────────────────

    const makeCandles = (count: number, endTs: number, stepMs = 5 * 60 * 1000) => {
        const out: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
        let price = 2000;
        for (let i = count - 1; i >= 0; i--) {
            const t = endTs - i * stepMs;
            const open = price;
            const close = price + Math.sin(i / 6) * 3.5 + ((i % 7) - 3) * 1.2;
            const high = Math.max(open, close) + 4;
            const low = Math.min(open, close) - 4;
            out.push({ timestamp: t, open, high, low, close, volume: 100 + (i % 40) });
            price = close;
        }
        return out;
    };

    const baseConfig = {
        market: "XAUUSD",
        style: "scalping" as const,
        entryTimeframe: "M5",
        confirmationTimeframe: "M15",
        contextTimeframe: "H1",
        riskProfile: "balanced" as const,
        behavior: "consensus" as const,
        intents: [] as string[],
    };

    const makeTeam = (overrides: Partial<AITradingTeam> = {}): AITradingTeam => ({
        id: "team_test",
        userId: "user-1",
        name: "XAUUSD Scalping Team",
        config: { ...baseConfig },
        agentIds: ["market-regime", "technical-analyst", "risk-manager", "contrarian", CHIEF_AGENT_ID],
        status: "active",
        version: 1,
        source: "user",
        createdAt: 1,
        updatedAt: 1,
        ...overrides,
    });

    const agentsFor = (...ids: string[]): TeamAgentDefinition[] =>
        ids.map((id) => {
            const agent = getBuiltinTeamAgent(id);
            if (!agent) throw new Error(`missing fixture agent ${id}`);
            return agent;
        });

    const memberJson = (stance: string, extra: Record<string, unknown> = {}) => ({
        summary: "Deterministic dossier reviewed; structured findings returned.",
        observations: [{ id: "obs_1", kind: "INTERPRETATION", text: "Bias leans constructive on provided data." }],
        evidence: [{ id: "ev_1", source: "regime" }],
        interpretation: "Evidence indicates continuation potential; confirmation still required.",
        stance,
        confidence: 0.7,
        invalidations: ["Return below the last confirmed swing invalidates the view."],
        risks: ["Event risk in the next session."],
        toolsUsed: ["regime"],
        limitations: ["OHLC only."],
        reasoningSummary: "Compared structure, regime and volatility sections of the dossier.",
        ...extra,
    });

    const chiefJson = {
        status: "final",
        setupState: "WATCHING",
        marketContext: "Regime and structure align; confirmation pending.",
        evidence: [{ id: "e1", kind: "FACT", text: "Regime classified as trending.", reference: "regime.label" }],
        bullishCase: ["Constructive structure."],
        bearishCase: ["No higher-timeframe confirmation."],
        risks: ["Event risk."],
        invalidations: ["Close below key level."],
        researchNextStep: "Re-check on next confirmation timeframe close.",
        confidence: 0.6,
        missingEvidence: ["Higher-timeframe confirmation."],
        synthesisNotes: "Conflicts reconciled by evidence weight.",
    };

    const ok = (content: unknown, provider = "gemini", model = "test-model"): AICallResult => ({
        ok: true,
        content: typeof content === "string" ? content : JSON.stringify(content),
        provider,
        model,
    });

    const buildDossierFor = async (asOf: number | null = null, mode: "live" | "replay" | "research" = "live") =>
        buildDossier({
            userId: "user-1",
            market: "XAUUSD",
            entryTimeframe: "M5",
            confirmationTimeframe: "M15",
            contextTimeframe: "H1",
            mode,
            asOf,
            deps: { fetchCandles: async () => makeCandles(160, asOf ?? Date.now()) },
        });

    // ── 1. Feature flags ────────────────────────────────────────────────────
    await section("Feature flags (staged rollout / rollback)", async () => {
        const { isAITeamsEnabled, isCustomAgentsEnabled, isAgentFactoryEnabled, featureFlagSnapshot } = await import("../flags");
        const saved = { ...process.env };
        try {
            delete process.env.AI_TRADING_TEAMS_ENABLED;
            delete process.env.AI_CUSTOM_AGENTS_ENABLED;
            delete process.env.AI_ADMIN_AGENT_FACTORY_ENABLED;
            check(isAITeamsEnabled() && isCustomAgentsEnabled() && isAgentFactoryEnabled(), "flags default to enabled when unset");

            process.env.AI_TRADING_TEAMS_ENABLED = "false";
            check(!isAITeamsEnabled(), "AI_TRADING_TEAMS_ENABLED=false disables the feature (rollback path)");
            check(!isCustomAgentsEnabled() && !isAgentFactoryEnabled(), "dependent flags follow the master flag");

            process.env.AI_TRADING_TEAMS_ENABLED = "1";
            process.env.AI_CUSTOM_AGENTS_ENABLED = "off";
            process.env.AI_ADMIN_AGENT_FACTORY_ENABLED = "true";
            check(isAITeamsEnabled(), "teams enabled with '1'");
            check(!isCustomAgentsEnabled(), "custom agents disabled with 'off'");
            check(isAgentFactoryEnabled(), "admin factory enabled with 'true'");

            const snapshot = featureFlagSnapshot();
            check(snapshot.aiTeamsEnabled && !snapshot.customAgentsEnabled, "snapshot reflects live flag values");
        } finally {
            process.env = saved;
        }
    });

    // ── 2. Team configuration schema ────────────────────────────────────────
    await section("Team schema validation", () => {
        const valid = validateTeamConfig({ ...baseConfig, market: "xauusd" });
        check(valid.valid, "valid config accepted");
        check((valid.value as { market: string }).market === "XAUUSD", "market normalized to uppercase");

        check(!validateTeamConfig({ ...baseConfig, style: "yolo" }).valid, "invalid style rejected");
        check(!validateTeamConfig({ ...baseConfig, riskProfile: "reckless" }).valid, "invalid risk profile rejected");
        check(!validateTeamConfig({ ...baseConfig, entryTimeframe: "?!?" }).valid, "invalid entry timeframe rejected");
        check(!validateTeamConfig({ ...baseConfig, market: "DROP TABLE" }).valid, "invalid market symbol rejected");
        check(!validateTeamConfig(null).valid, "non-object config rejected");

        const ids = ["market-regime", "risk-manager", "chief-analyst"];
        check(validateAgentIdList(ids).valid, "valid agent id list accepted");
        check(!validateAgentIdList([]).valid, "empty agent list rejected");
        check(!validateAgentIdList(["market-regime", "market-regime"]).valid, "duplicate agent id rejected");
        check(!validateAgentIdList(["../etc/passwd"]).valid, "path-traversal agent id rejected");
        check(!validateAgentIdList(new Array(20).fill("a").map((_, i) => `agent-${i}`)).valid, "agent count limit enforced");

        const intents = extractIntentsFromRequest("Build a conservative XAUUSD scalping team with risk validation");
        check(intents.includes("scalping") && intents.includes("risk"), "intents extracted from natural language");
    });

    // ── 3. Agent library + templates integrity ──────────────────────────────
    await section("Agent library & templates", () => {
        check(BUILTIN_TEAM_AGENTS.length === 12, "12 built-in agents ship");
        const ids = BUILTIN_TEAM_AGENTS.map((a) => a.id);
        check(new Set(ids).size === ids.length, "agent ids are unique");
        check(CHIEF_AGENT_ID === "chief-analyst" && getBuiltinTeamAgent("chief-analyst")?.isChief === true, "chief agent flagged");
        check(DEFAULT_TEAM_AGENT_IDS.includes(CHIEF_AGENT_ID), "default team includes the chief");

        let allValid = true;
        for (const agent of BUILTIN_TEAM_AGENTS) {
            const validation = validateAgentDefinition(agent, { custom: false });
            if (!validation.valid) {
                allValid = false;
                console.error(`    invalid builtin ${agent.id}:`, validation.errors);
            }
            if (!agent.tools.every((t) => (ALLOWED_AGENT_TOOLS as string[]).includes(t))) allValid = false;
            if (agent.activationTags.length === 0) allValid = false;
            if (agent.limitations.length === 0) allValid = false;
        }
        check(allValid, "every built-in agent validates and uses allow-listed tools only");

        for (const template of BUILTIN_TEAM_TEMPLATES) {
            const config = validateTeamConfig(template.config);
            const agentIds = validateAgentIdList(template.agentIds);
            const known = template.agentIds.every((id) => getBuiltinTeamAgent(id) !== undefined);
            check(config.valid && agentIds.valid && known, `template "${template.id}" validates (config, ids, known agents)`);
            check(template.agentIds.includes(CHIEF_AGENT_ID), `template "${template.id}" includes a Chief Analyst`);
        }
    });

    // ── 4. Output protocol + FACT grounding ─────────────────────────────────
    await section("Structured output validation & evidence grounding", () => {
        const refs = new Set(["regime.label", "volatility.atr"]);
        const good = validateAgentOutput("market-regime", memberJson("bullish"), refs, { agentVersion: "1.0.0" });
        check(good.valid && good.value?.status === "completed", "valid output accepted");
        check(good.value?.agentVersion === "1.0.0", "agent version snapshotted onto output");
        check(good.demoted.length === 0, "no demotions for grounded output");

        const uncitedFact = validateAgentOutput(
            "market-regime",
            memberJson("bullish", {
                observations: [{ id: "o", kind: "FACT", text: "Price is at 4000.", reference: "made.up.ref" }],
            }),
            refs,
        );
        check(uncitedFact.valid, "output still structurally valid");
        check(uncitedFact.demoted.length === 1, "uncited FACT demoted");
        check(uncitedFact.value?.observations[0]?.kind === "UNKNOWN", "demoted FACT reclassified as UNKNOWN");

        const citedFact = validateAgentOutput(
            "market-regime",
            memberJson("bullish", {
                observations: [{ id: "o", kind: "FACT", text: "Regime classified trending.", reference: "regime.label" }],
            }),
            refs,
        );
        check(citedFact.value?.observations[0]?.kind === "FACT", "cited FACT preserved");

        const missingSummary = validateAgentOutput("x", { ...memberJson("bullish"), summary: "" }, refs);
        check(!missingSummary.valid, "missing summary rejected");

        const badStance = validateAgentOutput("x", memberJson("to-the-moon"), refs);
        check(badStance.value?.stance === "unclear", "invalid stance degrades to unclear, never crashes");

        const badKind = validateAgentOutput(
            "x",
            memberJson("neutral", { observations: [{ id: "o", kind: "VERIFIED_BY_GOD", text: "trust me" }] }),
            refs,
        );
        check(!badKind.valid, "invalid evidence kind rejected");
    });

    // ── 5. Custom agent security boundaries ─────────────────────────────────
    await section("Custom agent security (spec §16)", () => {
        const base = {
            name: "Fibonacci Specialist",
            description: "Retracement-based confluence analysis for entries.",
            category: "research",
            visualType: "research-lens",
            systemInstructions: "You analyze fibonacci retracements using only the provided dossier sections.",
            tools: ["technical_indicators", "market_structure"],
            activationTags: ["setup-validation"],
        };

        const good = validateCustomAgentInput(base, "user-1");
        check(good.valid, "valid custom agent accepted");
        check((good.value as TeamAgentDefinition).builtin === false, "custom agent is never builtin");
        check((good.value as TeamAgentDefinition).isChief !== true, "custom agent cannot claim chief status");

        const chiefClaim = validateCustomAgentInput({ ...base, category: "chief" }, "user-1");
        check(chiefClaim.valid, "chief-claiming custom agent still validates after coercion");
        check((chiefClaim.value as TeamAgentDefinition).category === "research", "chief custom agent demoted to research");

        const badTool = validateCustomAgentInput({ ...base, tools: ["read_admin_secrets"] }, "user-1");
        check(!badTool.valid, "disallowed tool rejected");

        const shortInstructions = validateCustomAgentInput({ ...base, systemInstructions: "be smart" }, "user-1");
        check(!shortInstructions.valid, "too-short instructions rejected");

        const noOwner = validateCustomAgentInput(base, "");
        check(!noOwner.valid, "custom agent requires an authenticated owner");

        const nested = validateCustomAgentInput({ ...base, dependsOn: ["custom_user2_ab12"] }, "user-1");
        check(!nested.valid, "custom agents cannot depend on other custom agents");
    });

    // ── 6. Ownership / authorization ────────────────────────────────────────
    await section("Ownership & authorization helpers", () => {
        check(assertTeamOwnership({ userId: "user-1" }, "user-1", false).valid, "owner granted");
        check(!assertTeamOwnership({ userId: "user-1" }, "user-2", false).valid, "stranger denied");
        check(assertTeamOwnership({ userId: "user-1" }, "user-2", true).valid, "admin granted");

        const records = [{ userId: "user-1" }, { userId: "user-2" }];
        check(filterOwned(records, "user-1", false).length === 1, "records filtered to owner");
        check(filterOwned(records, "user-1", true).length === 2, "admin sees all records");

        check(!isValidId("../secret"), "path traversal id rejected");
        check(!isValidId("a".repeat(100)), "overlong id rejected");
        check(isValidId("team_abc-123"), "normal id accepted");
    });

    // ── 7. Point-in-time safety (no future leakage) ─────────────────────────
    await section("Historical replay isolation (spec §33/§34)", async () => {
        const mode = validateRunMode({ mode: "live" });
        check(mode.valid && (mode.value as { asOf: number | null }).asOf === null, "live mode needs no cutoff");

        const replayNoAsOf = validateRunMode({ mode: "replay" });
        check(!replayNoAsOf.valid, "replay without asOf rejected");

        const future = validateRunMode({ mode: "replay", asOf: Date.now() + 10 * 60 * 60 * 1000 });
        check(!future.valid, "future asOf rejected");

        const now = Date.now();
        const past = now - 60 * 60 * 1000;
        const candles = makeCandles(100, now);
        const stripped = enforcePointInTime(candles, past);
        check(stripped.length > 0 && stripped.every((c) => c.timestamp <= past), "future candles stripped at cutoff");

        // Full dossier build with a loader that IGNORES the `to` filter and
        // returns future candles: the context builder must still strip them.
        const dossier = await buildDossier({
            userId: "user-1",
            market: "XAUUSD",
            entryTimeframe: "M5",
            confirmationTimeframe: "M15",
            contextTimeframe: "H1",
            mode: "replay",
            asOf: past,
            deps: { fetchCandles: async () => makeCandles(160, now) },
        });
        const recent = (dossier.payloads.recentCandles ?? {}) as { recent?: { t: number }[] };
        const allTimestamps = (recent.recent ?? []).map((c) => c.t);
        check(allTimestamps.length > 0, "dossier still built for the historical window");
        check(allTimestamps.every((t) => t <= past), "no candle beyond asOf reaches agents");
        check(dossier.meta.asOf === past && dossier.meta.mode === "replay", "mode + asOf recorded on dossier meta");

        const slice = sliceDossierForAgent(dossier, agentsFor("price-action")[0]);
        const sliceJson = JSON.stringify(slice.data);
        const leaked = JSON.parse(sliceJson) as { recentCandles?: { recent?: { t: number }[] } };
        const sliceTimes = (leaked.recentCandles?.recent ?? []).map((c) => c.t);
        check(sliceTimes.length > 0, "price-action slice includes the recent candle window");
        check(sliceTimes.every((t) => t <= past), "agent slice contains no post-cutoff candles");
    });

    // ── 8. Relevance selection ──────────────────────────────────────────────
    await section("Relevance filtering (spec §8)", () => {
        const members = BUILTIN_TEAM_AGENTS.filter((a) => !a.isChief);
        const technicalOnly = selectRelevantAgents({
            agents: members,
            request: "Analyze RSI divergence on EURUSD technical structure",
            config: { ...baseConfig },
        });
        check(technicalOnly.selected.some((a) => a.id === "technical-analyst"), "technical agent selected for a technical question");
        check(!technicalOnly.selected.some((a) => a.id === "macro-news"), "macro agent not woken for a technical-only question");
        check(!technicalOnly.selected.some((a) => a.id === "quant-research"), "quant agent not woken for a technical-only question");
        check(technicalOnly.skipped.length > 0 && technicalOnly.skipped.every((s) => s.reason.startsWith("Not relevant")), "skipped agents carry an explicit reason");

        const riskFirst = selectRelevantAgents({
            agents: members,
            request: "pure technical question about RSI",
            config: { ...baseConfig, behavior: "risk-first", behaviorRules: { requireRiskValidation: true } },
        });
        check(riskFirst.selected.some((a) => a.id === "risk-manager"), "risk-first behavior forces the Risk Manager in");

        const noIntents = selectRelevantAgents({ agents: members, request: "", config: { ...baseConfig, intents: [] } });
        check(noIntents.selected.length === members.length, "no intents → full team runs (conservative default)");
    });

    // ── 9. Dependencies & waves ─────────────────────────────────────────────
    await section("Dependency planning", () => {
        const withDeps: TeamAgentDefinition[] = [
            { ...getBuiltinTeamAgent("technical-analyst")!, dependsOn: ["market-regime"] },
            getBuiltinTeamAgent("market-regime")!,
            getBuiltinTeamAgent("risk-manager")!,
            getBuiltinTeamAgent("chief-analyst")!,
        ];
        const plan = planWaves(withDeps);
        const regimeWave = plan.waves.findIndex((w) => w.includes("market-regime"));
        const techWave = plan.waves.findIndex((w) => w.includes("technical-analyst"));
        const chiefWave = plan.waves.findIndex((w) => w.includes(CHIEF_AGENT_ID));
        check(regimeWave < techWave, "dependent agent runs after its dependency");
        check(chiefWave === plan.waves.length - 1, "chief analyst always runs last");

        const cyclic: TeamAgentDefinition[] = [
            { ...getBuiltinTeamAgent("technical-analyst")!, dependsOn: ["risk-manager"] },
            { ...getBuiltinTeamAgent("risk-manager")!, dependsOn: ["technical-analyst"] },
            getBuiltinTeamAgent("chief-analyst")!,
        ];
        const cyclicPlan = planWaves(cyclic);
        check(cyclicPlan.skipped.length === 2 && cyclicPlan.skipped.every((s) => s.reason.includes("cycle")), "cyclic dependencies skipped with a reason");
        check(cyclicPlan.waves.flat().includes(CHIEF_AGENT_ID), "chief still planned when members are invalid");
    });

    // ── 10. Consensus / conflict analysis ───────────────────────────────────
    await section("Deterministic conflict analysis (spec §12)", () => {
        const outputs = [
            { agentId: "a", status: "completed" as const, stance: "bullish" as const, confidence: 0.8, risks: ["r1"], invalidations: ["i1"], observations: [] },
            { agentId: "b", status: "completed" as const, stance: "bullish" as const, confidence: 0.7, risks: [], invalidations: [], observations: [] },
            { agentId: "c", status: "completed" as const, stance: "bearish" as const, confidence: 0.6, risks: [], invalidations: [], observations: [] },
            { agentId: "risk-manager", status: "completed" as const, stance: "neutral" as const, confidence: 0.5, risks: ["r1", "r2", "r3"], invalidations: [], observations: [] },
        ];
        const consensus = analyzeConsensus(outputs as never, []);
        check(consensus.stance === "bullish", "majority stance detected");
        check(consensus.conflicts.some((c) => c.kind === "stance"), "bull/bear disagreement reported as a conflict");
        check(consensus.criticalRisks.length === 3, "risk manager risks surfaced as critical risks");
        check(consensus.agentsByStance.bullish.length === 2, "stance grouping correct");
        check(consensus.invalidations.includes("i1"), "invalidations aggregated");

        const split = analyzeConsensus(
            [
                { agentId: "a", status: "completed", stance: "bullish", confidence: 0.6, risks: [], invalidations: [], observations: [] },
                { agentId: "b", status: "completed", stance: "bearish", confidence: 0.6, risks: [], invalidations: [], observations: [] },
            ] as never,
            [],
        );
        check(split.stance === "split", "tied stances report split, not a fabricated score");

        const skippedGaps = analyzeConsensus([], [{ agentId: "quant-research", reason: "Not relevant." }]);
        check(skippedGaps.missingEvidence.length > 0, "skipped agents appear as missing evidence");

        const gate = evaluateBehaviorGate({
            config: { ...baseConfig, behavior: "risk-first", behaviorRules: { requireRiskValidation: true } },
            outputs: outputs.filter((o) => o.agentId !== "risk-manager") as never,
            consensus,
        });
        check(Boolean(gate.blocked && gate.reason?.includes("Risk")), "risk-first gate blocks when Risk validation is missing");

        const satisfied = evaluateBehaviorGate({
            config: { ...baseConfig, behavior: "risk-first", behaviorRules: { requireRiskValidation: true } },
            outputs: outputs as never,
            consensus,
        });
        check(!satisfied.blocked, "risk gate satisfied when the Risk Manager completed");
    });

    // ── 11. End-to-end orchestration ────────────────────────────────────────
    await section("Orchestrator end-to-end (parallel, conflicts, synthesis)", async () => {
        const dossier = await buildDossierFor();
        const team = makeTeam();
        const agents = agentsFor("market-regime", "technical-analyst", "risk-manager", "contrarian", CHIEF_AGENT_ID);

        let inFlight = 0;
        let maxInFlight = 0;
        const starts: number[] = [];
        const ai = async (request: AICallRequest): Promise<AICallResult> => {
            if (request.sourceId === CHIEF_AGENT_ID) return ok(chiefJson);
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            starts.push(Date.now());
            await new Promise((resolve) => setTimeout(resolve, 25));
            inFlight -= 1;
            const stance = request.sourceId === "contrarian" ? "bearish" : request.sourceId === "risk-manager" ? "neutral" : "bullish";
            return ok(memberJson(stance));
        };

        const progress: TeamRun[] = [];
        const run = await runTeamAnalysis({
            runId: "run_1",
            userId: "user-1",
            team,
            agents,
            ai,
            dataMode: "live",
            asOf: null,
            dossier,
            onProgress: (patch) => {
                progress.push(patch as TeamRun);
            },
        });

        check(run.status === "completed", `happy-path run completes (got ${run.status})`);
        check(maxInFlight >= 2, "members of the same wave execute in parallel");
        check(run.waves.length === 2, "two waves planned (members, chief)");
        check(Boolean(run.consensus?.conflicts.some((c) => c.kind === "stance")), "disagreement visible in run consensus");
        check(run.consensus?.stance === "bullish", "consensus stance computed deterministically");
        check(run.synthesis !== null && run.synthesis.setupState === "WATCHING", "chief synthesis present with setup state");
        check(run.synthesis?.status === "final", "synthesis marked final when gates pass");
        check(Boolean(run.synthesis?.disclaimer.includes("not financial advice")), "legal/financial disclaimer attached");
        check(run.budget.agentsExecuted === 5, "every selected agent executed");
        check(run.budget.aiCalls === 5, "AI call budget counted");
        check(progress.length >= 3, "progress callbacks streamed for the live UI");
        check(run.timeline.length >= 5, "execution timeline recorded");
        check(Object.keys(run.agentVersions).length === 5, "agent versions snapshotted onto the run");
        check(run.agentOutputs[CHIEF_AGENT_ID]?.status === "completed", "chief analyst output recorded");

        // Replay-labelled run carries its mode through to synthesis freshness.
        const replayDossier = await buildDossierFor(Date.now() - 3600_000, "replay");
        const replayRun = await runTeamAnalysis({
            runId: "run_replay",
            userId: "user-1",
            team,
            agents,
            ai: async (request) => (request.sourceId === CHIEF_AGENT_ID ? ok(chiefJson) : ok(memberJson("neutral"))),
            dataMode: "replay",
            asOf: Date.now() - 3600_000,
            dossier: replayDossier,
        });
        check(replayRun.dataMode === "replay" && replayRun.synthesis?.dataFreshness.mode === "replay", "replay runs labelled HISTORICAL REPLAY end-to-end");
    });

    // ── 12. Failure, timeout, retry, cancellation ────────────────────────────
    await section("Failure handling, timeouts, retries, cancellation", async () => {
        const dossier = await buildDossierFor();
        const team = makeTeam();
        const agents = agentsFor("market-regime", "technical-analyst", "risk-manager", "contrarian", CHIEF_AGENT_ID);

        // a) provider failure → structured failure, no fabricated analysis
        const failingRun = await runTeamAnalysis({
            runId: "run_fail",
            userId: "user-1",
            team,
            agents,
            ai: async () => ({ ok: false, content: "", error: "All AI providers failed." }),
            dataMode: "live",
            asOf: null,
            dossier,
        });
        check(failingRun.status === "failed", "all-provider failure produces a failed run");
        check(failingRun.agentOutputs["market-regime"]?.observations.length === 0, "failed agent fabricates no observations");
        check(failingRun.synthesis?.status !== "final", "no final synthesis on total failure");
        check(failingRun.synthesis?.setupState !== "CONFIRMED", "never claims CONFIRMED without evidence");
        check(failingRun.budget.aiFailures > 0, "provider failures counted in the budget");

        // b) partial failure → partial completion, others unaffected
        const partialRun = await runTeamAnalysis({
            runId: "run_partial",
            userId: "user-1",
            team,
            agents,
            ai: async (request) =>
                request.sourceId === CHIEF_AGENT_ID
                    ? ok(chiefJson)
                    : request.sourceId === "technical-analyst"
                        ? { ok: false, content: "", error: "TIMEOUT" }
                        : ok(memberJson("bullish")),
            dataMode: "live",
            asOf: null,
            dossier,
        });
        check(partialRun.status === "partial", "one failed agent → partial run");
        check(partialRun.agentOutputs["technical-analyst"]?.status === "failed", "failed agent marked failed");
        check(partialRun.agentOutputs["market-regime"]?.status === "completed", "other agents unaffected by a sibling failure");
        check(partialRun.synthesis !== null, "chief still synthesizes available evidence");

        // c) invalid JSON → retry → success on second attempt
        let attempts = 0;
        const retryRun = await runTeamAnalysis({
            runId: "run_retry",
            userId: "user-1",
            team,
            agents: agentsFor("market-regime", CHIEF_AGENT_ID),
            ai: async (request) => {
                if (request.sourceId === CHIEF_AGENT_ID) return ok(chiefJson);
                attempts += 1;
                if (attempts === 1) return ok("this is not json {");
                return ok(memberJson("neutral"));
            },
            dataMode: "live",
            asOf: null,
            dossier,
        });
        check(attempts === 2 && retryRun.agentOutputs["market-regime"]?.status === "completed", "invalid output retried once then validated");

        // d) timeout → structured failure after retry budget
        const slowAgents = agentsFor("market-regime", CHIEF_AGENT_ID).map((a) =>
            a.id === "market-regime" ? { ...a, timeoutMs: 40, maxRetries: 0 } : a,
        );
        const timeoutRun = await runTeamAnalysis({
            runId: "run_timeout",
            userId: "user-1",
            team,
            agents: slowAgents,
            ai: async (request) =>
                request.sourceId === CHIEF_AGENT_ID
                    ? ok(chiefJson)
                    : new Promise<AICallResult>(() => {
                          /* never resolves */
                      }),
            dataMode: "live",
            asOf: null,
            dossier,
        });
        check(timeoutRun.agentOutputs["market-regime"]?.status === "failed", "hung agent fails after its timeout");
        check((timeoutRun.agentOutputs["market-regime"]?.error ?? "").includes("timed out"), "timeout surfaced in the structured error");

        // e) cancellation before execution
        const cancelRun = await runTeamAnalysis({
            runId: "run_cancel",
            userId: "user-1",
            team,
            agents,
            ai: async () => ok(memberJson("neutral")),
            isCancelled: async () => true,
            dataMode: "live",
            asOf: null,
            dossier,
        });
        check(cancelRun.status === "cancelled", "pre-cancelled run is cancelled");
        check(cancelRun.budget.agentsExecuted === 0, "cancelled run burns no agent executions");
        check(cancelRun.timeline.some((t) => t.text.includes("cancelled")), "cancellation recorded on the timeline");
        check(cancelRun.synthesis?.setupState === "CANCELLED", "cancelled run reports CANCELLED setup state");

        // f) market data unavailable → fail-safe, no fake results
        const emptyDossier = await buildDossier({
            userId: "user-1",
            market: "NOTAMARKET",
            entryTimeframe: "M5",
            confirmationTimeframe: "M15",
            contextTimeframe: "H1",
            mode: "live",
            asOf: null,
            deps: { fetchCandles: async () => [] },
        });
        const noDataRun = await runTeamAnalysis({
            runId: "run_nodata",
            userId: "user-1",
            team,
            agents,
            ai: async () => ok(memberJson("neutral")),
            dataMode: "live",
            asOf: null,
            dossier: emptyDossier,
        });
        check(noDataRun.status === "failed", "missing market data fails the run safely");
        check(noDataRun.errors.some((e) => e.includes("Market data unavailable")), "market-data failure reported explicitly");

        // g) local heuristic fallback → low-trust warning surfaced
        const localRun = await runTeamAnalysis({
            runId: "run_local",
            userId: "user-1",
            team,
            agents: agentsFor("market-regime", CHIEF_AGENT_ID),
            ai: async (request) =>
                request.sourceId === CHIEF_AGENT_ID ? ok(chiefJson, "local", "heuristic") : ok(memberJson("neutral"), "local", "heuristic"),
            dataMode: "live",
            asOf: null,
            dossier,
        });
        check(
            (localRun.agentOutputs["market-regime"]?.warnings ?? []).some((w) => w.includes("local heuristic")),
            "local fallback provider flagged as low-trust narration",
        );
    });

    // ── 13. Memory validation ───────────────────────────────────────────────
    await section("Team memory validation (spec §17)", () => {
        const good = sanitizeMemoryUpdates({ notes: "Prefer M5 entries", strategyPreferences: ["breakout", "liquidity sweep"] });
        check(good.valid && good.updates?.notes === "Prefer M5 entries", "valid memory update accepted");

        const badPrefs = sanitizeMemoryUpdates({ preferences: { nested: { evil: true } } });
        check(!badPrefs.valid, "non-scalar memory preference rejected");

        const badList = sanitizeMemoryUpdates({ strategyPreferences: "not-an-array" });
        check(!badList.valid, "non-array strategy preferences rejected");
    });

    // ── 14. Versioning ──────────────────────────────────────────────────────
    await section("Agent versioning (spec §40)", () => {
        check(nextVersion("1.0.0") === "1.0.1", "patch version increments");
        check(nextVersion("2.9.9") === "2.9.10", "patch version rolls over digit");
        check(nextVersion("garbage") === "garbage.0.1" || nextVersion("garbage").startsWith("garbage."), "malformed version degrades safely");
    });

    console.log(`\nAI Trading Teams tests: ${passed} passed, ${failed} failed.`);
    return failed === 0;
}
