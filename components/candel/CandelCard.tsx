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
      className="group h-full cursor-pointer transition-colors hover:border-foreground/20"
      onClick={() => onOpen(instance.id)}
    >
      <CardContent className="flex h-full flex-col gap-3">
        <div className="flex items-start gap-3">
          <CandelAvatar role={role} avatar={instance.customization?.avatar} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-heading text-sm font-semibold text-foreground">
                {instance.displayName || instance.name}
              </h3>
              {busy ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {templateName ? `${templateName} template` : instance.templateId}
            </p>
          </div>
          <div
            className="flex items-center gap-1"
            onClick={(event) => event.stopPropagation()}
            role="presentation"
          >
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Candel actions" />
                }
              >
                <Settings2 />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onOpen(instance.id)}>
                  <MessagesSquare className="mr-1.5 size-3.5" /> Open chat
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onCustomize(instance)}>
                  <Settings2 className="mr-1.5 size-3.5" /> Customize
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {instance.status === "active" ? (
                  <DropdownMenuItem onSelect={() => onSetStatus(instance.id, "paused")}>
                    <Pause className="mr-1.5 size-3.5" /> Pause
                  </DropdownMenuItem>
                ) : !archived ? (
                  <DropdownMenuItem onSelect={() => onSetStatus(instance.id, "active")}>
                    <Play className="mr-1.5 size-3.5" /> Resume
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => onSetStatus(instance.id, "active")}>
                    <Play className="mr-1.5 size-3.5" /> Restore
                  </DropdownMenuItem>
                )}
                {!archived && (
                  <DropdownMenuItem onSelect={() => onArchive(instance.id)}>
                    <Archive className="mr-1.5 size-3.5" /> Archive
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onSelect={() => onDelete(instance)}
                >
                  <Trash2 className="mr-1.5 size-3.5" /> Delete permanently
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">
          {instance.description || spec.tagline}
        </p>

        <div className="mt-auto flex flex-wrap items-center gap-2">
          <RoleChip role={role} />
          <CandelStatusBadge status={instance.status} />
          <span className="ml-auto text-xs text-muted-foreground">
            {timeAgo(instance.updatedAt)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
