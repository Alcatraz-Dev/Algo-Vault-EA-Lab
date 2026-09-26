"use client";

import AdminShell from "@/components/admin/AdminShell";
import Link from "next/link";

export default function BusinessOperationsPaymentsPage() {
  return (
    <AdminShell title="Payments" subtitle="Business operations — stripe-authoritative payments">
      <div className="rounded-xl border bg-card p-6 shadow-sm mb-6">
        <h3 className="font-semibold mb-4">Payments</h3>
        <p className="text-sm text-muted-foreground mb-4">Stripe remains the authoritative payment source. Business Events record verified Stripe events only.</p>
        <div className="text-xs text-muted-foreground">Status: Stripe webhook verification preserves authoritative payment truth. No reconstructed PaymentIntents.</div>
      </div>
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h4 className="font-medium mb-2">Verified Events</h4>
        <div className="space-y-2 text-sm text-muted-foreground">
          <div>payment.succeeded — from verified Stripe webhook</div>
          <div>payment.failed — from verified Stripe webhook</div>
          <div>payment.refunded — from verified Stripe webhook</div>
        </div>
      </div>
    </AdminShell>
  );
}
