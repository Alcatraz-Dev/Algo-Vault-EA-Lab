"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Play, Zap, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { onSubscriptionChange } from "@/lib/subscription";
import { Button } from "@/components/ui/button";
import { WorkflowAutomation, WorkflowNode, WorkflowEdge, WorkflowRun, NodeExecutionRecord } from "@/lib/workflows/types";

export default function WorkflowEditorPage() {
  const params = useParams();
  const router = useRouter();
  const workflowId = params?.workflowId ? String(params.workflowId) : null;
  const [wf, setWf] = useState<WorkflowAutomation | null>(null);
  const [loading, setLoading] = useState(true);
  const [pro, setPro] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [running, setRunning] = useState(false);
  const [runTick, setRunTick] = useState(0);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;
    onSubscriptionChange(user.uid).then((sub) => setPro(sub.hasSubscription));
  }, [user]);

  useEffect(() => {
    if (!workflowId || !user) return;
    const fetchWorkflow = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(`/api/workflows/${workflowId}`, { headers });
        if (res.status === 403) {
          router.replace("/workflows");
          return;
        }
        const data = res.ok ? await res.json() : null;
        setWf(data);
      } catch {
        setWf(null);
      } finally {
        setLoading(false);
      }
    };
    fetchWorkflow();
  }, [workflowId, user, router]);

  const navGroups: NavGroup[] = useMemo(() => {
    return APP_NAV.map((group) => ({
      ...group,
      items: group.items.map((item) =>
        item.href === "/workflows" && !pro
          ? { ...item, badge: "PRO" }
          : item
      ),
    }));
  }, [pro]);

  const triggerRun = useCallback(async (id: string) => {
    if (!user || running) return;
    setRunning(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`/api/workflows/${id}/run`, { method: "POST", headers, body: JSON.stringify({ trigger: "manual" }) });
      if (res.ok) setRunTick((t) => t + 1);
    } catch {
      // surface nothing — the panel shows persisted runs only
    } finally {
      setRunning(false);
    }
  }, [user, running]);

  if (loading) return <AppShell navGroups={navGroups} title="Workflow" subtitle="Loading..."><div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-[0_1px_2px_rgb(0_0_0/0.05)]">Loading workflow...</div></AppShell>;
  if (!wf) return <AppShell navGroups={navGroups} title="Not found" subtitle="Workflow missing"><div className="rounded-xl border border-border bg-card p-6 text-sm text-negative shadow-[0_1px_2px_rgb(0_0_0/0.05)]">Workflow not found.</div></AppShell>;

  return (
    <AppShell
      navGroups={navGroups}
      title={wf.name || "Workflow"}
      subtitle={wf.status ? `Status: ${wf.status}` : ""}
      onBack={() => router.push("/workflows")}
      headerActions={
        <div className="flex gap-2">
          <Button size="sm" className="gap-1" onClick={() => workflowId && triggerRun(workflowId)} disabled={running || !workflowId}><Play size={14} /> {running ? "Running…" : "Run"}</Button>
          <Button size="sm" variant="outline" disabled>Save</Button>
        </div>
      }
    >
      <div className="grid lg:grid-cols-[250px_1fr_340px] gap-4 h-full min-h-[80vh]">
        {/* Palette */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-2 overflow-y-auto shadow-[0_1px_2px_rgb(0_0_0/0.05)]">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Node Library</h3>
          {["trigger", "market_data", "technical", "ai", "logic", "risk", "signal", "execution", "notification", "integration", "transform", "simulation", "reports", "marketing"].map((cat) => (
            <div key={cat}>
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mt-2 mb-1">{cat}</div>
              <div className="space-y-1">
                <PaletteItem label="Manual Trigger" type="trigger.manual" />
                {cat === "market_data" && <><PaletteItem label="Market Quote" type="market_data.quote" /><PaletteItem label="Market Candles" type="market_data.candles" /><PaletteItem label="Symbol Info" type="market_data.symbol_info" /></>}
                {cat === "technical" && <><PaletteItem label="SMA" type="technical.sma" /><PaletteItem label="RSI" type="technical.rsi" /><PaletteItem label="Stochastic %K" type="technical.stoch" /><PaletteItem label="OBV" type="technical.obv" /></>}
                {cat === "ai" && <><PaletteItem label="AI Analysis" type="ai.analyze" /><PaletteItem label="Extract JSON" type="ai.extract_json" /></>}
                {cat === "logic" && <><PaletteItem label="Condition" type="logic.condition" /><PaletteItem label="Delay" type="logic.delay" /><PaletteItem label="Math" type="logic.math" /><PaletteItem label="Extract Field" type="logic.extract" /><PaletteItem label="Merge" type="logic.merge" /><PaletteItem label="Switch" type="logic.switch" /></>}
                {cat === "signal" && <PaletteItem label="Create Signal" type="signal.create" />}
                {cat === "execution" && <PaletteItem label="Place Order" type="execution.place_order" />}
                {cat === "notification" && <PaletteItem label="Send Notification" type="notification.send" />}
                {cat === "simulation" && <PaletteItem label="Backtest" type="simulation.backtest" />}
                {cat === "reports" && <PaletteItem label="Build Report" type="reports.build_report" />}
                {cat === "marketing" && <><PaletteItem label="Creative" type="marketing.creative" /><PaletteItem label="Variants" type="marketing.variants" /><PaletteItem label="Compliance" type="marketing.compliance" /><PaletteItem label="Compose" type="marketing.compose" /><PaletteItem label="Thumbnail" type="marketing.thumbnail" /><PaletteItem label="Publish" type="marketing.publish" /></>}
              </div>
            </div>
          ))}
        </div>

        {/* Canvas */}
        <div className="rounded-xl border border-border bg-card p-6 relative overflow-auto min-h-[600px] shadow-[0_1px_2px_rgb(0_0_0/0.05)]">
          <div className="absolute top-3 left-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Canvas — drag nodes here</div>
          <CanvasArea nodes={wf.nodes || []} edges={wf.edges || []} />
        </div>

        {/* Inspector */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-4 overflow-y-auto shadow-[0_1px_2px_rgb(0_0_0/0.05)]">
          <h3 className="text-sm font-semibold text-foreground">Inspector</h3>
          <InspectorForm workflow={wf} />
          <div className="border-t border-border pt-3 mt-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Run History</h4>
            <RunPanel workflowId={String(workflowId)} refreshTick={runTick} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function PaletteItem({ label, type }: { label: string; type: string }) {
  return (
    <button className="w-full text-left px-2 py-1.5 rounded-lg text-xs bg-muted text-foreground hover:bg-muted/70 transition-colors border border-transparent" title={type}>
      <span className="inline-flex items-center gap-1.5"><Zap size={9} className="text-warning" />{label}</span>
    </button>
  );
}

function CanvasArea({ nodes, edges }: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }) {
  if (!nodes || nodes.length === 0) {
    return <div className="text-xs text-muted-foreground mt-20 text-center">No nodes configured.</div>;
  }
  return (
    <div className="relative w-full h-[540px]">
      {nodes.map((node) => (
        <div
          key={node.id}
          className="absolute rounded-lg border bg-card shadow-sm px-4 py-3 w-40 text-xs transition hover:shadow-[0_1px_2px_rgb(0_0_0/0.05)] hover:-translate-y-0.5"
          style={{ top: (node.position?.y ?? 0) + 60, left: (node.position?.x ?? 0) + 20 }}
        >
          <div className="font-semibold truncate">{node.label || node.id}</div>
          <div className="text-micro text-muted-foreground">{node.type}</div>
          <div className="text-micro text-warning">{JSON.stringify(node.config).slice(0, 60)}</div>
        </div>
      ))}
      <svg className="absolute inset-0 pointer-events-none" style={{ width: "100%", height: "100%" }}>
        {edges.map((edge) => {
          const s = nodes.find((n) => n.id === edge.source);
          const t = nodes.find((n) => n.id === edge.target);
          if (!s || !t) return null;
          return <line key={edge.id} x1={(s.position?.x ?? 0) + 140} y1={(s.position?.y ?? 0) + 20} x2={(t.position?.x ?? 0) + 20} y2={(t.position?.y ?? 0) + 20} stroke="#f59e0b" strokeWidth={2} />;
        })}
      </svg>
    </div>
  );
}

function InspectorForm({ workflow }: { workflow: WorkflowAutomation }) {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3 text-xs">
      <div className="flex justify-between gap-2"><span className="text-muted-foreground">Name</span><span className="font-medium text-foreground truncate">{workflow.name}</span></div>
      <div className="flex justify-between gap-2"><span className="text-muted-foreground">Status</span><span className="font-medium text-foreground">{workflow.status}</span></div>
      <div className="flex justify-between gap-2"><span className="text-muted-foreground">Nodes</span><span className="font-medium font-numeric text-foreground">{workflow.nodes?.length ?? 0}</span></div>
      <div className="flex justify-between gap-2"><span className="text-muted-foreground">Edges</span><span className="font-medium font-numeric text-foreground">{workflow.edges?.length ?? 0}</span></div>
      <div className="flex justify-between gap-2"><span className="text-muted-foreground">Permissions</span><span className="font-medium text-foreground text-right">{workflow.requiredPermissions?.join(", ") || "none"}</span></div>
    </div>
  );
}

function RunPanel({ workflowId, refreshTick }: { workflowId: string; refreshTick: number }) {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Record<string, NodeExecutionRecord[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await auth.currentUser?.getIdToken().catch(() => null);
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const res = await fetch("/api/workflows/runs", { headers });
      if (!res.ok) { setError("Could not load run history."); return; }
      const all = (await res.json()) as WorkflowRun[];
      setRuns(all.filter((r) => r.workflowId === workflowId));
      setError(null);
    } catch {
      setError("Could not load run history.");
    }
  }, [workflowId]);

  useEffect(() => {
    load();
  }, [load, refreshTick]);

  const toggle = useCallback(async (runId: string) => {
    if (expanded === runId) { setExpanded(null); return; }
    setExpanded(runId);
    if (!nodes[runId]) {
      setLoading(true);
      try {
        const token = await auth.currentUser?.getIdToken().catch(() => null);
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(`/api/workflows/runs/${runId}`, { headers });
        if (res.ok) {
          const data = await res.json();
          setNodes((prev) => ({ ...prev, [runId]: (data.nodes ?? []) }));
        }
      } catch {
        // keep empty trace — run row still visible
      } finally {
        setLoading(false);
      }
    }
  }, [expanded, nodes]);

  return (
    <div className="space-y-2">
      <button onClick={load} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"><RefreshCw size={10} /> Refresh</button>
      {error && <div className="rounded-xl border border-negative/30 bg-negative-muted px-3 py-2 text-xs text-negative">{error}</div>}
      {runs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">No runs yet for this workflow.</div>
      ) : (
        runs.slice(0, 8).map((run) => (
          <div key={run.id} className="rounded-xl border border-border bg-card p-2.5 text-xs space-y-1 shadow-[0_1px_2px_rgb(0_0_0/0.05)]">
            <button onClick={() => toggle(run.id)} className="flex items-center justify-between w-full text-left gap-1">
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                {expanded === run.id ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                <span className={
                  run.status === "success" ? "text-positive"
                  : run.status === "failed" || run.status === "partial" || run.status === "timeout" ? "text-negative"
                  : run.status === "running" ? "text-warning"
                  : "text-muted-foreground"
                }>{run.status}</span>
              </span>
              <span className="text-muted-foreground">{run.trigger}</span>
            </button>
            <div className="text-xs text-muted-foreground font-numeric flex justify-between">
              <span>{new Date(run.startedAt).toLocaleString()}</span>
              <span>{run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : "—"}</span>
            </div>
            {run.error && <div className="text-xs text-negative break-words">⚠ {run.error}</div>}
            {expanded === run.id && (
              <div className="border-t border-border pt-1 mt-1 space-y-0.5">
                {(nodes[run.id] ?? []).map((n) => (
                  <div key={n.id} className="flex justify-between text-xs">
                    <span className="truncate max-w-[150px] text-foreground">{n.nodeLabel || n.nodeId}</span>
                    <span className={
                      n.status === "success" ? "text-positive"
                      : n.status === "failed" ? "text-negative" : "text-muted-foreground"
                    }>{n.status}{n.error ? " ✕" : ""}</span>
                  </div>
                ))}
                {!nodes[run.id] && loading && <div className="text-xs text-muted-foreground">Loading trace…</div>}
                {nodes[run.id] && nodes[run.id].length === 0 && <div className="text-xs text-muted-foreground">No node records.</div>}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}