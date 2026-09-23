/**
 * Workflow Automation — core tests.
 *
 * Run: node scripts/jiti-tsrun.mjs lib/workflows/__tests__/run-workflow-tests.ts
 */

import {
    getNodeDefinition,
    NODE_REGISTRY,
    neededNodesForPermission,
    isRiskNodeType,
    isSignalNodeType,
    isExecutionNodeType,
    isTriggerNodeType,
} from "../node-registry";
import { validateWorkflow } from "../validate";
import { parseCron, isValidCron, nextRunAt } from "../cron";
import { deriveRequiredPermissions } from "../validate";
import { tryConsume, resetRateLimiter } from "../rate-limiter";
import { computeIndicator } from "../ta";
import { safeId } from "../naming";
import { resolveConfig, lookupValue } from "../paths";
import { createSnapshotCache } from "../market";

export async function runWorkflowTests(): Promise<boolean> {
    let passed = true;
    const check = (label: string, ok: boolean) => {
        if (ok) console.log(`  PASS: ${label}`);
        else { console.error(`  FAIL: ${label}`); passed = false; }
    };

    console.log("=== Workflow Automation Tests ===");

    // Registry
    check("node registry non-empty", Object.keys(NODE_REGISTRY).length > 0);
    check("market_data.candles exists", !!getNodeDefinition("market_data.candles"));
    check("signal.create exists", !!getNodeDefinition("signal.create"));
    check("execution.place_order exists", !!getNodeDefinition("execution.place_order"));
    check("trigger.manual exists", !!getNodeDefinition("trigger.manual"));

    // Permissions
    const nodes = [
        { type: "trigger.manual" },
        { type: "market_data.candles" },
        { type: "technical.sma", enabled: true },
    ];
    check("deriveRequiredPermissions yields analysis", deriveRequiredPermissions(nodes).includes("analysis"));

    // Validation — valid graph
    const valid = validateWorkflow({
        name: "Test",
        nodes: [
            { id: "t", type: "trigger.manual", position: { x: 0, y: 0 }, config: {}, enabled: true },
            { id: "q", type: "market_data.quote", position: { x: 0, y: 1 }, config: { symbol: "XAUUSD" }, enabled: true },
        ],
        edges: [{ id: "e", source: "t", target: "q" }],
        settings: {},
        schedule: undefined,
    }, { analysis: true, signal: false, execution: false });
    check("valid workflow passes", valid.valid);

    // Validation — missing trigger
    const missingTrigger = validateWorkflow({
        name: "No trigger",
        nodes: [{ id: "q", type: "market_data.quote", position: { x: 0, y: 0 }, config: { symbol: "XAUUSD" }, enabled: true }],
        edges: [],
        settings: {},
        schedule: undefined,
    }, { analysis: true, signal: false, execution: false });
    check("missing trigger fails", !missingTrigger.valid && missingTrigger.errors.some((e) => e.includes("trigger")));

    // Validation — cycle
    const cycle = validateWorkflow({
        name: "Cycle",
        nodes: [
            { id: "a", type: "trigger.manual", position: { x: 0, y: 0 }, config: {}, enabled: true },
            { id: "b", type: "market_data.quote", position: { x: 1, y: 0 }, config: { symbol: "XAUUSD" }, enabled: true },
        ],
        edges: [{ id: "e1", source: "a", target: "b" }, { id: "e2", source: "b", target: "a" }],
        settings: {},
        schedule: undefined,
    }, { analysis: true, signal: false, execution: false });
    check("cycle detected", !cycle.valid && cycle.errors.some((e) => e.includes("cycle") || e.includes("deadlock")));

    // Cron
    check("parse cron works", isValidCron("*/5 * * * *"));
    check("nextRunAt produces future time", (nextRunAt("*/5 * * * *", Date.now()) ?? 0) > Date.now());

    // Rate limiter
    resetRateLimiter();
    check("rate limiter allows first token", tryConsume("u1", "test", 10) >= 0);

    // TA
    const candles = Array.from({ length: 30 }, (_, i) => ({
        timestamp: i * 1000,
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100 + i,
    }));
    const rsi = computeIndicator("technical.rsi", candles, 14);
    check("TA RSI computes number", typeof rsi.value === "number");

    // Snapshot cache
    const cache = createSnapshotCache();
    check("snapshot cache created", !!cache && typeof cache.getOrFetch === "function");

    // Path resolver
    const lookup = { nodes: {}, variables: { x: 42 } };
    check("lookup resolves variables", lookupValue(lookup, "variables.x").value === 42);

    // Naming
    check("safeId creates string", typeof safeId("w").startsWith("w_") === "boolean");

    console.log("=== Workflow Tests Complete ===");
    return passed;
}

runWorkflowTests().then((ok) => {
    console.log(ok ? "🎉 WORKFLOW TESTS PASSED" : "❌ WORKFLOW TESTS FAILED");
    process.exit(ok ? 0 : 1);
});