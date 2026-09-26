"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";

export default function ERPNextAdminPanel() {
  const [status, setStatus] = useState({ enabled: false, reachable: false, pendingEvents: 0, failedEvents: 0, lastSyncAt: null as string | null });

  useEffect(() => {
    fetch("/api/admin/erpnext/health")
      .then((r) => r.json())
      .then((data) => setStatus(data))
      .catch(() => setStatus({ enabled: false, reachable: false, pendingEvents: 0, failedEvents: 0, lastSyncAt: null }));
  }, []);

  return (
    <AdminShell title="ERPNext" subtitle="Business operations layer — optional backend sync">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-xs text-muted-foreground">Enabled</div>
          <div className={`font-bold ${status.enabled ? "text-emerald-600" : "text-rose-600"}`}>{status.enabled ? "Yes" : "No"}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-xs text-muted-foreground">Reachable</div>
          <div className={`font-bold ${status.reachable ? "text-emerald-600" : "text-rose-600"}`}>{status.reachable ? "Yes" : "No"}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-xs text-muted-foreground">Pending</div>
          <div className="font-bold text-amber-600">{status.pendingEvents}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-xs text-muted-foreground">Failed</div>
          <div className={`font-bold ${status.failedEvents > 0 ? "text-rose-600" : "text-emerald-600"}`}>{status.failedEvents}</div>
        </div>
      </div>
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="font-semibold mb-2">Status</h3>
        <div className="text-sm text-muted-foreground">Last sync: {status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : "Never"}</div>
        <div className="mt-4 text-xs text-slate-400">ERPNext is invisible business infrastructure. Trading, AI, licensing and Stripe remain authoritative.</div>
      </div>
    </AdminShell>
  );
}
