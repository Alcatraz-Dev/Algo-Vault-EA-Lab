/** Active setups adapter. Displays setup evaluation state. */
export interface SetupItem { id?: string; symbol?: string; timeframe?: string; state: string; matched: number; total: number; evidence?: string[]; }
export function ActiveSetups({ setups }: { setups: SetupItem[] }) {
  return (
    <div className="rounded-xl border border-border/20 bg-card/20 p-4">
      <h3 className="font-bold text-xs mb-2">Active Setups</h3>
      {setups.length === 0 ? (
        <div className="text-xs text-muted-foreground">No active setups.</div>
      ) : (
        <ul className="text-xs space-y-1 text-muted-foreground divide-y divide-white/5">
          {setups.map((s) => (
            <li key={s.id || s.symbol} className="flex gap-2 py-0.5">
              <span className="font-mono">{s.id || s.symbol}</span>
              <span>—</span>
              <span>{s.timeframe || "—"}</span>
              <span>—</span>
              <span>{s.state}</span>
              <span className="ml-auto">{s.matched}/{s.total}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
