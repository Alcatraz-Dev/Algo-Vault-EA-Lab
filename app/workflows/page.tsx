"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { Plus, Zap, Clock, CheckCircle2 } from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { onSubscriptionChange } from "@/lib/subscription";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { WorkflowAutomation } from "@/lib/workflows/types";

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowAutomation[]>([]);
  const [loading, setLoading] = useState(true);
  const [pro, setPro] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsub();
  }, []);

  const fetchWorkflows = useCallback(async (uid: string) => {
    try {
      const token = await uid ? auth.currentUser?.getIdToken() : null;
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch("/api/workflows", { headers });
      const data = res.ok ? await res.json() : [];
      setWorkflows(Array.isArray(data) ? data : []);
    } catch {
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    const check = async () => {
      const sub = await onSubscriptionChange(user.uid);
      setPro(sub.hasSubscription);
      if (sub.hasSubscription) {
        await fetchWorkflows(user.uid);
      } else {
        setLoading(false);
      }
    };
    check();
  }, [user, fetchWorkflows]);

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

  const active = workflows.filter((w) => w.status === "active").length;
  const drafts = workflows.filter((w) => w.status === "draft").length;

  return (
    <AppShell
      navGroups={navGroups}
      title="Workflow Automation"
      subtitle={pro ? "Pro — build trading workflows" : "Upgrade to Pro to create workflows"}
      eyebrow={pro ? <Badge className="bg-amber-500 text-white hover:bg-amber-600">Pro</Badge> : <Badge variant="outline">Free</Badge>}
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Your Workflows</h2>
            <p className="text-sm text-muted-foreground">{workflows.length} created · {active} active · {drafts} drafts</p>
          </div>
          <Link href={pro ? "/workflows/new" : "/pricing"}>
            <Button className="gap-2"><Plus size={16} /> New Workflow</Button>
          </Link>
        </div>

        {!pro ? (
          <div className="rounded-2xl border bg-gradient-to-br from-amber-50 to-amber-100/40 dark:from-amber-950/30 dark:to-amber-900/20 p-8 text-center">
            <Zap className="mx-auto h-10 w-10 text-amber-500 mb-3" />
            <h3 className="text-lg font-semibold">Workflow Automation is a Pro feature</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">Build DAG workflows with market data, AI analysis, signals, and execution. Upgrade to Pro for unlimited nodes, schedules, and AI Builder.</p>
            <Link href="/pricing" className="inline-block mt-4"><Button>Upgrade to Pro</Button></Link>
          </div>
        ) : loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl border p-5 animate-pulse bg-muted/30 h-40" />
            ))}
          </div>
        ) : workflows.length === 0 ? (
          <EmptyState title="No workflows yet" description="Start with a manual trigger and build your trading automation." action={<Link href="/workflows/new"><Button>Create Workflow</Button></Link>} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {workflows.map((w) => (
              <Link key={w.id} href={`/workflows/${w.id}`} className="group block rounded-2xl border bg-card p-5 transition hover:shadow hover:-translate-y-0.5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold leading-snug group-hover:text-amber-600 dark:group-hover:text-amber-400">{w.name}</h3>
                   <StatusBadge label={w.status} tone={w.status === "active" ? "positive" : w.status === "paused" ? "warning" : w.status === "disabled" ? "negative" : "neutral"} />
                </div>
                <p className="text-xs text-muted-foreground truncate">{w.description || "No description."}</p>
                <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Clock size={10} /> {w.updatedAt ? new Date(w.updatedAt).toLocaleDateString() : "—"}</span>
                  <span className="inline-flex items-center gap-1"><Zap size={10} /> {w.nodes?.length ?? 0} nodes</span>
                  <span className="inline-flex items-center gap-1"><CheckCircle2 size={10} /> {w.version}</span>
                </div>
                <div className="mt-3 flex gap-2">
                  <Badge variant="secondary" className="text-[10px]">{w.requiredPermissions?.join(", ") || "none"}</Badge>
                  {w.schedule?.enabled && <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400">Scheduled</Badge>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}