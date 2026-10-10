"use client";

/**
 * Presentation layer for the Candel role catalog.
 *
 * Icons and accents live here rather than in `lib/candel/roles.ts` so the
 * server-side catalog stays free of JSX and can be imported by API routes
 * without pulling React into the bundle.
 */

import type { ComponentType } from "react";
import {
  Cpu,
  Crosshair,
  FileText,
  FlaskConical,
  LineChart,
  NotebookPen,
  Send,
  ShieldAlert,
  Sparkles,
  CandlestickChart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getCandelRole } from "@/lib/candel/roles";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { CandelInstance } from "@/lib/candel/types";

const ROLE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  LineChart,
  Crosshair,
  FlaskConical,
  ShieldAlert,
  NotebookPen,
  Send,
  CandlestickChart,
  Cpu,
  FileText,
  Sparkles,
};

const ACCENTS: Record<string, { avatar: string; chip: string; text: string }> = {
  blue: { avatar: "bg-info/10 text-info ring-info/25", chip: "border-info/30 bg-info/10 text-info", text: "text-info" },
  violet: { avatar: "bg-primary/10 text-primary ring-primary/25", chip: "border-primary/30 bg-primary/10 text-primary", text: "text-primary" },
  amber: { avatar: "bg-warning/10 text-warning ring-warning/25", chip: "border-warning/30 bg-warning/10 text-warning", text: "text-warning" },
  rose: { avatar: "bg-negative/10 text-negative ring-negative/25", chip: "border-negative/30 bg-negative/10 text-negative", text: "text-negative" },
  emerald: { avatar: "bg-positive/10 text-positive ring-positive/25", chip: "border-positive/30 bg-positive/10 text-positive", text: "text-positive" },
  cyan: { avatar: "bg-info/10 text-info ring-info/25", chip: "border-info/30 bg-info/10 text-info", text: "text-info" },
  slate: { avatar: "bg-muted text-muted-foreground ring-border", chip: "border-border bg-muted text-muted-foreground", text: "text-muted-foreground" },
};

function accentOf(accent: string | undefined) {
  return ACCENTS[accent ?? "slate"] ?? ACCENTS.slate;
}

export function RoleIcon({
  role,
  className,
}: {
  role: string | undefined;
  className?: string;
}) {
  const spec = getCandelRole(role);
  const Icon = ROLE_ICONS[spec.icon] ?? Sparkles;
  return <Icon className={cn("size-4", className)} />;
}

/** Square avatar: an explicit emoji wins, otherwise the role icon. */
export function CandelAvatar({
  role,
  avatar,
  size = "md",
  className,
}: {
  role?: string;
  avatar?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const spec = getCandelRole(role);
  const accent = accentOf(spec.accent);
  const sizes = {
    sm: "size-8 text-base rounded-lg",
    md: "size-10 text-xl rounded-lg",
    lg: "size-14 text-3xl rounded-lg",
  } as const;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center ring-1",
        sizes[size],
        accent.avatar,
        className,
      )}
    >
      {avatar ? <span className="leading-none">{avatar}</span> : <RoleIcon role={role} className={size === "lg" ? "size-6" : "size-4"} />}
    </span>
  );
}

export function RoleChip({ role, className }: { role?: string; className?: string }) {
  const spec = getCandelRole(role);
  const accent = accentOf(spec.accent);
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        accent.chip,
        className,
      )}
    >
      <RoleIcon role={role} className="size-3" />
      {spec.label}
    </span>
  );
}

const STATUS_TONES: Record<CandelInstance["status"], StatusTone> = {
  active: "live",
  paused: "warning",
  disabled: "neutral",
  archived: "offline",
};

const STATUS_LABELS: Record<CandelInstance["status"], string> = {
  active: "Active",
  paused: "Paused",
  disabled: "Disabled",
  archived: "Archived",
};

export function CandelStatusBadge({
  status,
  className,
}: {
  status: CandelInstance["status"];
  className?: string;
}) {
  return (
    <StatusBadge
      tone={STATUS_TONES[status] ?? "neutral"}
      label={STATUS_LABELS[status] ?? status}
      dot
      pulse={status === "active"}
      className={className}
    />
  );
}

/** Compact relative time for cards and activity rows. */
export function timeAgo(timestamp?: number): string {
  if (!timestamp) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
