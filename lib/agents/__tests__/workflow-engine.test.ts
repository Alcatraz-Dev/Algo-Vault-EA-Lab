// Workflow Engine tests — repo custom-runner pattern (jiti), no vitest.
//
// Run: jiti lib/agents/__tests__/run-agents-tests.ts
// ─────────────────────────────────────────────────────────────────────────────

import {
    executeWorkflow,
    registerBuiltInExecutors,
} from "@/lib/agents/workflow-engine";
import { WorkflowDefinition, WorkflowContext } from "@/lib/agents/types";
import { EngineConfig } from "@/lib/agents/workflow-engine";

// Register built-in agent executors before running tests
registerBuiltInExecutors();

// ─── Test Helpers ─────────────────────────────

const basicWorkflow: WorkflowDefinition = {
    id: "test-workflow",
    name: "Test Workflow",
    version: "1.0.0",
    description: "A test workflow",
    status: "active",
    trigger: "manual",
    requiredPermissions: ["market_data"],
    steps: [
        {
            id: "scout",
            mode: "sequential",
            agent: "market-scout",
            dependsOn: [],
        },
        {
            id: "context",
            mode: "sequential",
            agent: "market-context",
            dependsOn: ["scout"],
        },
    ],
    timeoutMs: 30000,
    notification: {
        method: "none",
        channels: [],
        requiresCritic: false,
        onCriticConflict: "block",
    },
};

// Grant the permissions `basicWorkflow` (and workflows deriving from it) require
// so the engine's workflow-level permission gate passes. `notifications` is
// included because the synthesis agent's contract requires it.
function testConfig(extra?: Partial<EngineConfig>): EngineConfig {
    return { testOnly: true, permissions: { market_data: true, notifications: true }, ...extra };
}

function createContext(partial?: Partial<WorkflowContext>): WorkflowContext {
    return {
        user: { uid: "test_user" },
        market: {
            XAUUSD: {
                volatility: { state: "high", atrPercent: 2.5, rangeExpansion: 1.8 },
                regime: { regime: "trending_bullish", confidence: 75 },
                session: { current: "New York" },
                quote: { changePercent: 1.2, spread: 0.5, ask: 2350.1, bid: 2349.9 },
                structure: [{ type: "higher_high", timestamp: Date.now() }],
                liquidity: [{ level: 3, timestamp: Date.now() }],
                candles: [],
                multiTimeframe: [{ bias: "bullish" }],
                vwap: { value: 2350, distance: 0.5 },
                timestamp: Date.now(),
                symbol: "XAUUSD",
                timeframe: "M5",
            },
        },
        history: { trades: [], positions: [], botCount: 0, symbols: ["XAUUSD"] },
        risk: { drawdownPercent: 15, exposureRatio: 0.3, positionCount: 2, correlatedExposure: 1, symbols: ["XAUUSD"] },
        news: { incoming: [], relevant: [] },
        strategy: {},
        variables: {},
        flags: [],
        agentOutputs: {},
        config: {},
        ...partial,
    };
}

// ─── Tests ─────────────────────────────────────

export async function runWorkflowEngineTests(): Promise<boolean> {
    console.log("--- Workflow Engine Tests ---");
    let passed = true;
    const check = (cond: boolean, label: string) => {
        if (cond) {
            console.log(`  PASS: ${label}`);
        } else {
            console.error(`  FAIL: ${label}`);
            passed = false;
        }
    };

    // 1. Sequential execution.
    {
        const result = await executeWorkflow(basicWorkflow, createContext(), testConfig());
        check(Boolean(result.execution.status), "Sequential workflow produced an execution status");
        check(result.traces.steps.length === 2, "Two steps traced in order");
        check(result.traces.steps[0].stepId === "scout", "First traced step is scout");
        check(result.traces.steps[1].stepId === "context", "Second traced step is context");
    }

    // 2. Agent outputs stored in context.
    {
        const result = await executeWorkflow(basicWorkflow, createContext(), testConfig());
        check(Boolean(result.outputs["scout"]), "scout output stored");
        check(Boolean(result.outputs["context"]), "context output stored");
        check(result.outputs["scout"].agentId === "market-scout", "scout output attributed to market-scout");
    }

    // 3. Parallel execution.
    {
        const parallelWorkflow: WorkflowDefinition = {
            ...basicWorkflow,
            steps: [
                ...basicWorkflow.steps,
                {
                    id: "parallel-group",
                    mode: "parallel",
                    agents: ["volatility-agent", "structure-agent"],
                    dependsOn: ["context"],
                },
            ],
        };
        const result = await executeWorkflow(parallelWorkflow, createContext(), testConfig());
        const parallelStep = result.traces.steps.find((s) => s.stepId === "parallel-group");
        check(Boolean(parallelStep), "Parallel step traced");
        check(parallelStep!.agentIds?.includes("volatility-agent") === true, "Volatility agent in parallel group");
        check(parallelStep!.agentIds?.includes("structure-agent") === true, "Structure agent in parallel group");
    }

    // 4. Conditional branching.
    {
        const conditionalWorkflow: WorkflowDefinition = {
            ...basicWorkflow,
            branches: [
                {
                    id: "branch1",
                    source: "flags.market_data_invalid",
                    operator: "eq",
                    value: true,
                    action: "abort",
                    reason: "Market data invalid, aborting.",
                },
            ],
            steps: [
                {
                    id: "check",
                    mode: "sequential",
                    agent: "market-scout",
                    dependsOn: [],
                },
            ],
        };
        const result = await executeWorkflow(conditionalWorkflow, createContext({ flags: ["market_data_invalid"] }), testConfig());
        check(Boolean(result.execution.status), "Branching workflow produced an execution status");
    }

    // 5. Non-fatal agent failure continues the workflow.
    {
        const failingWorkflow: WorkflowDefinition = {
            id: "failing-workflow",
            name: "Failing",
            version: "1.0.0",
            description: "",
            status: "active",
            trigger: "manual",
            requiredPermissions: [],
            steps: [
                { id: "bad_agent", mode: "sequential", agent: "non-existent-agent" },
                { id: "scout", mode: "sequential", agent: "market-scout" },
            ],
            timeoutMs: 5000,
            notification: { method: "none", channels: [], requiresCritic: false, onCriticConflict: "block" },
        };
        const result = await executeWorkflow(failingWorkflow, createContext(), testConfig());
        check(Boolean(result.outputs["bad_agent"]), "Missing agent still produces a record");
        check(result.outputs["bad_agent"].status === "failed", "Missing agent record marked failed");
        check(Boolean(result.outputs["scout"]), "Workflow continues to the next step after failure");
    }

    // 6. Permission violation is rejected.
    {
        const wf: WorkflowDefinition = {
            ...basicWorkflow,
            requiredPermissions: ["market_data", "risk_data"],
        };
        let rejected = false;
        try {
            await executeWorkflow(wf, createContext(), { testOnly: true, permissions: { market_data: true } });
        } catch (err) {
            rejected = err instanceof Error && err.message.includes("Permission denied");
        }
        check(rejected, "Missing required permission rejects execution");
    }

    // 7. Context isolation — workflows still run with partial permission sets.
    {
        const result = await executeWorkflow(basicWorkflow, createContext(), {
            testOnly: true,
            permissions: { market_data: true },
        });
        check(Boolean(result.outputs["scout"]), "Workflow executes with partial permissions");
    }

    // 8. Agent output contract.
    {
        const result = await executeWorkflow(basicWorkflow, createContext(), testConfig());
        const scoutOutput = result.outputs["scout"];
        check(Boolean(scoutOutput), "Scout produced output");
        check(scoutOutput.agentId === "market-scout", "Output carries agentId");
        check(["success", "failed", "skipped", "blocked"].includes(scoutOutput.status), "Output status is a known terminal state");
        check(typeof scoutOutput.confidence === "number", "Output confidence is numeric");
        check(Array.isArray(scoutOutput.findings), "Output findings is an array");
        check(Array.isArray(scoutOutput.evidence), "Output evidence is an array");
        check(Array.isArray(scoutOutput.warnings), "Output warnings is an array");
        check(Array.isArray(scoutOutput.dataUsed), "Output dataUsed is an array");
        check(typeof scoutOutput.nextStep === "string", "Output nextStep is a string");
    }

    // 9. Synthesis produces final structured output.
    {
        const workflow: WorkflowDefinition = {
            ...basicWorkflow,
            steps: [
                ...basicWorkflow.steps,
                {
                    id: "synthesis",
                    mode: "sequential",
                    agent: "synthesis",
                    dependsOn: ["context"],
                },
            ],
        };
        const result = await executeWorkflow(workflow, createContext(), testConfig());
        const synthesis = result.outputs["synthesis"];
        check(Boolean(synthesis), "Synthesis produced output");
        check(synthesis.status === "success", "Synthesis succeeded with full market data");
    }

    console.log("--- Workflow Engine Tests Complete ---");
    return passed;
}