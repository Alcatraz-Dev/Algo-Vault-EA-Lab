"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bot, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { FormError } from "@/components/ui/form-field";
import { RoleChip } from "@/components/candel/role-visuals";
import { CandelAvatar } from "@/components/candel/role-visuals";
import { CandelSwitcher } from "@/components/candel/CandelSwitcher";
import AccountShell from "@/components/account/AccountShell";
import { candelApi, candelErrorMessage } from "@/lib/candel/client";
import type { CandelInstance } from "@/lib/candel/types";

/**
 * Remembers which Candel the user was last working in, so the focused pages
 * (memory, activity, automations, …) open on that one instead of silently
 * jumping back to the first Candel in the roster.
 */
const LAST_CANDEL_KEY = "algovault.candel.last";

function readLastCandel(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(LAST_CANDEL_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeLastCandel(candelId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_CANDEL_KEY, candelId);
  } catch {
    // Private browsing or a full quota — the URL still carries the selection.
  }
}

/**
 * Focused Candel pages (memory, activity, automations, …) share this shell: it
 * loads the roster, keeps the selected Candel in the URL so a view is
 * shareable and reloadable, and hands the id to the panel.
 */
export function CandelScope({
  title,
  subtitle,
  render,
}: {
  title: string;
  subtitle: string;
  render: (candelId: string, instance: CandelInstance) => React.ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedId = searchParams.get("candelId") ?? "";

  const [candels, setCandels] = useState<CandelInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const instances = await candelApi.list();
        if (cancelled) return;
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

  // URL wins, then the last Candel the user actually worked in, then the
  // newest one. Archived Candels stay selectable if they were chosen directly.
  const selected = useMemo(() => {
    if (candels.length === 0) return null;
    const byUrl = candels.find((candel) => candel.id === requestedId);
    if (byUrl) return byUrl;
    const last = readLastCandel();
    const byMemory = candels.find((candel) => candel.id === last);
    if (byMemory) return byMemory;
    return candels[0];
  }, [candels, requestedId]);

  const select = useCallback(
    (candelId: string) => {
      writeLastCandel(candelId);
      router.push(`?candelId=${encodeURIComponent(candelId)}`);
    },
    [router]
  );

  useEffect(() => {
    if (selected) writeLastCandel(selected.id);
  }, [selected]);

  if (loading) {
    return (
      <AccountShell title={title} subtitle={subtitle}>
        <LoadingState label={title} rows={3} />
      </AccountShell>
    );
  }

  if (!selected) {
    return (
      <AccountShell title={title} subtitle={subtitle}>
        <EmptyState
          icon={<Bot className="size-4" />}
          title="No Candels yet"
          description="Create a Candel first — this view is scoped to one of them."
          action={
            <Button type="button" onClick={() => router.push("/account/candels")}>
              <Plus className="size-3.5" /> Go to the library
            </Button>
          }
        />
      </AccountShell>
    );
  }

  return (
    <AccountShell
      title={title}
      subtitle={subtitle}
      headerActions={
        <CandelSwitcher candels={candels} activeId={selected.id} onSelect={select} />
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 sm:px-4">
          <CandelAvatar
            role={selected.customization?.role}
            avatar={selected.customization?.avatar}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-medium text-foreground">
                {selected.displayName || selected.name}
              </p>
              <RoleChip role={selected.customization?.role} />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {selected.description || selected.templateId}
            </p>
          </div>
        </div>
        {error ? <FormError>{error}</FormError> : null}
        {render(selected.id, selected)}
      </div>
    </AccountShell>
  );
}
