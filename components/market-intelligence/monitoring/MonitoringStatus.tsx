/** Monitoring status — shows mode and connection. */
export function MonitoringStatus({ mode, dataStatus }: { mode?: string; dataStatus?: string }) {
  return (
    <div className="rounded-md border border-border/20 bg-muted/20 p-2 text-[10px] flex gap-3 items-center">
      <span className="font-black">MONITOR</span>
      <span>Mode: <span className="font-mono">{mode || "—"}</span></span>
      <span>Data: <span className="font-mono">{dataStatus || "—"}</span></span>
      <span className="ml-auto text-amber-300">Live monitoring uses existing data/analysis only.</span>
    </div>
  );
}
