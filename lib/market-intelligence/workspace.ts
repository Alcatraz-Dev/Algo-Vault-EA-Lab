import { ChartWorkspaceState, Timeframe } from "../types";

const STORAGE_KEY = "av-market-intelligence-workspace";

export function loadWorkspaceState(): Partial<ChartWorkspaceState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore parse errors
  }
  return {};
}

export function saveWorkspaceState(state: Partial<ChartWorkspaceState>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}
