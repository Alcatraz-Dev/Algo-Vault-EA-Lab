/** Watchlist adapter — compact market list. Only shows existing available info. */
export interface WatchItem { symbol?: string; timeframe?: string; dataStatus?: string; recentEvent?: string; setupActive?: boolean; }
export function Watchlist({ items }: { items: WatchItem[] }) {
  return (
    <div className="rounded-xl border border-border/20 bg-card/20 p-4">
      <h3 className="font-bold text-xs mb-2">Watchlist</h3>
      <table className="w-full text-[10px] text-left border-collapse">
        <thead className="text-[9px] uppercase tracking-wider text-muted-foreground border-b border-border/20">
          <tr><th>Symbol</th><th>TF</th><th>Status</th><th>Events</th><th>Setup</th></tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {items.map((w) => (
            <tr key={w.symbol || Math.random()}>
              <td>{w.symbol || "—"}</td>
              <td>{w.timeframe || "—"}</td>
              <td className="font-mono">{w.dataStatus || "—"}</td>
              <td>{w.recentEvent || "—"}</td>
              <td>{w.setupActive ? "Active" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
