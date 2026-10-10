// Candel library — the user's Candel roster
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Loader2, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import AccountShell from "@/components/account/AccountShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { FormError } from "@/components/ui/form-field";
import { SectionHeader } from "@/components/ui/section-header";
import { ToggleChip } from "@/components/ui/toggle-chip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CandelCard } from "@/components/candel/CandelCard";
import { CandelFormDialog } from "@/components/candel/CandelFormDialog";
import { candelApi, candelErrorMessage } from "@/lib/candel/client";
import { CANDEL_ROLES } from "@/lib/candel/roles";
import type { CandelInstance, CandelTemplate } from "@/lib/candel/types";

type StatusFilter = "active" | "all" | "archived";

export default function CandelLibraryPage() {
  const router = useRouter();
  const [candels, setCandels] = useState<CandelInstance[]>([]);
  const [templates, setTemplates] = useState<CandelTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [roleFilter, setRoleFilter] = useState<string>("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CandelInstance | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CandelInstance | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [instances, templateList] = await Promise.all([
          candelApi.list(true),
          candelApi.templates(),
        ]);
        if (cancelled) return;
        setCandels(instances);
        setTemplates(templateList);
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

  const templateNames = useMemo(
    () => new Map(templates.map((template) => [template.id, template.displayName])),
    [templates]
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return candels
      .filter((candel) => {
        if (statusFilter === "active" && candel.status === "archived") return false;
        if (statusFilter === "archived" && candel.status !== "archived") return false;
        if (roleFilter && (candel.customization?.role ?? "") !== roleFilter) return false;
        if (!needle) return true;
        return `${candel.displayName || candel.name} ${candel.description ?? ""}`
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [candels, query, statusFilter, roleFilter]);

  const usedRoles = useMemo(() => {
    const roles = new Set(candels.map((c) => c.customization?.role).filter(Boolean) as string[]);
    return CANDEL_ROLES.filter((role) => roles.has(role.id));
  }, [candels]);

  async function setStatus(candelId: string, status: CandelInstance["status"]) {
    setBusyId(candelId);
    setError("");
    try {
      const updated = await candelApi.update(candelId, { status });
      setCandels((prev) => prev.map((c) => (c.id === candelId ? updated : c)));
    } catch (err) {
      setError(candelErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function archive(candelId: string) {
    setBusyId(candelId);
    setError("");
    try {
      await candelApi.archive(candelId);
      setCandels((prev) =>
        prev.map((c) => (c.id === candelId ? { ...c, status: "archived" } : c))
      );
    } catch (err) {
      setError(candelErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setError("");
    try {
      await candelApi.destroy(pendingDelete.id);
      setCandels((prev) => prev.filter((c) => c.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (err) {
      setError(candelErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AccountShell
      title="Candels"
      subtitle="Your AI coworkers for trading research and execution"
      headerActions={
        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-3.5" /> New Candel
        </Button>
      }
    >
      <div className="space-y-5">
        <SectionHeader
          icon={<Bot className="size-4" />}
          title="Candel library"
          description="Each Candel is a specialist you own: pick a role, tune its instructions and decide exactly what it may touch."
          meta={
            <span className="text-xs text-muted-foreground">
              {candels.filter((c) => c.status !== "archived").length} active
            </span>
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Candels…"
              className="pl-8"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {(["active", "all", "archived"] as StatusFilter[]).map((filter) => (
              <ToggleChip
                key={filter}
                active={statusFilter === filter}
                onClick={() => setStatusFilter(filter)}
              >
                {filter === "active" ? "Active" : filter === "all" ? "All" : "Archived"}
              </ToggleChip>
            ))}
          </div>
          {usedRoles.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <ToggleChip active={!roleFilter} onClick={() => setRoleFilter("")}>
                Any role
              </ToggleChip>
              {usedRoles.map((role) => (
                <ToggleChip
                  key={role.id}
                  active={roleFilter === role.id}
                  onClick={() => setRoleFilter(roleFilter === role.id ? "" : role.id)}
                >
                  {role.label}
                </ToggleChip>
              ))}
            </div>
          ) : null}
        </div>

        {error ? <FormError>{error}</FormError> : null}

        {loading ? (
          <LoadingState label="Loading your Candels" rows={3} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="size-4" />}
            title={candels.length === 0 ? "No Candels yet" : "No Candels match those filters"}
            description={
              candels.length === 0
                ? "Create your first Candel from a template — a market analyst, a risk sentinel, an execution planner and more."
                : "Try a different search term, role or status filter."
            }
            action={
              candels.length === 0 ? (
                <Button type="button" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-3.5" /> Create your first Candel
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    setRoleFilter("");
                    setStatusFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((candel) => (
              <CandelCard
                key={candel.id}
                instance={candel}
                templateName={templateNames.get(candel.templateId)}
                busy={busyId === candel.id}
                onOpen={(id) => router.push(`/account/candels/${id}`)}
                onCustomize={(instance) => setEditing(instance)}
                onSetStatus={(id, status) => void setStatus(id, status)}
                onArchive={(id) => void archive(id)}
                onDelete={(instance) => setPendingDelete(instance)}
              />
            ))}
          </div>
        )}
      </div>

      {createOpen ? (
        <CandelFormDialog
          open
          onOpenChange={setCreateOpen}
          templates={templates}
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

      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this Candel?</DialogTitle>
            <DialogDescription>
              {pendingDelete?.displayName || pendingDelete?.name} and everything it owns — conversations,
              memory, activity, permissions and account bindings — will be removed permanently. This cannot
              be undone. Archiving keeps the record instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AccountShell>
  );
}
