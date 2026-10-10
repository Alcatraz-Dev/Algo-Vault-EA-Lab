/**
 * Evidence Panel — Phase 8 reference component.
 * Uses real engine IDs from workspace/backtest/research only.
 * No fabricated references.
 */
export interface EvidenceItem {
  label: string;
  id?: string;
  timestamp?: number;
  reference?: string;
}

export function EvidencePanel({ items }: { items: EvidenceItem[] }) {
  return (
    <div className="rounded-lg border border-border/30 bg-card p-4">
      <h3 className="font-bold text-xs mb-2">Evidence Chain</h3>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">No evidence loaded.</div>
      ) : (
        <ul className="text-xs space-y-1 text-muted-foreground">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2">
              <span className="font-numeric">{it.id || it.reference || it.label}</span>
              <span>—</span>
              <span>{it.label}</span>
              {it.timestamp && <span className="ml-auto text-micro">t={it.timestamp}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
