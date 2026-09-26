"use client";

import AdminShell from "@/components/admin/AdminShell";
import Link from "next/link";
import { ArrowRight, Database, Server, ShieldCheck, Activity, RefreshCw, AlertTriangle } from "lucide-react";

export default function BusinessOperationsPage() {
  return (
    <AdminShell title="Business Operations" subtitle="Internal operational visibility — read-only aggregation">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-xs text-muted-foreground">Business Events (Processed)</div>
          <div className="font-semibold">Check /admin/business-events</div>
          <div className="text-xs text-muted-foreground mt-1">Event layer status: Active v1</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-xs text-muted-foreground">ERPNext Adapter</div>
          <div className="font-semibold">Disabled by default</div>
          <div className="text-xs text-muted-foreground mt-1">Enable through deployment config only</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-xs text-muted-foreground">Orders</div>
          <div className="font-semibold">Available via existing admin</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="text-xs text-muted-foreground">Payments</div>
          <div className="font-semibold">Stripe authoritative</div>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-sm mb-6">
        <h3 className="font-semibold mb-4">Operations Navigation</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link href="/admin/orders" className="group block rounded-lg border bg-card hover:border-emerald-400 transition-colors p-4 shadow-sm hover:shadow-md">
            <div className="flex items-center gap-3 mb-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              <span className="font-semibold">Orders</span>
            </div>
            <p className="text-sm text-muted-foreground">Marketplace orders, cancellations, refunds. Source of truth.</p>
          </Link>
          <Link href="/admin/business-events" className="group block rounded-lg border bg-card hover:border-blue-400 transition-colors p-4 shadow-sm hover:shadow-md">
            <div className="flex items-center gap-3 mb-2">
              <Database className="w-5 h-5 text-blue-600" />
              <span className="font-semibold">Business Events</span>
            </div>
            <p className="text-sm text-muted-foreground">Canonical event timeline, retry states, adapter status.</p>
          </Link>
          <Link href="/admin/erpnext" className="group block rounded-lg border bg-card hover:border-amber-400 transition-colors p-4 shadow-sm hover:shadow-md">
            <div className="flex items-center gap-3 mb-2">
              <Server className="w-5 h-5 text-amber-600" />
              <span className="font-semibold">ERPNext</span>
            </div>
            <p className="text-sm text-muted-foreground">Optional business/accounting adapter. Disabled by default.</p>
          </Link>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-sm mb-6">
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

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="font-semibold mb-2">Health & Isolation</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-3 bg-emerald-50 rounded-lg border">
            <div className="text-xs text-muted-foreground">Marketplace/Stripe/Licensing</div>
            <div className="font-semibold text-emerald-700">Isolated</div>
          </div>
          <div className="p-3 bg-blue-50 rounded-lg border">
            <div className="text-xs text-muted-foreground">Business Events</div>
            <div className="font-semibold text-blue-700">Active v1</div>
          </div>
          <div className="p-3 bg-amber-50 rounded-lg border">
            <div className="text-xs text-muted-foreground">ERPNext Adapter</div>
            <div className="font-semibold text-amber-700">Disabled by default</div>
          </div>
        </div>
        <div className="mt-4 text-xs text-muted-foreground">
          ERPNext failure does not break marketplace, trading, AI, licensing, or Stripe flows. The adapter is optional downstream infrastructure.
        </div>
      </div>
    </AdminShell>
  );
}
