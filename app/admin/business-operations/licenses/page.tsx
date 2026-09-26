"use client";

import AdminShell from "@/components/admin/AdminShell";
import Link from "next/link";

export default function BusinessOperationsLicensesPage() {
  return (
    <AdminShell title="Licenses" subtitle="Business operations — licensing authorization layer">
      <div className="rounded-xl border bg-card p-6 shadow-sm mb-6">
        <h3 className="font-semibold mb-4">Licenses</h3>
        <p className="text-sm text-muted-foreground mb-4">Existing Licensing Service remains authoritative. Business Events observe activation only.</p>
        <div className="text-xs text-muted-foreground">Status: license.activated emitted from licensing service; authorization never delegated to events.</div>
      </div>
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h4 className="font-medium mb-2">License Events</h4>
        <div className="space-y-2 text-sm text-muted-foreground">
          <div>license.activated — emitted after successful licensing activation</div>
          <div>license.created — not separate (internal to activation)</div>
          <div>license.expired / revoked — documented; emit when existing expiration/revocation occurs</div>
        </div>
      </div>
    </AdminShell>
  );
}
