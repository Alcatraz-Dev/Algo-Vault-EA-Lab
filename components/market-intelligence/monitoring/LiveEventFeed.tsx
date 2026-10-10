/** Live event feed adapter. Shows normalized existing events. */
export function LiveEventFeed({ events }: { events: any[] }) {
  return (
    <div className="rounded-lg border border-border/30 bg-card p-4">
      <h3 className="font-bold text-xs mb-2">Live Events</h3>
      {events.length === 0 ? (
        <div className="text-xs text-muted-foreground">No events detected.</div>
      ) : (
        <ul className="text-xs space-y-1 text-muted-foreground divide-y divide-border/50">
          {events.slice(-6).map((e, i) => (
            <li key={i} className="flex gap-2 py-0.5">
              <span className="font-numeric">{e.eventId || `e-${i}`}</span>
              <span>—</span>
              <span>{e.eventType || "EVENT"}</span>
              <span className="ml-auto text-micro">t={e.timestamp}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
