import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { validateApiKey } from "@/lib/api-key-auth";
import { orchestrate } from "@/lib/agents/orchestrator";
import {
    getAgentDefinition,
    setAgentDefinition,
    getWorkflowDefinition,
    setWorkflowDefinition,
    getAllWorkflowDefinitions,
    getExecution,
    getUserExecutions,
    getExecutionTraces,
    cancelExecution,
    getAgentLogs,
    recordUsage,
    getUsage,
    getAllAgentDefinitions,
    saveAgentDraft,
    adminDatabase,
} from "@/lib/agents/database";
import {
    WorkflowDefinition,
    AgentContract,
    AgentDraft,
    PermissionSet,
} from "@/lib/agents/types";

// Ensure built-in executors are registered on import
import "@/lib/agents/workflow-engine";

async function authenticate(request: NextRequest): Promise<{ uid: string | null; isAdmin: boolean; error?: string }> {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (token) {
        try {
            const decoded = await adminAuth.verifyIdToken(token);
            // Firebase DecodedIdToken carries custom claims directly on itself.
            const isAdmin = decoded.admin === true || decoded.role === "admin";
            return { uid: decoded.uid, isAdmin };
        } catch {
            // Fall through to API key
        }
    }

    const apiKey = request.headers.get("x-api-key");
    if (apiKey) {
        const uid = await validateApiKey(apiKey);
        if (uid) {
            try {
                const user = await adminAuth.getUser(uid);
                const claims = user.customClaims as { admin?: boolean; role?: string } | undefined;
                return { uid, isAdmin: claims?.admin === true || claims?.role === "admin" };
            } catch {
                return { uid, isAdmin: false };
            }
        }
    }

    return { uid: null, isAdmin: false, error: "Authentication required" };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    const auth = await authenticate(request);
    if (!auth.uid && !auth.isAdmin) {
        return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    try {
        const body = await request.json();
        const result = await orchestrate({
            workflowId: body.workflowId,
            workflowVersion: body.workflowVersion,
            context: body.context || {},
            permissions: body.permissions,
            testOnly: body.testOnly || false,
            timeoutMs: body.timeoutMs,
        });

        return NextResponse.json({
            executionId: result.execution.id,
            status: result.execution.status,
            durationMs: result.durationMs,
            finalOutput: result.finalOutput,
        });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Orchestration failed" },
            { status: 400 }
        );
    }
}

export async function GET_agents_status(request: NextRequest, { params }: { params: { executionId: string } }): Promise<NextResponse> {
    const auth = await authenticate(request);
    if (!auth.uid && !auth.isAdmin) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const execution = await getExecution(params.executionId);
    if (!execution) return NextResponse.json({ error: "Execution not found" }, { status: 404 });
    if (!auth.isAdmin && execution.userId !== auth.uid) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    return NextResponse.json(execution);
}

export async function GET_agents_trace(request: NextRequest, { params }: { params: { executionId: string } }): Promise<NextResponse> {
    const auth = await authenticate(request);
    if (!auth.uid && !auth.isAdmin) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const execution = await getExecution(params.executionId);
    if (!execution) return NextResponse.json({ error: "Execution not found" }, { status: 404 });
    if (!auth.isAdmin && execution.userId !== auth.uid) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { steps, agents } = await getExecutionTraces(params.executionId);
    return NextResponse.json({ execution, steps, agents });
}

export async function POST_agents_cancel(request: NextRequest, { params }: { params: { executionId: string } }): Promise<NextResponse> {
    const auth = await authenticate(request);
    if (!auth.uid && !auth.isAdmin) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const execution = await getExecution(params.executionId);
    if (!execution) return NextResponse.json({ error: "Execution not found" }, { status: 404 });
    if (!auth.isAdmin && execution.userId !== auth.uid) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const cancelled = await cancelExecution(params.executionId);
    if (!cancelled) return NextResponse.json({ error: "Could not cancel (not running)" }, { status: 409 });

    return NextResponse.json({ cancelled: true });
}

export async function POST_agents_generate(request: NextRequest): Promise<NextResponse> {
    const auth = await authenticate(request);
    if (!auth.uid && !auth.isAdmin) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { defaultRouter } = await import("@/lib/ai/router");
        const { AIConfig } = await import("@/lib/ai/config");

        const systemPrompt = body.kind === "agent"
            ? "You are an AlgoVault Agent designer. Generate a valid AgentContract JSON. NEVER include forbidden permissions."
            : "You are an AlgoVault Workflow designer. Generate a valid WorkflowDefinition JSON.";

        const raw = await defaultRouter.generateStructured(body.prompt || "", body.kind || "workflow", systemPrompt);
        const draftId = `draft_${Date.now().toString(36)}`;
        const draft: AgentDraft = {
            id: draftId,
            kind: body.kind || "workflow",
            name: body.kind === "agent" ? (raw as AgentContract).name || "Generated" : (raw as WorkflowDefinition).name || "Generated",
            displayName: body.kind === "agent" ? (raw as AgentContract).name || "Generated" : (raw as WorkflowDefinition).name || "Generated",
            description: "",
            spec: { kind: body.kind || "workflow", agent: raw as AgentContract, workflow: raw as WorkflowDefinition, capabilities: [], testCases: [], unsupportedCapabilities: [] },
            validation: { schema: true, permissions: true, security: true, workflow: true, sandbox: false, tests: false },
            validationMessages: [],
            status: "generated",
            createdBy: auth.uid || "admin",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        await saveAgentDraft(draftId, draft);
        return NextResponse.json(draft);
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 400 });
    }
}

export async function POST_agents_validate(request: NextRequest): Promise<NextResponse> {
    const auth = await authenticate(request);
    if (!auth.uid && !auth.isAdmin) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    try {
        const body = await request.json();
        const wf = body.workflow || body;
        const errors: string[] = [];
        if (!wf.id) errors.push("id required");
        if (!wf.steps) errors.push("steps required");
        if (wf.steps) {
            const ids = new Set<string>();
            for (const s of wf.steps) {
                if (s.id) ids.add(s.id);
                if (s.mode === "parallel" && !Array.isArray(s.agents)) errors.push("parallel needs agents");
                if (s.mode === "sequential" && !s.agent) errors.push("sequential needs agent");
                for (const d of s.dependsOn || []) {
                    if (!ids.has(d)) errors.push(`unknown dep ${d}`);
                }
            }
        }
        return NextResponse.json({ valid: errors.length === 0, errors });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 400 });
    }
}

export async function POST_agents_publish(request: NextRequest): Promise<NextResponse> {
    const auth = await authenticate(request);
    if (!auth.isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    try {
        const body = await request.json();
        const wf = body.workflow as WorkflowDefinition;
        if (!wf || !wf.id || !wf.steps) return NextResponse.json({ error: "Invalid workflow" }, { status: 400 });
        wf.status = "active";
        wf.updatedAt = Date.now();
        await setWorkflowDefinition(wf);
        return NextResponse.json({ published: true, workflowId: wf.id });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 400 });
    }
}

export async function GET_agents(request: NextRequest): Promise<NextResponse> {
    const auth = await authenticate(request);
    if (!auth.uid && !auth.isAdmin) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const active = request.nextUrl.searchParams.get("active") === "true";
    let agents: AgentContract[];
    if (auth.isAdmin && !active) {
        agents = await getAllAgentDefinitions();
    } else {
        agents = (await getAllAgentDefinitions()).filter((a) => a.status === "active" || a.status === "testing");
    }
    return NextResponse.json({ agents });
}

export async function GET_agents_by_id(request: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
    const auth = await authenticate(request);
    if (!auth.uid && !auth.isAdmin) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const agent = await getAgentDefinition(params.id);
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    return NextResponse.json(agent);
}

export async function GET_workflows(request: NextRequest): Promise<NextResponse> {
    const auth = await authenticate(request);
    if (!auth.uid && !auth.isAdmin) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const workflows = await getAllWorkflowDefinitions();
    const result = auth.isAdmin ? workflows : workflows.filter((w) => w.status === "active");
    return NextResponse.json({ workflows: result });
}

export async function GET_executions(request: NextRequest): Promise<NextResponse> {
    const auth = await authenticate(request);
    if (!auth.uid && !auth.isAdmin) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") || "50", 10), 200);
    if (auth.isAdmin) {
        const snap = await adminDatabase.ref("workflowExecutions").limitToLast(limit).get();
        const data = (snap.val() || {}) as Record<string, unknown>;
        return NextResponse.json({ executions: Object.values(data) });
    }

    const executions = await getUserExecutions(auth.uid!, limit);
    return NextResponse.json({ executions });
}

export async function POST_admin_test(request: NextRequest): Promise<NextResponse> {
    const auth = await authenticate(request);
    if (!auth.isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    try {
        const body = await request.json();
        const result = await orchestrate({
            workflowId: body.workflowId,
            context: body.context || {},
            permissions: body.permissions || {},
            testOnly: true,
            timeoutMs: body.timeoutMs || 60000,
        });
        return NextResponse.json(result);
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 400 });
    }
}

export async function POST_agent_draft(request: NextRequest): Promise<NextResponse> {
    const auth = await authenticate(request);
    if (!auth.uid && !auth.isAdmin) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    try {
        const body = await request.json();
        const draft = body as AgentDraft;
        draft.createdBy = auth.uid || "admin";
        draft.updatedAt = Date.now();
        await saveAgentDraft(draft.id, draft);
        return NextResponse.json({ saved: true, draftId: draft.id });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 400 });
    }
}

export async function GET_agent_usage(request: NextRequest): Promise<NextResponse> {
    const auth = await authenticate(request);
    if (!auth.isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    const workflowId = request.nextUrl.searchParams.get("workflowId");
    const agentId = request.nextUrl.searchParams.get("agentId");
    const usage = await getUsage(workflowId || undefined, agentId || undefined);
    return NextResponse.json({ usage });
}

export async function POST_agent_register(request: NextRequest): Promise<NextResponse> {
    const auth = await authenticate(request);
    if (!auth.isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    try {
        const body = await request.json();
        const agent: AgentContract = body;
        if (!agent.id || !agent.name) return NextResponse.json({ error: "id and name required" }, { status: 400 });
        agent.status = agent.status || "active";
        await setAgentDefinition(agent);
        return NextResponse.json({ registered: true, agentId: agent.id });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 400 });
    }
}

export async function GET_agent_logs(request: NextRequest, { params }: { params: { executionId: string } }): Promise<NextResponse> {
    const auth = await authenticate(request);
    if (!auth.uid && !auth.isAdmin) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const logs = await getAgentLogs(params.executionId);
    return NextResponse.json({ logs });
}
