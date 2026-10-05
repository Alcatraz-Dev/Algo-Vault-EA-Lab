/**
 * Intelligence OS — deterministic priority labels and reasons.
 *
 * Used by the UI layer to render "What Matters Now" consistently.
 * This module does NOT compute priority; it only translates the canonical
 * deterministic priority enum into human labels and explanation snippets.
 */

import type { IntelligencePriority } from "./types";

export function getPriorityLabel(p: IntelligencePriority): string {
  return p;
}

export function getPriorityReason(p: IntelligencePriority): string {
  switch (p) {
    case "CRITICAL":
      return "Requires immediate attention — risk, connection or data-freshness issue.";
    case "HIGH":
      return "Active setup, strategy, research or position item warrants review.";
    case "MEDIUM":
      return "Alert, research milestone or pending review.";
    case "LOW":
      return "Discovery or non-critical signal.";
    case "INFO":
      return "Background context.";
  }
}
