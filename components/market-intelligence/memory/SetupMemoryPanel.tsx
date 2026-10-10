/** Setup Memory Panel — Phase 10. Shows factual lifecycle/state history/evidence. */
import type { SetupMemoryRecord } from "../../../lib/market-intelligence/memory/types";

export function SetupMemoryPanel({ record }: { record?: SetupMemoryRecord }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="font-bold text-sm mb-2">Setup Memory (Phase 10)</h3>
      {!record ? (
        <div className="text-xs text-muted-foreground">No setup selected. Memory requires existing deterministic events.</div>
      ) : (
        <div className="text-xs space-y-2 text-muted-foreground">
          <div><strong>Setup</strong> <span className="font-numeric">{record.id || "—"}</span></div>
          <div><strong>Symbol</strong> <span>{record.symbol || "—"}</span></div>
          <div><strong>Timeframe</strong> <span>{record.timeframe || "—"}</span></div>
          <div><strong>Mode</strong> <span className="font-numeric">{record.mode || "—"}</span></div>
          <div><strong>Status</strong> <span className="font-numeric font-medium">{record.status || "—"}</span></div>
          <div><strong>Created</strong> <span className="font-numeric">{record.createdAt ? new Date(record.createdAt).toISOString() : "—"}</span></div>
          <div><strong>Updated</strong> <span className="font-numeric">{record.updatedAt ? new Date(record.updatedAt).toISOString() : "—"}</span></div>
          <div><strong>Matched</strong> <span className="font-numeric">{record.matchedCount || 0}/{record.totalCount || 0}</span></div>
          <div><strong>Evidence Items</strong> <span className="font-numeric">{record.evidenceIds?.length || 0}</span></div>
          <div><strong>State History</strong> <span className="font-numeric">{record.stateHistory?.length || 0}</span> entries</div>
          <div className="text-micro text-warning">No fabricated predictions. No hidden scores.</div>
        </div>
      )}
    </div>
  );
}
