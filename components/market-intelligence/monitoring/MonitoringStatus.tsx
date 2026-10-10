/** Monitoring status — shows mode and connection. */
export function MonitoringStatus({ mode, dataStatus }: { mode?: string; dataStatus?: string }) {
  return (
    <div className="rounded-md border border-border/20 bg-muted/20 p-2 text-micro flex gap-3 items-center">
      <span className="font-black">MONITOR</span>
      <span>Mode: <span className="font-numeric">{mode || "—"}</span></span>
      <span>Data: <span className="font-numeric">{dataStatus || "—"}</span></span>
      <span className="ml-auto text-warning">Live monitoring uses existing data/analysis only.</span>
    </div>
  );
}
