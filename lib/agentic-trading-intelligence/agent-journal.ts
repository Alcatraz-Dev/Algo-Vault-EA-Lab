/** AlgoVault Agentic Trading Intelligence — Agent Journal Integration (Phase 14 §52)

 * After meaningful agent tasks: Agent Run → Result → Optional Journal Entry.
 * Do not automatically create excessive journal noise. Only meaningful events
 * should be recorded.
 */

import type { EvidenceReference } from "./contracts";
import type { AgentReport } from "./agent-reporting";

// ─── Journal entry ─────────────────────────────────────────────────────────────
export interface AgentJournalEntry {
  id: string;
  runId: string;
  taskId: string;
  agentId: string;
  report: AgentReport;
  createdAt: number;
}

// ─── Journal integration ───────────────────────────────────────────────────────
export class AgentJournalIntegration {
  constructor(private readonly entries: AgentJournalEntry[] = []) {}

  /** Create a journal entry for a meaningful agent run. */
  create(runId: string, taskId: string, agentId: string, report: AgentReport): AgentJournalEntry {
    const entry: AgentJournalEntry = {
      id: `journal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      runId,
      taskId,
      agentId,
      report,
      createdAt: Date.now(),
    };
    this.entries.push(entry);
    return entry;
  }

  /** Get entries for a run. */
  forRun(runId: string): AgentJournalEntry[] {
    return this.entries.filter((e) => e.runId === runId);
  }

  /** Get entries for an agent. */
  forAgent(agentId: string): AgentJournalEntry[] {
    return this.entries.filter((e) => e.agentId === agentId);
  }

  /** Check if a report is meaningful enough to journal. */
  static isMeaningful(report: AgentReport): boolean {
    // Only journal if there are observed facts, analysis, or a decision.
    return report.observedFacts.length > 0 || report.analysis.length > 0 || report.decision !== "";
  }
}
