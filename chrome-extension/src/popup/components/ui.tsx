/**
 * AlgoVault UI kit — small, consistent building blocks shared by every popup
 * view. Surfaces map to the platform palette (base #0f0f0f, card #181818,
 * raised #232323) and the single brand accent is AlgoVault orange #ff4d00.
 */
import React from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, ExternalLink, Loader2, Minus, Plus, Radio, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";

/* ── semantic direction styling ──────────────────────────────────────── */

export type Direction = "bullish" | "bearish" | "neutral";

export const dirClasses: Record<Direction, string> = {
  bullish: "text-emerald-400",
  bearish: "text-rose-400",
  neutral: "text-neutral-400",
};

export const dirBgClasses: Record<Direction, string> = {
  bullish: "bg-emerald-500/15 text-emerald-400",
  bearish: "bg-rose-500/15 text-rose-400",
  neutral: "bg-white/5 text-neutral-400",
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
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${className}`}>
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-edge bg-card ${className}`}>{children}</div>
  );
}

/* ── status dot ──────────────────────────────────────────────────────── */

export function StatusDot({ state }: { state: "ok" | "warn" | "off" }) {
  const color = state === "ok" ? "bg-emerald-400" : state === "warn" ? "bg-amber-400" : "bg-neutral-600";
  const glow = state === "ok" ? "shadow-[0_0_6px_rgba(52,211,153,0.7)]" : state === "warn" ? "shadow-[0_0_6px_rgba(251,191,36,0.6)]" : "";
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${color} ${glow} ${state !== "off" ? "animate-pulse-dot" : ""}`} />;
}

/* ── inputs ──────────────────────────────────────────────────────────── */

export const inputClass =
  "w-full rounded border border-edge bg-raised px-2.5 py-1.5 font-mono text-xs text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-brand-500/60";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-ink-mute">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[9px] text-ink-faint">{hint}</span>}
    </label>
  );
}

/* ── buttons ─────────────────────────────────────────────────────────── */
/**
 * Press-scale feedback so every actionable control feels snappy under the
 * thumb. `disabled` and `loading` shortcuts so callers don't repeat the
 * wiring on every confirm / submit.
 */
function pressCls(disabled?: boolean): string {
  return disabled
    ? "cursor-not-allowed opacity-30"
    : "active:scale-[0.97] active:brightness-90 transition-all duration-150";
}

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
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-brand-400 ${pressCls(disabled)} ${className}`}
    >
      {children}
    </button>
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
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center justify-center gap-2 rounded-lg border border-edge bg-raised py-2 text-xs font-medium text-ink transition-colors hover:border-neutral-600 hover:bg-[#2a2a2a] ${pressCls(disabled)} ${className}`}
    >
      {children}
    </button>
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
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center justify-center gap-2 rounded-lg bg-rose-600 py-2.5 text-xs font-bold text-white transition-colors hover:bg-rose-500 ${pressCls(disabled)} ${className}`}
    >
      {children}
    </button>
  );
}

export function MiniButton({
  children, onClick, disabled, variant = "neutral", className = "", title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "neutral" | "danger" | "success" | "brand";
  className?: string;
  title?: string;
}) {
  const palette = {
    neutral: "border-edge bg-raised text-ink-mute hover:bg-[#2a2a2a] hover:text-ink",
    danger: "border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20",
    success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20",
    brand: "border-brand-500/30 bg-brand-500/10 text-brand-400 hover:bg-brand-500/20",
  }[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center gap-1 rounded border px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${palette} ${pressCls(disabled)} ${className}`}
    >
      {children}
    </button>
  );
}

/* ── compact back button ────────────────────────────────────────────── */
/**
 * Compact, sleek "back" button used in popup sub-view footers.
 * Defaults to a clean 32×32 (h-8 w-8) icon button with an arrow micro-interaction
 * on hover, keeping maximum horizontal space available for action and reset buttons.
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
      className={`group inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-edge bg-raised/80 ${
        iconOnly ? "w-8 px-0" : "px-2.5"
      } text-[11px] font-medium text-ink-mute transition-all duration-150 hover:border-neutral-500 hover:bg-[#252528] hover:text-ink active:scale-95 shadow-xs ${pressCls(false)} ${className}`}
    >
      <ArrowLeft size={13} className="shrink-0 transition-transform duration-150 group-hover:-translate-x-0.5" strokeWidth={2.2} />
      {!iconOnly && <span className="tracking-wide truncate">{label}</span>}
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
        className={`flex h-8 flex-1 min-w-0 items-center justify-center rounded-lg border border-edge bg-raised/80 px-2 text-xs font-medium text-ink-mute transition-all duration-150 hover:border-neutral-500 hover:bg-[#252528] hover:text-ink active:scale-95 ${pressCls(false)}`}
      >
        <span className="truncate">{cancelLabel}</span>
      </button>
      <button
        type="button"
        onClick={onConfirm}
        className={`flex h-8 flex-[1.2] min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-95 shadow-sm ${pressCls(false)} ${
          destructive ? "bg-rose-600 hover:bg-rose-500 shadow-rose-950/30" : "bg-brand-500 hover:bg-brand-400"
        }`}
      >
        {confirmIcon}
        <span className="truncate">{confirmLabel}</span>
      </button>
    </div>
  );
}

/* ── segmented control (order type, sizing mode, …) ─────────────────── */

export function SegmentedControl<T extends string>({
  value, onChange, options, size = "sm",
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: React.ReactNode; title?: string }>;
  size?: "sm" | "md";
}) {
  const padding = size === "md" ? "py-2 text-xs" : "py-1.5 text-[10px]";
  return (
    <div className="flex w-full gap-1 rounded-lg border border-edge bg-base p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            title={o.title}
            className={`flex-1 select-none rounded-md ${padding} font-semibold uppercase tracking-wider transition-all duration-150 ${pressCls(false)} ${
              active
                ? "bg-brand-500/15 text-brand-400 shadow-[inset_0_0_0_1px_rgba(255,77,0,0.3)]"
                : "text-ink-mute hover:bg-raised hover:text-ink"
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
    <div className={`flex items-stretch overflow-hidden rounded border border-edge bg-raised ${className}`}>
      <button
        type="button"
        aria-label="Decrease"
        onClick={() => onChange(clamp(value - step))}
        disabled={value <= min}
        className={`flex w-6 items-center justify-center text-ink-mute hover:bg-[#2a2a2a] hover:text-ink disabled:opacity-30 ${pressCls(value <= min)}`}
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
        className="w-full min-w-0 border-x border-edge bg-transparent px-1.5 py-1.5 text-center font-mono text-xs text-ink outline-none focus:bg-[#2a2a2a]"
      />
      <button
        type="button"
        aria-label="Increase"
        onClick={() => onChange(clamp(value + step))}
        disabled={max != null && value >= max}
        className={`flex w-6 items-center justify-center text-ink-mute hover:bg-[#2a2a2a] hover:text-ink disabled:opacity-30 ${pressCls(max != null && value >= max)}`}
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
    tone === "bullish" ? "text-emerald-400"
    : tone === "bearish" ? "text-rose-400"
    : "text-ink";
  return (
    <div className="text-center">
      <div className="text-[9px] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className={`font-mono text-xs font-bold tabular-nums ${toneCls}`}>{value}</div>
      {sub != null && <div className="text-[8px] text-ink-faint">{sub}</div>}
    </div>
  );
}

/* ── mini progress bar (win-rate, exposure, etc.) ────────────────────── */

export function MiniBar({
  pct, tone = "bullish", label,
}: {
  pct: number; // 0..100
  tone?: "bullish" | "bearish" | "neutral" | "brand";
  label?: React.ReactNode;
}) {
  const safe = Math.max(0, Math.min(100, pct));
  const color =
    tone === "bullish" ? "bg-emerald-400"
    : tone === "bearish" ? "bg-rose-400"
    : tone === "brand" ? "bg-brand-400"
    : "bg-neutral-400";
  return (
    <div>
      {label != null && <div className="mb-0.5 flex items-center justify-between text-[9px] text-ink-faint">{label}</div>}
      <div className="h-1 w-full overflow-hidden rounded-full bg-neutral-800">
        <div className={`h-full ${color} transition-all duration-300`} style={{ width: `${safe}%` }} />
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
    success: { icon: <CheckCircle2 size={13} />, cls: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400" },
    error: { icon: <AlertCircle size={13} />, cls: "border-rose-500/25 bg-rose-500/10 text-rose-400" },
    info: { icon: <AlertCircle size={13} />, cls: "border-amber-500/25 bg-amber-500/10 text-amber-400" },
  };
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-snug ${map[kind].cls}`}>
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
  const barColor = bull ? "bg-emerald-400" : direction === "bearish" ? "bg-rose-400" : "bg-neutral-500";
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
      <div className="absolute inset-y-0 left-1/2 w-px bg-neutral-600" />
      <div
        className={`absolute inset-y-0 ${barColor} rounded-full transition-all duration-500`}
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
  const stroke = up ? "#34d399" : "#fb7185";
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── direction icon ──────────────────────────────────────────────────── */

export function DirIcon({ d, size = 12 }: { d: Direction; size?: number }) {
  if (d === "bullish") return <TrendingUp size={size} className="text-emerald-400" />;
  if (d === "bearish") return <TrendingDown size={size} className="text-rose-400" />;
  return <Minus size={size} className="text-neutral-400" />;
}

/* ── view header (used by sub-views) ─────────────────────────────────── */

export function ViewHeader({ title, sub, right }: { title: string; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-edge px-3 py-2">
      <div className="min-w-0">
        <span className="block truncate text-xs font-semibold text-ink">{title}</span>
        {sub && <span className="block text-[9px] text-ink-faint">{sub}</span>}
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
  const palette =
    state === "live"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
      : state === "stale"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
      : state === "manual"
      ? "border-brand-500/30 bg-brand-500/10 text-brand-400"
      : "border-edge bg-raised text-ink-faint";

  const dot =
    state === "live" ? "bg-emerald-400 animate-pulse-dot"
    : state === "stale" ? "bg-amber-400"
    : state === "manual" ? "bg-brand-400"
    : "bg-neutral-600";

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

  if (compact) {
    return (
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        title={subline}
        className={`flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-mono text-[9px] transition-all duration-150 active:scale-95 ${palette} ${pressCls(refreshing)}`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="font-sans font-semibold uppercase tracking-wider">{label}</span>
        <span className="ml-0.5 font-mono normal-case text-ink-faint">{symbol ?? "—"}</span>
        <span className="font-mono text-ink-faint">·</span>
        <span className="font-mono text-ink-faint">{timeframe ?? "—"}</span>
      </button>
    );
  }

  return (
    <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors duration-150 ${palette}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider">
          <Radio size={9} />
          <span>{label}</span>
        </div>
        <div className="truncate font-mono text-[10px] tabular-nums">{subline}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {state === "manual" && onClearManual && (
          <button
            type="button"
            onClick={onClearManual}
            className={`rounded border border-edge bg-raised px-1.5 py-1 text-[9px] font-semibold uppercase text-ink-mute ${pressCls(false)}`}
            title="Re-attach to the active TradingView chart"
          >
            Re-sync
          </button>
        )}
        {state === "offline" && onOpenChart && (
          <button
            type="button"
            onClick={onOpenChart}
            className={`flex items-center gap-1 rounded border border-edge bg-raised px-1.5 py-1 text-[9px] font-semibold uppercase text-ink-mute ${pressCls(false)}`}
            title="Open TradingView"
          >
            <ExternalLink size={9} /> Open
          </button>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh chart context"
          title="Re-detect from the active TradingView chart"
          className={`flex items-center gap-1 rounded border border-edge bg-raised px-1.5 py-1 text-[9px] font-semibold uppercase text-ink-mute ${pressCls(refreshing)}`}
        >
          <RefreshCw size={9} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Refreshing" : "Refresh"}
        </button>
      </div>
    </div>
  );
}
