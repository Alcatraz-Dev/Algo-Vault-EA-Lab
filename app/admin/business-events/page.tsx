"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Database, RefreshCw, Clock, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

export default function BusinessEventsAdmin() {
  const [status, setStatus] = useState({ enabled: true, pendingEvents: 0, failedEvents: 0, lastSyncAt: null as string | null });

  useEffect(() => {
    fetch("/api/admin/erpnext/health")
      .then((r) => r.json())
      .then((data) => setStatus({ enabled: data.enabled ?? true, pendingEvents: data.pendingEvents ?? 0, failedEvents: data.failedEvents ?? 0, lastSyncAt: data.lastSyncAt ?? null }))
      .catch(() => setStatus({ enabled: true, pendingEvents: 0, failedEvents: 0, lastSyncAt: null }));
  }, []);

  return (
    <AdminShell title="Business Events" subtitle="Canonical event layer — provider-agnostic">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-xs text-muted-foreground">Layer Status</div>
          <div className="font-semibold text-emerald-600">Active</div>
          <div className="text-xs text-muted-foreground mt-1">Version 1</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-xs text-muted-foreground">Pending Events</div>
          <div className="font-semibold">{status.pendingEvents}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-xs text-muted-foreground">Failed Events</div>
          <div className={`font-semibold ${status.failedEvents > 0 ? "text-rose-600" : "text-emerald-600"}`}>{status.failedEvents}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-xs text-muted-foreground">Last Sync</div>
          <div className="font-semibold">{status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : "—"}</div>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="font-semibold mb-2">Event Types</h3>
        <div className="flex flex-wrap gap-2">
          {["customer.created", "order.paid", "payment.succeeded", "license.activated", "subscription.created", "commission.created"].map((t) => (
            <span key={t} className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">{t}</span>
          ))}
        </div>
        <div className="mt-4 text-sm text-muted-foreground">
          Events are persistent in Firebase RTDB. Stripe and Licensing remain authoritative. ERPNext is optional downstream.
        </div>
      </div>
    </AdminShell>
  );
}
