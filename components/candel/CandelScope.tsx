"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bot, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { FormError } from "@/components/ui/form-field";
import AccountShell from "@/components/account/AccountShell";
import { CandelAvatar } from "@/components/candel/role-visuals";
import { candelApi, candelErrorMessage } from "@/lib/candel/client";
import type { CandelInstance } from "@/lib/candel/types";

/**
 * Focused Candel pages (memory, activity, automations) share this shell: it
 * loads the roster, keeps the selected Candel in the URL so a view is
 * shareable/reloadable, and hands the id to the panel.
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

  const selected = useMemo(() => {
    if (candels.length === 0) return null;
    return candels.find((candel) => candel.id === requestedId) ?? candels[0];
  }, [candels, requestedId]);

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
        <Select
          className="w-56"
          value={selected.id}
          onChange={(event) =>
            router.push(`?candelId=${encodeURIComponent(event.target.value)}`)
          }
        >
          {candels.map((candel) => (
            <option key={candel.id} value={candel.id}>
              {candel.displayName || candel.name}
            </option>
          ))}
        </Select>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <CandelAvatar
            role={selected.customization?.role}
            avatar={selected.customization?.avatar}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {selected.displayName || selected.name}
            </p>
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
