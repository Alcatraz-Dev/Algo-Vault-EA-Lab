/**
 * AlgoVault UI kit — shadcn-style building blocks shared by every popup
 * view, reimplemented on the extension's shadcn/ui Zinc design tokens
 * (src/styles/tokens.css). Surfaces use bg-background / bg-card / bg-muted,
 * text uses text-foreground / text-muted-foreground, and the single brand
 * accent is AlgoVault orange (bg-brand-500, text-brand-foreground).
 *
 * Conventions (shadcn/ui): variant-driven components composed with `cn`,
 * `rounded-lg` controls / `rounded-xl` cards / `rounded-full` pills,
 * `border-border` outlines, `focus-visible:ring-2 ring-ring` focus states,
 * and no decorative animation — state changes use plain color transitions
 * only. Trading semantics are single-meaning tokens: positive (bullish /
 * success), negative (bearish / error), warning (caution).
 */
import React from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, ExternalLink, Loader2, Minus, Plus, Radio, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";

import { Alert as BaseAlert } from "@/components/ui/alert";
import { Button as BaseButton } from "@/components/ui/button";
import { Card as BaseCard } from "@/components/ui/card";
import { Input as BaseInput } from "@/components/ui/input";
import { Separator as BaseSeparator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/* ── semantic direction styling ──────────────────────────────────────── */

export type Direction = "bullish" | "bearish" | "neutral";

export const dirClasses: Record<Direction, string> = {
  bullish: "text-positive",
  bearish: "text-negative",
  neutral: "text-muted-foreground",
};

export const dirBgClasses: Record<Direction, string> = {
  bullish: "bg-positive/10 text-positive",
  bearish: "bg-negative/10 text-negative",
  neutral: "bg-muted text-muted-foreground",
};

export function asDirection(v: string | null | undefined): Direction {
  return v === "bullish" || v === "long" || v === "BUY"
    ? "bullish"
    : v === "bearish" || v === "short" || v === "SELL"
    ? "bearish"
    : "neutral";
}

/* ── badges & cards ──────────────────────────────────────────────────── */

export function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground",
        className
      )}
    >
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card text-foreground", className)}>{children}</div>
  );
}

/* ── status dot ──────────────────────────────────────────────────────── */

export function StatusDot({ state }: { state: "ok" | "warn" | "off" }) {
  const color = state === "ok" ? "bg-positive" : state === "warn" ? "bg-warning" : "bg-muted-foreground/50";
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${color}`} />;
}

/* ── inputs ──────────────────────────────────────────────────────────── */

export const inputClass =
  "w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[10px] text-muted-foreground/70">{hint}</span>}
    </label>
  );
}

/* ── shadcn-style primitives ─────────────────────────────────────────── */

type ButtonVariant = "default" | "brand" | "secondary" | "outline" | "ghost" | "destructive";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const buttonVariants: Record<ButtonVariant, "default" | "brand" | "secondary" | "outline" | "ghost" | "destructive"> = {
  default: "default",
  brand: "brand",
  secondary: "secondary",
  outline: "outline",
  ghost: "ghost",
  destructive: "destructive",
};

const buttonSizes: Record<ButtonSize, "default" | "sm" | "lg" | "icon-sm"> = {
  sm: "sm",
  md: "default",
  lg: "lg",
  icon: "icon-sm",
};

export function Button({
  variant = "default",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <BaseButton
      variant={buttonVariants[variant]}
      size={buttonSizes[size]}
      className={cn("font-semibold", className)}
      {...props}
    />
  );
}

export function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <BaseInput
      className={cn("h-8 rounded-lg px-2.5 py-1 text-xs", className)}
      {...props}
    />
  );
}

export function Label({
  className = "",
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      {...props}
      className={cn("mb-1 block text-[11px] font-medium text-muted-foreground", className)}
    />
  );
}

type AlertVariant = "default" | "success" | "error" | "warning";

const alertVariants: Record<AlertVariant, { icon: React.ReactNode; variant: "default" | "success" | "destructive" | "warning" }> = {
  default: { icon: <AlertCircle size={13} />, variant: "default" },
  success: { icon: <CheckCircle2 size={13} />, variant: "success" },
  error: { icon: <AlertCircle size={13} />, variant: "destructive" },
  warning: { icon: <AlertCircle size={13} />, variant: "warning" },
};

export function Alert({
  variant = "default",
  className = "",
  children,
}: {
  variant?: AlertVariant;
  className?: string;
  children: React.ReactNode;
}) {
  const v = alertVariants[variant];
  return (
    <BaseAlert variant={v.variant} className={cn("py-2 text-[11px] leading-snug", className)}>
      {v.icon}
      <span>{children}</span>
    </BaseAlert>
  );
}

export function Separator({ className = "" }: { className?: string }) {
  return <BaseSeparator className={cn("bg-border", className)} role="separator" />;
}

/* ── full-width action buttons ───────────────────────────────────────── */

export function PrimaryButton({
  children, onClick, disabled, className = "", type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <BaseButton
      type={type}
      variant="brand"
      size="lg"
      onClick={onClick}
      disabled={disabled}
      className={cn("w-full gap-2 text-xs", className)}
    >
      {children}
    </BaseButton>
  );
}

export function GhostButton({
  children, onClick, disabled, className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <BaseButton
      type="button"
      variant="outline"
      size="lg"
      onClick={onClick}
      disabled={disabled}
      className={cn("w-full gap-2 text-xs", className)}
    >
      {children}
    </BaseButton>
  );
}

export function DangerButton({
  children, onClick, disabled, className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <BaseButton
      type="button"
      variant="destructive"
      size="lg"
      onClick={onClick}
      disabled={disabled}
      className={cn("w-full gap-2 text-xs font-bold", className)}
    >
      {children}
    </BaseButton>
  );
}

export function MiniButton({
  children, onClick, disabled, variant = "neutral", className = "", title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "neutral" | "danger" | "success";
  className?: string;
  title?: string;
}) {
  const palette = {
    neutral: "border-border bg-secondary/50 text-muted-foreground hover:bg-muted hover:text-foreground",
    danger: "border-negative/30 bg-negative/10 text-negative hover:bg-negative/20",
    success: "border-positive/30 bg-positive/10 text-positive hover:bg-positive/20",
  }[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex items-center justify-center gap-1 rounded-lg border px-1.5 py-1 text-[10px] font-medium",
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
        "disabled:cursor-not-allowed disabled:opacity-40",
        palette,
        className
      )}
    >
      {children}
    </button>
  );
}

/* ── compact back button ────────────────────────────────────────────── */
/**
 * Compact, sleek "back" button used in popup sub-view footers.
 * Defaults to a clean 32×32 (h-8 w-8) icon button, keeping maximum
 * horizontal space available for action and reset buttons.
 * Pass `iconOnly={false}` to show a text label when desired.
 */
export function BackButton({
  onClick,
  label = "Back",
  iconOnly = true,
  className = "",
}: {
  onClick: () => void;
  label?: string;
  iconOnly?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-input bg-transparent",
        "text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
        iconOnly ? "w-8 px-0" : "px-2.5",
        className
      )}
    >
      <ArrowLeft size={13} className="shrink-0" strokeWidth={2.2} />
      {!iconOnly && <span className="truncate">{label}</span>}
    </button>
  );
}

/* ── confirm action row ─────────────────────────────────────────────── */
/**
 * Inline Keep / Confirm action row for the popup footer.
 * Height is locked to h-8 (32px) to match BackButton and other footer controls.
 * Fully responsive with min-w-0 and truncation on labels to guarantee fit on any panel width.
 */
export function ConfirmActionRow({
  onCancel,
  cancelLabel = "Keep",
  onConfirm,
  confirmLabel,
  confirmIcon,
  destructive,
  className = "",
}: {
  onCancel: () => void;
  cancelLabel?: string;
  onConfirm: () => void;
  confirmLabel: React.ReactNode;
  confirmIcon?: React.ReactNode;
  destructive?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-1 items-center gap-1.5 min-w-0 ${className}`}>
      <button
        type="button"
        onClick={onCancel}
        className="flex h-8 flex-1 min-w-0 items-center justify-center rounded-lg border border-input bg-transparent px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
      >
        <span className="truncate">{cancelLabel}</span>
      </button>
      <button
        type="button"
        onClick={onConfirm}
        className={`flex h-8 flex-[1.2] min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-primary-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 ${
          destructive ? "bg-destructive hover:bg-destructive/90" : "bg-brand-500 hover:bg-brand-600"
        }`}
      >
        {confirmIcon}
        <span className="truncate">{confirmLabel}</span>
      </button>
    </div>
  );
}

/* ── segmented control (order type, sizing mode, theme, …) ──────────── */

export function SegmentedControl<T extends string>({
  value, onChange, options, size = "sm",
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: React.ReactNode; title?: string }>;
  size?: "sm" | "md";
}) {
  const padding = size === "md" ? "py-2 text-xs" : "py-1.5 text-[11px]";
  return (
    <div className="flex w-full gap-1 rounded-lg border border-border bg-muted p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            title={o.title}
            aria-pressed={active}
            className={`flex-1 select-none rounded-md ${padding} font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 ${
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── numeric stepper (lots, risk %, …) ──────────────────────────────── */

export function Stepper({
  value, onChange, step = 0.01, min = 0.01, max, decimals, ariaLabel, className = "",
}: {
  value: number;
  onChange: (next: number) => void;
  step?: number;
  min?: number;
  max?: number;
  decimals?: number;
  ariaLabel?: string;
  className?: string;
}) {
  const dec = decimals ?? Math.max(2, (String(step).split(".")[1]?.length ?? 0));
  const clamp = (n: number) => {
    if (!Number.isFinite(n)) return min;
    const r = Math.round(n / step) * step;
    return Math.max(min, max != null ? Math.min(max, Number(r.toFixed(dec))) : Number(r.toFixed(dec)));
  };
  return (
    <div className={`flex items-stretch overflow-hidden rounded-lg border border-input bg-transparent ${className}`}>
      <button
        type="button"
        aria-label="Decrease"
        onClick={() => onChange(clamp(value - step))}
        disabled={value <= min}
        className="flex w-6 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
      >
        <Minus size={11} />
      </button>
      <input
        type="number"
        aria-label={ariaLabel}
        value={Number.isFinite(value) ? value : ""}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const raw = parseFloat(e.target.value);
          onChange(Number.isFinite(raw) ? clamp(raw) : min);
        }}
        onBlur={(e) => onChange(clamp(parseFloat(e.target.value) || min))}
        className="w-full min-w-0 border-x border-border bg-transparent px-1.5 py-1.5 text-center font-mono text-xs text-foreground outline-none transition-colors focus:bg-muted"
      />
      <button
        type="button"
        aria-label="Increase"
        onClick={() => onChange(clamp(value + step))}
        disabled={max != null && value >= max}
        className="flex w-6 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
      >
        <Plus size={11} />
      </button>
    </div>
  );
}

/* ── tiny stat (Balance / Equity / Open PnL / Return) ────────────────── */

export function StatPill({
  label, value, tone = "neutral", sub,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "neutral" | "bullish" | "bearish";
  sub?: React.ReactNode;
}) {
  const toneCls =
    tone === "bullish" ? "text-positive"
    : tone === "bearish" ? "text-negative"
    : "text-foreground";
  return (
    <div className="text-center">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-mono text-xs font-bold tabular-nums ${toneCls}`}>{value}</div>
      {sub != null && <div className="text-[10px] text-muted-foreground/70">{sub}</div>}
    </div>
  );
}

/* ── mini progress bar (win-rate, exposure, etc.) ────────────────────── */

export function MiniBar({
  pct, tone = "bullish", label,
}: {
  pct: number; // 0..100
  tone?: "bullish" | "bearish" | "neutral" | "brand" | "warning";
  label?: React.ReactNode;
}) {
  const safe = Math.max(0, Math.min(100, pct));
  const color =
    tone === "bullish" ? "bg-positive"
    : tone === "bearish" ? "bg-negative"
    : tone === "brand" ? "bg-brand-500"
    : tone === "warning" ? "bg-warning"
    : "bg-muted-foreground/50";
  return (
    <div>
      {label != null && <div className="mb-0.5 flex items-center justify-between text-[10px] text-muted-foreground">{label}</div>}
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${color}`} style={{ width: `${safe}%` }} />
      </div>
    </div>
  );
}

/* ── loading spinner (used in PrimaryButton) ─────────────────────────── */

export function Spinner({ size = 13 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" />;
}

/* ── feedback banner ─────────────────────────────────────────────────── */

export function Feedback({ kind, msg }: { kind: "success" | "error" | "info"; msg: string }) {
  const map = {
    success: { icon: <CheckCircle2 size={13} />, cls: "border-positive/30 bg-positive/10 text-positive" },
    error: { icon: <AlertCircle size={13} />, cls: "border-negative/30 bg-negative/10 text-negative" },
    info: { icon: <AlertCircle size={13} />, cls: "border-border bg-muted/50 text-muted-foreground" },
  };
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-snug", map[kind].cls)}>
      <span className="mt-0.5 shrink-0">{map[kind].icon}</span>
      <span>{msg}</span>
    </div>
  );
}

/* ── confidence meter ────────────────────────────────────────────────── */

export function ConfidenceMeter({ score, direction }: { score: number; direction: Direction }) {
  // score: -100…+100 → centered bar from the midpoint
  const pct = Math.min(Math.abs(score), 100) / 2; // max 50% from center each side
  const bull = direction === "bullish";
  const barColor = bull ? "bg-positive" : direction === "bearish" ? "bg-negative" : "bg-muted-foreground/50";
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
      <div
        className={`absolute inset-y-0 ${barColor} rounded-full`}
        style={bull ? { left: "50%", width: `${pct}%` } : { right: "50%", width: `${pct}%` }}
      />
    </div>
  );
}

/* ── sparkline (price history) ───────────────────────────────────────── */

export function Sparkline({ data, width = 72, height = 22 }: { data: number[]; width?: number; height?: number }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / range) * (height - 4)).toFixed(1)}`);
  const up = data[data.length - 1] >= data[0];
  return (
    <svg width={width} height={height} className={cn("overflow-visible", up ? "text-positive" : "text-negative")}>
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── direction icon ──────────────────────────────────────────────────── */

export function DirIcon({ d, size = 12 }: { d: Direction; size?: number }) {
  if (d === "bullish") return <TrendingUp size={size} className="text-positive" />;
  if (d === "bearish") return <TrendingDown size={size} className="text-negative" />;
  return <Minus size={size} className="text-muted-foreground" />;
}

/* ── view header (used by sub-views) ─────────────────────────────────── */

export function ViewHeader({ title, sub, right }: { title: string; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-3 py-2">
      <div className="min-w-0">
        <span className="block truncate text-xs font-semibold text-foreground">{title}</span>
        {sub && <span className="block text-[10px] text-muted-foreground">{sub}</span>}
      </div>
      {right && <div className="ml-2 flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}

/* ── chart-sync badge ────────────────────────────────────────────────── */
/**
 * Compact indicator for the popup that tells the trader where the symbol
 * and timeframe came from, how fresh the detection is, and offers a one-tap
 * refresh that re-queries the active TradingView tab through the SW. Used in
 * the Trade Ticket and Demo Trades headers — these panels ride on the same
 * chart context the floating panel benefits from, but the popup can't read
 * the page directly, so the badge surfaces sync liveness explicitly.
 *
 * Renders one of three states:
 *   - `live`     : a heartbeat <15s old, with last-sync age in seconds
 *   - `stale`    : heartbeat between 15s and 60s, or no heartbeat but recent cache
 *   - `offline`  : no TradingView tab detected, or last heartbeat > 60s ago
 *   - `manual`   : symbol was typed in by the user (not auto-detected)
 */
export type ChartSyncState = "live" | "stale" | "offline" | "manual";

export interface ChartSyncBadgeProps {
  state: ChartSyncState;
  symbol: string | null;
  timeframe: string | null;
  ageMs: number | null;
  refreshing?: boolean;
  onRefresh: () => void;
  /** Optional CTA shown when state === "offline" — e.g. "Open TradingView". */
  onOpenChart?: () => void;
  /** Optional handler shown next to the badge when state === "manual". */
  onClearManual?: () => void;
  /** Compact = single row (header use). Default false = full inline. */
  compact?: boolean;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;

function formatAge(ageMs: number): string {
  if (ageMs < 0 || !Number.isFinite(ageMs)) return "—";
  if (ageMs < SECOND) return "now";
  if (ageMs < MINUTE) return `${Math.floor(ageMs / SECOND)}s ago`;
  const mins = Math.floor(ageMs / MINUTE);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

export function ChartSyncBadge({
  state, symbol, timeframe, ageMs, refreshing, onRefresh, onOpenChart, onClearManual, compact,
}: ChartSyncBadgeProps) {
  const stateText =
    state === "live"
      ? "text-positive"
      : state === "stale"
      ? "text-warning"
      : "text-muted-foreground";

  const dot =
    state === "live" ? "bg-positive"
    : state === "stale" ? "bg-warning"
    : state === "manual" ? "bg-muted-foreground"
    : "bg-muted-foreground/50";

  const label =
    state === "live" ? "Live from chart"
    : state === "stale" ? "Stale — refresh"
    : state === "manual" ? "Manual"
    : "No chart detected";

  const subline = state === "offline"
    ? "Open a TradingView chart to auto-detect symbol & timeframe"
    : ageMs != null
    ? `${symbol ?? "—"} · ${timeframe ?? "—"} · ${formatAge(ageMs)}`
    : `${symbol ?? "—"} · ${timeframe ?? "—"}`;

  const chipBtn =
    "rounded-md border border-border bg-secondary/50 px-1.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0";

  if (compact) {
    return (
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        title={subline}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50",
          stateText
        )}
      >
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
        <span className="text-[10px] font-medium">{label}</span>
        <span className="ml-0.5 font-mono text-muted-foreground/70">{symbol ?? "—"}</span>
        <span className="font-mono text-muted-foreground/70">·</span>
        <span className="font-mono text-muted-foreground/70">{timeframe ?? "—"}</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1.5">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
      <div className="min-w-0 flex-1">
        <div className={cn("flex items-center gap-1 text-[10px] font-medium", stateText)}>
          <Radio size={9} />
          <span>{label}</span>
        </div>
        <div className="truncate font-mono text-[10px] tabular-nums text-muted-foreground">{subline}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {state === "manual" && onClearManual && (
          <button type="button" onClick={onClearManual} className={chipBtn} title="Re-attach to the active TradingView chart">
            Re-sync
          </button>
        )}
        {state === "offline" && onOpenChart && (
          <button type="button" onClick={onOpenChart} className={chipBtn} title="Open TradingView">
            <span className="inline-flex items-center gap-1"><ExternalLink size={9} /> Open</span>
          </button>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh chart context"
          title="Re-detect from the active TradingView chart"
          className={chipBtn}
        >
          <span className="inline-flex items-center gap-1">
            <RefreshCw size={9} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing" : "Refresh"}
          </span>
        </button>
      </div>
    </div>
  );
}
