"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  GitBranch, Plus, Zap, Clock, CheckCircle2, AlertCircle,
  Play, Trash2, Copy, Settings, Search, Sparkles, BrainCircuit,
  Shield, RefreshCw, BookOpen, X, Loader2, Info, Edit,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { onSubscriptionChange } from "@/lib/subscription";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import AccountShell from "@/components/account/AccountShell";
import { WorkflowAutomation } from "@/lib/workflows/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { WORKFLOW_TEMPLATES } from "@/lib/workflows/templates";

/* ─ tiny toast ─ */
function Toast({ msg, kind, onClose }: { msg: string; kind: "ok" | "err" | "info"; onClose: () => void }) {
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-in slide-in-from-bottom-2
      ${kind === "err" ? "bg-red-600 text-white" : kind === "info" ? "bg-blue-600 text-white" : "bg-emerald-600 text-white"}`}>
      {kind === "err" ? <AlertCircle size={14} /> : kind === "info" ? <Info size={14} /> : <CheckCircle2 size={14} />}
      <span>{msg}</span>
      <button onClick={onClose}><X size={13} className="opacity-70 hover:opacity-100" /></button>
    </div>
  );
}

/* ─ create workflow dialog ─ */
interface CreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string) => Promise<void>;
  creating: boolean;
}
function CreateWorkflowDialog({ open, onClose, onCreate, creating }: CreateDialogProps) {
  const [name, setName] = useState("Untitled Workflow");
  const [desc, setDesc] = useState("");
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><GitBranch size={18} className="text-blue-500" /> New Workflow</DialogTitle>
          <DialogDescription className="text-xs">Give your workflow a name to get started. You can edit details in the Studio.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Workflow Name</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. XAUUSD Signal Monitor" className="text-sm" autoFocus />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
            <Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="What does this workflow do?" className="text-sm" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-3">
          <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => onCreate(name.trim() || "Untitled Workflow", desc.trim())} disabled={creating}>
            {creating ? <><Loader2 size={14} className="mr-1.5 animate-spin" /> Creating…</> : "Create & Open Studio"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─ stat card ─ */
function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 flex flex-col gap-0.5">
      <span className="text-2xl font-bold text-foreground">{value}</span>
      <span className="text-xs font-medium text-foreground">{label}</span>
      {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

/* ─ main page ─ */
export default function AccountWorkflowsPage() {
  const router = useRouter();
  const [user,       setUser]       = useState<User | null>(null);
  const [workflows,  setWorkflows]  = useState<WorkflowAutomation[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [pro,        setPro]        = useState(false);
  const [search,     setSearch]     = useState("");
  const [filter,     setFilter]     = useState<"all" | "active" | "draft" | "paused">("all");
  const [toast,      setToast]      = useState<{ msg: string; kind: "ok" | "err" | "info" } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [runningId,  setRunningId]  = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating,   setCreating]   = useState(false);
  const [showGuide,  setShowGuide]  = useState(true);

  const notify = (msg: string, kind: "ok" | "err" | "info" = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3500);
  };
  const getToken = async () => auth.currentUser?.getIdToken() ?? null;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) { router.replace("/login"); return; }
      setUser(u);
    });
    return () => unsub();
  }, [router]);

  const fetchWorkflows = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const tok = await getToken();
      const r = await fetch("/api/workflows", { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
      setWorkflows(r.ok ? await r.json() : []);
    } catch { setWorkflows([]); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try { setPro((await onSubscriptionChange(user.uid)).hasSubscription); }
      catch { setPro(false); }
    })();
    fetchWorkflows();
  }, [user, fetchWorkflows]);

  /* ─ create inline ─ */
  const handleCreate = async (name: string, description: string) => {
    setCreating(true);
    try {
      const tok = await getToken();
      const r = await fetch("/api/workflows", {
        method: "POST",
        headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      if (r.ok) {
        const w = await r.json();
        setShowCreate(false);
        notify("Workflow created — opening Studio…", "ok");
        setTimeout(() => router.push(`/admin/intelligence/studio?workflow=${w.id}`), 600);
      } else {
        let e: any = {}; try { e = await r.json(); } catch {}
        notify(e.error || "Failed to create", "err");
      }
    } catch { notify("Create error", "err"); }
    finally { setCreating(false); }
  };

  /* ─ delete ─ */
  const deleteWorkflow = async (id: string) => {
    if (!confirm("Delete this workflow? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const tok = await getToken();
      const r = await fetch(`/api/workflows/${id}`, { method: "DELETE", headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
      if (r.ok) { setWorkflows(p => p.filter(w => w.id !== id)); notify("Workflow deleted"); }
      else notify("Delete failed", "err");
    } catch { notify("Delete error", "err"); }
    finally { setDeletingId(null); }
  };

  /* ─ duplicate ─ */
  const duplicateWorkflow = async (id: string) => {
    try {
      const tok = await getToken();
      const r = await fetch(`/api/workflows/${id}/duplicate`, { method: "POST", headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
      if (r.ok) { const { workflow: c } = await r.json(); setWorkflows(p => [c, ...p]); notify("Duplicated"); }
      else notify("Duplicate failed", "err");
    } catch { notify("Duplicate error", "err"); }
  };

  /* ─ quick run ─ */
  const runWorkflow = async (id: string) => {
    setRunningId(id);
    try {
      const tok = await getToken();
      const r = await fetch(`/api/workflows/${id}/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tok ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ testMode: false }),
      });
      let d: any = {}; try { d = await r.json(); } catch {}
      if (r.ok) notify("Workflow triggered ✓");
      else notify(d.error || d.message || "Run failed", "err");
    } catch (e: any) { notify(e?.message || "Run error", "err"); }
    finally { setRunningId(null); }
  };

  const openStudio = (wf: WorkflowAutomation) => router.push(`/admin/intelligence/studio?workflow=${wf.id}`);

  const filtered = workflows.filter(w => {
    const matchS = !search || w.name.toLowerCase().includes(search.toLowerCase()) || (w.description ?? "").toLowerCase().includes(search.toLowerCase());
    const matchF = filter === "all" || w.status === filter;
    return matchS && matchF;
  });

  const stats = {
    total: workflows.length,
    active: workflows.filter(w => w.status === "active").length,
    draft: workflows.filter(w => w.status === "draft").length,
    paused: workflows.filter(w => w.status === "paused").length,
  };

  return (
    <AccountShell title="Workflow Automation">
      {toast && <Toast msg={toast.msg} kind={toast.kind} onClose={() => setToast(null)} />}

      <CreateWorkflowDialog open={showCreate} onClose={() => setShowCreate(false)} onCreate={handleCreate} creating={creating} />

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-4 border-b border-border pb-5" data-guide="page-header">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Workflow Automation</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Create, monitor, and manage your automated trading workflows.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap" data-guide="create-actions">
            <Button variant="outline" size="sm" onClick={fetchWorkflows} title="Refresh">
              <RefreshCw size={14} className="mr-1.5" /> Refresh
            </Button>
            {pro ? (
              <>
                <Button size="sm" variant="outline" onClick={() => router.push("/admin/intelligence/studio?open=templates")}>
                  <Sparkles size={14} className="mr-1.5 text-blue-500" /> Templates
                </Button>
                <Button size="sm" variant="outline" onClick={() => router.push("/admin/intelligence/studio?open=ai")}>
                  <BrainCircuit size={14} className="mr-1.5 text-pink-500" /> AI Builder
                </Button>
                <Button size="sm" onClick={() => setShowCreate(true)}>
                  <Plus size={14} className="mr-1.5" /> New Workflow
                </Button>
              </>
            ) : (
              <Link href="/pricing">
                <Button size="sm"><Zap size={14} className="mr-1.5" /> Upgrade to Pro</Button>
              </Link>
            )}
          </div>
        </div>



        {/* Pro upgrade callout */}
        {!loading && !pro && (
          <div className="rounded-xl border border-border bg-card p-8 text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-blue-500/10 flex items-center justify-center mx-auto">
              <Shield size={26} className="text-blue-500" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground">Workflow Automation is a Pro Feature</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                Build visual DAG workflows with market data, indicators, AI analysis, signals, and execution. Upgrade to unlock unlimited nodes, AI Builder, scheduling, and more.
              </p>
            </div>
            <div className="flex justify-center gap-2 flex-wrap">
              <Link href="/pricing"><Button>Upgrade to Pro</Button></Link>
              <Link href="/admin/intelligence/studio">
                <Button variant="outline"><Sparkles size={14} className="mr-1.5 text-blue-500" /> Explore Studio</Button>
              </Link>
            </div>
          </div>
        )}

        {/* Stats */}
        {!loading && pro && workflows.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-guide="stats">
            <Stat label="Total" value={stats.total} />
            <Stat label="Active" value={stats.active} sub="running automations" />
            <Stat label="Drafts" value={stats.draft} sub="in progress" />
            <Stat label="Paused" value={stats.paused} sub="not running" />
          </div>
        )}

        {/* Search + filter */}
        {pro && workflows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" data-guide="search-bar">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search size={13} className="absolute left-3 top-2.5 text-muted-foreground pointer-events-none" />
              <Input placeholder="Search workflows…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 text-sm h-9" />
            </div>
            <div className="flex items-center gap-1">
              {(["all", "active", "draft", "paused"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors capitalize ${
                    filter === f ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background hover:bg-muted text-foreground"
                  }`}>
                  {f}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && pro && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map(i => <div key={i} className="h-48 rounded-xl border border-border animate-pulse bg-muted/30" />)}
          </div>
        )}

        {/* Empty state */}
        {!loading && pro && workflows.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center mx-auto">
              <GitBranch size={28} className="text-blue-500" />
            </div>
            <div className="max-w-md mx-auto space-y-2">
              <h3 className="text-lg font-bold text-foreground">No Workflows Yet</h3>
              <p className="text-sm text-muted-foreground">
                Create your first automation — start blank, from a template, or let AI generate the entire workflow from a description.
              </p>
            </div>
            <div className="flex justify-center gap-2 flex-wrap">
              <Button size="sm" onClick={() => setShowCreate(true)}><Plus size={14} className="mr-1.5" /> New Workflow</Button>
              <Button size="sm" variant="outline" onClick={() => router.push("/admin/intelligence/studio?open=templates")}>
                <Sparkles size={14} className="mr-1.5 text-blue-500" /> Browse Templates
              </Button>
              <Button size="sm" variant="outline" onClick={() => router.push("/admin/intelligence/studio?open=ai")}>
                <BrainCircuit size={14} className="mr-1.5 text-pink-500" /> AI Builder
              </Button>
            </div>
          </div>
        )}

        {/* No search results */}
        {!loading && pro && workflows.length > 0 && filtered.length === 0 && (
          <div className="rounded-xl border border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
            No workflows match your search or filter.
          </div>
        )}

        {/* Workflow grid */}
        {!loading && pro && filtered.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-guide="workflows-grid">
            {filtered.map(wf => (
              <div key={wf.id}
                className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5">
                {/* Top */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-bold text-sm truncate text-foreground group-hover:text-blue-500 transition-colors">
                      {wf.name}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {wf.description || "No description."}
                    </p>
                  </div>
                  <StatusBadge
                    tone={wf.status === "active" ? "active" : wf.status === "paused" ? "warning" : "neutral"}
                    label={wf.status}
                  />
                </div>

                {/* Meta */}
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><GitBranch size={10} />{wf.nodes?.length ?? 0} nodes</span>
                  <span className="flex items-center gap-1"><Clock size={10} />{wf.updatedAt ? new Date(wf.updatedAt).toLocaleDateString() : "—"}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">v{wf.version}</span>
                </div>

                {/* Tags */}
                <div className="flex flex-wrap gap-1.5 min-h-[20px]">
                  {wf.schedule?.enabled && (
                    <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-600 dark:text-amber-400">Scheduled</Badge>
                  )}
                  {(wf.requiredPermissions ?? []).slice(0, 2).map(p => (
                    <Badge key={p} variant="secondary" className="text-[10px]">{p}</Badge>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 pt-1 border-t border-border">
                  <Button size="xs" className="flex-1" onClick={() => openStudio(wf)}>
                    <Settings size={11} className="mr-1" /> Open Studio
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => runWorkflow(wf.id)}
                    disabled={runningId === wf.id} title="Trigger run">
                    {runningId === wf.id ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => duplicateWorkflow(wf.id)} title="Duplicate">
                    <Copy size={11} />
                  </Button>
                  <Button size="xs" variant="outline"
                    className="text-destructive hover:text-destructive hover:border-destructive/50"
                    onClick={() => deleteWorkflow(wf.id)} disabled={deletingId === wf.id} title="Delete">
                    {deletingId === wf.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AccountShell>
  );
}
