"use client";

import { useState, useEffect, useCallback, ReactNode } from "react";
import Link from "next/link";
import {
  GitBranch,
  Play,
  Shield,
  Pause,
  Archive,
  X,
  RefreshCw,
  Sparkles,
  Search,
  Plus,
  Trash2,
  Copy,
  ExternalLink,
  SlidersHorizontal,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Layers,
  Loader2,
  Edit,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import AdminShell from "@/components/admin/AdminShell";
import { auth } from "@/lib/firebase";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface WorkflowSummary {
  workflowCount: number;
  runsTotal: number;
  killSwitch: boolean;
  killSwitchReason?: string;
  statusBreakdown: {
    draft: number;
    active: number;
    paused: number;
    disabled: number;
    archived: number;
  };
  recentFailures: Array<{
    id: string;
    workflowId: string;
    workflowName: string;
    status: string;
    startedAt: number;
    finishedAt: number | null;
    error?: string;
  }>;
}

interface WorkflowItem {
  id: string;
  name: string;
  description?: string;
  status: "draft" | "active" | "paused" | "disabled" | "archived";
  trigger?: string;
  version?: string | number;
  updatedAt?: number;
  createdAt?: number;
  nodes?: any[];
  edges?: any[];
}

export default function AdminWorkflowsPage() {
  const [summary, setSummary] = useState<WorkflowSummary | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [toastMessage, setToastMessage] = useState<{ text: string; isError?: boolean } | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) setLoading(false);
    });
    return () => unsub();
  }, []);

  const showToast = (text: string, isError = false) => {
    setToastMessage({ text, isError });
    setTimeout(() => setToastMessage(null), 3500);
  };

  const getToken = async () => auth.currentUser?.getIdToken() ?? null;

  // Load summary metrics + real workflows list from Admin API
  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch("/api/admin/workflows", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setSummary(data);
        if (Array.isArray(data.workflows)) {
          setWorkflows(data.workflows);
        }
      } else {
        // Fallback: fetch from /api/workflows
        const fallbackRes = await fetch("/api/workflows", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (fallbackRes.ok) {
          const list = await fallbackRes.json();
          setWorkflows(Array.isArray(list) ? list : []);
        }
      }
    } catch (err: any) {
      showToast("Failed to load workflows", true);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user, loadData]);

  // Toggle admin kill switch
  const toggleKillSwitch = async () => {
    if (!user) return;
    const currentKillSwitch = summary?.killSwitch ?? false;
    const nextState = !currentKillSwitch;
    try {
      const token = await getToken();
      const res = await fetch("/api/admin/workflows", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ killSwitch: nextState, reason: nextState ? "Admin kill switch engaged." : "" }),
      });
      if (res.ok) {
        const data = await res.json();
        const isEnabled = data.killSwitchEnabled ?? data.killSwitch ?? nextState;
        setSummary((prev) => ({
          workflowCount: prev?.workflowCount ?? workflows.length,
          runsTotal: prev?.runsTotal ?? 0,
          statusBreakdown: prev?.statusBreakdown ?? { draft: 0, active: 0, paused: 0, disabled: 0, archived: 0 },
          recentFailures: prev?.recentFailures ?? [],
          ...prev,
          killSwitch: isEnabled,
          killSwitchReason: isEnabled ? (data.killSwitchReason || "Admin kill switch engaged.") : undefined,
        }));
        showToast(`Kill switch turned ${isEnabled ? "ON" : "OFF"}`);
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast(errData.error || "Failed to toggle kill switch", true);
      }
    } catch {
      showToast("Failed to toggle kill switch", true);
    }
  };

  // Toggle workflow status (active <-> paused) via API
  const handleToggleStatus = async (wf: WorkflowItem) => {
    setActionLoadingId(wf.id);
    const newStatus = wf.status === "active" ? "paused" : "active";
    try {
      const token = await getToken();
      const res = await fetch(`/api/workflows/${wf.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        setWorkflows((prev) =>
          prev.map((w) => (w.id === wf.id ? { ...w, status: newStatus } : w))
        );
        showToast(`Workflow "${wf.name}" set to ${newStatus}`);
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || "Failed to update status", true);
      }
    } catch {
      showToast("Network error updating status", true);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Duplicate workflow via API
  const handleDuplicate = async (wf: WorkflowItem) => {
    setActionLoadingId(wf.id);
    try {
      const token = await getToken();
      const res = await fetch(`/api/workflows/${wf.id}/duplicate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.workflow) {
          setWorkflows((prev) => [data.workflow, ...prev]);
          showToast(`Duplicated "${wf.name}"`);
        }
      } else {
        showToast("Failed to duplicate workflow", true);
      }
    } catch {
      showToast("Duplicate network error", true);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Delete workflow via API
  const handleDeleteWorkflow = async (wf: WorkflowItem) => {
    if (!confirm(`Are you sure you want to delete workflow "${wf.name}"?`)) return;
    setActionLoadingId(wf.id);
    try {
      const token = await getToken();
      const res = await fetch(`/api/workflows/${wf.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        setWorkflows((prev) => prev.filter((w) => w.id !== wf.id));
        showToast(`Workflow "${wf.name}" deleted`);
      } else {
        showToast("Failed to delete workflow", true);
      }
    } catch {
      showToast("Delete network error", true);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Trigger manually via API
  const handleRunWorkflow = async (wf: WorkflowItem) => {
    setActionLoadingId(wf.id);
    try {
      const token = await getToken();
      const res = await fetch(`/api/workflows/${wf.id}/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ triggerType: "manual" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.success ?? true)) {
        showToast(`Workflow "${wf.name}" triggered successfully!`);
      } else {
        showToast(`Run failed: ${data.error || data.message || "Unknown error"}`, true);
      }
    } catch (e: any) {
      showToast(`Trigger failed: ${e.message}`, true);
    } finally {
      setActionLoadingId(null);
    }
  };

  const statusBreakdown = summary?.statusBreakdown ?? {
    draft: workflows.filter((w) => w.status === "draft").length,
    active: workflows.filter((w) => w.status === "active").length,
    paused: workflows.filter((w) => w.status === "paused").length,
    disabled: workflows.filter((w) => w.status === "disabled").length,
    archived: workflows.filter((w) => w.status === "archived").length,
  };

  const filteredWorkflows = workflows.filter((w) => {
    const matchSearch =
      w.name.toLowerCase().includes(search.toLowerCase()) ||
      (w.description && w.description.toLowerCase().includes(search.toLowerCase())) ||
      w.id.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || w.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <AdminShell
      title="Workflow Studio & Management"
      subtitle="Monitor runs, orchestrate intelligence workflows, configure kill switch."
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 shadow-2xl text-xs font-semibold flex items-center gap-2 border animate-in fade-in slide-in-from-bottom-2 ${
            toastMessage.isError
              ? "bg-red-600 text-white border-red-700"
              : "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 border-slate-700"
          }`}
        >
          {toastMessage.isError ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} className="text-emerald-400" />}
          {toastMessage.text}
        </div>
      )}

      {/* Header bar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3" data-guide="page-header">
        <div className="flex flex-wrap items-center gap-3">
          <StatCard icon={<GitBranch size={16} className="text-violet-400" />} label="Workflows" value={workflows.length || (summary?.workflowCount ?? "—")} />
          <StatCard icon={<Play size={16} className="text-blue-400" />} label="Total Runs" value={summary?.runsTotal ?? "—"} />
          <StatCard
            icon={<Shield size={16} className={summary?.killSwitch ? "text-rose-500" : "text-emerald-400"} />}
            label="System Safety"
            value={summary?.killSwitch ? "KILL SWITCH" : "Active"}
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={summary?.killSwitch ? "destructive" : "outline"}
            size="sm"
            data-guide="kill-switch"
            onClick={toggleKillSwitch}
            disabled={loading}
          >
            <Shield size={14} className="mr-1.5" />
            Kill Switch: {summary?.killSwitch ? "ON" : "OFF"}
          </Button>
          <Link href="/admin/intelligence/studio">
            <Button size="sm">
              <Sparkles size={14} className="mr-1.5" /> Launch Studio
            </Button>
          </Link>
        </div>
      </div>

      {summary?.killSwitchReason && (
        <div className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs sm:text-sm text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-2">
          <AlertTriangle size={18} className="shrink-0 text-rose-500" />
          <span>{summary.killSwitchReason}</span>
        </div>
      )}

      {/* Status breakdown grid */}
      <div className="mb-8 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" data-guide="stats">
        <MiniStat label="Active" value={statusBreakdown.active ?? 0} icon={<Play size={14} className="text-emerald-500" />} />
        <MiniStat label="Paused" value={statusBreakdown.paused ?? 0} icon={<Pause size={14} className="text-amber-500" />} />
        <MiniStat label="Disabled" value={statusBreakdown.disabled ?? 0} icon={<X size={14} className="text-rose-500" />} />
        <MiniStat label="Drafts" value={statusBreakdown.draft ?? 0} icon={<Archive size={14} className="text-muted-foreground" />} />
        <MiniStat label="Archived" value={statusBreakdown.archived ?? 0} icon={<Archive size={14} className="text-muted-foreground/50" />} />
      </div>

      {/* Filter and Workflow Search Section */}
      <div className="mb-6 rounded-2xl border border-border bg-card p-4 space-y-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search size={14} className="absolute left-3 top-3 text-muted-foreground" />
            <Input
              placeholder="Search workflows by name or ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 text-xs h-9"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto">
            <span className="text-xs text-muted-foreground font-medium shrink-0 flex items-center gap-1">
              <SlidersHorizontal size={12} /> Status:
            </span>
            {["all", "active", "paused", "draft", "disabled"].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`text-xs px-3 py-1 rounded-lg border capitalize whitespace-nowrap transition-colors ${
                  statusFilter === st
                    ? "bg-primary text-primary-foreground border-primary font-medium"
                    : "border-border bg-background hover:bg-muted text-foreground"
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Workflows List */}
      <div className="mb-8 rounded-2xl border border-border bg-card overflow-hidden" data-guide="workflows-list">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/20">
          <div>
            <h3 className="font-bold text-sm text-foreground">Workflow Definitions ({filteredWorkflows.length})</h3>
            <p className="text-xs text-muted-foreground">Manage and run automated intelligence strategies across the platform</p>
          </div>
          <Button size="sm" variant="outline" onClick={loadData} disabled={loading}>
            <RefreshCw size={13} className={`mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {loading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-xl border border-border bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : filteredWorkflows.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <GitBranch size={36} className="mx-auto text-muted-foreground opacity-50" />
            <p className="text-sm font-medium text-muted-foreground">No workflows found matching filter criteria.</p>
            <Link href="/admin/intelligence/studio">
              <Button size="sm" variant="outline">
                <Plus size={14} className="mr-1.5" /> Create First Workflow
              </Button>
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredWorkflows.map((wf) => {
              const nodeCount = wf.nodes?.length ?? 0;
              const isBusy = actionLoadingId === wf.id;

              return (
                <div key={wf.id} className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-muted/20 transition-colors">
                  {/* Left: Info */}
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-foreground">{wf.name}</span>
                      <StatusBadge
                        tone={wf.status === "active" ? "positive" : wf.status === "paused" ? "warning" : "info"}
                        label={wf.status}
                      />
                      <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground border">
                        v{wf.version || "1.0.0"}
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-1">{wf.description || "No description provided."}</p>

                    <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <Layers size={11} className="text-blue-500" /> {nodeCount} nodes
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={11} className="text-amber-500" /> Trigger: {wf.trigger || "manual"}
                      </span>
                      <span>ID: <code className="bg-muted px-1.5 py-0.5 rounded text-[10px]">{wf.id}</code></span>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => handleRunWorkflow(wf)}
                      disabled={isBusy || summary?.killSwitch}
                      title="Run workflow"
                    >
                      {isBusy ? <Loader2 size={12} className="animate-spin mr-1" /> : <Play size={12} className="mr-1 text-emerald-500" />}
                      Run
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => handleToggleStatus(wf)}
                      disabled={isBusy}
                      title={wf.status === "active" ? "Pause workflow" : "Activate workflow"}
                    >
                      {wf.status === "active" ? (
                        <>
                          <Pause size={12} className="mr-1 text-amber-500" /> Pause
                        </>
                      ) : (
                        <>
                          <Play size={12} className="mr-1 text-emerald-500" /> Activate
                        </>
                      )}
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => handleDuplicate(wf)}
                      disabled={isBusy}
                      title="Duplicate workflow"
                    >
                      <Copy size={12} className="mr-1" /> Copy
                    </Button>

                    <Link href={`/admin/intelligence/studio?workflowId=${wf.id}`}>
                      <Button size="sm" variant="outline" className="h-8 text-xs">
                        <Edit size={12} className="mr-1" /> Studio
                      </Button>
                    </Link>

                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10"
                      onClick={() => handleDeleteWorkflow(wf)}
                      disabled={isBusy}
                      title="Delete workflow"
                    >
                      {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Failures & Audit Log */}
      <div className="rounded-2xl border border-border bg-card p-5" data-guide="audit-log">
        <h3 className="font-bold text-sm text-foreground mb-3">System Execution Audit Log</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Recent failed executions and automated triggers monitored by the Intelligence Router.
        </p>

        {summary?.recentFailures && summary.recentFailures.length > 0 ? (
          <div className="divide-y divide-border border rounded-xl overflow-hidden">
            {summary.recentFailures.map((run) => (
              <div key={run.id} className="p-3 text-xs flex items-center justify-between gap-3 bg-muted/10">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{run.workflowName || run.workflowId}</span>
                    <StatusBadge tone="negative" label={run.status} />
                  </div>
                  {run.error && <p className="text-rose-500 font-mono text-[11px] mt-0.5 truncate">{run.error}</p>}
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {new Date(run.startedAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 rounded-xl border border-dashed text-center text-xs text-muted-foreground">
            No recent failures detected. All automated systems operating within nominal parameters.
          </div>
        )}
      </div>
    </AdminShell>
  );
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-2.5 flex items-center gap-3 min-w-[140px]">
      <div className="p-2 rounded-lg bg-muted/40 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground truncate">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: ReactNode; label: string; value: number | string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 px-3.5 py-2.5">
      {icon}
      <div>
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold text-foreground">{value}</p>
      </div>
    </div>
  );
}