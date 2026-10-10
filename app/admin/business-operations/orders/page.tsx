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
      <div className="rounded-lg border border-border bg-card p-6 mb-6">
        <h3 className="font-semibold mb-4">Orders</h3>
        <p className="text-sm text-muted-foreground mb-4">Marketplace orders from the existing order management system.</p>
        <Link href="/admin/orders" className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80">
          View Full Orders Admin
        </Link>
      </div>
      <div className="rounded-lg border border-border bg-card p-6">
        <h4 className="font-medium mb-2">Recent Order Events</h4>
        <div className="text-xs text-muted-foreground">No business events found in this session. Real events persist in Firebase RTDB.</div>
      </div>
    </AdminShell>
  );
}
