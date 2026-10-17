"use client";

import { Archive, Loader2, MessagesSquare, Pause, Play, Settings2, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CandelAvatar, CandelStatusBadge, RoleChip, timeAgo } from "@/components/candel/role-visuals";
import { getCandelRole } from "@/lib/candel/roles";
import type { CandelInstance } from "@/lib/candel/types";

export function CandelCard({
  instance,
  templateName,
  busy = false,
  onOpen,
  onCustomize,
  onSetStatus,
  onArchive,
  onDelete,
}: {
  instance: CandelInstance;
  templateName?: string;
  busy?: boolean;
  onOpen: (candelId: string) => void;
  onCustomize: (instance: CandelInstance) => void;
  onSetStatus: (candelId: string, status: CandelInstance["status"]) => void;
  onArchive: (candelId: string) => void;
  onDelete: (instance: CandelInstance) => void;
}) {
  const role = instance.customization?.role;
  const spec = getCandelRole(role);
  const archived = instance.status === "archived";

  return (
    <Card
      className="group h-full cursor-pointer rounded-xl border border-border/60 bg-gradient-to-b from-card to-muted/10 shadow-[0_1px_3px_rgba(0,0,0,0.05),0_8px_16px_rgba(0,0,0,0.03)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(0,0,0,0.08)] hover:border-border/80"
      onClick={() => onOpen(instance.id)}
    >
      <CardContent className="flex h-full flex-col gap-3">
        <div className="flex items-start gap-3 relative">
          {instance.customization?.avatar ? (
            <img
              src={instance.customization.avatar}
              alt=""
              className="inline-flex shrink-0 size-14 rounded-xl ring-1 ring-border object-cover block"
            />
          ) : (
            <CandelAvatar role={role} avatar={instance.customization?.avatar} size="lg" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate font-heading text-base font-semibold text-foreground leading-tight">
                  {instance.displayName || instance.name}
                </h3>
                <div className="mt-1 flex items-center gap-1.5">
                  <RoleChip role={role} />
                  <span className="text-[10px] text-muted-foreground">{templateName ? `${templateName} template` : instance.templateId}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Customize" title="Customize" onClick={(e) => { e.stopPropagation(); onCustomize(instance); }} className="hover:bg-muted">
                  <Settings2 size={14} />
                </Button>
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Delete" title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(instance); }} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          </div>
        </div>

        <p className="line-clamp-2 text-xs text-muted-foreground leading-relaxed">
          {instance.description || spec.tagline}
        </p>

        <div className="mt-auto flex items-center gap-2 pt-2 border-t border-border/40">
          <Button type="button" size="xs" variant="outline" onClick={(e) => { e.stopPropagation(); onOpen(instance.id); }} className="h-6 gap-1 text-[10px] px-1.5">
            <MessagesSquare size={10} /> Chat
          </Button>
          {!archived && (
            <Button type="button" size="xs" variant="outline" onClick={(e) => { e.stopPropagation(); onArchive(instance.id); }} className="h-6 gap-1 text-[10px] px-1.5">
              <Archive size={10} /> Archive
            </Button>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            <CandelStatusBadge status={instance.status} />
            <span className="text-[10px] text-muted-foreground tabular-nums">{timeAgo(instance.updatedAt)}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
