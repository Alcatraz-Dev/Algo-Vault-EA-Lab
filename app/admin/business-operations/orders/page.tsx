"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import Link from "next/link";

export default function BusinessOperationsOrdersPage() {
  const [events, setEvents] = useState<Array<{ eventId: string; eventType: string; occurredAt: string; entityId: string }>>([]);

  useEffect(() => {
    // Read from Firebase businessEvents (server-side would use /api/admin/business-events)
    // For now, display placeholder with note that real orders admin page exists
    setEvents([]);
  }, []);

  return (
    <AdminShell title="Orders" subtitle="Business operations — orders overview">
      <div className="rounded-xl border bg-card p-6 shadow-sm mb-6">
        <h3 className="font-semibold mb-4">Orders</h3>
        <p className="text-sm text-muted-foreground mb-4">Marketplace orders from the existing order management system.</p>
        <Link href="/admin/orders" className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          View Full Orders Admin
        </Link>
      </div>
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h4 className="font-medium mb-2">Recent Order Events</h4>
        <div className="text-xs text-muted-foreground">No business events found in this session. Real events persist in Firebase RTDB.</div>
      </div>
    </AdminShell>
  );
}
