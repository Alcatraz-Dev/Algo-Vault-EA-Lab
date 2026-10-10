// Candel builder — start from a template, then customize your own
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Hammer, Plus, Settings2, ShieldCheck, Wrench } from "lucide-react";
import AccountShell from "@/components/account/AccountShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { FormError } from "@/components/ui/form-field";
import { SectionHeader } from "@/components/ui/section-header";
import { CandelAvatar, RoleChip, timeAgo } from "@/components/candel/role-visuals";
import { CandelFormDialog } from "@/components/candel/CandelFormDialog";
import { candelApi, candelErrorMessage } from "@/lib/candel/client";
import { getCandelRole, selectableCandelRoles } from "@/lib/candel/roles";
import type { CandelInstance, CandelTemplate } from "@/lib/candel/types";

export default function CandelBuilderPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<CandelTemplate[]>([]);
  const [candels, setCandels] = useState<CandelInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [presetTemplateId, setPresetTemplateId] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<CandelInstance | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [templateList, instances] = await Promise.all([
          candelApi.templates(),
          candelApi.list(),
        ]);
        if (cancelled) return;
        setTemplates(templateList);
        setCandels(instances);
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
  }, []);

  const roleSpec = useMemo(() => new Map(selectableCandelRoles({ isPro: true }).map((r) => [r.id, r])), []);

  function startFromTemplate(templateId: string) {
    setPresetTemplateId(templateId);
    setCreateOpen(true);
  }

  return (
    <AccountShell
      title="Candel builder"
      subtitle="Pick a specialist, then make it yours"
      headerActions={
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setPresetTemplateId(undefined);
            setCreateOpen(true);
          }}
        >
          <Plus className="size-3.5" /> New Candel
        </Button>
      }
    >
      <div className="space-y-6">
        <SectionHeader
          icon={<Hammer className="size-4" />}
          title="Templates"
          description="Every Candel starts from a template that fixes its tool ceiling and default instructions."
        />

        {error ? <FormError>{error}</FormError> : null}

        {loading ? (
          <LoadingState label="Loading templates" rows={4} />
        ) : templates.length === 0 ? (
          <EmptyState
            icon={<Hammer className="size-4" />}
            title="No templates available"
            description="The template catalog could not be loaded. Reload the page or check the seed data."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {templates.map((template) => {
              const spec = getCandelRole(template.role);
              return (
                <Card key={template.id} className="h-full">
                  <CardContent className="flex h-full flex-col gap-3">
                    <div className="flex items-start gap-3">
                      <CandelAvatar role={template.role} avatar={template.avatar} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate font-heading text-sm font-semibold text-foreground">
                            {template.displayName}
                          </h3>
                          {template.proOnly ? <Badge variant="warning">Pro</Badge> : null}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {roleSpec.get(template.role)?.tagline ?? spec.tagline}
                        </p>
                      </div>
                    </div>
                    <p className="line-clamp-3 text-xs text-muted-foreground">
                      {template.description || spec.description}
                    </p>
                    <div className="mt-auto space-y-2">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Wrench className="size-3" />
                        {template.tools.length} tools
                        <span className="text-border">·</span>
                        <span className="truncate">{template.tools.slice(0, 2).join(", ") || "none"}</span>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => startFromTemplate(template.id)}
                      >
                        <Plus className="size-3.5" /> Use this template
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <SectionHeader
          icon={<Settings2 className="size-4" />}
          title="My Candels"
          description="Customize an existing Candel's role, instructions and enabled tools."
          meta={<span className="text-xs text-muted-foreground">{candels.length} total</span>}
        />

        {!loading && candels.length === 0 ? (
          <EmptyState
            compact
            icon={<ShieldCheck className="size-4" />}
            title="Nothing built yet"
            description="Use a template above to create your first Candel."
          />
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {candels.map((candel) => (
              <div key={candel.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <CandelAvatar
                  role={candel.customization?.role}
                  avatar={candel.customization?.avatar}
                  size="sm"
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => router.push(`/account/candels/${candel.id}`)}
                >
                  <p className="truncate text-sm text-foreground">
                    {candel.displayName || candel.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {candel.templateId} · updated {timeAgo(candel.updatedAt)}
                  </p>
                </button>
                <RoleChip role={candel.customization?.role} />
                {candel.customization?.instructions ? (
                  <Badge variant="outline">custom instructions</Badge>
                ) : null}
                {candel.customization?.tools !== undefined ? (
                  <Badge variant="outline">
                    {candel.customization.tools.length} tools
                  </Badge>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => setEditing(candel)}
                >
                  <Settings2 className="size-3" /> Customize
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {createOpen ? (
        <CandelFormDialog
          key={presetTemplateId ?? "blank"}
          open
          onOpenChange={setCreateOpen}
          templates={templates}
          defaultTemplateId={presetTemplateId}
          onSaved={(instance) => {
            setCandels((prev) => [...prev, instance]);
            router.push(`/account/candels/${instance.id}`);
          }}
        />
      ) : null}

      {editing ? (
        <CandelFormDialog
          key={editing.id}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          templates={templates}
          instance={editing}
          onSaved={(updated) => {
            setCandels((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
            setEditing(null);
          }}
        />
      ) : null}
    </AccountShell>
  );
}
