// Candel studio — one Candel: a continuous conversation with an inspector panel
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Activity as ActivityIcon,
  ArrowLeft,
  Brain,
  CalendarClock,
  FileText,
  GitBranch,
  ListChecks,
  Loader2,
  Lock,
  MessageSquare,
  Pause,
  Play,
  Settings2,
  ShieldCheck,
  Wallet,
  Wrench,
} from "lucide-react";
import AccountShell from "@/components/account/AccountShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { FormError } from "@/components/ui/form-field";
import { CandelAvatar, CandelStatusBadge, RoleChip, timeAgo } from "@/components/candel/role-visuals";
import { CandelChat } from "@/components/candel/CandelChat";
import { CandelFormDialog } from "@/components/candel/CandelFormDialog";
import { CandelSwitcher } from "@/components/candel/CandelSwitcher";
import {
  ActivityPanel,
  ApprovalsPanel,
  AutomationsPanel,
  BindingsPanel,
  JobsPanel,
  MemoryPanel,
  PermissionsPanel,
  ProposalsPanel,
  ToolCallsPanel,
  WorkspacePanel,
} from "@/components/candel/panels";
import { candelApi, candelErrorMessage } from "@/lib/candel/client";
import { isApprovalPending } from "@/lib/candel/approvals";
import { resolveCandelConfig, riskPostureLabel } from "@/lib/candel/config";
import { getCandelRole } from "@/lib/candel/roles";
import { cn } from "@/lib/utils";
import type { CandelApprovalRequest, CandelInstance, CandelTemplate } from "@/lib/candel/types";

type PanelId =
  | "chat"
  | "workspace"
  | "memory"
  | "activity"
  | "approvals"
  | "proposals"
  | "tool-calls"
  | "automations"
  | "jobs"
  | "permissions"
  | "accounts";

interface PanelDef {
  id: PanelId;
  label: string;
  /** Compact label for the narrow scroll strip. */
  short: string;
  icon: React.ComponentType<{ className?: string }>;
}

const PANELS: PanelDef[] = [
  { id: "chat", label: "Chat", short: "Chat", icon: MessageSquare },
  { id: "workspace", label: "Workspace", short: "Pages", icon: FileText },
  { id: "memory", label: "Memory", short: "Memory", icon: Brain },
  { id: "activity", label: "Activity", short: "Activity", icon: ActivityIcon },
  { id: "approvals", label: "Approvals", short: "Approvals", icon: ShieldCheck },
  { id: "proposals", label: "Proposals", short: "Proposals", icon: ListChecks },
  { id: "tool-calls", label: "Tool calls", short: "Tools", icon: Wrench },
  { id: "automations", label: "Automations", short: "Automations", icon: GitBranch },
  { id: "jobs", label: "Background jobs", short: "Jobs", icon: CalendarClock },
  { id: "permissions", label: "Permissions", short: "Permissions", icon: Lock },
  { id: "accounts", label: "Accounts", short: "Accounts", icon: Wallet },
];

export default function CandelStudioPage() {
  const params = useParams<{ candelId: string }>();
  const router = useRouter();
  const candelId = params?.candelId ?? "";

  const [instance, setInstance] = useState<CandelInstance | null>(null);
  const [templates, setTemplates] = useState<CandelTemplate[]>([]);
  const [roster, setRoster] = useState<CandelInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [activityReload, setActivityReload] = useState(0);
  const [approvals, setApprovals] = useState<CandelApprovalRequest[]>([]);
  const [panel, setPanel] = useState<PanelId>("chat");
  const tabRefs = useRef<Partial<Record<PanelId, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (!candelId) return;
    let cancelled = false;
    (async () => {
      try {
        const [candel, templateList, approvalList, instances] = await Promise.all([
          candelApi.get(candelId),
          candelApi.templates(),
          candelApi.approvals(candelId),
          candelApi.list(),
        ]);
        if (cancelled) return;
        setInstance(candel);
        setTemplates(templateList);
        setApprovals(approvalList);
        // Archived Candels stay in the switcher only while they are the ones
        // being viewed; otherwise the roster is the active set.
        setRoster(instances.filter((entry) => entry.id === candelId || entry.status !== "archived"));
        setError("");
      } catch (err) {
        if (!cancelled) setError(candelErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candelId]);

  /** Re-pull the approval inbox after a chat turn or a decision. */
  const refreshApprovals = () => {
    if (!candelId) return;
    void candelApi
      .approvals(candelId)
      .then(setApprovals)
      .catch(() => undefined);
  };

  const pendingApprovalCount = useMemo(
    () => approvals.filter((request) => isApprovalPending(request)).length,
    [approvals]
  );

  async function toggleStatus() {
    if (!instance) return;
    setBusy(true);
    setError("");
    try {
      const next = instance.status === "active" ? "paused" : "active";
      const updated = await candelApi.update(instance.id, { status: next });
      setInstance(updated);
      setRoster((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
    } catch (err) {
      setError(candelErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /** Arrow keys move between panels, matching a tablist's expected behaviour. */
  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = PANELS.findIndex((entry) => entry.id === panel);
    const last = PANELS.length - 1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : event.key === "ArrowRight" || event.key === "ArrowDown"
            ? (index + 1) % PANELS.length
            : (index - 1 + PANELS.length) % PANELS.length;
    const target = PANELS[next];
    setPanel(target.id);
    tabRefs.current[target.id]?.focus();
  }

  if (loading) {
    return (
      <AccountShell title="Candel" subtitle="Loading Candel">
        <LoadingState label="Loading Candel" rows={4} />
      </AccountShell>
    );
  }

  if (!instance) {
    return (
      <AccountShell title="Candel" subtitle="Not found">
        <EmptyState
          title="Candel unavailable"
          description={error || "This Candel does not exist or is not yours."}
          action={
            <Button type="button" variant="outline" onClick={() => router.push("/account/candels")}>
              <ArrowLeft className="size-3.5" /> Back to library
            </Button>
          }
        />
      </AccountShell>
    );
  }

  const template = templates.find((t) => t.id === instance.templateId);
  const role = instance.customization?.role ?? template?.role;
  const spec = getCandelRole(role);
  const name = instance.displayName || instance.name;
  const paused = instance.status === "paused" || instance.status === "disabled";
  const posture = template ? riskPostureLabel(resolveCandelConfig(instance, template)) : null;
  const activePanel = PANELS.find((entry) => entry.id === panel) ?? PANELS[0];

  return (
    <AccountShell
      title={name}
      subtitle={spec.tagline}
      onBack={() => router.push("/account/candels")}
      headerActions={
        <>
          {roster.length > 1 ? (
            <CandelSwitcher
              candels={roster}
              activeId={instance.id}
              onSelect={(id) => router.push(`/account/candels/${id}`)}
            />
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Customize Candel"
            onClick={() => setCustomizeOpen(true)}
          >
            <Settings2 className="size-3.5" />
            <span className="hidden sm:inline">Customize</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={paused ? "Resume Candel" : "Pause Candel"}
            onClick={() => void toggleStatus()}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : paused ? (
              <Play className="size-3.5" />
            ) : (
              <Pause className="size-3.5" />
            )}
            <span className="hidden sm:inline">{paused ? "Resume" : "Pause"}</span>
          </Button>
        </>
      }
    >
      {/* The studio is a fixed-height canvas: the conversation and the open
          panel share the leftover viewport, and only the panel area scrolls.
          Reserving the space up front (rather than measuring after paint) is
          what keeps the composer above the fold on a phone. */}
      <div className="flex h-[calc(100svh-11rem)] min-h-[32rem] flex-col gap-3 sm:gap-4">
        {/* Identity — avatar, role, posture and what it may touch, in one line
            that wraps instead of overflowing on narrow screens. */}
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 sm:px-4">
          <CandelAvatar role={role} avatar={instance.customization?.avatar} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 truncate font-heading text-base font-semibold text-foreground">
                {name}
              </h1>
              <RoleChip role={role} />
              <CandelStatusBadge status={instance.status} />
              {posture ? (
                <Badge variant={posture === "Live execution" ? "destructive" : "outline"}>
                  {posture}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground sm:line-clamp-2">
              {instance.description || spec.description}
            </p>
          </div>
          {/* Secondary provenance — kept out of the way on narrow screens. */}
          <div className="hidden text-right text-xs text-muted-foreground md:block">
            <p className="truncate">{template?.displayName ?? instance.templateId}</p>
            <p>updated {timeAgo(instance.updatedAt)}</p>
          </div>
        </div>

        {error ? <FormError>{error}</FormError> : null}

        {/* Canvas + inspector. On `lg` the panel nav is a column on the right;
            below that it is a single scrollable strip so eleven destinations
            never wrap into a wall of text. */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row-reverse">
          <div
            role="tablist"
            aria-label="Candel panels"
            aria-orientation="vertical"
            className="scrollbar-hide -mx-1 flex shrink-0 gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:w-52 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0"
          >
            {PANELS.map((entry) => {
              const Icon = entry.icon;
              const selected = entry.id === panel;
              return (
                <button
                  key={entry.id}
                  ref={(node) => {
                    tabRefs.current[entry.id] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`candel-tab-${entry.id}`}
                  aria-selected={selected}
                  aria-controls="candel-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setPanel(entry.id)}
                  onKeyDown={onTabKeyDown}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-2 rounded-md border border-transparent px-2.5 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                    "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                    "lg:w-full lg:justify-start",
                    selected
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="hidden lg:inline">{entry.label}</span>
                  <span className="lg:hidden">{entry.short}</span>
                  {entry.id === "approvals" && pendingApprovalCount > 0 ? (
                    <Badge variant="warning" className="ml-0.5">
                      {pendingApprovalCount}
                    </Badge>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div
            id="candel-panel"
            role="tabpanel"
            aria-labelledby={`candel-tab-${activePanel.id}`}
            className="min-h-0 min-w-0 flex-1 overflow-y-auto"
          >
            {panel === "chat" ? (
              <div className="h-full min-h-24">
                <CandelChat
                  candelId={instance.id}
                  candelName={name}
                  role={role}
                  avatar={instance.customization?.avatar}
                  disabled={paused}
                  onTurnComplete={() => {
                    setActivityReload((value) => value + 1);
                    refreshApprovals();
                  }}
                />
              </div>
            ) : panel === "workspace" ? (
              <WorkspacePanel candelId={instance.id} />
            ) : panel === "memory" ? (
              <MemoryPanel candelId={instance.id} />
            ) : panel === "activity" ? (
              <ActivityPanel candelId={instance.id} reloadKey={activityReload} />
            ) : panel === "approvals" ? (
              <ApprovalsPanel
                candelId={instance.id}
                reloadKey={activityReload}
                onDecided={() => setActivityReload((value) => value + 1)}
              />
            ) : panel === "proposals" ? (
              <ProposalsPanel candelId={instance.id} reloadKey={activityReload} />
            ) : panel === "tool-calls" ? (
              <ToolCallsPanel candelId={instance.id} reloadKey={activityReload} />
            ) : panel === "automations" ? (
              <AutomationsPanel candelId={instance.id} />
            ) : panel === "jobs" ? (
              <JobsPanel candelId={instance.id} />
            ) : panel === "permissions" ? (
              <PermissionsPanel candelId={instance.id} />
            ) : (
              <BindingsPanel candelId={instance.id} />
            )}
          </div>
        </div>
      </div>

      {customizeOpen ? (
        <CandelFormDialog
          key={`${instance.id}-${instance.updatedAt}`}
          open
          onOpenChange={setCustomizeOpen}
          templates={templates}
          instance={instance}
          onSaved={(updated) => {
            setInstance(updated);
            setRoster((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
          }}
        />
      ) : null}
    </AccountShell>
  );
}
