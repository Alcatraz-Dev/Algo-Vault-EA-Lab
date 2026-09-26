/**
 * Workspace Context — Phase 7.3 cross-page integration adapter.
 * Extends lib/market-intelligence/workspace.ts (ChartWorkspaceState) with
 * backtest/research/replay/event/trade continuity fields.
 * No second workspace engine; uses existing load/save + URL-safe encode.
 */
import { loadWorkspaceState, saveWorkspaceState } from "../../../lib/market-intelligence/workspace";

export interface WorkspaceContext {
  symbol?: string;
  timeframe?: string;
  datasetId?: string;
  dateRange?: { start?: string; end?: string };
  strategyId?: string;
  strategyVersion?: string;
  backtestId?: string;
  researchRunId?: string;
  selectedTradeId?: string;
  selectedEventId?: string;
  selectedTimestamp?: number;
  replayPosition?: number;
  analysisMode?: "analysis" | "backtest" | "research" | "studio";
  sourcePage?: string;
}

const ALLOWED_KEYS = new Set([
  "symbol","timeframe","datasetId","dateRange","strategyId","strategyVersion",
  "backtestId","researchRunId","selectedTradeId","selectedEventId","selectedTimestamp",
  "replayPosition","analysisMode","sourcePage",
]);

export function isValidSymbol(s?: string): boolean {
  return typeof s === "string" && /^[A-Z][A-Z0-9]*$/.test(s) && s.length <= 10;
}

export function isValidTimeframe(s?: string): boolean {
  return typeof s === "string" && /^(M1|M3|M5|M15|M30|H1|H4|D1|W1)$/.test(s);
}

export function validateContext(ctx: Partial<WorkspaceContext>): Partial<WorkspaceContext> {
  const v: Partial<WorkspaceContext> = {};
  if (ctx.symbol && isValidSymbol(ctx.symbol)) v.symbol = ctx.symbol;
  if (ctx.timeframe && isValidTimeframe(ctx.timeframe)) v.timeframe = ctx.timeframe;
  if (ctx.datasetId && typeof ctx.datasetId === "string" && ctx.datasetId.length <= 64) v.datasetId = ctx.datasetId;
  if (ctx.dateRange && typeof ctx.dateRange === "object" && !Array.isArray(ctx.dateRange)) {
    const d = ctx.dateRange;
    if (d.start && typeof d.start === "string" && d.end && typeof d.end === "string") v.dateRange = { start: d.start, end: d.end };
  }
  if (ctx.strategyId && typeof ctx.strategyId === "string" && ctx.strategyId.length <= 64) v.strategyId = ctx.strategyId;
  if (ctx.strategyVersion && typeof ctx.strategyVersion === "string" && ctx.strategyVersion.length <= 32) v.strategyVersion = ctx.strategyVersion;
  if (ctx.backtestId && typeof ctx.backtestId === "string" && /^[A-Za-z0-9_-]+$/.test(ctx.backtestId)) v.backtestId = ctx.backtestId;
  if (ctx.researchRunId && typeof ctx.researchRunId === "string" && /^[A-Za-z0-9_-]+$/.test(ctx.researchRunId)) v.researchRunId = ctx.researchRunId;
  if (ctx.selectedTradeId && typeof ctx.selectedTradeId === "string" && /^[A-Za-z0-9_-]+$/.test(ctx.selectedTradeId)) v.selectedTradeId = ctx.selectedTradeId;
  if (ctx.selectedEventId && typeof ctx.selectedEventId === "string" && /^[A-Za-z0-9_-]+$/.test(ctx.selectedEventId)) v.selectedEventId = ctx.selectedEventId;
  if (typeof ctx.selectedTimestamp === "number" && Number.isFinite(ctx.selectedTimestamp) && ctx.selectedTimestamp > 0) v.selectedTimestamp = ctx.selectedTimestamp;
  if (typeof ctx.replayPosition === "number" && Number.isFinite(ctx.replayPosition) && ctx.replayPosition >= 0) v.replayPosition = ctx.replayPosition;
  if (ctx.analysisMode && ["analysis","backtest","research","studio"].includes(ctx.analysisMode)) v.analysisMode = ctx.analysisMode as WorkspaceContext["analysisMode"];
  if (ctx.sourcePage && typeof ctx.sourcePage === "string" && ctx.sourcePage.length <= 40) v.sourcePage = ctx.sourcePage;
  return v;
}

export function encodeContext(ctx: Partial<WorkspaceContext>): string {
  const safe: Record<string, unknown> = {};
  for (const k of Object.keys(ctx)) {
    if (!ALLOWED_KEYS.has(k)) continue;
    const key = k as keyof WorkspaceContext;
    const val = ctx[key];
    if (val === undefined || val === null) continue;
    if (typeof val === "object" && val !== null && !(val instanceof Date)) {
      safe[key] = val;
    } else if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
      safe[key] = val;
    }
  }
  return encodeURIComponent(JSON.stringify(safe));
}

export function decodeContext(raw: string): Partial<WorkspaceContext> {
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return validateContext(parsed);
    }
  } catch {
    // safe fallback
  }
  return {};
}

export function saveWorkspaceContext(ctx: Partial<WorkspaceContext>) {
  const chart = loadWorkspaceState();
  const merged = { ...chart, ...ctx };
  saveWorkspaceState(merged as Partial<import("../../../lib/market-intelligence/types").ChartWorkspaceState>);
}

export function loadWorkspaceContext(): Partial<WorkspaceContext> {
  const chart = loadWorkspaceState();
  const ctx: Partial<WorkspaceContext> = {};
  if (chart.symbol) ctx.symbol = chart.symbol;
  if (chart.timeframe) ctx.timeframe = chart.timeframe;
  // extendable: if chart persisted extra fields (via saveWorkspaceContext), they survive
  return ctx;
}
