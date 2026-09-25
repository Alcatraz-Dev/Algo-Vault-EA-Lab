"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  GitBranch, Play, Search, Sparkles, Zap, Save,
  Copy, AlertCircle, CheckCircle2, Clock, Shield,
  Loader2, X, Download, AlertTriangle, BrainCircuit,
  TrendingUp, Bell, Filter, BarChart2, FlaskConical,
  PanelLeftClose, PanelLeftOpen, Info, XCircle,
  ChevronLeft, BookOpen, Plus, Boxes, Globe, FileText,
  SlidersHorizontal, Layers, ChevronDown, ChevronRight, ChevronsDown, ChevronsUp,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/loading-state";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { WorkflowAutomation, WorkflowNode, WorkflowEdge } from "@/lib/workflows/types";
import { getAllNodes, getNodeDefinition, NODE_CATEGORY_ORDER, NODE_CATEGORY_LABELS } from "@/lib/workflows/node-registry";
import { isConnectionAllowed } from "@/lib/workflows/connection-rules";
import { autoConnectNodes, autoPositionNodes } from "@/lib/workflows/ai-builder";
import { instantiateTemplate, WORKFLOW_TEMPLATES, WorkflowTemplate } from "@/lib/workflows/templates";
import { PortableWorkflow } from "@/lib/workflows/portable";
import { onSubscriptionChange } from "@/lib/subscription";
import {
  ReactFlow, Background, Controls, MiniMap, Panel,
  useNodesState, useEdgesState, addEdge,
  Connection, Edge, Node, NodeTypes, useReactFlow,
  Handle, Position, MarkerType, EdgeTypes,
  getBezierPath, EdgeProps, BaseEdge,
} from "@xyflow/react";
import { Inspector } from "./inspector";
import { TemplatePickerModal } from "./template-picker-modal";
import { AiBuilderModal } from "./ai-builder-modal";
import { ImportExportModal } from "./import-export-modal";
import { WorkflowGuideTour } from "@/components/workflows/WorkflowGuideTour";
import "@xyflow/react/dist/style.css";
import { PageHeader } from "@/components/ui/page-header";

// ─── Category styles ──────────────────────────────────────────────────────────
const CAT_STYLES: Record<string, { dot: string; header: string; badge: string; icon: React.ReactNode }> = {
  trigger: { dot: "#8b5cf6", header: "bg-violet-500/10 border-b border-violet-500/30", badge: "bg-violet-100 text-violet-950 dark:bg-violet-900/70 dark:text-violet-100 font-extrabold border border-violet-400/50 shadow-xs", icon: <Zap size={11} /> },
  market_data: { dot: "#0ea5e9", header: "bg-sky-500/10 border-b border-sky-500/30", badge: "bg-sky-100 text-sky-950 dark:bg-sky-900/70 dark:text-sky-100 font-extrabold border border-sky-400/50 shadow-xs", icon: <BarChart2 size={11} /> },
  technical: { dot: "#f59e0b", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", icon: <TrendingUp size={11} /> },
  filter: { dot: "#f97316", header: "bg-orange-500/10 border-b border-orange-500/30", badge: "bg-orange-100 text-orange-950 dark:bg-orange-900/70 dark:text-orange-100 font-extrabold border border-orange-400/50 shadow-xs", icon: <Filter size={11} /> },
  signal: { dot: "#22c55e", header: "bg-emerald-500/10 border-b border-emerald-500/30", badge: "bg-emerald-100 text-emerald-950 dark:bg-emerald-900/70 dark:text-emerald-100 font-extrabold border border-emerald-400/50 shadow-xs", icon: <Bell size={11} /> },
  execution: { dot: "#3b82f6", header: "bg-blue-500/10 border-b border-blue-500/30", badge: "bg-blue-100 text-blue-950 dark:bg-blue-900/70 dark:text-blue-100 font-extrabold border border-blue-400/50 shadow-xs", icon: <Play size={11} /> },
  ai: { dot: "#ec4899", header: "bg-pink-500/10 border-b border-pink-500/30", badge: "bg-pink-100 text-pink-950 dark:bg-pink-900/70 dark:text-pink-100 font-extrabold border border-pink-400/50 shadow-xs", icon: <BrainCircuit size={11} /> },
  notification: { dot: "#14b8a6", header: "bg-teal-500/10 border-b border-teal-500/30", badge: "bg-teal-100 text-teal-950 dark:bg-teal-900/70 dark:text-teal-100 font-extrabold border border-teal-400/50 shadow-xs", icon: <Bell size={11} /> },
  logic: { dot: "#6366f1", header: "bg-indigo-500/10 border-b border-indigo-500/30", badge: "bg-indigo-100 text-indigo-950 dark:bg-indigo-900/70 dark:text-indigo-100 font-extrabold border border-indigo-400/50 shadow-xs", icon: <FlaskConical size={11} /> },
  risk: { dot: "#ef4444", header: "bg-red-500/10 border-b border-red-500/30", badge: "bg-red-100 text-red-950 dark:bg-red-900/70 dark:text-red-100 font-extrabold border border-red-400/50 shadow-xs", icon: <Shield size={11} /> },
  integration: { dot: "#8b5cf6", header: "bg-purple-500/10 border-b border-purple-500/30", badge: "bg-purple-100 text-purple-950 dark:bg-purple-900/70 dark:text-purple-100 font-extrabold border border-purple-400/50 shadow-xs", icon: <GitBranch size={11} /> },
  storage: { dot: "#64748b", header: "bg-slate-500/10 border-b border-slate-500/30", badge: "bg-slate-200 text-slate-950 dark:bg-slate-800 dark:text-slate-100 font-extrabold border border-slate-400/50 shadow-xs", icon: <Boxes size={11} /> },
  http: { dot: "#0284c7", header: "bg-cyan-500/10 border-b border-cyan-500/30", badge: "bg-cyan-100 text-cyan-950 dark:bg-cyan-900/70 dark:text-cyan-100 font-extrabold border border-cyan-400/50 shadow-xs", icon: <Globe size={11} /> },
  transform: { dot: "#d97706", header: "bg-yellow-500/10 border-b border-yellow-500/30", badge: "bg-yellow-100 text-yellow-950 dark:bg-yellow-900/70 dark:text-yellow-100 font-extrabold border border-yellow-400/50 shadow-xs", icon: <SlidersHorizontal size={11} /> },
  simulation: { dot: "#059669", header: "bg-emerald-500/10 border-b border-emerald-500/30", badge: "bg-emerald-100 text-emerald-950 dark:bg-emerald-900/70 dark:text-emerald-100 font-extrabold border border-emerald-400/50 shadow-xs", icon: <Layers size={11} /> },
  reports: { dot: "#4f46e5", header: "bg-indigo-500/10 border-b border-indigo-500/30", badge: "bg-indigo-100 text-indigo-950 dark:bg-indigo-900/70 dark:text-indigo-100 font-extrabold border border-indigo-400/50 shadow-xs", icon: <FileText size={11} /> },
};
const DEF_CAT = { dot: "#64748b", header: "bg-slate-500/10 border-b border-slate-500/30", badge: "bg-slate-200 text-slate-950 dark:bg-slate-800 dark:text-slate-100 font-extrabold border border-slate-400/50 shadow-xs", icon: <GitBranch size={11} /> };
const getCat = (c?: string) => CAT_STYLES[c ?? ""] ?? DEF_CAT;

// ─── Custom Node (type="wfNode" avoids ReactFlow's .react-flow__node-default styles) ──
function WfNode({ data, selected }: { data: any; selected?: boolean }) {
  const node: WorkflowNode = data.node;
  const def = data.def;
  const runState: string | undefined = data.state;
  const validation = data.validation;
  const cat = def?.category ?? "data";
  const cs = getCat(cat);
  const hasErrors = (validation?.errors?.length ?? 0) > 0;

  const summary = useMemo(() => {
    const p: string[] = [];
    if (node.config?.symbol) p.push(String(node.config.symbol));
    if (node.config?.timeframe) p.push(String(node.config.timeframe));
    if (node.config?.period) p.push(`P:${node.config.period}`);
    if (node.config?.prompt) p.push("AI");
    return p.slice(0, 2).join(" · ");
  }, [node.config]);

  const ring = runState === "success" ? "ring-2 ring-emerald-500/50"
    : runState === "failed" ? "ring-2 ring-red-500/50"
      : runState === "running" ? "ring-2 ring-blue-500/50 animate-pulse"
        : selected ? "ring-2 ring-primary/60"
          : hasErrors ? "ring-1 ring-red-500/40" : "";

  return (
    <div className={`relative rounded-xl border-2 ${selected ? "border-primary shadow-md" : "border-border"} bg-card text-card-foreground shadow-sm min-w-[168px] max-w-[208px] select-none transition-all duration-150 ${ring}`}>
      {/* target port — clearly visible input */}
      <div className="absolute -top-2 left-1/2 -translate-x-1/2 flex flex-col items-center z-20">
        <Handle type="target" id="in" position={Position.Top}
          style={{ width: 16, height: 16, background: cs.dot, border: "3px solid #fff", boxShadow: "0 0 0 2px #cbd5e1", top: 4, zIndex: 10, borderRadius: "50%" }} />
      </div>

      {/* header */}
      <div className={`flex items-center gap-1.5 px-2.5 pt-2 pb-1.5 rounded-t-xl ${cs.header}`}>
        <span style={{ color: cs.dot }}>{cs.icon}</span>
        <span className="font-semibold text-[0.72rem] truncate flex-1 leading-tight text-foreground">
          {node.label || def?.name || node.id}
        </span>
        {runState === "running" && <Loader2 size={9} className="shrink-0 animate-spin" style={{ color: cs.dot }} />}
        {runState === "success" && <CheckCircle2 size={9} className="text-emerald-500 shrink-0" />}
        {runState === "failed" && <XCircle size={9} className="text-red-500 shrink-0" />}
      </div>

      {/* body */}
      <div className="px-2.5 py-1.5 space-y-0.5">
        <span className={`inline-flex text-[0.62rem] font-extrabold px-2 py-0.5 rounded-full ${cs.badge}`}>
          {(NODE_CATEGORY_LABELS as Record<string, string>)[cat] ?? cat}
        </span>
        {summary && <p className="text-[0.68rem] text-muted-foreground truncate">{summary}</p>}
        {hasErrors && (
          <p className="flex items-center gap-1 text-[0.65rem] text-red-500 font-medium truncate">
            <AlertCircle size={8} className="shrink-0" />{validation.errors[0]}
          </p>
        )}
      </div>

      {/* source port — clearly visible output */}
      <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex flex-col items-center z-20">
        <Handle type="source" id="out" position={Position.Bottom}
          style={{ width: 16, height: 16, background: "#22c55e", border: "3px solid #fff", boxShadow: "0 0 0 2px #cbd5e1", bottom: 4, zIndex: 10, borderRadius: "50%" }} />
      </div>
    </div>
  );
}

// ─── Custom Edge ──────────────────────────────────────────────────────────────
function WfEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, markerEnd }: EdgeProps) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <BaseEdge path={path} markerEnd={markerEnd}
      style={{
        stroke: selected ? "hsl(var(--ring, 221 83% 53%))" : "#64748b",
        strokeWidth: selected ? 2.5 : 1.5,
        opacity: selected ? 1 : 0.7,
        filter: selected ? "drop-shadow(0 0 4px hsl(var(--ring, 221 83% 53%) / 0.5))" : undefined,
      }} />
  );
}

const nodeTypes: NodeTypes = { wfNode: WfNode };
const edgeTypes: EdgeTypes = { wfEdge: WfEdge };
const EDGE_DEF = { type: "wfEdge", markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13 }, selectable: true, deletable: true };

// ─── Main Component ───────────────────────────────────────────────────────────
export default function StudioClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workflowIdParam = useMemo(() => searchParams?.get("workflow") ?? null, [searchParams]);

  const [user, setUser] = useState<User | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowAutomation[]>([]);
  const [selected, setSelected] = useState<WorkflowAutomation | null>(null);
  const [loading, setLoading] = useState(true);
  const [pro, setPro] = useState(false);
  const [view, setView] = useState<"list" | "builder">("list");
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" | "info" } | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [showGuide, setShowGuide] = useState(true);

  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showAiBuilder, setShowAiBuilder] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);

  const [isDirty, setIsDirty] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const [wfName, setWfName] = useState("");
  const [wfDesc, setWfDesc] = useState("");

  const [validState, setValidState] = useState<{ valid: boolean; errors: string[]; warnings: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [processingRun, setProcessingRun] = useState(false);
  const [runOutcome, setRunOutcome] = useState<any | null>(null);

  const initialLoadRef = useRef(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => { setUser(u); if (!u) router.replace("/login"); });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!user) return;
    (async () => { try { setPro((await onSubscriptionChange(user.uid)).hasSubscription); } catch { setPro(false); } })();
    fetchWorkflows();
  }, [user]);

  useEffect(() => {
    if (workflowIdParam && user) loadWorkflowById(workflowIdParam);
  }, [workflowIdParam, user]);

  useEffect(() => {
    if (initialLoadRef.current) { initialLoadRef.current = false; return; }
    if (view === "builder") setIsDirty(true);
  }, [nodes, edges]);

  const notify = (msg: string, kind: "ok" | "err" | "info" = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3500);
  };
  const getToken = async () => auth.currentUser?.getIdToken() ?? null;

  const fetchWorkflows = async () => {
    try {
      const tok = await getToken();
      const r = await fetch("/api/workflows", { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
      setWorkflows(r.ok ? await r.json() : []);
    } catch { setWorkflows([]); }
    finally { setLoading(false); }
  };

  const loadWorkflowById = async (id: string, fallbackWf?: WorkflowAutomation, force = false) => {
    if (!force && selected?.id === id && nodes.length > 0) return;
    try {
      const tok = await getToken();
      const r = await fetch(`/api/workflows/${id}`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
      if (r.ok) {
        const full = await r.json();
        openInBuilder(full);
        return;
      }
    } catch { }
    if (fallbackWf) {
      openInBuilder(fallbackWf);
    }
  };

  const openInBuilder = (w: WorkflowAutomation) => {
    initialLoadRef.current = true;
    setSelected(w); setWfName(w.name || "Untitled Workflow"); setWfDesc(w.description || "");
    setView("builder"); setRunOutcome(null); setValidState(null); setSelectedId(null);
    syncCanvas(w); setIsDirty(false);

    if (typeof window !== "undefined" && w.id) {
      const currentParam = new URLSearchParams(window.location.search).get("workflow");
      if (currentParam !== w.id) {
        router.replace(`/admin/intelligence/studio?workflow=${encodeURIComponent(w.id)}`, { scroll: false });
      }
    }
  };

  const closeBuilder = () => {
    setView("list");
    setSelected(null);
    setNodes([]);
    setEdges([]);
    setSelectedId(null);
    setIsDirty(false);
    if (typeof window !== "undefined") {
      const currentParam = new URLSearchParams(window.location.search).get("workflow");
      if (currentParam) {
        router.replace("/admin/intelligence/studio", { scroll: false });
      }
    }
  };

  const syncCanvas = (w: WorkflowAutomation) => {
    setNodes((w.nodes ?? []).map((n: WorkflowNode) => ({
      id: n.id, type: "wfNode",
      position: { x: n.position?.x ?? 60, y: n.position?.y ?? 60 },
      data: { node: n, def: getNodeDefinition(n.type), state: undefined, validation: undefined },
    })));
    setEdges((w.edges ?? []).map((e: WorkflowEdge) => ({ id: e.id, source: e.source, target: e.target, ...EDGE_DEF })));
    setTimeout(() => fitView({ padding: 0.25, duration: 350 }), 80);
  };

  const checkUnsaved = (action: () => void) => {
    if (isDirty) { setPendingAction(() => action); setShowUnsavedDialog(true); }
    else action();
  };

  const saveDraft = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const tok = await getToken();
      const r = await fetch(`/api/workflows/${selected.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: wfName.trim() || selected.name, description: wfDesc.trim(),
          nodes: nodes.map(n => ({ id: n.id, type: (n.data as any).node.type, label: (n.data as any).node.label, description: (n.data as any).node.description, enabled: (n.data as any).node.enabled, position: { x: n.position.x, y: n.position.y }, config: (n.data as any).node.config })),
          edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? "out", targetHandle: e.targetHandle ?? "in", enabled: (e as any).enabled !== false })),
          settings: selected.settings, schedule: selected.schedule,
        }),
      });
      if (r.ok) { setSelected(await r.json()); setIsDirty(false); notify("Saved ✓"); fetchWorkflows(); }
      else { let e: any = {}; try { e = await r.json(); } catch { } notify(e.error || "Save failed", "err"); }
    } catch { notify("Save error", "err"); }
    finally { setSaving(false); }
  };

  const validate = async () => {
    if (!selected) return;
    try {
      const tok = await getToken();
      const r = await fetch(`/api/workflows/${selected.id}/validate`, { headers: { Authorization: `Bearer ${tok}` } });
      let d: any = {}; try { d = await r.json(); } catch { }
      if (r.ok) {
        const vs = { valid: d.valid ?? true, errors: d.errors ?? [], warnings: d.warnings ?? [] };
        setValidState(vs);
        if (vs.valid && !vs.errors.length) notify("Validation passed ✓");
        else notify(`${vs.errors.length} error(s), ${vs.warnings.length} warning(s)`, "err");
      } else notify("Validation error", "err");
    } catch { notify("Validation failed", "err"); }
  };

  const runWorkflow = async (testMode = false) => {
    if (!selected) return;
    setProcessingRun(true); setRunOutcome(null);
    try {
      const tok = await getToken();
      const r = await fetch(`/api/workflows/${selected.id}/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify({ testMode }),
      });
      let d: any = {}; try { d = await r.json(); } catch { }
      if (r.ok) {
        setRunOutcome({ ...d, testMode, success: d.success ?? true });
        notify(testMode ? "Test completed — see results" : "Workflow triggered ✓");
      } else {
        const errMsg = d.error || d.message || `HTTP ${r.status}`;
        setRunOutcome({ success: false, testMode, error: errMsg });
        notify(errMsg, "err");
      }
    } catch (e: any) {
      const msg = e?.message || "Network error";
      setRunOutcome({ success: false, testMode, error: msg });
      notify(msg, "err");
    } finally { setProcessingRun(false); }
  };

  const createBlank = async () => {
    try {
      const tok = await getToken();
      const r = await fetch("/api/workflows", {
        method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled Workflow", description: "" }),
      });
      if (r.ok) { const w = await r.json(); setWorkflows(p => [w, ...p]); openInBuilder(w); notify("Workflow created"); }
      else notify("Failed to create", "err");
    } catch { notify("Create error", "err"); }
  };

  const duplicate = async () => {
    if (!selected) return;
    try {
      const tok = await getToken();
      const r = await fetch(`/api/workflows/${selected.id}/duplicate`, { method: "POST", headers: { Authorization: `Bearer ${tok}` } });
      if (r.ok) { const { workflow: c } = await r.json(); setWorkflows(p => [c, ...p]); openInBuilder(c); notify("Duplicated"); }
      else notify("Duplicate failed", "err");
    } catch { notify("Duplicate error", "err"); }
  };

  const applyToCanvas = (nodeArr: WorkflowNode[], edgeArr: WorkflowEdge[], name?: string, desc?: string) => {
    initialLoadRef.current = false;
    let finalNodes = nodeArr;
    let finalEdges = edgeArr;
    if (finalEdges.length === 0 && finalNodes.length > 1) {
      finalEdges = autoConnectNodes(finalNodes);
      autoPositionNodes(finalNodes);
    }
    setNodes(finalNodes.map(n => ({ id: n.id, type: "wfNode", position: { x: n.position?.x ?? 100, y: n.position?.y ?? 100 }, data: { node: n, def: getNodeDefinition(n.type) } })));
    setEdges(finalEdges.map(e => ({ id: e.id, source: e.source, target: e.target, ...EDGE_DEF })));
    if (name) setWfName(name);
    if (desc) setWfDesc(desc);
    setSelectedId(null); setIsDirty(true);
    setTimeout(() => fitView({ padding: 0.25, duration: 350 }), 80);
  };

  const handleAutoConnect = () => {
    if (nodes.length < 2) return;
    const wfNodes: WorkflowNode[] = nodes.map((n) => (n.data as any).node as WorkflowNode);
    const newEdges = autoConnectNodes(wfNodes);
    autoPositionNodes(wfNodes);

    setNodes((prev) => prev.map((n) => {
      const updated = wfNodes.find((x) => x.id === n.id);
      return updated ? { ...n, position: { x: updated.position.x, y: updated.position.y } } : n;
    }));

    setEdges(newEdges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...EDGE_DEF })));
    setIsDirty(true);
    notify("Graph auto-connected & organized ✓");
    setTimeout(() => fitView({ padding: 0.25, duration: 350 }), 80);
  };

  const handleSelectTemplate = (tpl: WorkflowTemplate, symbol?: string) => {
    try {
      const inst = instantiateTemplate(tpl.id, { symbol });
      applyToCanvas(inst.nodes, inst.edges, inst.name, inst.description);
      notify(`Template loaded: ${tpl.name}`);
    } catch (e: any) { notify(e.message || "Template error", "err"); }
  };

  const handleApplyAi = async (g: {
    name: string;
    description: string;
    nodes: WorkflowAutomation["nodes"];
    edges: WorkflowAutomation["edges"];
    settings?: WorkflowAutomation["settings"];
    schedule?: WorkflowAutomation["schedule"];
  }) => {
    const tok = await getToken();
    const r = await fetch("/api/workflows", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: g.name,
        description: g.description,
        nodes: g.nodes,
        edges: g.edges,
        settings: g.settings,
        schedule: g.schedule,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(data.error || data.message || "Failed to save AI workflow");
    }

    const workflow = data as WorkflowAutomation;
    setWorkflows((current) => [workflow, ...current.filter((item) => item.id !== workflow.id)]);
    openInBuilder(workflow);
    notify("AI workflow saved");
  };

  const handleImport = (p: PortableWorkflow) => {
    applyToCanvas(p.nodes, p.edges ?? [], p.name, p.description); notify("Imported");
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/node-type");
    if (!type || !selected) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const def = getNodeDefinition(type);
    const id = `node_${Math.random().toString(36).slice(2, 7)}`;
    setNodes(nds => [...nds, {
      id, type: "wfNode",
      position: { x: e.clientX - rect.left - 84, y: e.clientY - rect.top - 35 },
      data: { node: { id, type, label: def?.name ?? type, description: def?.description ?? "", position: { x: 0, y: 0 }, config: def?.defaults ?? {}, enabled: true }, def },
    }]);
    setSelectedId(id);
  };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; };
  const onConnect = useCallback((p: Connection) => {
    // Find source/target nodes for validation
    const sourceNodeData = nodes.find((n) => n.id === p.source)?.data?.node as WorkflowNode | undefined;
    const targetNodeData = nodes.find((n) => n.id === p.target)?.data?.node as WorkflowNode | undefined;
    if (sourceNodeData && targetNodeData) {
      const result = isConnectionAllowed(sourceNodeData, targetNodeData);
      if (!result.allowed) {
        notify(`Connection blocked: ${result.reason || "Not allowed by workflow rules"}`, "err");
        return;
      }
    }
    setEdges(eds => addEdge({ ...p, ...EDGE_DEF, sourceHandle: p.sourceHandle || "out", targetHandle: p.targetHandle || "in" }, eds));
  }, [nodes, setEdges, notify]);

  const selectedNode = useMemo(() => nodes.find(n => n.id === selectedId) ?? null, [nodes, selectedId]);
  const selectedDef = selectedNode ? getNodeDefinition((selectedNode.data as any).node.type) : null;
  const deleteNode = () => { if (!selectedId) return; setNodes(n => n.filter(x => x.id !== selectedId)); setEdges(e => e.filter(x => x.source !== selectedId && x.target !== selectedId)); setSelectedId(null); };

  const toggleCat = (cat: string) => {
    setCollapsedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };
  const expandAllCats = () => setCollapsedCats(new Set());
  const collapseAllCats = () => setCollapsedCats(new Set(NODE_CATEGORY_ORDER));

  if (loading || !user) return <LoadingState />;
  if (!pro) return <UpgradeState />;

  return (
    <div className="min-h-[80vh] flex flex-col gap-4">

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-in slide-in-from-bottom-2
          ${toast.kind === "err" ? "bg-red-600 text-white" : toast.kind === "info" ? "bg-blue-600 text-white" : "bg-emerald-600 text-white"}`}>
          {toast.kind === "err" ? <AlertCircle size={14} /> : toast.kind === "info" ? <Info size={14} /> : <CheckCircle2 size={14} />}
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)}><X size={13} className="opacity-70 hover:opacity-100" /></button>
        </div>
      )}

      {/* ─── LIST VIEW ─────────────────────────────────────────────────────────── */}
      {view === "list" && (
        <div className="space-y-6">
          <PageHeader
            title="Intelligence Studio"
            subtitle="Build, test, and deploy automated trading workflows with a visual node editor."
            actions={
              <div className="flex items-center gap-2 flex-wrap" data-guide="studio-actions">
                <Button size="sm" onClick={() => checkUnsaved(createBlank)}>
                  <Plus size={14} className="mr-1.5" /> New Workflow
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowTemplatePicker(true)} data-guide="templates">
                  <Sparkles size={14} className="mr-1.5 text-blue-500" /> Templates
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowAiBuilder(true)} data-guide="ai-builder">
                  <BrainCircuit size={14} className="mr-1.5 text-pink-500" /> AI Builder
                </Button>
              </div>
            }
            className="border-b border-border pb-5"
          />

          {/* Workflow grid */}
          {workflows.length === 0 ? (
            <EmptyState
              title="No Workflows Yet"
              description="Create a blank canvas, pick a template, or describe your strategy for AI to generate the workflow."
              action={
                <div className="flex justify-center gap-2 flex-wrap mt-4">
                  <Button size="sm" onClick={createBlank}><Plus size={14} className="mr-1.5" /> Blank Workflow</Button>
                  <Button size="sm" variant="outline" onClick={() => setShowTemplatePicker(true)}><Sparkles size={14} className="mr-1.5 text-blue-500" /> Templates</Button>
                  <Button size="sm" variant="outline" onClick={() => setShowAiBuilder(true)}><BrainCircuit size={14} className="mr-1.5 text-pink-500" /> AI Builder</Button>
                </div>
              }
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {workflows.map(wf => (
                <div key={wf.id} className="group flex flex-col justify-between gap-4 rounded-2xl border border-border bg-card p-5 shadow-xs transition hover:shadow-md hover:-translate-y-0.5">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-sm truncate text-foreground group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">{wf.name}</h3>
                      <StatusBadge tone={wf.status === "active" ? "positive" : wf.status === "paused" ? "warning" : "neutral"} label={wf.status} />
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{wf.description || "No description."}</p>
                  </div>
                  <div className="space-y-3 pt-2 border-t border-border/50">
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><GitBranch size={11} />{wf.nodes?.length ?? 0} nodes</span>
                      <span className="inline-flex items-center gap-1"><Clock size={11} />{wf.updatedAt ? new Date(wf.updatedAt).toLocaleDateString() : "—"}</span>
                      <span className="ml-auto text-[10px] font-mono text-muted-foreground/70">v{wf.version}</span>
                    </div>
                    <Button size="sm" variant="outline" className="w-full justify-center" onClick={() => checkUnsaved(() => loadWorkflowById(wf.id, wf, true))}>Open Studio</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── BUILDER VIEW ──────────────────────────────────────────────────────── */}
      {view === "builder" && selected && (
        <div className="flex flex-col gap-3" style={{ minHeight: "calc(100vh - 160px)" }}>

          {/* Toolbar */}
          <div className="flex items-center justify-between gap-2 flex-wrap rounded-2xl border border-border bg-card px-4 py-2.5 shadow-xs">
            <div className="flex items-center gap-3 min-w-0">
              <button onClick={() => checkUnsaved(closeBuilder)}
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0 p-1 rounded-md hover:bg-muted" title="Back to list">
                <ChevronLeft size={18} />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold truncate max-w-[160px] sm:max-w-[240px] text-foreground">{wfName}</span>
                  {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" title="Unsaved changes" />}
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 font-mono">v{selected.version}</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">{nodes.length} nodes · {edges.length} edges</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap" data-guide="actions">
              <Button size="sm" variant={isDirty ? "default" : "outline"} onClick={saveDraft} disabled={saving}>
                <Save size={14} className="mr-1" />{saving ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={validate}>
                <CheckCircle2 size={14} className="mr-1 text-emerald-500" /> Validate
              </Button>
              <Button size="sm" variant="outline" onClick={() => runWorkflow(true)} disabled={processingRun}>
                {processingRun ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Play size={14} className="mr-1 text-blue-500" />}
                Test
              </Button>
              <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white" onClick={() => runWorkflow(false)} disabled={processingRun}>
                <Zap size={14} className="mr-1" /> Run
              </Button>
              <div className="w-px h-4 bg-border mx-1" />
              <Button size="sm" variant="outline" onClick={handleAutoConnect} title="Auto Connect & Organize Nodes">
                <GitBranch size={14} className="mr-1 text-indigo-500" />
                <span className="hidden sm:inline">Auto Connect</span>
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowTemplatePicker(true)} title="Templates">
                <Sparkles size={14} className="text-blue-500" />
                <span className="hidden sm:inline ml-1">Templates</span>
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowAiBuilder(true)} title="AI Builder">
                <BrainCircuit size={14} className="text-pink-500" />
                <span className="hidden sm:inline ml-1">AI</span>
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowImportExport(true)} title="Import/Export">
                <Download size={14} />
              </Button>
              <Button size="sm" variant="outline" onClick={duplicate} title="Duplicate">
                <Copy size={14} />
              </Button>
              <WorkflowGuideTour pageKey="studio_builder" title="Guide" />
            </div>
          </div>

          {/* Validation banner */}
          {validState && (
            <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-xs
              ${!validState.valid ? "border-red-500/30 bg-red-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}>
              {!validState.valid ? <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" /> : <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />}
              <div className="flex-1 space-y-0.5">
                <p className={`font-semibold text-sm ${!validState.valid ? "text-red-500" : "text-emerald-500"}`}>
                  {!validState.valid ? `Validation failed — ${validState.errors.length} error(s)` : "Workflow validated ✓"}
                </p>
                {validState.errors.map((e, i) => <p key={i} className="text-red-500">✕ {e}</p>)}
                {validState.warnings.map((w, i) => <p key={i} className="text-amber-500">⚠ {w}</p>)}
              </div>
              <button onClick={() => setValidState(null)} className="text-muted-foreground hover:text-foreground shrink-0"><X size={13} /></button>
            </div>
          )}

          {/* Run outcome */}
          {runOutcome && (
            <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-xs
              ${runOutcome.success ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
              {runOutcome.success
                ? <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                : <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />}
              <div className="flex-1 space-y-1.5">
                <p className={`font-semibold text-sm ${runOutcome.success ? "text-emerald-500" : "text-red-500"}`}>
                  {runOutcome.testMode ? "Test Run" : "Live Run"} — {runOutcome.success ? "Completed Successfully" : "Failed"}
                  {runOutcome.executedAt && (
                    <span className="text-muted-foreground font-normal ml-2 text-[10px]">
                      {new Date(runOutcome.executedAt).toLocaleTimeString()}
                    </span>
                  )}
                </p>
                {runOutcome.error && <p className="text-red-500 font-medium">Error: {runOutcome.error}</p>}
                {runOutcome.message && <p className="text-muted-foreground">{runOutcome.message}</p>}
                {runOutcome.nodeResults && Object.keys(runOutcome.nodeResults).length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pt-1">
                    {Object.entries(runOutcome.nodeResults as Record<string, any>).map(([nid, res]) => (
                      <div key={nid} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 bg-background ${(res as any).status === "success" ? "border-emerald-500/30" : "border-red-500/30"}`}>
                        {(res as any).status === "success"
                          ? <CheckCircle2 size={9} className="text-emerald-500 shrink-0" />
                          : <AlertCircle size={9} className="text-red-500 shrink-0" />}
                        <span className="truncate font-medium text-foreground">{nid}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => setRunOutcome(null)} className="text-muted-foreground hover:text-foreground shrink-0"><X size={13} /></button>
            </div>
          )}

          {/* Canvas */}
          <div className="flex-1 flex overflow-hidden rounded-xl border border-border bg-transparent shadow-inner relative"
            style={{ minHeight: 520 }}>

            {/* Library panel */}
            <div className={`border-r border-border bg-card flex flex-col transition-all duration-200 ${libraryOpen ? "w-56 shrink-0" : "w-0 overflow-hidden"}`} data-guide="palette">
              {libraryOpen && (
                <div className="flex flex-col h-full p-3 gap-2 min-w-0" style={{ width: 224 }}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground">Library</span>
                    <div className="flex items-center gap-0.5">
                      <button onClick={collapseAllCats} title="Collapse all categories" className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors">
                        <ChevronsUp size={12} />
                      </button>
                      <button onClick={expandAllCats} title="Expand all categories" className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors">
                        <ChevronsDown size={12} />
                      </button>
                      <button onClick={() => setLibraryOpen(false)} className="text-muted-foreground hover:text-foreground"><PanelLeftClose size={13} /></button>
                    </div>
                  </div>
                  <div className="relative">
                    <Search size={11} className="absolute left-2.5 top-2.5 text-muted-foreground pointer-events-none" />
                    <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search nodes…" className="text-xs h-7 pl-7" />
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
                    {NODE_CATEGORY_ORDER.map(cat => {
                      const matching = getAllNodes().filter(n => n.category === cat && (!searchQuery || n.name.toLowerCase().includes(searchQuery.toLowerCase()) || n.type.toLowerCase().includes(searchQuery.toLowerCase())));
                      if (!matching.length) return null;
                      const cs = getCat(cat);
                      // Searching always reveals matches; otherwise respect the collapsed set.
                      const expanded = !searchQuery.trim() && collapsedCats.has(cat) ? false : true;
                      return (
                        <div key={cat} className="space-y-0.5">
                          <button
                            onClick={() => toggleCat(cat)}
                            title={expanded ? `Collapse ${NODE_CATEGORY_LABELS[cat] ?? cat}` : `Expand ${NODE_CATEGORY_LABELS[cat] ?? cat}`}
                            className="w-full flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground mt-1 hover:text-foreground transition-colors group"
                          >
                            <span style={{ color: cs.dot }}>{cs.icon}</span>
                            <span className="flex-1 text-left truncate">{NODE_CATEGORY_LABELS[cat] ?? cat}</span>
                            <span className="text-[8px] font-semibold text-muted-foreground/50 group-hover:text-muted-foreground/80 shrink-0">{matching.length}</span>
                            {expanded
                              ? <ChevronDown size={10} className="shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground/80" />
                              : <ChevronRight size={10} className="shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground/80" />}
                          </button>
                          {expanded && matching.map(n => (
                            <div key={n.type} draggable
                              onDragStart={e => { e.dataTransfer.setData("application/node-type", n.type); e.dataTransfer.effectAllowed = "copy"; }}
                              title={n.description}
                              className="cursor-grab active:cursor-grabbing flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted transition-colors border border-transparent hover:border-border">
                              <span style={{ color: cs.dot }} className="shrink-0">{cs.icon}</span>
                              <span className="truncate text-[11px] text-foreground font-medium">{n.name}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {!libraryOpen && (
              <button onClick={() => setLibraryOpen(true)}
                className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-card border border-border border-l-0 rounded-r-lg px-1.5 py-2 text-muted-foreground hover:text-foreground shadow-sm">
                <PanelLeftOpen size={13} />
              </button>
            )}

            {/* ReactFlow */}
            <div className="flex-1 relative" onDrop={onDrop} onDragOver={onDragOver} data-guide="canvas">
              <ReactFlow
                nodes={nodes} edges={edges}
                onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
                nodeTypes={nodeTypes} edgeTypes={edgeTypes}
                onNodeClick={(_e, n) => setSelectedId(n.id)} onPaneClick={() => setSelectedId(null)}
                onEdgeClick={(_e, e) => setSelectedId((e as any).id || null)}
                fitView deleteKeyCode="Delete" snapToGrid snapGrid={[16, 16]}
                minZoom={0.15} maxZoom={2.5}
                defaultEdgeOptions={EDGE_DEF}
                connectionLineStyle={{ stroke: "#6366f1", strokeWidth: 2, strokeDasharray: "6 3" }}
                proOptions={{ hideAttribution: false }}
              >
                <Background gap={24} size={1} color="#9ca3af" />
                <Controls showZoom showFitView showInteractive />
                <MiniMap nodeStrokeWidth={3} zoomable pannable />
                {nodes.length === 0 && (
                  <Panel position="top-center">
                    <div className="mt-6 rounded-xl border border-dashed border-border bg-card px-6 py-4 text-center text-sm text-muted-foreground pointer-events-none select-none">
                      Drag nodes from the panel · or use <strong>Templates</strong> / <strong>AI Builder</strong>
                    </div>
                  </Panel>
                )}
              </ReactFlow>
            </div>

            {/* Inspector panel */}
            <div className={`border-l border-border bg-card flex flex-col transition-all duration-200 ${inspectorOpen ? "shrink-0" : "w-0 overflow-hidden"}`}
              style={{ width: inspectorOpen ? 272 : 0 }} data-guide="inspector">
              {inspectorOpen && (
                <div className="flex flex-col h-full p-3 gap-3" style={{ width: 272 }}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[10px] uppercase tracking-wider text-muted-foreground">Inspector</span>
                    <button onClick={() => setInspectorOpen(false)} className="text-muted-foreground hover:text-foreground"><PanelLeftClose size={13} className="rotate-180" /></button>
                  </div>
                  <Inspector selectedNode={selectedNode} selectedDef={selectedDef} nodes={nodes} setNodes={setNodes} setSelectedId={setSelectedId} deleteNode={deleteNode} />
                </div>
              )}
            </div>

            {!inspectorOpen && (
              <button onClick={() => setInspectorOpen(true)}
                className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-card border border-border border-r-0 rounded-l-lg px-1.5 py-2 text-muted-foreground hover:text-foreground shadow-sm">
                <PanelLeftOpen size={13} className="rotate-180" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      <TemplatePickerModal open={showTemplatePicker} onOpenChange={setShowTemplatePicker} onSelectTemplate={handleSelectTemplate} />
      <AiBuilderModal open={showAiBuilder} onOpenChange={setShowAiBuilder} onApplyGeneratedWorkflow={handleApplyAi} />
      <ImportExportModal open={showImportExport} onOpenChange={setShowImportExport} currentWorkflow={selected} onImportWorkflow={handleImport} />

      <Dialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600"><AlertTriangle size={18} /> Unsaved Changes</DialogTitle>
            <DialogDescription className="text-xs">You have unsaved edits. Proceeding will discard them.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={() => setShowUnsavedDialog(false)}>Keep Editing</Button>
            <Button size="sm" variant="destructive" onClick={() => { setShowUnsavedDialog(false); setIsDirty(false); pendingAction?.(); }}>Discard</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-8 w-56" />
      <div className="grid gap-4 sm:grid-cols-3"><Skeleton className="h-40" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
    </div>
  );
}

function UpgradeState() {
  return (
    <EmptyState icon={<Shield size={32} />} title="Upgrade to Pro"
      description="Intelligence Studio & Workflow Automation is a Pro feature."
      action={<Link href="/pricing"><Button>Upgrade to Pro</Button></Link>} />
  );
}
