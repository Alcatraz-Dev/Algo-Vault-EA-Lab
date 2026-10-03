"use client";

/**
 * Growth → Marketing Agent (§1, §41, §42, §43).
 *
 * The prompt is the primary input; every other field is optional and the agent
 * infers it. The live timeline shows the real state of every task — a task is
 * only marked done when its artifact exists (§91).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CalendarClock,
  CheckCircle2,
  Circle,
  Loader2,
  Megaphone,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { adminFetch } from "@/components/growth/admin/session";

type TaskState = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED" | "BLOCKED";

type AgentJob = {
  id: string;
  prompt: string;
  mode: string;
  state: string;
  cursor: number;
  tasks: { id: string; label: string; status: TaskState; summary?: string; error?: string; startedAt?: number; finishedAt?: number }[];
  artifacts: { key: string; kind: string; label: string; taskId: string; createdAt: number; ref?: string; url?: string }[];
  estimatedUnits: number;
  consumedUnits: number;
  approval?: { required: boolean; decision?: string; reason?: string; decidedBy?: string } | null;
  blockedReason?: string | null;
  error?: string | null;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
  createdAt: number;
  planId?: string | null;
  creativeId?: string | null;
};

type Health = { id: string; label: string; state: string; detail?: string; checkedAt: number };
type CapabilityRow = {
  platform: string;
  canPublishVideo: boolean;
  canSchedule: boolean;
  canRetrieveMetrics: boolean;
  apiSurface: string;
};

const EXAMPLE_PROMPTS = [
  "Create a 30-second TikTok and Instagram campaign showing how AlgoVault AI Signals works. Open the AI Signals page, demonstrate how a user finds and understands a signal, explain why the feature is useful, add energetic motion graphics, captions and a strong CTA. Create English and French versions and schedule them for this week.",
  "Make a 20 second YouTube Short explaining how Strategy Lab works, professional tone.",
  "Take the AI Signals video we made and create three new versions. Keep the product demonstration but change the hook and CTA — one educational, one energetic, one premium.",
  "Promote AlgoVault with a 45-second video. Explore the platform yourself, choose the strongest features to demonstrate, and prepare it for all major social platforms.",
];

function stateIcon(status: TaskState) {
  switch (status) {
    case "DONE":
      return <CheckCircle2 size={14} className="text-emerald-500" />;
    case "RUNNING":
      return <Loader2 size={14} className="animate-spin text-primary" />;
    case "FAILED":
      return <XCircle size={14} className="text-red-500" />;
    case "BLOCKED":
      return <TriangleAlert size={14} className="text-amber-500" />;
    case "SKIPPED":
      return <Circle size={14} className="text-muted-foreground/50" />;
    default:
      return <Circle size={14} className="text-muted-foreground/40" />;
  }
}

export default function MarketingAgentPage() {
  const status = useAdminFetch<{ settings: { mode: string; enabled: boolean }; health: Health[]; capabilities: CapabilityRow[] }>("/api/admin/marketing-agent");
  const jobs = useAdminFetch<{ jobs: AgentJob[] }>("/api/admin/marketing-agent/jobs");
  const schedules = useAdminFetch<{ schedules: { id: string; platform: string; scheduledFor: number; timezone: string; state: string; recurrence: { kind: string } }[] }>("/api/admin/marketing-agent/schedules");
  const publishing = useAdminFetch<{ jobs: { id: string; platform: string; state: string; attempt: number; externalId?: string; lastError?: { message: string } }[] }>("/api/admin/marketing-agent/publishing");
  const social = useAdminFetch<{ connectors: { platform: string; state: string; reason?: string; permissions: string[] }[] }>("/api/admin/marketing-agent/social");

  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState("ASSISTED");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [liveJob, setLiveJob] = useState<AgentJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status.data?.settings?.mode) setMode(status.data.settings.mode);
  }, [status.data?.settings?.mode]);

  const activeJob = useMemo(() => {
    if (liveJob && liveJob.id === activeJobId) return liveJob;
    return jobs.data?.jobs?.find((j) => j.id === activeJobId) ?? null;
  }, [activeJobId, liveJob, jobs.data]);

  const poll = useCallback(async (jobId: string) => {
    try {
      const data = await adminFetch<{ job: AgentJob }>(`/api/admin/marketing-agent/jobs/${jobId}`);
      if (data.job) {
        setLiveJob(data.job);
        if (data.job.state === "RUNNING" || data.job.state === "CREATED" || data.job.state === "PAUSED") {
          pollRef.current = setTimeout(() => void poll(jobId), 2500);
        } else {
          jobs.refresh();
          schedules.refresh();
          publishing.refresh();
        }
      }
    } catch {
      pollRef.current = setTimeout(() => void poll(jobId), 5000);
    }
  }, [jobs, schedules, publishing]);

  useEffect(() => () => {
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  const startRun = async () => {
    if (prompt.trim().length < 8) {
      setError("Describe what you want to market in a sentence or two.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await adminFetch<{ job: AgentJob }>("/api/admin/marketing-agent/run", {
        method: "POST",
        body: JSON.stringify({ prompt, mode }),
      });
      setActiveJobId(data.job.id);
      setLiveJob(data.job);
      setPrompt("");
      jobs.refresh();
      if (pollRef.current) clearTimeout(pollRef.current);
      pollRef.current = setTimeout(() => void poll(data.job.id), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the run.");
    } finally {
      setBusy(false);
    }
  };

  const jobAction = async (action: string, jobId: string, reason?: string) => {
    try {
      const data = await adminFetch<{ job: AgentJob }>(`/api/admin/marketing-agent/jobs/${jobId}`, {
        method: "POST",
        body: JSON.stringify({ action, ...(reason ? { reason } : {}) }),
      });
      setLiveJob(data.job);
      jobs.refresh();
      if (action === "resume" || action === "approve") {
        if (pollRef.current) clearTimeout(pollRef.current);
        pollRef.current = setTimeout(() => void poll(jobId), 1200);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    }
  };

  const health = status.data?.health ?? [];
  const capabilities = status.data?.capabilities ?? [];
  const running = activeJob?.state === "RUNNING";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Bot size={22} /> Marketing Agent
          </h1>
          <p className="text-sm text-muted-foreground">
            Understand → Plan → Capture real product → Produce → QA → Approve → Schedule → Publish → Analyze → Learn
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="h-9 rounded-lg border bg-card px-2 text-xs"
            aria-label="Agent mode"
          >
            <option value="MANUAL">Manual — you publish</option>
            <option value="ASSISTED">Assisted — you approve</option>
            <option value="AUTONOMOUS">Autonomous — rules apply</option>
          </select>
          <Button size="sm" variant="outline" onClick={() => { status.refresh(); jobs.refresh(); schedules.refresh(); publishing.refresh(); social.refresh(); }}>
            <RefreshCw size={14} /> Refresh
          </Button>
        </div>
      </div>

      {/* ── Prompt box ─────────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <label htmlFor="ma-prompt" className="text-sm font-semibold">What do you want to market?</label>
          <textarea
            id="ma-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="Create a 30-second TikTok and Instagram campaign showing how AlgoVault AI Signals works…"
            className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLE_PROMPTS.slice(0, 2).map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPrompt(p)}
                  className="max-w-[280px] truncate rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted/60"
                  title={p}
                >
                  Example {i + 1}
                </button>
              ))}
            </div>
            <Button size="sm" onClick={startRun} disabled={busy || prompt.trim().length < 8}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Run agent
            </Button>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </CardContent>
      </Card>

      {/* ── Live progress (§43) ───────────────────────────────────── */}
      {activeJob && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Execution timeline</span>
                <Badge variant="secondary" className="text-[10px]">{activeJob.state}</Badge>
                <Badge variant="outline" className="text-[10px]">{activeJob.mode}</Badge>
                <Badge variant="outline" className="text-[10px]">{activeJob.consumedUnits}/{activeJob.estimatedUnits} units</Badge>
              </div>
              <div className="flex gap-1.5">
                {activeJob.state === "AWAITING_APPROVAL" && (
                  <>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void jobAction("approve", activeJob.id)}>
                      <CheckCircle2 size={12} /> Approve
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void jobAction("reject", activeJob.id, "Rejected from the command center.")}>
                      <XCircle size={12} /> Reject
                    </Button>
                  </>
                )}
                {(activeJob.state === "PAUSED" || activeJob.state === "FAILED") && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void jobAction("resume", activeJob.id)}>
                    <Play size={12} /> Resume
                  </Button>
                )}
                {running && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void jobAction("cancel", activeJob.id)}>
                    <Square size={12} /> Cancel
                  </Button>
                )}
              </div>
            </div>

            <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{activeJob.prompt}</p>

            <ol className="grid gap-1 sm:grid-cols-2">
              {activeJob.tasks.map((t) => (
                <li
                  key={t.id}
                  className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
                    t.status === "DONE"
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : t.status === "RUNNING"
                        ? "border-primary/50 bg-primary/5"
                        : t.status === "FAILED"
                          ? "border-red-500/40 bg-red-500/5"
                          : "bg-card"
                  }`}
                >
                  <span className="mt-0.5">{stateIcon(t.status)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{t.label}</span>
                    {t.summary && <span className="block truncate text-[11px] text-muted-foreground" title={t.summary}>{t.summary}</span>}
                    {t.error && <span className="block text-[11px] text-red-500">{t.error}</span>}
                  </span>
                </li>
              ))}
            </ol>

            {activeJob.approval?.required && !activeJob.approval.decision && (
              <p className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                <ShieldCheck size={14} /> {activeJob.blockedReason || "Approval required before scheduling or publishing."}
              </p>
            )}
            {activeJob.error && <p className="text-xs text-red-500">{activeJob.error}</p>}

            {activeJob.artifacts.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {activeJob.artifacts.map((a) => (
                  <Badge key={`${a.key}_${a.createdAt}`} variant="outline" className="text-[10px] font-normal">
                    {a.label}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Runs ───────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
          <Megaphone size={16} /> Runs
        </h2>
        <div className="grid gap-2">
          {(jobs.data?.jobs ?? []).slice(0, 8).map((j) => (
            <button
              key={j.id}
              onClick={() => { setActiveJobId(j.id); setLiveJob(null); poll(j.id); }}
              className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-xs transition ${
                activeJobId === j.id ? "border-primary bg-muted/50" : "bg-card hover:bg-muted/40"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{j.prompt}</span>
                <span className="text-[10px] text-muted-foreground">{new Date(j.createdAt).toLocaleString()} · {j.tasks.filter((t) => t.status === "DONE").length}/{j.tasks.length} tasks</span>
              </span>
              <Badge variant="secondary" className="shrink-0 text-[10px]">{j.state}</Badge>
            </button>
          ))}
          {(jobs.data?.jobs ?? []).length === 0 && (
            <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
              No runs yet. Describe what you want to market above.
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Publishing ──────────────────────────────────────── */}
        <Card>
          <CardContent className="space-y-2 p-4">
            <h3 className="text-sm font-semibold">Publishing jobs</h3>
            {(publishing.data?.jobs ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No publishing jobs yet.</p>
            ) : (
              <ul className="space-y-1">
                {(publishing.data?.jobs ?? []).slice(0, 10).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs">
                    <span className="truncate">{p.platform}</span>
                    <span className="flex items-center gap-2">
                      {p.externalId && <span className="text-[10px] text-muted-foreground">#{p.externalId.slice(0, 8)}</span>}
                      <Badge variant={p.state === "PUBLISHED" ? "secondary" : p.state === "FAILED" ? "destructive" : "outline"} className="text-[10px]">{p.state}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── Schedules ───────────────────────────────────────── */}
        <Card>
          <CardContent className="space-y-2 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarClock size={14} /> Schedules</h3>
            {(schedules.data?.schedules ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No schedules stored.</p>
            ) : (
              <ul className="space-y-1">
                {(schedules.data?.schedules ?? []).slice(0, 10).map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs">
                    <span className="truncate">{s.platform} · {new Date(s.scheduledFor).toLocaleString()}</span>
                    <Badge variant="outline" className="text-[10px]">{s.state}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Subsystem health (§84) ─────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <h3 className="text-sm font-semibold">Subsystem health</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {health.map((h) => (
              <div key={h.id} className="rounded-lg border px-3 py-2">
                <div className="truncate text-xs font-medium">{h.label}</div>
                <div
                  className={`text-[11px] ${
                    h.state === "CONNECTED" || h.state === "READY"
                      ? "text-emerald-500"
                      : h.state === "DEGRADED"
                        ? "text-amber-500"
                        : "text-muted-foreground"
                  }`}
                >
                  {h.state}
                </div>
                {h.detail && <div className="truncate text-[10px] text-muted-foreground" title={h.detail}>{h.detail}</div>}
              </div>
            ))}
            {health.length === 0 && <p className="text-xs text-muted-foreground">Loading status…</p>}
          </div>
        </CardContent>
      </Card>

      {/* ── Platform capabilities (§65) ────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <h3 className="text-sm font-semibold">Platform publishing capabilities</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Platform</th>
                  <th className="py-1 pr-3">Video</th>
                  <th className="py-1 pr-3">Native schedule</th>
                  <th className="py-1 pr-3">Metrics</th>
                  <th className="py-1">Official API</th>
                </tr>
              </thead>
              <tbody>
                {capabilities.map((c) => (
                  <tr key={c.platform} className="border-t">
                    <td className="py-1 pr-3 font-medium">{c.platform}</td>
                    <td className="py-1 pr-3">{c.canPublishVideo ? "✓" : "—"}</td>
                    <td className="py-1 pr-3">{c.canSchedule ? "✓" : "scheduler-driven"}</td>
                    <td className="py-1 pr-3">{c.canRetrieveMetrics ? "✓" : "—"}</td>
                    <td className="py-1 text-muted-foreground">{c.apiSurface}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Social accounts (§32) ──────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Social accounts</h3>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={async () => {
              try {
                await adminFetch("/api/admin/marketing-agent/social", { method: "POST", body: JSON.stringify({ action: "health" }) });
                social.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Health check failed.");
              }
            }}>
              <RefreshCw size={12} /> Health check
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(social.data?.connectors ?? []).map((c) => (
              <div key={c.platform} className="rounded-lg border px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{c.platform}</span>
                  <Badge variant={c.state === "CONNECTED" ? "secondary" : "outline"} className="text-[10px]">{c.state}</Badge>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {c.state === "CONNECTED" ? `${c.permissions.length} permission(s)` : c.reason || "Not configured"}
                </div>
              </div>
            ))}
            {(social.data?.connectors ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">No connectors registered.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
