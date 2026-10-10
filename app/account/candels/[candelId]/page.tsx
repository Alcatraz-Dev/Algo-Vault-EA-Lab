// Candel studio — one Candel: chat, memory, activity, permissions, automations, accounts
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Activity as ActivityIcon,
  ArrowLeft,
  Brain,
  GitBranch,
  Loader2,
  Pause,
  Play,
  Settings2,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import AccountShell from "@/components/account/AccountShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { FormError } from "@/components/ui/form-field";
import { CandelAvatar, CandelStatusBadge, RoleChip, timeAgo } from "@/components/candel/role-visuals";
import { CandelChat } from "@/components/candel/CandelChat";
import { CandelFormDialog } from "@/components/candel/CandelFormDialog";
import {
  ActivityPanel,
  ApprovalsPanel,
  AutomationsPanel,
  BindingsPanel,
  MemoryPanel,
  PermissionsPanel,
} from "@/components/candel/panels";
import { candelApi, candelErrorMessage } from "@/lib/candel/client";
import { isApprovalPending } from "@/lib/candel/approvals";
import { resolveCandelConfig, riskPostureLabel } from "@/lib/candel/config";
import { getCandelRole } from "@/lib/candel/roles";
import type { CandelApprovalRequest, CandelInstance, CandelTemplate } from "@/lib/candel/types";

export default function CandelStudioPage() {
  const params = useParams<{ candelId: string }>();
  const router = useRouter();
  const candelId = params?.candelId ?? "";

  const [instance, setInstance] = useState<CandelInstance | null>(null);
  const [templates, setTemplates] = useState<CandelTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [activityReload, setActivityReload] = useState(0);
  const [approvals, setApprovals] = useState<CandelApprovalRequest[]>([]);

  useEffect(() => {
    if (!candelId) return;
    let cancelled = false;
    (async () => {
      try {
        const [candel, templateList, approvalList] = await Promise.all([
          candelApi.get(candelId),
          candelApi.templates(),
          candelApi.approvals(candelId),
        ]);
        if (cancelled) return;
        setInstance(candel);
        setTemplates(templateList);
        setApprovals(approvalList);
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

  const pendingApprovalCount = approvals.filter((request) => isApprovalPending(request)).length;

  async function toggleStatus() {
    if (!instance) return;
    setBusy(true);
    setError("");
    try {
      const next = instance.status === "active" ? "paused" : "active";
      const updated = await candelApi.update(instance.id, { status: next });
      setInstance(updated);
    } catch (err) {
      setError(candelErrorMessage(err));
    } finally {
      setBusy(false);
    }
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

  return (
    <AccountShell
      title={name}
      subtitle={spec.tagline}
      onBack={() => router.push("/account/candels")}
      headerActions={
        <>
          <Button type="button" variant="outline" size="sm" onClick={() => setCustomizeOpen(true)}>
            <Settings2 className="size-3.5" /> Customize
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
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
            {paused ? "Resume" : "Pause"}
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <CandelAvatar role={role} avatar={instance.customization?.avatar} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-base font-semibold text-foreground">{name}</h1>
              <RoleChip role={role} />
              <CandelStatusBadge status={instance.status} />
              {posture ? (
                <Badge variant={posture === "Live execution" ? "destructive" : "outline"}>
                  {posture}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {instance.description || spec.description}
            </p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p>{template?.displayName ?? instance.templateId}</p>
            <p>updated {timeAgo(instance.updatedAt)}</p>
          </div>
        </div>

        {error ? <FormError>{error}</FormError> : null}

        <Tabs defaultValue="chat" className="min-h-0 flex-1">
          <TabsList variant="line">
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="memory">
              <Brain className="size-3.5" /> Memory
            </TabsTrigger>
            <TabsTrigger value="activity">
              <ActivityIcon className="size-3.5" /> Activity
            </TabsTrigger>
            <TabsTrigger value="approvals">
              <ShieldCheck className="size-3.5" /> Approvals
              {pendingApprovalCount > 0 ? (
                <Badge variant="warning">{pendingApprovalCount}</Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="permissions">
              <ShieldCheck className="size-3.5" /> Permissions
            </TabsTrigger>
            <TabsTrigger value="automations">
              <GitBranch className="size-3.5" /> Automations
            </TabsTrigger>
            <TabsTrigger value="accounts">
              <Wallet className="size-3.5" /> Accounts
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chat" className="min-h-0">
            <div className="h-[calc(100dvh-22rem)] min-h-[22rem]">
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
          </TabsContent>

          <TabsContent value="memory">
            <MemoryPanel candelId={instance.id} />
          </TabsContent>

          <TabsContent value="activity">
            <ActivityPanel candelId={instance.id} reloadKey={activityReload} />
          </TabsContent>

          <TabsContent value="approvals">
            <ApprovalsPanel
              candelId={instance.id}
              reloadKey={activityReload}
              onDecided={() => setActivityReload((value) => value + 1)}
            />
          </TabsContent>

          <TabsContent value="permissions">
            <PermissionsPanel candelId={instance.id} />
          </TabsContent>

          <TabsContent value="automations">
            <AutomationsPanel candelId={instance.id} />
          </TabsContent>

          <TabsContent value="accounts">
            <BindingsPanel candelId={instance.id} />
          </TabsContent>
        </Tabs>
      </div>

      {customizeOpen ? (
        <CandelFormDialog
          key={`${instance.id}-${instance.updatedAt}`}
          open
          onOpenChange={setCustomizeOpen}
          templates={templates}
          instance={instance}
          onSaved={(updated) => setInstance(updated)}
        />
      ) : null}
    </AccountShell>
  );
}
