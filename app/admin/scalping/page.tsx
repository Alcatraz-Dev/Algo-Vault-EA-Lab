"use client";
import AdminShell from "@/components/admin/AdminShell";
import ScalpingTerminal from "@/components/live/ScalpingTerminal";

export default function AdminScalpingPage() {
  return (
    <AdminShell title="Scalping Terminal" subtitle="Pro-level scalping intelligence">
      <div className="space-y-6">
        <ScalpingTerminal pro />
        <div className="rounded-2xl border border-border bg-card/60 p-6">
          <h2 className="text-lg font-extrabold tracking-tight text-foreground mb-3">Admin Scalping Signals</h2>
          <p className="text-sm text-muted-foreground">Full scalping intelligence with smart-money tracking, AI signals, and aggregated executions.</p>
        </div>
      </div>
    </AdminShell>
  );
}
