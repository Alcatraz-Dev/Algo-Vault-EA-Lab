/**
 * AI Workflow Builder.
 *
 * Pipeline: Generate → Validate → Preview → Review → Save → Activate.
 * The builder NEVER activates anything. It produces a draft with a strict
 * validation report; activation requires the explicit activate endpoint.
 *
 * Generation is constrained to the node registry — unknown node types are
 * discarded with a message, and validation flags structural issues (missing
 * risk guard before signal/execution nodes, cycles, unreachable nodes).
 */

import { defaultRouter } from "@/lib/ai/router";
import { getAllNodes, NODE_CATEGORY_LABELS, nodePermissionClass, needsRiskGuard } from "./node-registry";
import { validateWorkflow } from "./validate";
import { safeId } from "./naming";
import {
    WorkflowAutomation,
    WorkflowBuildDraft,
    WorkflowBuildValidation,
    WorkflowEdge,
    WorkflowNode,
} from "./types";
import { saveDraft } from "./database";

interface NativeAIBuild {
    name: string;
    description?: string;
    nodes?: Array<{
        id: string;
        type: string;
        label?: string;
        position?: { x: number; y: number };
        config?: Record<string, unknown>;
    }>;
    edges?: Array<{ source: string; target: string }>;
    schedule?: { enabled: boolean; cron: string };
}

const REGISTRY_TYPES = getAllNodes().map((n) => n.type).sort();

function systemPrompt(): string {
    const categories = getAllNodes()
        .map((n) => `  - ${n.type}: ${n.name} — ${n.description}`)
        .join("\n");
    return [
        "You are the AlgoVault Workflow Builder. You generate a trading workflow draft as STRICT JSON.",
        "Rules:",
        `1. Only use these node types (complete registry):\n${categories}`,
        "2. Return JSON exactly like:",
        `{"name":"...","description":"...","nodes":[{"id":"candles","type":"market_data.candles","config":{"symbol":"XAUUSD","timeframe":"M5","limit":100}},{"id":"rsi","type":"technical.rsi","config":{"source":"$candles","period":14}}],"edges":[{"source":"manual","target":"candles"},{"source":"candles","target":"rsi"}],"schedule":{"enabled":false,"cron":""}}`,
        "3. Every graph must start with exactly one trigger node (trigger.manual | trigger.schedule | trigger.webhook).",
        `4. If the workflow creates signals (signal.create) or places orders (execution.place_order), it MUST include a risk.check or risk.position_size node that runs before the signal/order node. This is mandatory.`,
        "5. Prefer canonical symbols (XAUUSD, XAGUSD, EURUSD, GBPUSD, BTCUSD, etc.).",
        "6. Nodes should reference upstream data via edge dependencies, and config templates can use {{ $nodeId.field }}.",
        "7. Return ONLY the JSON object. No markdown fences.",
    ].join("\n");
}

/** Local deterministic fallback when the AI router is unavailable. */
function fallbackBuild(prompt: string): NativeAIBuild {
    const lower = prompt.toLowerCase();
    const symbol = matchSymbol(prompt) ?? "XAUUSD";
    const wantsSignal = /signal|alert|notify|warn/.test(lower);
    const wantsBacktest = /backtest|simulat|test strategy|walk/.test(lower);
    const timeframe = /(?:m1|1 ?min)/.test(lower) ? "M1"
        : /m5|5 ?min/.test(lower) ? "M5"
        : /m15|15 ?min/.test(lower) ? "M15"
        : /h1|1 ?hour/.test(lower) ? "H1"
        : /h4|4 ?hour/.test(lower) ? "H4"
        : /d1|daily/.test(lower) ? "D1"
        : "M5";

    const nodes: WorkflowNode[] = [
        { id: "manual", type: "trigger.manual", position: { x: 40, y: 120 }, config: {} },
        { id: "candles", type: "market_data.candles", position: { x: 260, y: 120 }, config: { symbol, timeframe, limit: 200 } },
        { id: "rsi", type: "technical.rsi", position: { x: 480, y: 120 }, config: { source: "$candles", period: 14 } },
    ];
    const edges: WorkflowEdge[] = [
        { id: "e1", source: "manual", target: "candles" },
        { id: "e2", source: "candles", target: "rsi" },
    ];

    if (wantsSignal) {
        nodes.push({ id: "condition", type: "logic.condition", position: { x: 700, y: 40 }, config: { left: "{{ $rsi.value }}", operator: "lt", right: "30" } });
        nodes.push({ id: "risk", type: "risk.check", position: { x: 700, y: 160 }, config: { riskPercent: 1, maxExposurePercent: 20, requireStopLoss: true } });
        nodes.push({ id: "signal", type: "signal.create", position: { x: 920, y: 160 }, config: { symbol, direction: "BUY", entry: "{{ $candles.close }}", stopLoss: "{{ $candles.candles[0].low }}" } });
        nodes.push({ id: "notify", type: "notification.send", position: { x: 920, y: 320 }, config: { title: "RSI oversold caught", message: "{{ $signal.direction }} {{ $signal.symbol }} @ {{ $signal.entry }}", channels: ["telegram"] } });
        edges.push({ id: "e3", source: "rsi", target: "condition" });
        edges.push({ id: "e4", source: "condition", target: "risk" });
        edges.push({ id: "e5", source: "risk", target: "signal" });
        edges.push({ id: "e6", source: "signal", target: "notify" });
    } else if (wantsBacktest) {
        nodes.push({ id: "bt", type: "simulation.backtest", position: { x: 700, y: 40 }, config: { symbol, timeframe, fast: 5, slow: 20, initialBalance: 10000 } });
        nodes.push({ id: "report", type: "reports.build_report", position: { x: 920, y: 40 }, config: { title: "SMA Cross Backtest", sections: [{ title: "Results", ref: "$bt" }] } });
        edges.push({ id: "e3", source: "candles", target: "bt" });
        edges.push({ id: "e4", source: "bt", target: "report" });
    }

    return {
        name: `AI Draft — ${symbol} ${wantsSignal ? "signal watch" : wantsBacktest ? "backtest" : "analysis"}`,
        description: `Generated from prompt: "${prompt.slice(0, 120)}"`,
        nodes,
        edges,
        schedule: { enabled: false, cron: "" },
    };
}

function matchSymbol(prompt: string): string | null {
    const candidates = ["XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "USDCAD", "USDCHF", "BTCUSD", "ETHUSD", "US30", "SPX500", "NAS100", "GER40", "WTI", "BRENT"];
    const upper = prompt.toUpperCase();
    for (const c of candidates) if (upper.includes(c)) return c;
    return null;
}

/**
 * Generates a validated draft. Returns the draft with a validation report.
 * Never activates; never persists onto a live workflow.
 */
export async function generateWorkflowDraft(uid: string, prompt: string): Promise<{
    draft: WorkflowBuildDraft;
    validation: WorkflowBuildValidation;
}> {
    const name = nameFor(prompt);
    const description = prompt.slice(0, 500);

    let native: NativeAIBuild | null = null;
    try {
        const res = await defaultRouter.chat({
            messages: [{ role: "user", content: prompt }],
            systemPrompt: systemPrompt(),
            responseFormat: "json_object",
            temperature: 0.2,
            maxTokens: 4000,
        });
        if (res.success && res.content) {
            const parsed = JSON.parse(stripFences(res.content)) as NativeAIBuild;
            if (parsed && Array.isArray(parsed.nodes)) native = parsed;
        }
    } catch (err) {
        console.warn("[workflows.ai-builder] router failed, using fallback:", err);
    }
    if (!native) native = fallbackBuild(prompt);

    const built = sanitizeBuild(native);
    const nodes = built.nodes;
    const edges = built.edges;
    const settings = { maxConcurrency: 4, timeoutMs: 120_000, notifyOnCompletion: false };

    const workflow: WorkflowAutomation = {
        id: safeId("wf"),
        userId: uid,
        name: built.name || name,
        description: built.description || description,
        status: "draft",
        visibility: "private",
        version: 1,
        nodes,
        edges,
        requiredPermissions: [],
        schedule: built.schedule ? { enabled: Boolean(built.schedule.enabled), cron: built.schedule.cron || "" } : undefined,
        settings,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: uid,
    };

    const validation = validateWorkflow(
        { nodes, edges, settings, schedule: workflow.schedule, name: workflow.name },
        { analysis: true, signal: true, execution: true },
        { maxNodes: 150 }
    );

    const draft: WorkflowBuildDraft = {
        id: safeId("wfd"),
        userId: uid,
        prompt,
        workflow,
        validation,
        status: "generated",
        createdAt: Date.now(),
        createdBy: uid,
    };
    await saveDraft(uid, draft);

    return { draft, validation };
}

function nameFor(prompt: string): string {
    const cleaned = prompt.trim().replace(/\s+/g, " ").slice(0, 60);
    return cleaned ? `AI ${cleaned[0].toUpperCase()}${cleaned.slice(1)}` : "AI Draft";
}

function stripFences(content: string): string {
    return content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
}

/** Sanitizes an AI/native build: only registry types, unique ids, valid edges. */
function sanitizeBuild(native: NativeAIBuild): { name: string; description: string; nodes: WorkflowNode[]; edges: WorkflowEdge[]; schedule?: { enabled: boolean; cron: string } } {
    const known = new Set(REGISTRY_TYPES);
    const nodes: WorkflowNode[] = [];
    const seen = new Set<string>();
    let triggerCount = 0;
    for (const raw of native.nodes ?? []) {
        const type = String(raw.type || "");
        if (!known.has(type)) continue;
        const id = String(raw.id || "").trim();
        if (!id || seen.has(id)) continue;
        if (type.startsWith("trigger.")) triggerCount += 1;
        seen.add(id);
        nodes.push({
            id,
            type,
            label: raw.label,
            position: { x: Number(raw.position?.x) || 0, y: Number(raw.position?.y) || 0 },
            config: typeof raw.config === "object" && raw.config !== null ? (raw.config as Record<string, unknown>) : {},
        });
    }
    if (triggerCount === 0) {
        nodes.unshift({ id: "manual", type: "trigger.manual", label: "Manual trigger", position: { x: 40, y: 120 }, config: {} });
    }
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges: WorkflowEdge[] = [];
    const edgeSeen = new Set<string>();
    for (const raw of native.edges ?? []) {
        const source = String(raw?.source || "");
        const target = String(raw?.target || "");
        if (!nodeIds.has(source) || !nodeIds.has(target)) continue;
        if (source === target) continue;
        const eid = `${source}:${target}`;
        if (edgeSeen.has(eid)) continue;
        edgeSeen.add(eid);
        edges.push({ id: `e_${edges.length}`, source, target });
    }
    return {
        name: String(native.name || "AI Draft").slice(0, 120),
        description: String(native.description || "").slice(0, 500),
        nodes,
        edges,
        schedule: typeof native.schedule === "object" && native.schedule !== null
            ? { enabled: Boolean(native.schedule.enabled), cron: String(native.schedule.cron || "").slice(0, 64) }
            : undefined,
    };
}

/** Advisory validation summary for the builder's Review step. */
export function summarizeValidation(v: WorkflowBuildValidation): { safe: boolean; errorCount: number; warningCount: number; messages: string[] } {
    return {
        safe: v.valid,
        errorCount: v.errors.length,
        warningCount: v.warnings.length,
        messages: [...v.errors, ...v.warnings.map((w) => `⚠ ${w}`)],
    };
}

export { needsRiskGuard, nodePermissionClass, NODE_CATEGORY_LABELS };