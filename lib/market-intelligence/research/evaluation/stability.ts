/**
 * Stability — factual summary from robustness/OOS/MC, not a score.
 */
import { StabilitySummary } from "./types";

export function summarizeStability(oosResults?: any[], robustnessResults?: any[], monteCarlo?: any): StabilitySummary {
  return {
    limitations: ["Stability summary is informational only; no ranking or optimization claim."],
  };
}
