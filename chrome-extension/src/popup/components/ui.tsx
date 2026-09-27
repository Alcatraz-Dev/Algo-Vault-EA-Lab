/**
 * AlgoVault UI kit — small, consistent building blocks shared by every popup
 * view. Surfaces map to the platform palette (base #0f0f0f, card #181818,
 * raised #232323) and the single brand accent is AlgoVault orange #ff4d00.
 */
import React from "react";
import { Loader2, AlertCircle, CheckCircle2, TrendingUp, TrendingDown, Minus } from "lucide-react";

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

export function PrimaryButton({
  children, onClick, disabled, loading, className = "", type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-30 ${className}`}
    >
      {loading && <Loader2 size={13} className="animate-spin" />}
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
      className={`flex w-full items-center justify-center gap-2 rounded-lg border border-edge bg-raised py-2 text-xs font-medium text-ink transition-colors hover:border-neutral-600 hover:bg-[#2a2a2a] disabled:cursor-not-allowed disabled:opacity-30 ${className}`}
    >
      {children}
    </button>
  );
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
