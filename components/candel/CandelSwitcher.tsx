"use client";

import { ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CandelAvatar, CandelStatusBadge } from "@/components/candel/role-visuals";
import type { CandelInstance } from "@/lib/candel/types";

/**
 * CandelSwitcher — jump between Candels without leaving the page you are on.
 *
 * OpenDots keeps its specialists in one persistent list next to the work; the
 * AlgoVault equivalent is this header control, which replaced a native
 * `<select>` that (a) overflowed narrow screens with a fixed width and (b) reset
 * to the first Candel on every visit because nothing recorded the choice.
 */
export function CandelSwitcher({
  candels,
  activeId,
  onSelect,
  onCreate,
  className,
}: {
  candels: CandelInstance[];
  activeId: string;
  onSelect: (candelId: string) => void;
  onCreate?: () => void;
  className?: string;
}) {
  const active = candels.find((candel) => candel.id === activeId) ?? candels[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={`max-w-[15rem] justify-start gap-2 ${className ?? ""}`}
            aria-label="Switch Candel"
          />
        }
      >
        <CandelAvatar
          role={active?.customization?.role}
          avatar={active?.customization?.avatar}
          size="sm"
          className="size-6 rounded-md text-xs"
        />
        <span className="truncate">{active?.displayName || active?.name || "Select Candel"}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuLabel>Switch Candel</DropdownMenuLabel>
        {candels.map((candel) => (
          <DropdownMenuItem
            key={candel.id}
            onSelect={() => onSelect(candel.id)}
            className="gap-2"
            aria-current={candel.id === activeId ? "true" : undefined}
          >
            <CandelAvatar
              role={candel.customization?.role}
              avatar={candel.customization?.avatar}
              size="sm"
              className="size-6 rounded-md text-xs"
            />
            <span className="min-w-0 flex-1 truncate">
              {candel.displayName || candel.name}
            </span>
            <CandelStatusBadge status={candel.status} />
          </DropdownMenuItem>
        ))}
        {onCreate ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onCreate} className="gap-2">
              <Plus className="size-3.5" /> New Candel
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
