"use client";

import AdminShell from "@/components/admin/AdminShell";
import Link from "next/link";
import { ArrowRight, Database, Server, ShieldCheck, Activity, RefreshCw, AlertTriangle } from "lucide-react";

export default function BusinessOperationsPage() {
  return (
    <AdminShell title="Business Operations" subtitle="Internal operational visibility — read-only aggregation">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Business Events (Processed)</div>
          <div className="font-semibold">Check /admin/business-events</div>
          <div className="text-xs text-muted-foreground mt-1">Event layer status: Active v1</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">ERPNext Adapter</div>
          <div className="font-semibold">Disabled by default</div>
          <div className="text-xs text-muted-foreground mt-1">Enable through deployment config only</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Orders</div>
          <div className="font-semibold">Available via existing admin</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Payments</div>
          <div className="font-semibold">Stripe authoritative</div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 mb-6">
        <h3 className="font-semibold mb-4">Operations Navigation</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link href="/admin/orders" className="group block rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50">
            <div className="flex items-center gap-3 mb-2">
              <ShieldCheck className="w-5 h-5 text-muted-foreground" />
              <span className="font-semibold">Orders</span>
            </div>
            <p className="text-sm text-muted-foreground">Marketplace orders, cancellations, refunds. Source of truth.</p>
          </Link>
          <Link href="/admin/business-events" className="group block rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50">
            <div className="flex items-center gap-3 mb-2">
              <Database className="w-5 h-5 text-muted-foreground" />
              <span className="font-semibold">Business Events</span>
            </div>
            <p className="text-sm text-muted-foreground">Canonical event timeline, retry states, adapter status.</p>
          </Link>
          <Link href="/admin/erpnext" className="group block rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50">
            <div className="flex items-center gap-3 mb-2">
              <Server className="w-5 h-5 text-muted-foreground" />
              <span className="font-semibold">ERPNext</span>
            </div>
            <p className="text-sm text-muted-foreground">Optional business/accounting adapter. Disabled by default.</p>
          </Link>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 mb-6">
        <h3 className="font-semibold mb-2">Source of Truth</h3>
        <ul className="text-sm text-muted-foreground space-y-1">
          <li>Firebase Auth → Authentication (authoritative)</li>
          <li>Stripe → Payment transaction truth (authoritative)</li>
          <li>Firebase RTDB → Application/realtime state (authoritative)</li>
          <li>AlgoVault Licensing Service → License authorization (authoritative)</li>
          <li>Business Events → Integration/event history (not a second truth source)</li>
          <li>ERPNext → Optional business/accounting backend (not authoritative for trading/AI)</li>
        </ul>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <h3 className="font-semibold mb-2">Health & Isolation</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-3 bg-positive-muted rounded-lg border border-positive/30">
            <div className="text-xs text-muted-foreground">Marketplace/Stripe/Licensing</div>
            <div className="font-semibold text-positive-foreground">Isolated</div>
          </div>
          <div className="p-3 bg-info-muted rounded-lg border border-info/30">
            <div className="text-xs text-muted-foreground">Business Events</div>
            <div className="font-semibold text-info-foreground">Active v1</div>
          </div>
          <div className="p-3 bg-warning-muted rounded-lg border border-warning/30">
            <div className="text-xs text-muted-foreground">ERPNext Adapter</div>
            <div className="font-semibold text-warning-foreground">Disabled by default</div>
          </div>
        </div>
        <div className="mt-4 text-xs text-muted-foreground">
          ERPNext failure does not break marketplace, trading, AI, licensing, or Stripe flows. The adapter is optional downstream infrastructure.
        </div>
      </div>
    </AdminShell>
  );
}
