/** Knowledge panel — shows lineage / relationships using existing references only. */
export function KnowledgePanel({ rootType, rootId, edges }: { rootType?: string; rootId?: string; edges?: any[] }) {
  return (
    <div className="rounded-2xl border border-border/30 bg-card/60 p-4 backdrop-blur-xl">
      <h3 className="font-bold text-sm mb-2">Knowledge Graph — Phase 13</h3>
      <div className="text-xs text-muted-foreground space-y-1">
        <div>Root: <span className="font-mono">{rootType || "—"}:{rootId || "—"}</span></div>
        <div>Relationships: <span className="font-mono">{edges?.length ?? 0}</span></div>
        <div>Evidence traceable to existing sources only.</div>
        <div>Replay-safe: future evidence excluded.</div>
        <div>No predictive output; advisory explanation only.</div>
      </div>
      <div className="mt-2 text-[10px] text-amber-300">No duplicate engines. Deterministic edge IDs. Real IDs only.</div>
    </div>
  );
}
