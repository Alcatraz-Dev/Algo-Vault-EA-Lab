/** Pattern Explorer — Phase 11. Factual historical patterns only. No predictions. */
export interface PatternRow { key: string; symbol?: string; timeframe?: string; occurrences: number; triggered: number; invalidated: number; firstObserved?: number; lastObserved?: number; dataQualityStatus?: string; }
export function PatternExplorer({ patterns }: { patterns: PatternRow[] }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="font-bold text-sm mb-2">Historical Pattern Discovery (Phase 11)</h3>
      <table className="w-full text-micro text-left border-collapse">
        <thead className="text-micro uppercase tracking-wider text-muted-foreground border-b border-border/20"><tr><th>Pattern</th><th>Symbol</th><th>TF</th><th className="text-right">Observations</th><th className="text-right">Triggered</th><th className="text-right">Invalidated</th><th>First</th><th>Last</th></tr></thead>
        <tbody className="divide-y divide-border/50">
          {patterns.map((p) => (
            <tr key={p.key} className="text-muted-foreground">
              <td className="font-mono">{p.key}</td>
              <td>{p.symbol || "—"}</td>
              <td>{p.timeframe || "—"}</td>
              <td className="text-right font-numeric">{p.occurrences}</td>
              <td className="text-right font-numeric">{p.triggered}</td>
              <td className="text-right font-numeric">{p.invalidated}</td>
              <td>{p.firstObserved ? new Date(p.firstObserved).toISOString().slice(0,10) : "—"}</td>
              <td>{p.lastObserved ? new Date(p.lastObserved).toISOString().slice(0,10) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 text-micro text-warning">Historical observation only. Not predictive. No scores.</div>
    </div>
  );
}
