/** Pattern Explorer — Phase 11. Factual historical patterns only. No predictions. */
export interface PatternRow { key: string; symbol?: string; timeframe?: string; occurrences: number; triggered: number; invalidated: number; firstObserved?: number; lastObserved?: number; dataQualityStatus?: string; }
export function PatternExplorer({ patterns }: { patterns: PatternRow[] }) {
  return (
    <div className="rounded-2xl border border-border/30 bg-card/60 p-4 backdrop-blur-xl">
      <h3 className="font-bold text-sm mb-2">Historical Pattern Discovery (Phase 11)</h3>
      <table className="w-full text-[10px] text-left border-collapse">
        <thead className="text-[9px] uppercase tracking-wider text-muted-foreground border-b border-border/20"><tr><th>Pattern</th><th>Symbol</th><th>TF</th><th>Observations</th><th>Triggered</th><th>Invalidated</th><th>First</th><th>Last</th></tr></thead>
        <tbody className="divide-y divide-white/5">
          {patterns.map((p) => (
            <tr key={p.key} className="text-muted-foreground">
              <td className="font-mono">{p.key}</td>
              <td>{p.symbol || "—"}</td>
              <td>{p.timeframe || "—"}</td>
              <td>{p.occurrences}</td>
              <td>{p.triggered}</td>
              <td>{p.invalidated}</td>
              <td>{p.firstObserved ? new Date(p.firstObserved).toISOString().slice(0,10) : "—"}</td>
              <td>{p.lastObserved ? new Date(p.lastObserved).toISOString().slice(0,10) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 text-[10px] text-amber-300">Historical observation only. Not predictive. No scores.</div>
    </div>
  );
}
